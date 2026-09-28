-- Trend Atlas: one free-plan Supabase Cron job, every five minutes.
-- Run this installer as postgres after the production migration and deployment.
-- It installs the job; it does NOT make an HTTP request during installation.
--
-- INSTALL PARAMETERS (use the Vault Dashboard, not plaintext SQL/history):
--   name: trend_atlas_site_url
--   value: the public HTTPS origin, e.g. https://your-project.vercel.app
--   name: trend_atlas_cron_secret
--   value: the same random 32-512 character CRON_SECRET configured in Vercel
-- Use Vault secret names exactly as above. Do not use Edge Function secrets.
-- Editing those two Vault entries rotates configuration without changing jobs.
--
-- PREREQUISITES: enable pg_cron, pg_net, and supabase_vault in the Dashboard.
-- Equivalent extension-only SQL (run separately BEFORE adding Vault values):
--   create extension if not exists pg_cron with schema pg_catalog;
--   create extension if not exists pg_net with schema extensions;
--   create extension if not exists supabase_vault with schema vault;
-- Leave private/vault/net/cron out of the Data API exposed schemas.
--
-- Official references:
-- https://supabase.com/docs/guides/cron/install
-- https://supabase.com/docs/guides/cron/quickstart
-- https://supabase.com/docs/guides/database/vault
-- https://supabase.com/docs/guides/database/extensions/pg_net

begin;
select pg_advisory_xact_lock(hashtextextended('trend-atlas-collect-installer',0));

do $prerequisites$
begin
  if current_user <> 'postgres' then
    raise exception 'Install Trend Atlas scheduling as the postgres owner.';
  end if;
  if (select count(*) from pg_extension where extname in ('pg_cron','pg_net','supabase_vault')) <> 3
    or to_regprocedure('net.http_post(text,jsonb,jsonb,jsonb,integer)') is null then
    raise exception 'Enable pg_cron, pg_net, and supabase_vault before installing scheduling.';
  end if;
  if to_regprocedure('public.acquire_collection_lease(text,uuid,bigint,bigint)') is null then
    raise exception 'Apply the Trend Atlas production migration before scheduling.';
  end if;
end;
$prerequisites$;

create or replace function private.dispatch_trend_atlas_collection(p_dry_run boolean default false)
returns bigint language plpgsql security definer set search_path='' as $dispatch$
declare
  v_url text;
  v_secret text;
  v_url_count integer;
  v_secret_count integer;
  v_request bigint;
begin
  select count(*) filter(where name='trend_atlas_site_url'),
    count(*) filter(where name='trend_atlas_cron_secret'),
    max(decrypted_secret) filter(where name='trend_atlas_site_url'),
    max(decrypted_secret) filter(where name='trend_atlas_cron_secret')
  into v_url_count,v_secret_count,v_url,v_secret
  from vault.decrypted_secrets where name in ('trend_atlas_site_url','trend_atlas_cron_secret');
  if v_url_count <> 1 or v_secret_count <> 1 or v_url is null or v_secret is null
    or v_url !~ '^https://([a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,63}(:443)?/?$'
    or length(v_url)>2048 or length(v_secret) not between 32 and 512
    or v_secret<>btrim(v_secret) or v_secret collate "C" !~ '^[!-~]+$' then
    raise exception 'Trend Atlas Vault configuration is missing or invalid.';
  end if;
  if p_dry_run is true then return 0; end if;

  -- Preserve only this application's seven-day Cron history, without a second job.
  delete from cron.job_run_details where jobid in (
    select jobid from cron.job where jobname='trend-atlas-collect' and username=current_user
  ) and coalesce(end_time,start_time)<clock_timestamp()-interval '7 days';

  -- pg_net dispatches only after commit. Headers remain briefly in its unlogged
  -- queue, restricted to trusted DB roles; they are never placed in job commands.
  select net.http_post(
    url:=rtrim(v_url,'/')||'/api/cron',
    body:='{}'::jsonb,
    params:='{}'::jsonb,
    headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||v_secret),
    timeout_milliseconds:=65000
  ) into v_request;
  if v_request is null or v_request<=0 then raise exception 'Scheduled HTTP request was not queued.'; end if;
  return v_request;
exception when others then
  -- Never echo SQLERRM, the decrypted secret, headers, or an upstream URL/error.
  raise exception 'Trend Atlas scheduled dispatch failed; check configuration and service health.' using errcode='P0001';
end;
$dispatch$;
revoke all on function private.dispatch_trend_atlas_collection(boolean) from public,anon,authenticated,service_role;
revoke all on vault.secrets,vault.decrypted_secrets,net.http_request_queue from public,anon,authenticated;

-- Validate before changing the job. Any missing/invalid value aborts the installer
-- transaction and leaves an existing installed job unchanged.
select private.dispatch_trend_atlas_collection(true);
select cron.schedule('trend-atlas-collect','*/5 * * * *','select private.dispatch_trend_atlas_collection();');
-- cron.schedule upserts a name for the current owner. Explicitly reactivate a
-- previously paused job when the installer is rerun.
select cron.alter_job(job_id:=jobid,active:=true) from cron.job
  where jobname='trend-atlas-collect' and username=current_user;
commit;

-- SAFE VERIFICATION (no Vault values or outbound headers):
-- select jobid,jobname,schedule,active from cron.job where jobname='trend-atlas-collect';
-- select status,start_time,end_time from cron.job_run_details
--   where jobid in(select jobid from cron.job where jobname='trend-atlas-collect')
--   order by start_time desc limit 10;
-- A Cron success proves enqueueing only. Verify the HTTP response and fresh
-- collection_runs/source_snapshots as well. pg_net responses expire after 6 hours.
-- After an owner-only manual SELECT private.dispatch_trend_atlas_collection()
-- and COMMIT, inspect its returned request_id with:
-- select id,status_code,timed_out,created from net._http_response where id=<request_id>;
-- Do not print vault.decrypted_secrets or net.http_request_queue.
--
-- STOP (preserves Vault configuration; no error if no job exists):
-- select cron.alter_job(job_id:=jobid,active:=false) from cron.job
--   where jobname='trend-atlas-collect' and username=current_user;
-- This stops future ticks; an already dispatched request can still finish.
--
-- REMOVE ONLY THIS SCHEDULER (as postgres; keeps shared extensions and app data):
-- begin;
-- select pg_advisory_xact_lock(hashtextextended('trend-atlas-collect-installer',0));
-- delete from cron.job_run_details where jobid in(select jobid from cron.job
--   where jobname='trend-atlas-collect' and username=current_user);
-- select cron.unschedule(jobid) from cron.job
--   where jobname='trend-atlas-collect' and username=current_user;
-- drop function if exists private.dispatch_trend_atlas_collection(boolean);
-- commit;
-- Optional, only after confirming these two entries are no longer needed:
-- delete from vault.secrets where name in ('trend_atlas_site_url','trend_atlas_cron_secret');

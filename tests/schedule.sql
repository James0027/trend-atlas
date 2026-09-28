-- TEST STUBS ONLY. Never run this file against Supabase or another real database.
-- scripts/test-schedule.mjs runs these in an isolated PGlite transaction and
-- rolls back every schema, queue row, fake secret, job, and extension marker.
-- The Vault view below uses explicit synthetic fixtures; encryption is NOT tested.
-- No background scheduler or network implementation is loaded.

create schema vault;
create schema net;
create schema cron;
create table vault.secrets (
  id uuid primary key default gen_random_uuid(),
  name text unique,
  decrypted_secret text
);
create view vault.decrypted_secrets as select * from vault.secrets;
create table net.http_request_queue (
  id bigint generated always as identity,
  method text,
  url text,
  body jsonb,
  params jsonb,
  headers jsonb,
  timeout_milliseconds integer
);
-- Start permissive so installer revocations are meaningfully tested.
grant all on vault.secrets,vault.decrypted_secrets,net.http_request_queue to public,anon,authenticated;

create function net.http_post(
  url text,body jsonb default '{}',params jsonb default '{}',
  headers jsonb default '{}',timeout_milliseconds integer default 2000
) returns bigint language plpgsql set search_path='' as $$
declare v_id bigint;
begin
  insert into net.http_request_queue(method,url,body,params,headers,timeout_milliseconds)
  values('POST',url,body,params,headers,timeout_milliseconds) returning id into v_id;
  return v_id;
end;
$$;
create table cron.job (
  jobid bigint generated always as identity primary key,
  jobname text,
  schedule text,
  command text,
  username text,
  active boolean default true,
  unique(jobname,username)
);
create table cron.job_run_details (
  jobid bigint,status text,start_time timestamptz,end_time timestamptz
);
create function cron.schedule(p_name text,p_schedule text,p_command text)
returns bigint language plpgsql as $$
declare v_id bigint;
begin
  insert into cron.job(jobname,schedule,command,username) values(p_name,p_schedule,p_command,current_user)
  on conflict(jobname,username) do update set schedule=excluded.schedule,command=excluded.command returning jobid into v_id;
  return v_id;
end;
$$;
create function cron.alter_job(job_id bigint,active boolean default null)
returns void language plpgsql as $$
begin
  update cron.job set active=alter_job.active where jobid=job_id;
end;
$$;
create function cron.unschedule(p_jobid bigint)
returns boolean language plpgsql as $$
begin
  delete from cron.job where jobid=p_jobid;
  return found;
end;
$$;

-- Simulate installed-extension metadata for the installer's prerequisite check.
-- These catalog markers are fake, transaction-scoped, and explicitly verified
-- absent after rollback. The actual C extensions are not available in PGlite.
insert into pg_extension(oid,extname,extowner,extnamespace,extrelocatable,extversion)
select (row_number() over()+10000000)::integer::oid,e,current_user::regrole,
  'public'::regnamespace,false,'test-stub'
from unnest(array['pg_cron','pg_net','supabase_vault']) e;

-- Execute as postgres against a migrated Supabase database. Entire fixture
-- transaction rolls back, including temporary auth users and public records.
begin;
create function pg_temp.assert(p_condition boolean,p_message text)
returns void language plpgsql as $$begin
  if p_condition is distinct from true then raise exception 'assertion failed: %',p_message; end if;
end;$$;

select pg_temp.assert(not has_table_privilege('anon','public.user_library','SELECT'),'guest cannot read user libraries');
select pg_temp.assert(not has_table_privilege('authenticated','public.user_library','UPDATE'),'direct library writes cannot bypass revision checks');
select pg_temp.assert(not has_function_privilege('anon','public.acquire_collection_lease(text,uuid,bigint,bigint)','EXECUTE'),'anonymous collector denied');
select pg_temp.assert(not has_function_privilege('authenticated','private.acquire_collection_lease(text,uuid,bigint,bigint)','EXECUTE'),'private implementation denied to users');
select pg_temp.assert(not has_function_privilege('service_role','public.save_library(jsonb,bigint)','EXECUTE'),'library RPC requires user identity');
select pg_temp.assert(not exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname in ('save_library','is_admin','acquire_collection_lease','save_source_snapshot','release_collection_lease','consume_api_budget') and p.prosecdef),'no elevated RPC in exposed schema');
select pg_temp.assert(not exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='private' and p.prosecdef and not coalesce(p.proconfig,'{}') @> array['search_path=""']),'definer functions pin empty search path');

insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values
('50000000-0000-4000-8000-000000000001','authenticated','authenticated','trend-atlas-a@invalid.example','',now(),'{}','{}',now(),now()),
('50000000-0000-4000-8000-000000000002','authenticated','authenticated','trend-atlas-b@invalid.example','',now(),'{}','{}',now(),now());
insert into public.admin_users(user_id) values('50000000-0000-4000-8000-000000000001');

set local role anon;
do $$begin
  begin perform public.acquire_collection_lease('feed','60000000-0000-4000-8000-000000000001',floor(extract(epoch from clock_timestamp())*1000)::bigint,60000);
    raise exception 'anonymous collector unexpectedly succeeded'; exception when insufficient_privilege then null; end;
  begin perform public.save_library('{"bookmarks":[],"views":[],"overrides":{}}',0);
    raise exception 'anonymous library save unexpectedly succeeded'; exception when insufficient_privilege then null; end;
  begin perform 1 from public.admin_users;
    raise exception 'anonymous admin lookup unexpectedly succeeded'; exception when insufficient_privilege then null; end;
end;$$;
reset role;

set local role service_role;
do $$declare
  v_now bigint:=floor(extract(epoch from clock_timestamp())*1000)::bigint;
  v_owner uuid:='60000000-0000-4000-8000-000000000001';
  v_other uuid:='60000000-0000-4000-8000-000000000002';
  v_payload jsonb;
begin
  perform pg_temp.assert(public.acquire_collection_lease('feed',v_owner,v_now,60000),'first collector acquires lease');
  perform pg_temp.assert(not public.acquire_collection_lease('feed',v_other,v_now,60000),'second collector denied active lease');
  perform pg_temp.assert(not public.release_collection_lease('feed',v_other),'foreign owner cannot release lease');
  v_payload:=jsonb_build_object('items','[]'::jsonb,'status',jsonb_build_object('id','fixture-test','state','error','count',0,
    'fetchedAt',null,'checkedAt',v_now,'nextRefreshAt',v_now+60000,'message','Fixture source unavailable'));
  perform pg_temp.assert(public.save_source_snapshot('fixture-test',v_payload,v_now+60000,v_owner,v_now),'owner snapshot write succeeds');
  perform pg_temp.assert(not public.save_source_snapshot('fixture-test',v_payload,v_now+60000,v_other,v_now),'foreign owner snapshot write fenced');
  update public.collection_leases set expires_at=v_now-1 where key='feed';
  perform pg_temp.assert(not public.save_source_snapshot('fixture-test',v_payload,v_now+60000,v_owner,v_now),'expired owner snapshot write fenced');
  perform pg_temp.assert(public.acquire_collection_lease('feed',v_other,v_now,60000),'expired lease can be taken over');
  perform pg_temp.assert(not public.save_source_snapshot('fixture-test',v_payload,v_now+60000,v_owner,v_now),'previous owner fenced after takeover');
  perform pg_temp.assert(public.release_collection_lease('feed',v_other),'current owner can release');
  begin insert into public.source_snapshots(source_id,payload,next_attempt) values('fixture-secret',v_payload||'{"apiKey":"private"}',v_now+60000);
    raise exception 'secret payload unexpectedly accepted'; exception when check_violation then null; end;
  begin insert into public.source_snapshots(source_id,payload,next_attempt) values('fixture-malformed','{"items":false,"status":{}}',v_now+60000);
    raise exception 'malformed payload unexpectedly accepted'; exception when check_violation then null; end;
  perform pg_temp.assert(public.consume_api_budget('fixture-budget',2,v_now+600000),'first budget consumed');
  perform pg_temp.assert(public.consume_api_budget('fixture-budget',2,v_now+600000),'second budget consumed');
  perform pg_temp.assert(not public.consume_api_budget('fixture-budget',2,v_now+600000),'budget limit enforced');
  perform pg_temp.assert(not public.consume_api_budget('fixture-budget',2,v_now+700000),'expiry cannot be moved to bypass limit');
  update public.api_budgets set expires_at=v_now-1 where bucket='fixture-budget';
  perform pg_temp.assert(public.consume_api_budget('fixture-budget',2,v_now+600000),'expired budget resets');
  insert into public.collection_runs(id,started_at,status) values('70000000-0000-4000-8000-000000000001',clock_timestamp()-interval '8 days','failed');
  perform pg_temp.assert(not exists(select 1 from public.collection_runs where id='70000000-0000-4000-8000-000000000001'),'runs older than seven days trimmed');
  insert into public.collection_runs(status) select 'skipped' from generate_series(1,2001);
  perform pg_temp.assert((select count(*) from public.collection_runs)<=2000,'run count capped to bounded free storage');
end;$$;
reset role;

set local role anon;
select pg_temp.assert(exists(select 1 from public.source_snapshots where source_id='fixture-test'),'anonymous reader sees validated shared snapshot');
reset role;

select set_config('request.jwt.claim.sub','50000000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claims','{"sub":"50000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
set local role authenticated;
do $$declare v_saved public.user_library;begin
  select * into v_saved from public.save_library('{"bookmarks":[],"views":[],"overrides":{}}',0);
  perform pg_temp.assert(v_saved.user_id='50000000-0000-4000-8000-000000000001' and v_saved.revision=1,'initial save assigned to caller at revision one');
  select * into v_saved from public.save_library('{"bookmarks":[],"views":[],"overrides":{"fixture":["ai"]}}',1);
  perform pg_temp.assert(v_saved.revision=2 and v_saved.data->'overrides'='{"fixture":["ai"]}','CAS update increases revision');
  begin perform public.save_library('{"bookmarks":[],"views":[],"overrides":{}}',1);
    raise exception 'stale revision unexpectedly accepted'; exception when serialization_failure then null; end;
  begin perform public.save_library('{"bookmarks":[],"views":[],"overrides":{}}',0);
    raise exception 'duplicate initial save unexpectedly accepted'; exception when serialization_failure then null; end;
  begin perform public.save_library('{"bookmarks":[],"views":[],"overrides":{},"user_id":"50000000-0000-4000-8000-000000000002"}',2);
    raise exception 'unvalidated keys unexpectedly accepted'; exception when invalid_parameter_value then null; end;
  begin perform public.save_library('{"bookmarks":[],"views":[],"overrides":{"fixture":["unknown"]}}',2);
    raise exception 'unknown topics unexpectedly accepted'; exception when invalid_parameter_value then null; end;
  begin perform public.save_library(jsonb_build_object('bookmarks','[]'::jsonb,'views','[]'::jsonb,'overrides',jsonb_build_object(repeat('x',512001),'[]'::jsonb)),2);
    raise exception 'oversized library unexpectedly accepted'; exception when invalid_parameter_value then null; end;
  perform pg_temp.assert(public.is_admin(),'registered admin recognized');
  begin perform public.consume_api_budget('fixture-user-budget',10,floor(extract(epoch from clock_timestamp())*1000)::bigint+600000);
    raise exception 'authenticated user bypassed server budget ownership'; exception when insufficient_privilege then null; end;
  begin update public.user_library set revision=999;
    raise exception 'direct CAS bypass unexpectedly succeeded'; exception when insufficient_privilege then null; end;
  begin insert into public.admin_users(user_id) values('50000000-0000-4000-8000-000000000002');
    raise exception 'admin grant unexpectedly succeeded'; exception when insufficient_privilege then null; end;
end;$$;
reset role;

select set_config('request.jwt.claim.sub','50000000-0000-4000-8000-000000000002',true);
select set_config('request.jwt.claims','{"sub":"50000000-0000-4000-8000-000000000002","role":"authenticated"}',true);
set local role authenticated;
select pg_temp.assert(not public.is_admin(),'ordinary user cannot become admin');
select pg_temp.assert(not exists(select 1 from public.user_library),'second user cannot read first user library');
select pg_temp.assert((select user_id from public.save_library('{"bookmarks":[],"views":[],"overrides":{}}',0))='50000000-0000-4000-8000-000000000002','second user creates only own library');
select pg_temp.assert((select count(*) from public.user_library)=1,'second user only sees own row');
reset role;

select pg_temp.assert((select revision from public.user_library where user_id='50000000-0000-4000-8000-000000000001')=2,'rejected CAS did not overwrite first user');
select 'database behavior assertions passed' as result;
rollback;

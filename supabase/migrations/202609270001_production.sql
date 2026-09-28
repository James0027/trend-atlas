-- Apply as the Supabase postgres owner. Epoch values are milliseconds.
-- Data API wrappers are invokers; elevated implementations are outside the API.
begin;
create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to anon, authenticated, service_role;

create function private.valid_text(p_value jsonb,p_min integer,p_max integer)
returns boolean language sql immutable set search_path='' as $$
  select case when jsonb_typeof(p_value)='string' then length(p_value#>>'{}') between p_min and p_max else false end;
$$;
create function private.valid_number(p_value jsonb,p_min numeric,p_max numeric,p_integer boolean default false)
returns boolean language sql immutable set search_path='' as $$
  select case when jsonb_typeof(p_value)='number' then (p_value::text)::numeric between p_min and p_max
    and (not p_integer or trunc((p_value::text)::numeric)=(p_value::text)::numeric) else false end;
$$;
create function private.only_keys(p_value jsonb,p_allowed text[])
returns boolean language plpgsql immutable set search_path='' as $$
begin
  if jsonb_typeof(p_value) is distinct from 'object' then return false; end if;
  return not exists(select 1 from jsonb_object_keys(p_value) k where not k=any(p_allowed));
end;
$$;
create function private.valid_topics(p_value jsonb)
returns boolean language plpgsql immutable set search_path='' as $$
begin
  if jsonb_typeof(p_value) is distinct from 'array' then return false; end if;
  if jsonb_array_length(p_value)>12 then return false; end if;
  return not exists(select 1 from jsonb_array_elements(p_value) t where not private.valid_text(t,1,20)
    or (t#>>'{}') not in ('ai','automation','technology','finance','beauty','culture','gaming','design','travel','sports','society','health'));
end;
$$;
create function private.valid_item(p_item jsonb,p_source_id text)
returns boolean language plpgsql immutable set search_path='' as $$
declare v_history jsonb;
begin
  if not private.only_keys(p_item,array['id','sourceId','platform','title','url','description','region','topics','rank','metric','publishedAt','fetchedAt','firstSeen','score','previousRank','history','publisher','stale','sampleSize','channel'])
    or not p_item ?& array['id','sourceId','platform','title','url','description','region','topics','rank','fetchedAt','firstSeen','score','history'] then return false; end if;
  if not private.valid_text(p_item->'id',1,199) or not private.valid_text(p_item->'sourceId',1,80)
    or p_item->>'sourceId' is distinct from p_source_id or p_source_id !~ '^[a-z0-9][a-z0-9_-]{0,79}$'
    or not private.valid_text(p_item->'platform',1,80) or not private.valid_text(p_item->'title',1,500)
    or not private.valid_text(p_item->'description',0,650) or not private.valid_text(p_item->'url',8,2048)
    or p_item->>'url' !~* '^https?://[^[:space:]]+$'
    or p_item->>'url' ~* '[?&](api[_-]?key|token|secret|password|authorization)='
    or not private.valid_text(p_item->'region',2,6) or p_item->>'region' not in ('CN','US','JP','KR','EU','IN','GLOBAL')
    or not private.valid_topics(p_item->'topics') or not private.valid_number(p_item->'rank',1,100000,true)
    or not private.valid_number(p_item->'score',0,100)
    or not private.valid_number(p_item->'fetchedAt',946684800000,4102444800000,true)
    or not private.valid_number(p_item->'firstSeen',946684800000,4102444800000,true)
    or jsonb_typeof(p_item->'history') is distinct from 'array' then return false; end if;
  if jsonb_array_length(p_item->'history')>24 then return false; end if;
  for v_history in select value from jsonb_array_elements(p_item->'history') loop
    if not private.only_keys(v_history,array['at','rank']) or not v_history ?& array['at','rank']
      or not private.valid_number(v_history->'at',946684800000,4102444800000,true)
      or not private.valid_number(v_history->'rank',1,100000,true) then return false; end if;
  end loop;
  if p_item ? 'metric' and not private.valid_text(p_item->'metric',0,500) then return false; end if;
  if p_item ? 'publisher' and not private.valid_text(p_item->'publisher',0,250) then return false; end if;
  if p_item ? 'channel' and not private.valid_text(p_item->'channel',0,250) then return false; end if;
  if p_item ? 'stale' and jsonb_typeof(p_item->'stale') is distinct from 'boolean' then return false; end if;
  if p_item ? 'publishedAt' and not private.valid_number(p_item->'publishedAt',946684800000,4102444800000,true) then return false; end if;
  if p_item ? 'previousRank' and not private.valid_number(p_item->'previousRank',1,100000,true) then return false; end if;
  if p_item ? 'sampleSize' and not private.valid_number(p_item->'sampleSize',1,100000,true) then return false; end if;
  return true;
end;
$$;
create function private.valid_source_payload(p_payload jsonb,p_source_id text)
returns boolean language plpgsql immutable set search_path='' as $$
declare v_status jsonb; v_item jsonb;
begin
  if not private.only_keys(p_payload,array['items','status']) or not p_payload ?& array['items','status']
    or octet_length(p_payload::text)>524288 or jsonb_typeof(p_payload->'items') is distinct from 'array' then return false; end if;
  if jsonb_array_length(p_payload->'items')>60 then return false; end if;
  v_status:=p_payload->'status';
  if not private.only_keys(v_status,array['id','state','count','fetchedAt','upstreamUpdatedAt','channel','checkedAt','message','nextRefreshAt'])
    or not v_status ?& array['id','state','count','fetchedAt','checkedAt','message','nextRefreshAt']
    or not private.valid_text(v_status->'id',1,80) or v_status->>'id' is distinct from p_source_id or not private.valid_text(v_status->'state',2,10)
    or v_status->>'state' not in ('ok','cached','error','restricted') or not private.valid_number(v_status->'count',0,60,true)
    or (v_status->>'count')::integer<>jsonb_array_length(p_payload->'items')
    or not private.valid_number(v_status->'checkedAt',946684800000,4102444800000,true)
    or not private.valid_number(v_status->'nextRefreshAt',946684800000,4102444800000,true)
    or not private.valid_text(v_status->'message',0,500) then return false; end if;
  if v_status->'fetchedAt'<>'null'::jsonb and not private.valid_number(v_status->'fetchedAt',946684800000,4102444800000,true) then return false; end if;
  if v_status ? 'upstreamUpdatedAt' and not private.valid_number(v_status->'upstreamUpdatedAt',946684800000,4102444800000,true) then return false; end if;
  if v_status ? 'channel' and not private.valid_text(v_status->'channel',0,250) then return false; end if;
  for v_item in select value from jsonb_array_elements(p_payload->'items') loop
    if not private.valid_item(v_item,p_source_id) then return false; end if;
  end loop;
  return true;
exception when invalid_text_representation or numeric_value_out_of_range then return false;
end;
$$;
create function private.valid_filters(p_filters jsonb)
returns boolean language plpgsql immutable set search_path='' as $$
begin
  if not private.only_keys(p_filters,array['query','region','topics','platforms','sort','time','dedupe'])
    or not p_filters ?& array['query','region','topics','platforms','sort','time','dedupe']
    or not private.valid_text(p_filters->'query',0,200) or not private.valid_text(p_filters->'region',2,6)
    or p_filters->>'region' not in ('all','CN','US','JP','KR','EU','IN','GLOBAL') or not private.valid_topics(p_filters->'topics')
    or jsonb_typeof(p_filters->'platforms') is distinct from 'array' or not private.valid_text(p_filters->'sort',1,10)
    or p_filters->>'sort' not in ('signal','latest','rising') or not private.valid_text(p_filters->'time',1,3)
    or p_filters->>'time' not in ('1','6','24','all') or jsonb_typeof(p_filters->'dedupe') is distinct from 'boolean' then return false; end if;
  return jsonb_array_length(p_filters->'platforms')<=60 and not exists(
    select 1 from jsonb_array_elements(p_filters->'platforms') p where not private.valid_text(p,1,80));
end;
$$;
create function private.valid_library_data(p_data jsonb)
returns boolean language plpgsql immutable set search_path='' as $$
declare v_item jsonb; v_view jsonb; v_override record;
begin
  if not private.only_keys(p_data,array['bookmarks','views','overrides']) or not p_data ?& array['bookmarks','views','overrides']
    or octet_length(p_data::text)>512000 or jsonb_typeof(p_data->'bookmarks') is distinct from 'array'
    or jsonb_typeof(p_data->'views') is distinct from 'array' or jsonb_typeof(p_data->'overrides') is distinct from 'object' then return false; end if;
  if jsonb_array_length(p_data->'bookmarks')>500 or jsonb_array_length(p_data->'views')>30 then return false; end if;
  if (select count(*) from jsonb_object_keys(p_data->'overrides'))>1000 then return false; end if;
  for v_item in select value from jsonb_array_elements(p_data->'bookmarks') loop
    if not private.valid_item(v_item,v_item->>'sourceId') then return false; end if;
  end loop;
  for v_view in select value from jsonb_array_elements(p_data->'views') loop
    if not private.only_keys(v_view,array['id','name','filters']) or not v_view ?& array['id','name','filters']
      or not private.valid_text(v_view->'id',1,199) or not private.valid_text(v_view->'name',1,100)
      or not private.valid_filters(v_view->'filters') then return false; end if;
  end loop;
  for v_override in select key,value from jsonb_each(p_data->'overrides') loop
    if length(v_override.key) not between 1 and 199 or not private.valid_topics(v_override.value) then return false; end if;
  end loop;
  return true;
end;
$$;

create table public.source_snapshots (
  source_id text primary key constraint source_snapshots_id_check check(source_id ~ '^[a-z0-9][a-z0-9_-]{0,79}$'),
  payload jsonb not null constraint source_snapshots_payload_check check(private.valid_source_payload(payload,source_id)),
  next_attempt bigint not null constraint source_snapshots_next_attempt_check check(next_attempt between 946684800000 and 4102444800000),
  updated_at timestamptz not null default now()
);
create table public.collection_leases (
  key text primary key constraint collection_leases_key_check check(length(key) between 1 and 80),owner uuid not null,expires_at bigint not null
);
create table public.api_budgets (
  bucket text primary key constraint api_budgets_bucket_check check(length(bucket) between 1 and 120),
  count integer not null constraint api_budgets_count_check check(count between 1 and 1000000),expires_at bigint not null
);
create table public.collection_runs (
  id uuid primary key default gen_random_uuid(),started_at timestamptz not null default now(),ended_at timestamptz,
  status text not null default 'running' constraint collection_runs_status_check check(status in ('running','succeeded','partial','failed','skipped')),
  summary jsonb not null default '{}'::jsonb constraint collection_runs_summary_check check(jsonb_typeof(summary)='object' and octet_length(summary::text)<=16384),
  constraint collection_runs_time_check check(ended_at is null or ended_at>=started_at)
);
create index collection_runs_started_at_idx on public.collection_runs(started_at);
create table public.user_library (
  user_id uuid primary key references auth.users(id) on delete cascade,
  data jsonb not null default '{"bookmarks":[],"views":[],"overrides":{}}'::jsonb constraint user_library_data_check check(private.valid_library_data(data)),
  revision bigint not null default 1 constraint user_library_revision_check check(revision between 1 and 9007199254740991),updated_at timestamptz not null default now()
);
create table public.admin_users(user_id uuid primary key references auth.users(id) on delete cascade);

alter table public.source_snapshots enable row level security;
alter table public.collection_leases enable row level security;
alter table public.api_budgets enable row level security;
alter table public.collection_runs enable row level security;
alter table public.user_library enable row level security;
alter table public.admin_users enable row level security;
revoke all on public.source_snapshots,public.collection_leases,public.api_budgets,public.collection_runs,public.user_library,public.admin_users from public,anon,authenticated;
grant select on public.source_snapshots to anon,authenticated;
grant select on public.user_library to authenticated;
grant all on public.source_snapshots,public.collection_leases,public.api_budgets,public.collection_runs,public.user_library,public.admin_users to service_role;
create policy public_valid_snapshots on public.source_snapshots for select to anon,authenticated using(private.valid_source_payload(payload,source_id));
create policy user_reads_own_library on public.user_library for select to authenticated using((select auth.uid()) is not null and user_id=(select auth.uid()));

create function private.acquire_collection_lease(p_key text,p_owner uuid,p_now bigint,p_ttl bigint)
returns boolean language plpgsql security definer set search_path='' as $$
declare v_now bigint:=floor(extract(epoch from clock_timestamp())*1000)::bigint;v_changed boolean;
begin
  if p_key is null or length(p_key) not between 1 and 80 or p_owner is null or p_now is null or abs(p_now::numeric-v_now)>300000
    or p_ttl is null or p_ttl not between 1000 and 300000 then raise exception 'invalid_collection_lease' using errcode='22023'; end if;
  insert into public.collection_leases(key,owner,expires_at) values(p_key,p_owner,v_now+p_ttl)
  on conflict(key) do update set owner=excluded.owner,expires_at=excluded.expires_at
    where public.collection_leases.expires_at<=v_now or public.collection_leases.owner=p_owner returning true into v_changed;
  delete from public.api_budgets where expires_at<=v_now;
  delete from public.collection_runs where started_at<clock_timestamp()-interval '7 days';
  return coalesce(v_changed,false);
end;
$$;
create function public.acquire_collection_lease(p_key text,p_owner uuid,p_now bigint,p_ttl bigint)
returns boolean language sql security invoker set search_path='' as $$select private.acquire_collection_lease(p_key,p_owner,p_now,p_ttl);$$;

create function private.save_source_snapshot(p_source_id text,p_payload jsonb,p_next_attempt bigint,p_owner uuid,p_now bigint)
returns boolean language plpgsql security definer set search_path='' as $$
declare v_now bigint:=floor(extract(epoch from clock_timestamp())*1000)::bigint;v_expires bigint;
begin
  if p_now is null or abs(p_now::numeric-v_now)>300000 or p_next_attempt is null or p_next_attempt not between v_now-300000 and v_now+2678400000
    or p_source_id is null or p_source_id !~ '^[a-z0-9][a-z0-9_-]{0,79}$' or not private.valid_source_payload(p_payload,p_source_id)
  then raise exception 'invalid_source_snapshot' using errcode='22023'; end if;
  -- A row lock fences takeover until this write commits. Expiry uses DB time.
  select expires_at into v_expires from public.collection_leases where key='feed' and owner=p_owner for share;
  if not found or v_expires<=floor(extract(epoch from clock_timestamp())*1000)::bigint then return false; end if;
  insert into public.source_snapshots(source_id,payload,next_attempt,updated_at) values(p_source_id,p_payload,p_next_attempt,clock_timestamp())
  on conflict(source_id) do update set payload=excluded.payload,next_attempt=excluded.next_attempt,updated_at=excluded.updated_at;
  if v_expires<=floor(extract(epoch from clock_timestamp())*1000)::bigint then
    raise exception 'collection_lease_expired' using errcode='40001';
  end if;
  return true;
end;
$$;
create function public.save_source_snapshot(p_source_id text,p_payload jsonb,p_next_attempt bigint,p_owner uuid,p_now bigint)
returns boolean language sql security invoker set search_path='' as $$select private.save_source_snapshot(p_source_id,p_payload,p_next_attempt,p_owner,p_now);$$;

create function private.release_collection_lease(p_key text,p_owner uuid)
returns boolean language plpgsql security definer set search_path='' as $$
begin
  delete from public.collection_leases where key=p_key and owner=p_owner;
  return found;
end;
$$;
create function public.release_collection_lease(p_key text,p_owner uuid)
returns boolean language sql security invoker set search_path='' as $$select private.release_collection_lease(p_key,p_owner);$$;

create function private.consume_api_budget(p_bucket text,p_limit integer,p_expires bigint)
returns boolean language plpgsql security definer set search_path='' as $$
declare v_now bigint:=floor(extract(epoch from clock_timestamp())*1000)::bigint;v_changed boolean;
begin
  if p_bucket is null or length(p_bucket) not between 1 and 120 or p_limit is null or p_limit not between 1 and 1000000
    or p_expires is null or p_expires not between v_now+1 and v_now+3456000000 then raise exception 'invalid_api_budget' using errcode='22023'; end if;
  insert into public.api_budgets(bucket,count,expires_at) values(p_bucket,1,p_expires)
  on conflict(bucket) do update set count=case when public.api_budgets.expires_at<=v_now then 1 else public.api_budgets.count+1 end,
    expires_at=case when public.api_budgets.expires_at<=v_now then p_expires else public.api_budgets.expires_at end
    where public.api_budgets.expires_at<=v_now or (public.api_budgets.count<p_limit and public.api_budgets.expires_at=p_expires)
  returning true into v_changed;
  return coalesce(v_changed,false);
end;
$$;
create function public.consume_api_budget(p_bucket text,p_limit integer,p_expires bigint)
returns boolean language sql security invoker set search_path='' as $$select private.consume_api_budget(p_bucket,p_limit,p_expires);$$;

create function private.save_library(p_data jsonb,p_expected_revision bigint)
returns setof public.user_library language plpgsql security definer set search_path='' as $$
declare v_user uuid:=auth.uid();v_result public.user_library;
begin
  if v_user is null then raise exception 'authentication_required' using errcode='42501'; end if;
  if p_expected_revision is null or p_expected_revision not between 0 and 9007199254740990 or not private.valid_library_data(p_data)
    then raise exception 'invalid_library_data' using errcode='22023'; end if;
  if p_expected_revision=0 then
    insert into public.user_library(user_id,data,revision,updated_at) values(v_user,p_data,1,clock_timestamp())
    on conflict(user_id) do nothing returning * into v_result;
  else
    update public.user_library set data=p_data,revision=revision+1,updated_at=clock_timestamp()
    where user_id=v_user and revision=p_expected_revision returning * into v_result;
  end if;
  if not found then raise exception 'library_revision_conflict' using errcode='40001'; end if;
  return next v_result;
end;
$$;
create function public.save_library(p_data jsonb,p_expected_revision bigint)
returns setof public.user_library language sql security invoker set search_path='' as $$select * from private.save_library(p_data,p_expected_revision);$$;
create function private.is_admin()
returns boolean language sql stable security definer set search_path='' as $$
  select auth.uid() is not null and exists(select 1 from public.admin_users where user_id=auth.uid());
$$;
create function public.is_admin()
returns boolean language sql stable security invoker set search_path='' as $$select private.is_admin();$$;

create function private.trim_collection_runs()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  delete from public.collection_runs where started_at<clock_timestamp()-interval '7 days'
    or id in(select id from public.collection_runs order by started_at desc,id desc offset 2000);
  return null;
end;
$$;
create trigger trim_collection_runs after insert on public.collection_runs for each statement execute function private.trim_collection_runs();

-- Explicit grants protect projects that still have permissive default grants.
revoke all on function private.valid_text(jsonb,integer,integer),private.valid_number(jsonb,numeric,numeric,boolean),private.only_keys(jsonb,text[]),private.valid_topics(jsonb),private.valid_item(jsonb,text),private.valid_source_payload(jsonb,text),private.valid_filters(jsonb),private.valid_library_data(jsonb) from public,anon,authenticated,service_role;
grant execute on function private.valid_text(jsonb,integer,integer),private.valid_number(jsonb,numeric,numeric,boolean),private.only_keys(jsonb,text[]),private.valid_topics(jsonb),private.valid_item(jsonb,text),private.valid_source_payload(jsonb,text),private.valid_filters(jsonb),private.valid_library_data(jsonb) to anon,authenticated,service_role;
revoke all on function private.acquire_collection_lease(text,uuid,bigint,bigint),public.acquire_collection_lease(text,uuid,bigint,bigint),private.save_source_snapshot(text,jsonb,bigint,uuid,bigint),public.save_source_snapshot(text,jsonb,bigint,uuid,bigint),private.release_collection_lease(text,uuid),public.release_collection_lease(text,uuid),private.consume_api_budget(text,integer,bigint),public.consume_api_budget(text,integer,bigint) from public,anon,authenticated,service_role;
grant execute on function private.acquire_collection_lease(text,uuid,bigint,bigint),public.acquire_collection_lease(text,uuid,bigint,bigint),private.save_source_snapshot(text,jsonb,bigint,uuid,bigint),public.save_source_snapshot(text,jsonb,bigint,uuid,bigint),private.release_collection_lease(text,uuid),public.release_collection_lease(text,uuid),private.consume_api_budget(text,integer,bigint),public.consume_api_budget(text,integer,bigint) to service_role;
revoke all on function private.save_library(jsonb,bigint),public.save_library(jsonb,bigint),private.is_admin(),public.is_admin() from public,anon,authenticated,service_role;
grant execute on function private.save_library(jsonb,bigint),public.save_library(jsonb,bigint),private.is_admin(),public.is_admin() to authenticated;
revoke all on function private.trim_collection_runs() from public,anon,authenticated,service_role;
comment on table public.source_snapshots is 'Public validated source records only. Never store provider credentials or raw errors.';
comment on table public.user_library is 'Owner-only cloud preferences. Writes require authenticated save_library revision CAS.';
comment on table public.collection_runs is 'Service-only summaries automatically trimmed to seven days and 2000 rows.';
commit;

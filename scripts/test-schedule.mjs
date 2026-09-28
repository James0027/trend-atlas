import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";

// All SQL uses an isolated in-memory PostgreSQL engine. The extensions and HTTP
// dispatch are explicit stubs; this never contacts a website or Supabase Cloud.
const database = new PGlite();
let checks = 0;
let stage = "Supabase role bootstrap";
let transactionOpen = false;
function check(condition, label) {
  stage = label;
  if (condition !== true) throw new Error("Schedule verification assertion failed.");
  checks++;
}
async function value(query) { return (await database.query(query)).rows[0]?.value; }

function transactionBody(sql) {
  // Preserve the exact production statements, putting only its outer transaction
  // under the test's savepoint control so all fixtures can be rolled back.
  // Fail if the template's transaction shape changes instead of rewriting SQL.
  if ([...sql.matchAll(/^begin;\s*$/gim)].length !== 1 || [...sql.matchAll(/^commit;\s*$/gim)].length !== 1) {
    throw new Error("Expected one outer installer transaction.");
  }
  return sql.replace(/^begin;\s*$/im, "").replace(/^commit;\s*$/im, "");
}

async function expectRejection(sql, label, isSafe = () => true) {
  stage = label;
  await database.exec("savepoint expected_failure;");
  let rejected = false;
  let safe = false;
  try { await database.exec(sql); }
  catch (error) { rejected = true; safe = isSafe(error); }
  finally { await database.exec("rollback to savepoint expected_failure; release savepoint expected_failure;"); }
  check(rejected, label);
  check(safe, `${label}: safe error`);
}

try {
  await database.exec(`
    create role anon nologin;
    create role authenticated nologin;
    create role service_role nologin bypassrls;
    create schema auth;
    create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable set search_path='' as $$
      select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid;
    $$;
  `);
  stage = "real production migration";
  await database.exec(await readFile(new URL("../supabase/migrations/202609270001_production.sql", import.meta.url), "utf8"));
  const template = await readFile(new URL("../supabase/schedule.sql", import.meta.url), "utf8");
  const installer = transactionBody(template);
  stage = "transaction-scoped extension stubs";
  await database.exec("begin;");
  transactionOpen = true;
  await database.exec(await readFile(new URL("../tests/schedule.sql", import.meta.url), "utf8"));

  await expectRejection(installer, "missing Vault configuration rejects installation");
  check(await value("select count(*)=0 as value from cron.job"), "missing configuration leaves no job");
  // Deliberately synthetic printable fixtures; these are not usable credentials.
  await database.exec(`insert into vault.secrets(name,decrypted_secret) values
    ('trend_atlas_site_url','https://fixture.vercel.app/'),
    ('trend_atlas_cron_secret','unit-test-placeholder-'||repeat('x',40));`);
  stage = "idempotent installation";
  await database.exec(installer);
  await database.exec(installer);
  check(await value("select count(*)=1 as value from cron.job where jobname='trend-atlas-collect'"), "reinstall keeps one job");
  check(await value("select count(*)=0 as value from net.http_request_queue"), "installation sends no HTTP request");
  check(await value(`select schedule='*/5 * * * *' and active
    and command='select private.dispatch_trend_atlas_collection();' as value
    from cron.job where jobname='trend-atlas-collect'`), "five-minute private function command");
  await database.exec("select cron.alter_job(job_id:=jobid,active:=false) from cron.job where jobname='trend-atlas-collect';");
  check(await value("select not active as value from cron.job where jobname='trend-atlas-collect'"), "stop pauses job");
  await database.exec(installer);
  check(await value("select active as value from cron.job where jobname='trend-atlas-collect'"), "reinstall reactivates job");
  for (const role of ["anon", "authenticated", "service_role"]) {
    check(await value(`select not has_function_privilege('${role}',
      'private.dispatch_trend_atlas_collection(boolean)','EXECUTE') as value`), `${role} cannot invoke secret-bearing dispatcher`);
  }
  for (const role of ["anon", "authenticated"]) {
    check(await value(`select not has_table_privilege('${role}','vault.decrypted_secrets','SELECT')
      and not has_table_privilege('${role}','net.http_request_queue','SELECT') as value`), `${role} cannot read Vault/queue`);
  }
  stage = "rotation and history retention";
  await database.exec(`select cron.schedule('unrelated','0 * * * *','select 1');
    insert into cron.job_run_details(jobid,start_time,end_time,status)
    select jobid,now()-interval '8 days',now()-interval '8 days','succeeded' from cron.job;
    update vault.secrets set decrypted_secret='unit-test-rotated-placeholder-'||repeat('y',40)
    where name='trend_atlas_cron_secret';
    select private.dispatch_trend_atlas_collection();`);
  check(await value(`select method='POST' and url='https://fixture.vercel.app/api/cron'
    and body='{}'::jsonb and params='{}'::jsonb
    and headers->>'Authorization'='Bearer unit-test-rotated-placeholder-'||repeat('y',40)
    and timeout_milliseconds=65000 as value from net.http_request_queue`), "rotated Vault value, endpoint, and finite timeout");
  check(await value(`select count(*)=0 as value from cron.job_run_details
    where jobid in(select jobid from cron.job where jobname='trend-atlas-collect')`), "own old history trimmed");
  check(await value(`select count(*)=1 as value from cron.job_run_details
    where jobid in(select jobid from cron.job where jobname='unrelated')`), "unrelated history preserved");
  check(await value(`select command not like '%placeholder%' and command not like '%https://%' as value
    from cron.job where jobname='trend-atlas-collect'`), "job command contains no URL or credential fixture");

  await database.exec(`update vault.secrets set decrypted_secret='https://fixture.vercel.app/?token=unsafe'
    where name='trend_atlas_site_url';`);
  await expectRejection(installer, "invalid origin rejected", error => !error.message.includes("unsafe"));
  check(await value("select count(*)=1 as value from cron.job where jobname='trend-atlas-collect'"), "failed reinstall preserves existing job");
  check(await value("select count(*)=1 as value from net.http_request_queue"), "failed reinstall sends no request");
  await database.exec(`update vault.secrets set decrypted_secret='https://fixture.vercel.app'
    where name='trend_atlas_site_url';
    update vault.secrets set decrypted_secret=repeat('非',40) where name='trend_atlas_cron_secret';`);
  await expectRejection("select private.dispatch_trend_atlas_collection(true);", "non-ASCII header value rejected", error => !error.message.includes("非"));
  await database.exec(`update vault.secrets set decrypted_secret='unit-test-rotated-placeholder-'||repeat('y',40)
    where name='trend_atlas_cron_secret';
    create or replace function net.http_post(url text,body jsonb default '{}',params jsonb default '{}',
      headers jsonb default '{}',timeout_milliseconds integer default 2000)
    returns bigint language plpgsql as $$begin raise exception 'Synthetic backend header: %',headers->>'Authorization';end;$$;`);
  await expectRejection("select private.dispatch_trend_atlas_collection();", "backend failure redacted", error =>
    error.message.includes("scheduled dispatch failed") && !JSON.stringify(error).includes("unit-test-rotated-placeholder"));

  stage = "documented scheduler removal";
  const removalSection = template.split("-- REMOVE ONLY THIS SCHEDULER")[1]?.split("-- Optional")[0];
  if (!removalSection) throw new Error("Documented removal SQL missing.");
  const removal = removalSection.split(/\r?\n/).slice(1).map(line => line.replace(/^-- /, "")).join("\n");
  await database.exec(transactionBody(removal));
  check(await value("select count(*)=0 as value from cron.job where jobname='trend-atlas-collect'"), "removal deletes owned job");
  check(await value("select count(*)=1 as value from cron.job where jobname='unrelated'"), "removal preserves unrelated job");
  check(await value("select to_regprocedure('private.dispatch_trend_atlas_collection(boolean)') is null as value"), "removal drops dispatcher");
  check(await value("select count(*)=2 as value from vault.secrets"), "removal preserves configuration");

  stage = "fixture rollback";
  await database.exec("rollback;");
  transactionOpen = false;
  check(await value(`select to_regnamespace('vault') is null and to_regnamespace('net') is null
    and to_regnamespace('cron') is null as value`), "all stub schemas and fixture data rolled back");
  check(await value(`select count(*)=0 as value from pg_extension
    where extname in ('pg_cron','pg_net','supabase_vault')`), "fake extension markers rolled back");
  check(await value(`select to_regprocedure('private.dispatch_trend_atlas_collection(boolean)') is null
    and to_regprocedure('public.acquire_collection_lease(text,uuid,bigint,bigint)') is not null as value`), "scheduler rolled back and real production migration preserved");
  check(await value(`select (select count(*) from auth.users)+(select count(*) from public.source_snapshots)
    +(select count(*) from public.collection_leases)+(select count(*) from public.api_budgets)
    +(select count(*) from public.collection_runs)+(select count(*) from public.user_library)
    +(select count(*) from public.admin_users)=0 as value`), "production tables contain no test fixtures");
  console.info(`Schedule SQL checks passed: ${checks}; all fixtures rolled back (isolated PostgreSQL WASM).`);
  console.info("Cron/pg_net/Vault extension APIs mocked; real scheduling, networking, and Vault encryption remain unverified.");
} catch (error) {
  // Do not print headers, SQL text, synthetic secret values, or backend error data.
  console.error(JSON.stringify({ stage, code: error?.code, message: "Schedule SQL verification failed." }));
  process.exitCode = 1;
} finally {
  if (transactionOpen) { try { await database.exec("rollback;"); } catch { /* Disposable in-memory DB. */ } }
  await database.close();
}

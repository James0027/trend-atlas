import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";

// An isolated, in-memory PostgreSQL engine verifies migration behavior without
// Docker, credentials, an external database, or persistent test data.
const database = new PGlite();
let stage = "Supabase role/auth bootstrap";

try {
  await database.exec(`
    create role anon nologin;
    create role authenticated nologin;
    create role service_role nologin bypassrls;
    create schema auth;
    grant usage on schema auth to anon,authenticated,service_role;
    create table auth.users (
      id uuid primary key, aud text, role text, email text,
      encrypted_password text, email_confirmed_at timestamptz,
      raw_app_meta_data jsonb, raw_user_meta_data jsonb,
      created_at timestamptz, updated_at timestamptz
    );
    create function auth.uid() returns uuid language sql stable set search_path = '' as $$
      select coalesce(
        nullif(current_setting('request.jwt.claim.sub',true),''),
        nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub'
      )::uuid;
    $$;
    grant execute on function auth.uid() to anon,authenticated,service_role;
  `);

  stage = "production migration";
  await database.exec(await readFile(new URL("../supabase/migrations/202609270001_production.sql", import.meta.url), "utf8"));

  stage = "SQL permission, lease, budget, retention, and CAS tests";
  const results = await database.exec(await readFile(new URL("../tests/database.sql", import.meta.url), "utf8"));
  if (!results.some(result => result.rows.some(row => row.result === "database behavior assertions passed"))) {
    throw new Error("Database test success marker was not returned.");
  }

  stage = "fixture rollback verification";
  const leftover = await database.query(`
    select (select count(*) from auth.users)
      + (select count(*) from public.source_snapshots)
      + (select count(*) from public.collection_leases)
      + (select count(*) from public.api_budgets)
      + (select count(*) from public.collection_runs)
      + (select count(*) from public.user_library)
      + (select count(*) from public.admin_users) as count;
  `);
  if (Number(leftover.rows[0]?.count) !== 0) throw new Error("Test fixtures were not rolled back.");
  console.info("Database SQL checks passed; all fixtures rolled back (isolated PostgreSQL WASM).");
} catch (error) {
  console.error(JSON.stringify({
    stage,
    message: error instanceof Error ? error.message : "Database verification failed.",
    code: error?.code,
    position: error?.position,
  }));
  process.exitCode = 1;
} finally {
  await database.close();
}

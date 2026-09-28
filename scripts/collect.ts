import { resolve } from "node:path";
import { existsSync } from "node:fs";

// Run with --conditions=react-server: this explicitly server-side command can
// import the collector while Next still enforces its server-only boundary.
for (const filename of [".env.local", ".env"]) {
  const path = resolve(process.cwd(), filename);
  if (existsSync(path)) process.loadEnvFile(path);
}

const { runCollection } = await import("../lib/collector");
const { serviceDatabase } = await import("../lib/database");
const { SOURCES } = await import("../lib/catalog");
const seed = process.argv.includes("--seed");
const rounds = seed ? 12 : 1;
let incomplete = false;
for (let index = 0; index < rounds; index += 1) {
  let result;
  try { result = await runCollection(seed ? "seed" : "manual"); }
  catch { console.error("云端采集暂不可用，请检查服务配置。"); incomplete = true; break; }
  console.log(JSON.stringify({ round: index + 1, ...result }));
  if (result.state === "busy") { incomplete = true; break; }
  if (!seed) { incomplete = result.state === "degraded"; break; }
  const db = serviceDatabase();
  if (!db) { incomplete = true; break; }
  const checked = await db.from("source_snapshots").select("source_id");
  if (checked.error) { incomplete = true; break; }
  const identifiers = new Set((checked.data ?? []).map(row => row.source_id));
  if (SOURCES.every(source => identifiers.has(source.id))) break;
  if (index === rounds - 1) incomplete = true;
}
if (incomplete) process.exitCode = 1;

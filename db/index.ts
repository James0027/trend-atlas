import "server-only";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

// Runtime collection uses Supabase REST RPCs and needs no database password.
// A direct connection is optional for trusted migration/maintenance tools.
export function getDb() {
  const connectionString = process.env.DATABASE_URL?.trim();
  if (!connectionString) throw new Error("DATABASE_URL is required for direct database maintenance.");
  return drizzle(postgres(connectionString, { prepare: false, max: 1 }), { schema });
}

import { sql } from "drizzle-orm";
import { bigint, check, index, integer, jsonb, pgSchema, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import type { Item, SavedView, SourceStatus, Topic } from "@/lib/types";

// Supabase owns auth.users. Only reference its stable primary key; migrations
// for the auth schema remain Supabase's responsibility.
const authUsers = pgSchema("auth").table("users", { id: uuid("id").primaryKey() });
export type SnapshotPayload = { items: Item[]; status: SourceStatus };
export type LibraryData = { bookmarks: Item[]; views: SavedView[]; overrides: Record<string, Topic[]> };

export const snapshots = pgTable("source_snapshots", {
  sourceId: text("source_id").primaryKey(),
  payload: jsonb("payload").$type<SnapshotPayload>().notNull(),
  nextAttempt: bigint("next_attempt", { mode: "number" }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  check("source_snapshots_id_check", sql`${table.sourceId} ~ '^[a-z0-9][a-z0-9_-]{0,79}$'`),
  check("source_snapshots_payload_check", sql`private.valid_source_payload(${table.payload}, ${table.sourceId})`),
  check("source_snapshots_next_attempt_check", sql`${table.nextAttempt} between 946684800000 and 4102444800000`),
]);

export const locks = pgTable("collection_leases", {
  key: text("key").primaryKey(),
  owner: uuid("owner").notNull(),
  expiresAt: bigint("expires_at", { mode: "number" }).notNull(),
}, (table) => [check("collection_leases_key_check", sql`length(${table.key}) between 1 and 80`)]);

export const budgets = pgTable("api_budgets", {
  bucket: text("bucket").primaryKey(),
  count: integer("count").notNull(),
  expiresAt: bigint("expires_at", { mode: "number" }).notNull(),
}, (table) => [
  check("api_budgets_bucket_check", sql`length(${table.bucket}) between 1 and 120`),
  check("api_budgets_count_check", sql`${table.count} between 1 and 1000000`),
]);

export const runs = pgTable("collection_runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  startedAt: timestamp("started_at", { withTimezone: true }).defaultNow().notNull(),
  endedAt: timestamp("ended_at", { withTimezone: true }),
  status: text("status").notNull().default("running"),
  summary: jsonb("summary").$type<Record<string, unknown>>().notNull().default({}),
}, (table) => [
  index("collection_runs_started_at_idx").on(table.startedAt),
  check("collection_runs_status_check", sql`${table.status} in ('running','succeeded','partial','failed','skipped')`),
  check("collection_runs_summary_check", sql`jsonb_typeof(${table.summary}) = 'object' and octet_length(${table.summary}::text) <= 16384`),
  check("collection_runs_time_check", sql`${table.endedAt} is null or ${table.endedAt} >= ${table.startedAt}`),
]);

export const userLibrary = pgTable("user_library", {
  userId: uuid("user_id").primaryKey().references(() => authUsers.id, { onDelete: "cascade" }),
  data: jsonb("data").$type<LibraryData>().notNull().default({ bookmarks: [], views: [], overrides: {} }),
  revision: bigint("revision", { mode: "number" }).notNull().default(1),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  check("user_library_data_check", sql`private.valid_library_data(${table.data})`),
  check("user_library_revision_check", sql`${table.revision} between 1 and 9007199254740991`),
]);

export const adminUsers = pgTable("admin_users", {
  userId: uuid("user_id").primaryKey().references(() => authUsers.id, { onDelete: "cascade" }),
});

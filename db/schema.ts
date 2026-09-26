import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
export const snapshots = sqliteTable("source_snapshots", {
  sourceId: text("source_id").primaryKey(),
  payload: text("payload").notNull(),
  nextAttempt: integer("next_attempt").notNull(),
});
export const locks = sqliteTable("refresh_locks", {
  key: text("key").primaryKey(), owner: text("owner").notNull(), until: integer("until").notNull(),
});
export const budgets = sqliteTable("api_budgets", {
  bucket: text("bucket").primaryKey(), count: integer("count").notNull(),
});

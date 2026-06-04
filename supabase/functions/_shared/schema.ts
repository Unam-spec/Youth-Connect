import { pgTable, text, uuid } from "npm:drizzle-orm@0.45.2/pg-core";

// Minimal subset of the profiles table for the Phase-0 spike only.
// Phase 1 replaces this with the full shared schema (mirrors lib/db).
export const profilesTable = pgTable("profiles", {
  id: uuid("id").primaryKey(),
  pin_hash: text("pin_hash"),
  role: text("role"),
});

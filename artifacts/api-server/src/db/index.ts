import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { logger } from "../lib/logger";
import { messagesTable, roleEnum } from "./schema/messages";

// ── Messages DB (local schema) ─────────────────────────────────────────────────
// Used only by messages.ts route.  Lazy pool — connects on first query.
const messagesPool = process.env.DATABASE_URL
  ? new Pool({ connectionString: process.env.DATABASE_URL })
  : null;

export const db = messagesPool
  ? drizzle(messagesPool, { schema: { messagesTable, roleEnum } })
  : null as any;

// ── Startup schema sync ────────────────────────────────────────────────────────
// Instead of relying on Drizzle's migrator (which requires a correct _journal.json),
// we run idempotent ALTER TABLE statements on every boot to guarantee the live DB
// schema matches what the ORM expects.  These are all safe to run repeatedly.

const SCHEMA_PATCHES = `
-- Ensure permission columns exist
ALTER TABLE "profiles" ADD COLUMN IF NOT EXISTS "can_create_events" boolean NOT NULL DEFAULT true;
ALTER TABLE "profiles" ADD COLUMN IF NOT EXISTS "can_view_kpis" boolean NOT NULL DEFAULT true;
ALTER TABLE "profiles" ADD COLUMN IF NOT EXISTS "can_view_members" boolean NOT NULL DEFAULT true;
ALTER TABLE "profiles" ADD COLUMN IF NOT EXISTS "can_view_attendance" boolean NOT NULL DEFAULT true;

-- Ensure school / parent_phone columns exist (added in v0.8)
ALTER TABLE "profiles" ADD COLUMN IF NOT EXISTS "school" text;
ALTER TABLE "profiles" ADD COLUMN IF NOT EXISTS "parent_phone" text;

-- Ensure avatar_url column exists (added in v0.9)
ALTER TABLE "profiles" ADD COLUMN IF NOT EXISTS "avatar_url" text;

-- Ensure pin_plain column exists (added in v0.4)
ALTER TABLE "profiles" ADD COLUMN IF NOT EXISTS "pin_plain" text;
`;

export async function runMigrations() {
  if (!process.env.DATABASE_URL) {
    logger.warn("DATABASE_URL not set – skipping schema sync");
    return;
  }

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const client = await pool.connect();
  try {
    logger.info("Running schema sync patches...");
    await client.query(SCHEMA_PATCHES);
    logger.info("Schema sync complete.");
  } catch (err: any) {
    // Log but do NOT crash the server — some patches may fail if the table
    // itself doesn't exist yet (handled separately by existing migrations)
    logger.error({ err }, "Schema sync warning (non-fatal)");
  } finally {
    client.release();
    await pool.end();
  }
}

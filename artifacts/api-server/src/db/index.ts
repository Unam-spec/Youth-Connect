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
ALTER TABLE "profiles" ADD COLUMN IF NOT EXISTS "parent_name" text;
ALTER TABLE "profiles" ADD COLUMN IF NOT EXISTS "whatsapp_opt_in" boolean NOT NULL DEFAULT false;

-- Ensure visitors table columns exist
ALTER TABLE "visitors" ADD COLUMN IF NOT EXISTS "parent_name" text;
ALTER TABLE "visitors" ADD COLUMN IF NOT EXISTS "whatsapp_opt_in" boolean NOT NULL DEFAULT false;

-- Ensure avatar_url column exists (added in v0.9)
ALTER TABLE "profiles" ADD COLUMN IF NOT EXISTS "avatar_url" text;


-- Ensure link verification columns exist
ALTER TABLE "profiles" ADD COLUMN IF NOT EXISTS "link_token" text;
ALTER TABLE "profiles" ADD COLUMN IF NOT EXISTS "link_token_expires_at" timestamp with time zone;
ALTER TABLE "profiles" ADD COLUMN IF NOT EXISTS "link_token_used" boolean NOT NULL DEFAULT false;

-- Ensure session_token column exists
ALTER TABLE "profiles" ADD COLUMN IF NOT EXISTS "session_token" uuid;

-- Ensure pending_emails table exists
CREATE TABLE IF NOT EXISTS "pending_emails" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "to_address" text NOT NULL,
  "subject" text NOT NULL,
  "body_html" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now(),
  "sent_at" timestamp with time zone,
  "attempts" integer DEFAULT 0,
  "last_error" text
);

-- Ensure super admin role unique constraint exists
CREATE UNIQUE INDEX IF NOT EXISTS idx_super_admin_limit ON profiles (role) WHERE role = 'super_admin';

-- Ensure database indexes exist
CREATE INDEX IF NOT EXISTS idx_profiles_clerk_id ON profiles (clerk_id);
CREATE INDEX IF NOT EXISTS idx_profiles_email ON profiles (email);
CREATE INDEX IF NOT EXISTS idx_profiles_phone ON profiles (phone);
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

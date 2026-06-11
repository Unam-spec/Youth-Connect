import { Pool } from "pg";
import { logger } from "../lib/logger";

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

-- Ensure events.poster_url column exists (event poster image, stored as data URL)
ALTER TABLE "events" ADD COLUMN IF NOT EXISTS "poster_url" text;


-- Ensure link verification columns exist
ALTER TABLE "profiles" ADD COLUMN IF NOT EXISTS "link_token" text;
ALTER TABLE "profiles" ADD COLUMN IF NOT EXISTS "link_token_expires_at" timestamp with time zone;
ALTER TABLE "profiles" ADD COLUMN IF NOT EXISTS "link_token_used" boolean NOT NULL DEFAULT false;

-- Ensure session_token column exists
ALTER TABLE "profiles" ADD COLUMN IF NOT EXISTS "session_token" uuid;

-- Ensure username + PIN-account columns exist (no-email username+PIN accounts, 2026-06).
-- Mirrors lib/db/drizzle/0011_add_pin_accounts.sql. Without these, the ORM's
-- full-table profile reads fail with "column does not exist" → 500 on every
-- profile load. pin_plain may already exist from an older patch.
ALTER TABLE "profiles" ADD COLUMN IF NOT EXISTS "username" text;
ALTER TABLE "profiles" ADD COLUMN IF NOT EXISTS "pin_plain" text;
ALTER TABLE "profiles" ADD COLUMN IF NOT EXISTS "parental_consent_at" timestamp with time zone;
ALTER TABLE "profiles" ADD COLUMN IF NOT EXISTS "parental_consent_by" uuid;
CREATE UNIQUE INDEX IF NOT EXISTS "profiles_username_unique"
  ON "profiles" (lower(btrim("username")))
  WHERE "username" IS NOT NULL AND btrim("username") <> '';

-- Ensure attendance.type column exists. Prod was missing it while the code inserts
-- type:"member" on every check-in → "column type does not exist" → 500 on all
-- check-ins. Stored as text to match check_in_requests.type (prod uses text, not the
-- enum the ORM schema declares).
ALTER TABLE "attendance" ADD COLUMN IF NOT EXISTS "type" text NOT NULL DEFAULT 'member';

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

-- Super admins are limited to 4 at the APPLICATION level (see PATCH /profiles/:id/role).
-- The old single-super-admin unique index is wrong (it caps at 1) and a unique index
-- cannot express "max 4", so we actively drop it on every boot to undo any leftover.
DROP INDEX IF EXISTS idx_super_admin_limit;

-- Ensure database indexes exist
CREATE INDEX IF NOT EXISTS idx_profiles_clerk_id ON profiles (clerk_id);
CREATE INDEX IF NOT EXISTS idx_profiles_email ON profiles (email);
CREATE INDEX IF NOT EXISTS idx_profiles_phone ON profiles (phone);

-- Configurable check-in schedule (added 2026-06): single-row settings + per-weekday windows.
CREATE TABLE IF NOT EXISTS "checkin_settings" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "restrict_to_schedule" boolean NOT NULL DEFAULT true,
  "updated_at" timestamp with time zone DEFAULT now(),
  "updated_by" uuid
);

CREATE TABLE IF NOT EXISTS "checkin_windows" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "day_of_week" integer NOT NULL UNIQUE,
  "start_time" text NOT NULL,
  "end_time" text NOT NULL,
  "enabled" boolean NOT NULL DEFAULT true
);

-- Seed defaults only when empty (never overwrites leader edits).
INSERT INTO "checkin_settings" ("restrict_to_schedule")
  SELECT true WHERE NOT EXISTS (SELECT 1 FROM "checkin_settings");

INSERT INTO "checkin_windows" ("day_of_week", "start_time", "end_time", "enabled")
  SELECT 5, '18:30', '22:00', true
  WHERE NOT EXISTS (SELECT 1 FROM "checkin_windows");
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

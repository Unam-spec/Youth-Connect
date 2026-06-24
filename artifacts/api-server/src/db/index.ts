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

-- Feedback table (2026-06): free-text feedback, optionally anonymous and/or tied
-- to a profile. Mirrors lib/db/drizzle/0012_add_feedbacks_whatsapp_templates.sql.
CREATE TABLE IF NOT EXISTS "feedbacks" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "content" text NOT NULL,
  "anonymous" boolean NOT NULL DEFAULT false,
  "user_id" uuid REFERENCES "profiles"("id"),
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);

-- WhatsApp templates table (2026-06): reusable message templates for automations.
CREATE TABLE IF NOT EXISTS "whatsapp_templates" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "template_type" text NOT NULL,
  "stage_weeks" integer,
  "message_text" text NOT NULL,
  "color_hex" text NOT NULL DEFAULT '#2A9D8F',
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);

-- Twilio Content API columns (set per-template once approved templates exist;
-- NULL → free-form send, used for the sandbox / within the 24h session window).
ALTER TABLE "whatsapp_templates" ADD COLUMN IF NOT EXISTS "content_sid" text;
ALTER TABLE "whatsapp_templates" ADD COLUMN IF NOT EXISTS "content_var_map" jsonb;

-- Seed default WhatsApp templates only when the table is empty (leaders can edit
-- them afterward). follow_up stages key off weeks-absent; event_creation is the
-- new-event announcement. Placeholders: [User] [Leader] [Event] [Date] [Time] [Location].
INSERT INTO "whatsapp_templates" ("template_type", "stage_weeks", "message_text", "color_hex")
  SELECT * FROM (VALUES
    ('follow_up', 2, 'Hi [User]! 👋 We''ve missed you at JG Youth these past couple of weeks. Hope you''re doing okay — would love to see you again this Friday! — [Leader]', '#FACC15'),
    ('follow_up', 4, 'Hey [User], it''s been about a month since we last saw you at JG Youth. You matter to us and we''d love to have you back! Anything we can do to help? — [Leader]', '#FB923C'),
    ('follow_up', 6, 'Hi [User], we really miss having you at JG Youth — it''s been a while. Is everything alright? We''d love to check in and see you again soon. — [Leader]', '#F87171'),
    ('follow_up', 8, 'Hi [User], it''s been quite some time since we''ve seen you at JG Youth. You''re always welcome here, and we''d love to reconnect whenever you''re ready. — [Leader]', '#EF4444'),
    ('event_creation', NULL::integer, 'Hi [User]! 🎉 New at JG Youth: [Event] on [Date] at [Time], [Location]. Hope to see you there!', '#2A9D8F')
  ) AS seed(template_type, stage_weeks, message_text, color_hex)
  WHERE NOT EXISTS (SELECT 1 FROM "whatsapp_templates");

-- Feedback prompt settings (2026-06): single-row, editable copy + cadence for the
-- recurring member feedback prompt. Seeded with defaults only when empty.
CREATE TABLE IF NOT EXISTS "feedback_settings" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "enabled" boolean NOT NULL DEFAULT true,
  "interval_days" integer NOT NULL DEFAULT 14,
  "title" text NOT NULL,
  "body" text NOT NULL,
  "examples" jsonb,
  "updated_at" timestamp with time zone DEFAULT now(),
  "updated_by" uuid
);

INSERT INTO "feedback_settings" ("title", "body", "examples")
  SELECT
    'How''s your JG Youth experience?',
    'We''d love a quick word — what''s going well, or what could be better?',
    '["What''s something you loved recently? 🙌","Anything we could do better at sessions?","An event or topic you''d love to see"]'::jsonb
  WHERE NOT EXISTS (SELECT 1 FROM "feedback_settings");

-- Follow-up queue status enum (2026-06): lifecycle states for queued WhatsApp
-- messages. Created as DO block to be fully idempotent.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'follow_up_queue_status') THEN
    CREATE TYPE "follow_up_queue_status" AS ENUM ('pending','approved','rejected','sent','failed');
  END IF;
END $$;

-- WhatsApp automation settings (2026-06): single-row config for the automated
-- follow-up queue generator. Leaders can change the day/time from the UI.
CREATE TABLE IF NOT EXISTS "whatsapp_automation_settings" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "enabled" boolean NOT NULL DEFAULT true,
  "day_of_week" integer NOT NULL DEFAULT 5,
  "time" text NOT NULL DEFAULT '18:30',
  "include_never_attended" boolean NOT NULL DEFAULT true,
  "updated_at" timestamp with time zone DEFAULT now(),
  "updated_by" uuid
);

-- Seed default automation settings (Friday 18:30, enabled).
INSERT INTO "whatsapp_automation_settings" ("enabled", "day_of_week", "time", "include_never_attended")
  SELECT true, 5, '18:30', true
  WHERE NOT EXISTS (SELECT 1 FROM "whatsapp_automation_settings");

-- Follow-up queue (2026-06): pending WhatsApp messages generated by the cron.
-- Leaders review & approve before they are sent.
CREATE TABLE IF NOT EXISTS "follow_up_queue" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "profile_id" uuid NOT NULL REFERENCES "profiles"("id"),
  "stage_weeks" integer NOT NULL,
  "weeks_absent" integer NOT NULL,
  "message_preview" text NOT NULL,
  "template_id" uuid REFERENCES "whatsapp_templates"("id"),
  "status" "follow_up_queue_status" NOT NULL DEFAULT 'pending',
  "twilio_sid" text,
  "error_message" text,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "sent_at" timestamp with time zone,
  "reviewed_by" uuid REFERENCES "profiles"("id"),
  "reviewed_at" timestamp with time zone
);

CREATE INDEX IF NOT EXISTS idx_follow_up_queue_status ON "follow_up_queue" ("status");
CREATE INDEX IF NOT EXISTS idx_follow_up_queue_profile ON "follow_up_queue" ("profile_id");

-- Add 'invited' to membership_status if it doesn't exist
DO $$ BEGIN
  ALTER TYPE "membership_status" ADD VALUE IF NOT EXISTS 'invited';
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
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

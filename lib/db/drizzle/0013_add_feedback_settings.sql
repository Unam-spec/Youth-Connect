-- Single-row config for the recurring member feedback prompt (2026-06).
-- Idempotent; seeded with sensible defaults when empty.

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

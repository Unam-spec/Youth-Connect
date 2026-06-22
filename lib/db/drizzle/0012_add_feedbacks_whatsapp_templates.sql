-- Feedback + WhatsApp template tables (2026-06).
-- Idempotent so they can be re-run safely (mirrors the boot-time schema sync in
-- artifacts/api-server/src/db/index.ts).

CREATE TABLE IF NOT EXISTS "feedbacks" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "content" text NOT NULL,
  "anonymous" boolean NOT NULL DEFAULT false,
  "user_id" uuid REFERENCES "profiles"("id"),
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "whatsapp_templates" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "template_type" text NOT NULL,
  "stage_weeks" integer,
  "message_text" text NOT NULL,
  "color_hex" text NOT NULL DEFAULT '#2A9D8F',
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);

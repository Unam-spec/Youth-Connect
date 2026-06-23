-- Twilio Content API support for whatsapp_templates (2026-06).
-- content_sid = approved Twilio Content template (HX…); content_var_map maps the
-- template's positional variables to our semantic keys, e.g. {"1":"User"}.
ALTER TABLE "whatsapp_templates" ADD COLUMN IF NOT EXISTS "content_sid" text;
ALTER TABLE "whatsapp_templates" ADD COLUMN IF NOT EXISTS "content_var_map" jsonb;

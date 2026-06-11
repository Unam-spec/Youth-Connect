ALTER TABLE "profiles" ADD COLUMN IF NOT EXISTS "username" text;
-- pin_plain: re-introduced here. It was added by 0004 then dropped by the
-- 0010_drop_pin_plain TS migration; this brings it back for PIN accounts.
ALTER TABLE "profiles" ADD COLUMN IF NOT EXISTS "pin_plain" text;
ALTER TABLE "profiles" ADD COLUMN IF NOT EXISTS "parental_consent_at" timestamp with time zone;
ALTER TABLE "profiles" ADD COLUMN IF NOT EXISTS "parental_consent_by" uuid;

-- Case/whitespace-insensitive uniqueness for non-blank usernames (mirrors the
-- profiles_phone_unique pattern). Lets Clerk/email members keep username NULL.
CREATE UNIQUE INDEX IF NOT EXISTS "profiles_username_unique"
  ON "profiles" (lower(btrim("username")))
  WHERE "username" IS NOT NULL AND btrim("username") <> '';

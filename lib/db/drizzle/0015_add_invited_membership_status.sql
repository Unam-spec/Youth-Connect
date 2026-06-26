-- Adds the 'invited' value to the membership_status enum (leader-initiated
-- membership invitations). Idempotent so it is safe to re-run.
-- NOTE: the live database is also patched at api-server startup via the
-- SCHEMA_PATCHES block in artifacts/api-server/src/db/index.ts; this file keeps
-- the drizzle/ migration history consistent with lib/db/src/schema/index.ts.
ALTER TYPE membership_status ADD VALUE IF NOT EXISTS 'invited';

-- Migration 0003: Fix check-in system — attendance unique constraint + type column
--
-- 1. Add `type` column to attendance (member | visitor) so approved visitor
--    check-ins can be distinguished from member check-ins in the attendance log.
-- 2. Add a partial unique index on attendance (profile_id, session_date) so a
--    member cannot be inserted into attendance twice for the same session.
--    The index is partial (WHERE profile_id IS NOT NULL) to allow visitor rows
--    that have no profile_id.

-- Add type column; default 'member' keeps all existing rows valid
ALTER TABLE "attendance" ADD COLUMN "type" "check_in_request_type" NOT NULL DEFAULT 'member';--> statement-breakpoint

-- Partial unique index: one attendance row per member per session
CREATE UNIQUE INDEX "attendance_profile_session_unique"
  ON "attendance" USING btree ("profile_id", "session_date")
  WHERE "profile_id" IS NOT NULL;

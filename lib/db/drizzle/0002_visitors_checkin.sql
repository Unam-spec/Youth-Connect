-- Migration 0002: Add visitors table and update check_in_requests for first-timer support
--
-- 1. New enum: check_in_request_type ('member' | 'visitor')
-- 2. New table: visitors — stores first-timers who register via the public QR flow
--    without a Clerk account (phone_number, how_did_you_hear, session_date, status…)
-- 3. Alter check_in_requests:
--    - Make profile_id nullable (visitors don't have a profile row)
--    - Add visitor_id FK → visitors
--    - Add type column (defaults 'member' so existing rows are unaffected)
--    - Replace the non-null profile unique index with a partial one
--    - Add partial unique index for (visitor_id, session_date)

CREATE TYPE "public"."check_in_request_type" AS ENUM('member', 'visitor');--> statement-breakpoint

CREATE TABLE "visitors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"full_name" text NOT NULL,
	"phone_number" text NOT NULL,
	"email" text,
	"gender" "gender" NOT NULL,
	"age" integer NOT NULL,
	"how_did_you_hear" text NOT NULL,
	"session_date" date NOT NULL,
	"status" "check_in_request_status" NOT NULL DEFAULT 'pending',
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint

-- Make profile_id nullable so visitor-only requests don't need a profile row
ALTER TABLE "check_in_requests" ALTER COLUMN "profile_id" DROP NOT NULL;--> statement-breakpoint

-- Add visitor_id FK for first-timer check-in requests
ALTER TABLE "check_in_requests" ADD COLUMN "visitor_id" uuid;--> statement-breakpoint

-- Add type column; default 'member' keeps all existing rows valid
ALTER TABLE "check_in_requests" ADD COLUMN "type" "check_in_request_type" NOT NULL DEFAULT 'member';--> statement-breakpoint

-- FK: visitor_id → visitors
ALTER TABLE "check_in_requests" ADD CONSTRAINT "check_in_requests_visitor_id_visitors_id_fk"
  FOREIGN KEY ("visitor_id") REFERENCES "public"."visitors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint

-- Replace the old btree unique index (which assumed profile_id IS NOT NULL)
-- with a partial index so it only applies when profile_id is present
DROP INDEX IF EXISTS "check_in_requests_profile_session_unique";--> statement-breakpoint
CREATE UNIQUE INDEX "check_in_requests_profile_session_unique"
  ON "check_in_requests" USING btree ("profile_id", "session_date")
  WHERE "profile_id" IS NOT NULL;--> statement-breakpoint

-- Partial unique index for visitor check-in requests
CREATE UNIQUE INDEX "check_in_requests_visitor_session_unique"
  ON "check_in_requests" USING btree ("visitor_id", "session_date")
  WHERE "visitor_id" IS NOT NULL;

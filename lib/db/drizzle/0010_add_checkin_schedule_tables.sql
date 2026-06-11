CREATE TABLE IF NOT EXISTS "checkin_settings" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "restrict_to_schedule" boolean NOT NULL DEFAULT true,
  "updated_at" timestamp with time zone DEFAULT now(),
  "updated_by" uuid
);
CREATE TABLE IF NOT EXISTS "checkin_windows" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "day_of_week" integer NOT NULL,
  "start_time" text NOT NULL,
  "end_time" text NOT NULL,
  "enabled" boolean NOT NULL DEFAULT true,
  CONSTRAINT "checkin_windows_day_of_week_unique" UNIQUE ("day_of_week")
);

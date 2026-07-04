-- Shared kiosk PIN (single row): all leaders/super-admins use this one PIN to
-- exit kiosk mode. Seeded with a random PIN at api-server boot when empty.
CREATE TABLE IF NOT EXISTS "kiosk_settings" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "pin_hash" text NOT NULL,
  "pin_plain" text NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

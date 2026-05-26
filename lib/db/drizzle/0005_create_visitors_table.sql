CREATE TABLE "visitors" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "full_name" text NOT NULL,
  "phone_number" text NOT NULL,
  "email" text,
  "gender" text NOT NULL,
  "age" integer NOT NULL,
  "how_did_you_hear" text NOT NULL,
  "session_date" date NOT NULL,
  "status" text NOT NULL DEFAULT 'pending',
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
ALTER TABLE check_in_requests
ADD COLUMN "visitor_id" uuid REFERENCES visitors(id);
ALTER TABLE check_in_requests
ALTER COLUMN "profile_id" DROP NOT NULL;
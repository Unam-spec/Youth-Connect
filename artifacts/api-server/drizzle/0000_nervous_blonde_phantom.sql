DO 586 BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'role' AND typnamespace = 'public'::regnamespace) THEN
    CREATE TYPE "public"."role" AS ENUM('super_admin', 'leader', 'member', 'visitor');
  END IF;
END 586;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sender_id" text NOT NULL,
	"sender_name" text NOT NULL,
	"sender_role" "role" NOT NULL,
	"content" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

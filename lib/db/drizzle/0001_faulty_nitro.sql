CREATE TYPE "public"."message_status" AS ENUM('sent', 'read', 'archived');--> statement-breakpoint
CREATE TABLE "leader_slots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"profile_id" uuid NOT NULL,
	"slot_number" integer NOT NULL,
	"assigned_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "leader_slots_profile_id_unique" UNIQUE("profile_id")
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sender_id" uuid NOT NULL,
	"recipient_id" uuid NOT NULL,
	"content" text NOT NULL,
	"status" "message_status" DEFAULT 'sent' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "super_admin_slots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"profile_id" uuid NOT NULL,
	"slot_number" integer NOT NULL,
	"assigned_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "super_admin_slots_profile_id_unique" UNIQUE("profile_id")
);
--> statement-breakpoint
ALTER TABLE "attendance" DROP CONSTRAINT "attendance_profile_id_profiles_id_fk";
--> statement-breakpoint
ALTER TABLE "attendance" DROP CONSTRAINT "attendance_event_id_events_id_fk";
--> statement-breakpoint
ALTER TABLE "check_in_requests" DROP CONSTRAINT "check_in_requests_profile_id_profiles_id_fk";
--> statement-breakpoint
ALTER TABLE "check_in_requests" DROP CONSTRAINT "check_in_requests_reviewed_by_profiles_id_fk";
--> statement-breakpoint
ALTER TABLE "events" DROP CONSTRAINT "events_created_by_profiles_id_fk";
--> statement-breakpoint
ALTER TABLE "leader_permissions" DROP CONSTRAINT "leader_permissions_profile_id_profiles_id_fk";
--> statement-breakpoint
ALTER TABLE "membership_requests" DROP CONSTRAINT "membership_requests_profile_id_profiles_id_fk";
--> statement-breakpoint
ALTER TABLE "membership_requests" DROP CONSTRAINT "membership_requests_reviewed_by_profiles_id_fk";
--> statement-breakpoint
ALTER TABLE "rsvps" DROP CONSTRAINT "rsvps_event_id_events_id_fk";
--> statement-breakpoint
ALTER TABLE "rsvps" DROP CONSTRAINT "rsvps_profile_id_profiles_id_fk";
--> statement-breakpoint
ALTER TABLE "profiles" ALTER COLUMN "phone" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "profiles" ALTER COLUMN "gender" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "profiles" ALTER COLUMN "age" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "profiles" ALTER COLUMN "heard_from" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "leader_slots" ADD CONSTRAINT "leader_slots_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_sender_id_profiles_id_fk" FOREIGN KEY ("sender_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_recipient_id_profiles_id_fk" FOREIGN KEY ("recipient_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "super_admin_slots" ADD CONSTRAINT "super_admin_slots_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance" ADD CONSTRAINT "attendance_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance" ADD CONSTRAINT "attendance_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "check_in_requests" ADD CONSTRAINT "check_in_requests_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "check_in_requests" ADD CONSTRAINT "check_in_requests_reviewed_by_profiles_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_created_by_profiles_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leader_permissions" ADD CONSTRAINT "leader_permissions_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "membership_requests" ADD CONSTRAINT "membership_requests_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "membership_requests" ADD CONSTRAINT "membership_requests_reviewed_by_profiles_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rsvps" ADD CONSTRAINT "rsvps_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rsvps" ADD CONSTRAINT "rsvps_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "attendance_profile_session_unique" ON "attendance" USING btree ("profile_id","session_date");--> statement-breakpoint
CREATE UNIQUE INDEX "check_in_requests_profile_session_unique" ON "check_in_requests" USING btree ("profile_id","session_date");
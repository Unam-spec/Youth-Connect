import {
  pgTable,
  text,
  uuid,
  integer,
  boolean,
  timestamp,
  date,
  time,
  jsonb,
  pgEnum,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const roleEnum = pgEnum("role", [
  "super_admin",
  "leader",
  "member",
  "visitor",
]);

export const genderEnum = pgEnum("gender", ["male", "female", "other"]);

export const membershipStatusEnum = pgEnum("membership_status", [
  "pending",
  "approved",
  "rejected",
]);

export const checkInMethodEnum = pgEnum("check_in_method", [
  "manual",
  "self",
  "qr",
]);

export const qrCodeTypeEnum = pgEnum("qr_code_type", ["public", "leader", "session"]);

export const rsvpStatusEnum = pgEnum("rsvp", ["going", "not_going", "maybe"]);

export const followUpQueueStatusEnum = pgEnum("follow_up_queue_status", [
  "pending",
  "approved",
  "rejected",
  "sent",
  "failed",
]);

export const checkInRequestStatusEnum = pgEnum("check_in_request_status", [
  "pending",
  "approved",
  "rejected",
]);

export const checkInRequestTypeEnum = pgEnum("check_in_request_type", [
  "member",
  "visitor",
]);

// DB invariant (managed via Supabase migration, not drizzle-kit):
//   CREATE UNIQUE INDEX profiles_phone_unique ON profiles (lower(btrim(phone)))
//     WHERE phone IS NOT NULL AND btrim(phone) <> '';
// Enforces case/whitespace-insensitive phone uniqueness for non-blank phones.
// Mirrored in app logic by normalizePhone()/phoneInUse() in the api-server.
export const profilesTable = pgTable("profiles", {
  id: uuid("id").primaryKey().defaultRandom(),
  clerk_id: text("clerk_id").unique(),
  full_name: text("full_name").notNull(),
  phone: text("phone"),
  email: text("email"),
  gender: genderEnum("gender"),
  age: integer("age"),
  heard_from: text("heard_from"),
  role: roleEnum("role").notNull().default("visitor"),
  pin_hash: text("pin_hash"),
  can_create_events: boolean("can_create_events").notNull().default(true),
  can_view_kpis: boolean("can_view_kpis").notNull().default(true),
  can_view_members: boolean("can_view_members").notNull().default(true),
  can_view_attendance: boolean("can_view_attendance").notNull().default(true),
  school: text("school"),
  parent_phone: text("parent_phone"),
  parent_name: text("parent_name"),
  whatsapp_opt_in: boolean("whatsapp_opt_in").notNull().default(false),
  avatar_url: text("avatar_url"),
  link_token: text("link_token"),
  link_token_expires_at: timestamp("link_token_expires_at", { withTimezone: true }),
  link_token_used: boolean("link_token_used").notNull().default(false),
  session_token: uuid("session_token"),
  username: text("username"),
  pin_plain: text("pin_plain"),
  parental_consent_at: timestamp("parental_consent_at", { withTimezone: true }),
  parental_consent_by: uuid("parental_consent_by"),
  created_at: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const eventsTable = pgTable("events", {
  id: uuid("id").primaryKey().defaultRandom(),
  title: text("title").notNull(),
  description: text("description"),
  date: date("date").notNull(),
  time: time("time").notNull(),
  location: text("location").notNull(),
  poster_url: text("poster_url"),
  created_by: uuid("created_by").references(() => profilesTable.id),
  age_min: integer("age_min"),
  age_max: integer("age_max"),
  custom_requirements: jsonb("custom_requirements"),
  is_public: boolean("is_public").notNull().default(true),
  created_at: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const attendanceTable = pgTable("attendance", {
  id: uuid("id").primaryKey().defaultRandom(),
  profile_id: uuid("profile_id").references(() => profilesTable.id),
  event_id: uuid("event_id").references(() => eventsTable.id),
  checked_in_at: timestamp("checked_in_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  session_date: date("session_date").notNull(),
  check_in_method: checkInMethodEnum("check_in_method")
    .notNull()
    .default("manual"),
  // member = registered profile, visitor = first-timer without a Clerk account
  type: checkInRequestTypeEnum("type").notNull().default("member"),
});

export const rsvpsTable = pgTable("rsvps", {
  id: uuid("id").primaryKey().defaultRandom(),
  event_id: uuid("event_id")
    .notNull()
    .references(() => eventsTable.id),
  profile_id: uuid("profile_id")
    .notNull()
    .references(() => profilesTable.id),
  status: rsvpStatusEnum("status").notNull().default("going"),
  created_at: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const membershipRequestsTable = pgTable("membership_requests", {
  id: uuid("id").primaryKey().defaultRandom(),
  profile_id: uuid("profile_id")
    .notNull()
    .references(() => profilesTable.id),
  reason: text("reason").notNull(),
  status: membershipStatusEnum("status").notNull().default("pending"),
  reviewed_by: uuid("reviewed_by").references(() => profilesTable.id),
  created_at: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const qrCodesTable = pgTable("qr_codes", {
  id: uuid("id").primaryKey().defaultRandom(),
  slug: text("slug").notNull().unique(),
  type: qrCodeTypeEnum("type").notNull(),
  active: boolean("active").notNull().default(true),
  created_at: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const leaderPermissionsTable = pgTable("leader_permissions", {
  id: uuid("id").primaryKey().defaultRandom(),
  profile_id: uuid("profile_id")
    .notNull()
    .unique()
    .references(() => profilesTable.id),
  can_create_events: boolean("can_create_events").notNull().default(true),
  can_manage_members: boolean("can_manage_members").notNull().default(false),
  can_view_kpis: boolean("can_view_kpis").notNull().default(true),
  can_approve_membership: boolean("can_approve_membership")
    .notNull()
    .default(false),
  created_at: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// ─── Visitors table ────────────────────────────────────────────────────────────
// Stores first-time visitors who register via the public QR code flow.
// These visitors do NOT have a Clerk account or a profiles row.
export const visitorsTable = pgTable("visitors", {
  id: uuid("id").primaryKey().defaultRandom(),
  full_name: text("full_name").notNull(),
  phone_number: text("phone_number").notNull(),
  email: text("email"), // nullable
  gender: genderEnum("gender").notNull(),
  age: integer("age").notNull(),
  how_did_you_hear: text("how_did_you_hear").notNull(),
  school: text("school"),
  parent_phone: text("parent_phone"),
  parent_name: text("parent_name"),
  whatsapp_opt_in: boolean("whatsapp_opt_in").notNull().default(false),
  session_date: date("session_date").notNull(),
  status: checkInRequestStatusEnum("status").notNull().default("pending"),
  created_at: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// ─── Check-in requests ─────────────────────────────────────────────────────────
// Supports both profile-based (members/visitors with accounts) and
// visitor-based (first-timers without accounts) check-in requests.
// Exactly one of profile_id or visitor_id must be set.
export const checkInRequestsTable = pgTable("check_in_requests", {
  id: uuid("id").primaryKey().defaultRandom(),
  // profile_id is nullable to allow visitor-only check-in requests
  profile_id: uuid("profile_id").references(() => profilesTable.id),
  // visitor_id is set for first-timer check-in requests
  visitor_id: uuid("visitor_id").references(() => visitorsTable.id),
  type: checkInRequestTypeEnum("type").notNull().default("member"),
  session_date: date("session_date").notNull(),
  status: checkInRequestStatusEnum("status").notNull().default("pending"),
  requested_at: timestamp("requested_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  reviewed_by: uuid("reviewed_by").references(() => profilesTable.id),
  reviewed_at: timestamp("reviewed_at", { withTimezone: true }),
});

export const insertProfileSchema = createInsertSchema(profilesTable).omit({
  id: true,
  created_at: true,
});
export const insertEventSchema = createInsertSchema(eventsTable).omit({
  id: true,
  created_at: true,
});
export const insertAttendanceSchema = createInsertSchema(attendanceTable).omit({
  id: true,
  checked_in_at: true,
});
export const insertRsvpSchema = createInsertSchema(rsvpsTable).omit({
  id: true,
  created_at: true,
});
export const insertMembershipRequestSchema = createInsertSchema(
  membershipRequestsTable,
).omit({ id: true, created_at: true });
export const insertQrCodeSchema = createInsertSchema(qrCodesTable).omit({
  id: true,
  created_at: true,
});
export const insertLeaderPermissionsSchema = createInsertSchema(
  leaderPermissionsTable,
).omit({ id: true, created_at: true });
export const insertCheckInRequestSchema = createInsertSchema(
  checkInRequestsTable,
).omit({ id: true, requested_at: true });
export const insertVisitorSchema = createInsertSchema(visitorsTable).omit({
  id: true,
  created_at: true,
});

export type Profile = typeof profilesTable.$inferSelect;
export type InsertProfile = z.infer<typeof insertProfileSchema>;
export type Event = typeof eventsTable.$inferSelect;
export type InsertEvent = z.infer<typeof insertEventSchema>;
export type AttendanceRecord = typeof attendanceTable.$inferSelect;
export type InsertAttendance = z.infer<typeof insertAttendanceSchema>;
export type Rsvp = typeof rsvpsTable.$inferSelect;
export type InsertRsvp = z.infer<typeof insertRsvpSchema>;
export type MembershipRequest = typeof membershipRequestsTable.$inferSelect;
export type InsertMembershipRequest = z.infer<
  typeof insertMembershipRequestSchema
>;
export type QrCode = typeof qrCodesTable.$inferSelect;
export type InsertQrCode = z.infer<typeof insertQrCodeSchema>;
export type LeaderPermissions = typeof leaderPermissionsTable.$inferSelect;
export type InsertLeaderPermissions = z.infer<
  typeof insertLeaderPermissionsSchema
>;
export type CheckInRequest = typeof checkInRequestsTable.$inferSelect;
export type InsertCheckInRequest = z.infer<typeof insertCheckInRequestSchema>;
export type Visitor = typeof visitorsTable.$inferSelect;
export type InsertVisitor = z.infer<typeof insertVisitorSchema>;

// ── Pending emails table ───────────────────────────────────────────────────────
export const pendingEmailsTable = pgTable("pending_emails", {
  id: uuid("id").primaryKey().defaultRandom(),
  to_address: text("to_address").notNull(),
  subject: text("subject").notNull(),
  body_html: text("body_html").notNull(),
  created_at: timestamp("created_at", { withTimezone: true }).defaultNow(),
  sent_at: timestamp("sent_at", { withTimezone: true }),
  attempts: integer("attempts").default(0),
  last_error: text("last_error"),
});

export const insertPendingEmailSchema = createInsertSchema(pendingEmailsTable).omit({
  id: true,
  created_at: true,
});

export type PendingEmail = typeof pendingEmailsTable.$inferSelect;
export type InsertPendingEmail = z.infer<typeof insertPendingEmailSchema>;

// ── Check-in schedule tables ───────────────────────────────────────────────────
export const checkinSettingsTable = pgTable("checkin_settings", {
  id: uuid("id").primaryKey().defaultRandom(),
  restrict_to_schedule: boolean("restrict_to_schedule").notNull().default(true),
  updated_at: timestamp("updated_at", { withTimezone: true }).defaultNow(),
  updated_by: uuid("updated_by"),
});

export const checkinWindowsTable = pgTable("checkin_windows", {
  id: uuid("id").primaryKey().defaultRandom(),
  day_of_week: integer("day_of_week").notNull().unique(),
  start_time: text("start_time").notNull(),
  end_time: text("end_time").notNull(),
  enabled: boolean("enabled").notNull().default(true),
});

export type CheckinSettingsRow = typeof checkinSettingsTable.$inferSelect;
export type CheckinWindowRow = typeof checkinWindowsTable.$inferSelect;

// ── Feedback table ─────────────────────────────────────────────────────────────
// Free-text feedback submitted by members/visitors. When `anonymous` is true the
// submitter's identity is hidden in the UI; `user_id` is still optional so that
// genuinely account-less submissions are supported.
export const feedbacksTable = pgTable("feedbacks", {
  id: uuid("id").primaryKey().defaultRandom(),
  content: text("content").notNull(),
  anonymous: boolean("anonymous").notNull().default(false),
  user_id: uuid("user_id").references(() => profilesTable.id),
  created_at: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// ── WhatsApp templates table ───────────────────────────────────────────────────
// Reusable message templates for WhatsApp automations (e.g. follow-ups keyed to a
// number of weeks since a stage, or event-creation announcements). `color_hex` is
// used to colour-code templates in the leader UI.
export const whatsappTemplatesTable = pgTable("whatsapp_templates", {
  id: uuid("id").primaryKey().defaultRandom(),
  template_type: text("template_type").notNull(),
  stage_weeks: integer("stage_weeks"),
  message_text: text("message_text").notNull(),
  color_hex: text("color_hex").notNull().default("#2A9D8F"),
  // Production WhatsApp sends: when `content_sid` (a Twilio approved Content
  // template, HX…) is set, messages go out via the Content API instead of
  // free-form text. `content_var_map` maps the template's positional variables
  // ({{1}}, {{2}}…) to our semantic keys, e.g. {"1":"User","2":"Event"}.
  content_sid: text("content_sid"),
  content_var_map: jsonb("content_var_map").$type<Record<string, string>>(),
  created_at: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const insertFeedbackSchema = createInsertSchema(feedbacksTable).omit({
  id: true,
  created_at: true,
});
export const insertWhatsappTemplateSchema = createInsertSchema(
  whatsappTemplatesTable,
).omit({ id: true, created_at: true });

export type Feedback = typeof feedbacksTable.$inferSelect;
export type InsertFeedback = z.infer<typeof insertFeedbackSchema>;
export type WhatsappTemplate = typeof whatsappTemplatesTable.$inferSelect;
export type InsertWhatsappTemplate = z.infer<
  typeof insertWhatsappTemplateSchema
>;

// ── Feedback settings ──────────────────────────────────────────────────────────
// Single-row config for the recurring member feedback prompt. Lets leaders edit
// the prompt copy + cadence from the backend without a frontend redeploy.
export const feedbackSettingsTable = pgTable("feedback_settings", {
  id: uuid("id").primaryKey().defaultRandom(),
  enabled: boolean("enabled").notNull().default(true),
  interval_days: integer("interval_days").notNull().default(14),
  title: text("title").notNull(),
  body: text("body").notNull(),
  examples: jsonb("examples").$type<string[]>(),
  updated_at: timestamp("updated_at", { withTimezone: true }).defaultNow(),
  updated_by: uuid("updated_by"),
});

export const insertFeedbackSettingsSchema = createInsertSchema(
  feedbackSettingsTable,
).omit({ id: true, updated_at: true });

export type FeedbackSettings = typeof feedbackSettingsTable.$inferSelect;
export type InsertFeedbackSettings = z.infer<
  typeof insertFeedbackSettingsSchema
>;

// ── WhatsApp automation settings ───────────────────────────────────────────────
// Single-row config that controls when the follow-up queue generator runs.
// Leaders can change the day/time from the UI without a code deploy.
export const whatsappAutomationSettingsTable = pgTable(
  "whatsapp_automation_settings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    enabled: boolean("enabled").notNull().default(true),
    day_of_week: integer("day_of_week").notNull().default(5), // 0=Sun … 5=Fri
    time: text("time").notNull().default("18:30"),             // HH:MM (SAST)
    include_never_attended: boolean("include_never_attended")
      .notNull()
      .default(true),
    updated_at: timestamp("updated_at", { withTimezone: true }).defaultNow(),
    updated_by: uuid("updated_by"),
  },
);

export const insertWhatsappAutomationSettingsSchema = createInsertSchema(
  whatsappAutomationSettingsTable,
).omit({ id: true, updated_at: true });

export type WhatsappAutomationSettings =
  typeof whatsappAutomationSettingsTable.$inferSelect;
export type InsertWhatsappAutomationSettings = z.infer<
  typeof insertWhatsappAutomationSettingsSchema
>;

// ── Follow-up queue ────────────────────────────────────────────────────────────
// Pending WhatsApp messages generated by the automation cron. Leaders review &
// approve them before they're sent. Each row = one message to one person.
export const followUpQueueTable = pgTable("follow_up_queue", {
  id: uuid("id").primaryKey().defaultRandom(),
  profile_id: uuid("profile_id")
    .notNull()
    .references(() => profilesTable.id),
  stage_weeks: integer("stage_weeks").notNull(),
  weeks_absent: integer("weeks_absent").notNull(),
  message_preview: text("message_preview").notNull(),
  template_id: uuid("template_id").references(
    () => whatsappTemplatesTable.id,
  ),
  status: followUpQueueStatusEnum("status").notNull().default("pending"),
  twilio_sid: text("twilio_sid"),
  error_message: text("error_message"),
  created_at: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  sent_at: timestamp("sent_at", { withTimezone: true }),
  reviewed_by: uuid("reviewed_by").references(() => profilesTable.id),
  reviewed_at: timestamp("reviewed_at", { withTimezone: true }),
});

export const insertFollowUpQueueSchema = createInsertSchema(
  followUpQueueTable,
).omit({ id: true, created_at: true });

export type FollowUpQueueEntry = typeof followUpQueueTable.$inferSelect;
export type InsertFollowUpQueueEntry = z.infer<
  typeof insertFollowUpQueueSchema
>;


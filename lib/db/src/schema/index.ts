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

export const qrCodeTypeEnum = pgEnum("qr_code_type", ["public", "leader"]);

export const rsvpStatusEnum = pgEnum("rsvp_status", [
  "going",
  "not_going",
  "maybe",
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

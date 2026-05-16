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
  uniqueIndex,
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

export const messageStatusEnum = pgEnum("message_status", [
  "sent",
  "read",
  "archived",
]);

export const profilesTable = pgTable("profiles", {
  id: uuid("id").primaryKey().defaultRandom(),
  clerk_id: text("clerk_id").unique(),
  full_name: text("full_name").notNull(),
  phone: text("phone").notNull(),
  email: text("email"),
  gender: genderEnum("gender").notNull(),
  age: integer("age").notNull(),
  heard_from: text("heard_from").notNull(),
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
  created_by: uuid("created_by").references(() => profilesTable.id, {
    onDelete: "set null",
  }),
  age_min: integer("age_min"),
  age_max: integer("age_max"),
  custom_requirements: jsonb("custom_requirements"),
  is_public: boolean("is_public").notNull().default(true),
  created_at: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const attendanceTable = pgTable(
  "attendance",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    profile_id: uuid("profile_id").references(() => profilesTable.id, {
      onDelete: "cascade",
    }),
    event_id: uuid("event_id").references(() => eventsTable.id, {
      onDelete: "cascade",
    }),
    checked_in_at: timestamp("checked_in_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    session_date: date("session_date").notNull(),
    check_in_method: checkInMethodEnum("check_in_method")
      .notNull()
      .default("manual"),
  },
  (table) => ({
    uniqueProfileSession: uniqueIndex("attendance_profile_session_unique").on(
      table.profile_id,
      table.session_date,
    ),
  }),
);

export const rsvpsTable = pgTable("rsvps", {
  id: uuid("id").primaryKey().defaultRandom(),
  event_id: uuid("event_id")
    .notNull()
    .references(() => eventsTable.id, { onDelete: "cascade" }),
  profile_id: uuid("profile_id")
    .notNull()
    .references(() => profilesTable.id, { onDelete: "cascade" }),
  status: rsvpStatusEnum("status").notNull().default("going"),
  created_at: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const membershipRequestsTable = pgTable("membership_requests", {
  id: uuid("id").primaryKey().defaultRandom(),
  profile_id: uuid("profile_id")
    .notNull()
    .references(() => profilesTable.id, { onDelete: "cascade" }),
  reason: text("reason").notNull(),
  status: membershipStatusEnum("status").notNull().default("pending"),
  reviewed_by: uuid("reviewed_by").references(() => profilesTable.id, {
    onDelete: "set null",
  }),
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
    .references(() => profilesTable.id, { onDelete: "cascade" }),
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

export const checkInRequestsTable = pgTable(
  "check_in_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    profile_id: uuid("profile_id")
      .notNull()
      .references(() => profilesTable.id, { onDelete: "cascade" }),
    session_date: date("session_date").notNull(),
    status: checkInRequestStatusEnum("status").notNull().default("pending"),
    requested_at: timestamp("requested_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    reviewed_by: uuid("reviewed_by").references(() => profilesTable.id, {
      onDelete: "set null",
    }),
    reviewed_at: timestamp("reviewed_at", { withTimezone: true }),
  },
  (table) => ({
    uniqueProfileSession: uniqueIndex(
      "check_in_requests_profile_session_unique",
    ).on(table.profile_id, table.session_date),
  }),
);

export const messagesTable = pgTable("messages", {
  id: uuid("id").primaryKey().defaultRandom(),
  sender_id: uuid("sender_id")
    .notNull()
    .references(() => profilesTable.id, { onDelete: "cascade" }),
  recipient_id: uuid("recipient_id")
    .notNull()
    .references(() => profilesTable.id, { onDelete: "cascade" }),
  content: text("content").notNull(),
  status: messageStatusEnum("status").notNull().default("sent"),
  created_at: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const leaderSlotsTable = pgTable("leader_slots", {
  id: uuid("id").primaryKey().defaultRandom(),
  profile_id: uuid("profile_id")
    .notNull()
    .unique()
    .references(() => profilesTable.id, { onDelete: "cascade" }),
  slot_number: integer("slot_number").notNull(),
  assigned_at: timestamp("assigned_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const superAdminSlotsTable = pgTable("super_admin_slots", {
  id: uuid("id").primaryKey().defaultRandom(),
  profile_id: uuid("profile_id")
    .notNull()
    .unique()
    .references(() => profilesTable.id, { onDelete: "cascade" }),
  slot_number: integer("slot_number").notNull(),
  assigned_at: timestamp("assigned_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
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
export const insertMessageSchema = createInsertSchema(messagesTable).omit({
  id: true,
  created_at: true,
});
export const insertLeaderSlotSchema = createInsertSchema(leaderSlotsTable).omit(
  {
    id: true,
    assigned_at: true,
  },
);
export const insertSuperAdminSlotSchema = createInsertSchema(
  superAdminSlotsTable,
).omit({ id: true, assigned_at: true });

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
export type Message = typeof messagesTable.$inferSelect;
export type InsertMessage = z.infer<typeof insertMessageSchema>;
export type LeaderSlot = typeof leaderSlotsTable.$inferSelect;
export type InsertLeaderSlot = z.infer<typeof insertLeaderSlotSchema>;
export type SuperAdminSlot = typeof superAdminSlotsTable.$inferSelect;
export type InsertSuperAdminSlot = z.infer<typeof insertSuperAdminSlotSchema>;

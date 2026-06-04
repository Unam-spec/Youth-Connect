// Vendored Drizzle schema for the Deno Edge Functions runtime.
// MIRRORS lib/db/src/schema/index.ts (single source of truth in the Node packages).
// Kept in sync manually; uses npm: specifiers so Deno can resolve drizzle-orm.
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
  type AnyPgColumn,
} from "npm:drizzle-orm@0.45.2/pg-core";

export const roleEnum = pgEnum("role", ["super_admin", "leader", "member", "visitor"]);
export const genderEnum = pgEnum("gender", ["male", "female", "other"]);
export const membershipStatusEnum = pgEnum("membership_status", ["pending", "approved", "rejected"]);
export const checkInMethodEnum = pgEnum("check_in_method", ["manual", "self", "qr"]);
export const qrCodeTypeEnum = pgEnum("qr_code_type", ["public", "leader", "session"]);
export const rsvpStatusEnum = pgEnum("rsvp", ["going", "not_going", "maybe"]);
export const checkInRequestStatusEnum = pgEnum("check_in_request_status", ["pending", "approved", "rejected"]);
export const checkInRequestTypeEnum = pgEnum("check_in_request_type", ["member", "visitor"]);

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
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
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
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const attendanceTable = pgTable("attendance", {
  id: uuid("id").primaryKey().defaultRandom(),
  profile_id: uuid("profile_id").references(() => profilesTable.id),
  event_id: uuid("event_id").references(() => eventsTable.id),
  checked_in_at: timestamp("checked_in_at", { withTimezone: true }).notNull().defaultNow(),
  session_date: date("session_date").notNull(),
  check_in_method: checkInMethodEnum("check_in_method").notNull().default("manual"),
  type: checkInRequestTypeEnum("type").notNull().default("member"),
});

export const rsvpsTable = pgTable("rsvps", {
  id: uuid("id").primaryKey().defaultRandom(),
  event_id: uuid("event_id").notNull().references(() => eventsTable.id),
  profile_id: uuid("profile_id").notNull().references(() => profilesTable.id),
  status: rsvpStatusEnum("status").notNull().default("going"),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const membershipRequestsTable = pgTable("membership_requests", {
  id: uuid("id").primaryKey().defaultRandom(),
  profile_id: uuid("profile_id").notNull().references(() => profilesTable.id),
  reason: text("reason").notNull(),
  status: membershipStatusEnum("status").notNull().default("pending"),
  reviewed_by: uuid("reviewed_by").references(() => profilesTable.id),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const qrCodesTable = pgTable("qr_codes", {
  id: uuid("id").primaryKey().defaultRandom(),
  slug: text("slug").notNull().unique(),
  type: qrCodeTypeEnum("type").notNull(),
  active: boolean("active").notNull().default(true),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const leaderPermissionsTable = pgTable("leader_permissions", {
  id: uuid("id").primaryKey().defaultRandom(),
  profile_id: uuid("profile_id").notNull().unique().references(() => profilesTable.id),
  can_create_events: boolean("can_create_events").notNull().default(true),
  can_manage_members: boolean("can_manage_members").notNull().default(false),
  can_view_kpis: boolean("can_view_kpis").notNull().default(true),
  can_approve_membership: boolean("can_approve_membership").notNull().default(false),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const visitorsTable = pgTable("visitors", {
  id: uuid("id").primaryKey().defaultRandom(),
  full_name: text("full_name").notNull(),
  phone_number: text("phone_number").notNull(),
  email: text("email"),
  gender: genderEnum("gender").notNull(),
  age: integer("age").notNull(),
  how_did_you_hear: text("how_did_you_hear").notNull(),
  school: text("school"),
  parent_phone: text("parent_phone"),
  parent_name: text("parent_name"),
  whatsapp_opt_in: boolean("whatsapp_opt_in").notNull().default(false),
  session_date: date("session_date").notNull(),
  status: checkInRequestStatusEnum("status").notNull().default("pending"),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const checkInRequestsTable = pgTable("check_in_requests", {
  id: uuid("id").primaryKey().defaultRandom(),
  profile_id: uuid("profile_id").references(() => profilesTable.id),
  visitor_id: uuid("visitor_id").references(() => visitorsTable.id),
  type: checkInRequestTypeEnum("type").notNull().default("member"),
  session_date: date("session_date").notNull(),
  status: checkInRequestStatusEnum("status").notNull().default("pending"),
  requested_at: timestamp("requested_at", { withTimezone: true }).notNull().defaultNow(),
  reviewed_by: uuid("reviewed_by").references(() => profilesTable.id),
  reviewed_at: timestamp("reviewed_at", { withTimezone: true }),
});

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

// Chat messages (mirrors artifacts/api-server/src/db/schema/messages.ts)
export const messagesTable = pgTable("messages", {
  id: uuid("id").primaryKey().defaultRandom(),
  sender_id: text("sender_id").notNull(),
  sender_name: text("sender_name").notNull(),
  sender_role: roleEnum("sender_role").notNull(),
  content: text("content").notNull(),
  replyToId: uuid("reply_to_id").references((): AnyPgColumn => messagesTable.id, { onDelete: "set null" }),
  deletedForEveryone: boolean("deleted_for_everyone").default(false).notNull(),
  deletedForSender: boolean("deleted_for_sender").default(false).notNull(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Profile = typeof profilesTable.$inferSelect;

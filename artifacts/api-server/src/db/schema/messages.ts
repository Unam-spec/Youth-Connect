import { pgTable, text, uuid, timestamp, pgEnum } from "drizzle-orm/pg-core";

export const roleEnum = pgEnum("role", [
  "super_admin",
  "leader",
  "member",
  "visitor",
]);

export const messagesTable = pgTable("messages", {
  id: uuid("id").primaryKey().defaultRandom(),
  sender_id: text("sender_id").notNull(),
  sender_name: text("sender_name").notNull(),
  sender_role: roleEnum("sender_role").notNull(),
  content: text("content").notNull(),
  created_at: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

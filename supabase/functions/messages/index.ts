// Supabase Edge Function: messages
// Port of artifacts/api-server/src/routes/messages.ts.
//
// NOTE: The SSE `GET /messages/stream` route and the `clients` broadcast
// machinery from the Express version are DROPPED entirely — the frontend now
// polls `GET /messages` instead of subscribing to a live stream.

import { createApp } from "../_shared/router.ts";
import { db } from "../_shared/db.ts";
import { messagesTable, profilesTable } from "../_shared/schema.ts";
import { getClerkUserId, validateLeaderSession } from "../_shared/auth.ts";
import { asc, eq } from "npm:drizzle-orm@0.45.2";
import type { Context, Next } from "npm:hono@4";

const app = createApp();

// ── Auth middleware (ported from messages.ts) ────────────────────────────────

/**
 * Resolves a leader/super_admin identity from either a Clerk JWT or a PIN
 * x-leader-session header, and stashes senderId/senderRole/senderName on the
 * context. Returns 403 if the caller is neither a leader nor super_admin.
 */
async function resolveLeaderOrSuperAdmin(c: Context, next: Next) {
  try {
    const uid = await getClerkUserId(c.req.raw);
    if (uid) {
      const profile = await db.query.profilesTable.findFirst({
        where: eq(profilesTable.clerk_id, uid),
      });
      if (profile && ["leader", "super_admin"].includes(profile.role as string)) {
        c.set("senderId", uid);
        c.set("senderRole", profile.role);
        c.set("senderName", profile.full_name);
        return next();
      }
    }

    const p = await validateLeaderSession(c.req.header("x-leader-session") ?? null);
    if (p && ["leader", "super_admin"].includes(p.role as string)) {
      c.set("senderId", p.id);
      c.set("senderRole", p.role);
      c.set("senderName", p.full_name);
      return next();
    }

    return c.json({ message: "Forbidden" }, 403);
  } catch (err) {
    console.error("resolveLeaderOrSuperAdmin error:", err);
    return c.json({ message: "Forbidden" }, 403);
  }
}

/**
 * Like resolveLeaderOrSuperAdmin, but requires the DB-validated role to be
 * exactly super_admin. Also stashes sender identity for consistency.
 */
async function resolveSuperAdmin(c: Context, next: Next) {
  try {
    const uid = await getClerkUserId(c.req.raw);
    if (uid) {
      const profile = await db.query.profilesTable.findFirst({
        where: eq(profilesTable.clerk_id, uid),
      });
      if (profile && profile.role === "super_admin") {
        c.set("senderId", uid);
        c.set("senderRole", profile.role);
        c.set("senderName", profile.full_name);
        return next();
      }
    }

    const p = await validateLeaderSession(c.req.header("x-leader-session") ?? null);
    if (p && p.role === "super_admin") {
      c.set("senderId", p.id);
      c.set("senderRole", p.role);
      c.set("senderName", p.full_name);
      return next();
    }

    return c.json({ message: "Forbidden" }, 403);
  } catch (err) {
    console.error("resolveSuperAdmin error:", err);
    return c.json({ message: "Forbidden" }, 403);
  }
}

// ── Routes ───────────────────────────────────────────────────────────────────

// GET /messages - Fetch chat history (leaders/super admins only)
app.get("/messages", resolveLeaderOrSuperAdmin, async (c) => {
  try {
    const messages = await db
      .select()
      .from(messagesTable)
      .orderBy(asc(messagesTable.created_at));
    return c.json(messages);
  } catch (error) {
    console.error("Error fetching messages:", error);
    return c.json({ message: "Internal server error" }, 500);
  }
});

// POST /messages - Send new message (leaders/super admins only)
app.post("/messages", resolveLeaderOrSuperAdmin, async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const { content, reply_to_id } = body ?? {};

  if (!content || typeof content !== "string" || !content.trim()) {
    return c.json({ message: "content is required" }, 400);
  }

  try {
    const [newMessage] = await db
      .insert(messagesTable)
      .values({
        content: content.trim(),
        sender_id: c.get("senderId"),
        sender_name: c.get("senderName"),
        sender_role: c.get("senderRole"),
        replyToId: reply_to_id || null,
      })
      .returning();

    return c.json(newMessage, 201);
  } catch (error) {
    console.error("Error creating message:", error);
    return c.json({ message: "Internal server error" }, 500);
  }
});

// DELETE /messages/:id - Moderation delete (super admins only)
app.delete("/messages/:id", resolveSuperAdmin, async (c) => {
  const id = c.req.param("id");

  try {
    const deletedMessages = await db
      .delete(messagesTable)
      .where(eq(messagesTable.id, id))
      .returning();

    if (deletedMessages.length === 0) {
      return c.json({ message: "Message not found" }, 404);
    }

    return c.body(null, 204);
  } catch (error) {
    console.error("Error deleting message:", error);
    return c.json({ message: "Internal server error" }, 500);
  }
});

// PATCH /messages/:id/delete-for-me (leaders/super admins; own message only)
app.patch("/messages/:id/delete-for-me", resolveLeaderOrSuperAdmin, async (c) => {
  const id = c.req.param("id");

  try {
    const [message] = await db
      .select()
      .from(messagesTable)
      .where(eq(messagesTable.id, id));
    if (!message) return c.json({ error: "Message not found" }, 404);
    if (message.sender_id !== c.get("senderId")) {
      return c.json({ error: "Forbidden" }, 403);
    }

    await db
      .update(messagesTable)
      .set({ deletedForSender: true })
      .where(eq(messagesTable.id, id));

    return c.json({ success: true });
  } catch (error) {
    console.error("Error deleting message for sender:", error);
    return c.json({ message: "Internal server error" }, 500);
  }
});

// PATCH /messages/:id/delete-for-everyone (leaders/super admins; own OR role-based)
app.patch("/messages/:id/delete-for-everyone", resolveLeaderOrSuperAdmin, async (c) => {
  const id = c.req.param("id");

  try {
    const [message] = await db
      .select()
      .from(messagesTable)
      .where(eq(messagesTable.id, id));
    if (!message) return c.json({ error: "Message not found" }, 404);

    const senderRole = c.get("senderRole") as string;
    const canDelete =
      message.sender_id === c.get("senderId") ||
      ["super_admin", "leader"].includes(senderRole);
    if (!canDelete) return c.json({ error: "Forbidden" }, 403);

    const [updated] = await db
      .update(messagesTable)
      .set({ deletedForEveryone: true, deletedAt: new Date() })
      .where(eq(messagesTable.id, id))
      .returning();

    return c.json(updated);
  } catch (error) {
    console.error("Error deleting message for everyone:", error);
    return c.json({ message: "Internal server error" }, 500);
  }
});

Deno.serve(app.fetch);

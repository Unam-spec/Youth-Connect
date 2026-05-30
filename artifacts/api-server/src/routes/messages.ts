import { NextFunction, Request, Response, Router } from "express";
import { getAuth } from "@clerk/express";
import { db as messagesDb } from "../db";
import { db as mainDb, profilesTable } from "@workspace/db";
import { messagesTable } from "../db/schema/messages";
import { eq, asc } from "drizzle-orm";

const messagesRouter = Router();

// Store active Server-Sent Events (SSE) clients
let clients: { id: string; res: Response }[] = [];

// Middleware to resolve leader/super_admin identity from either Clerk or PIN leader session
const resolveLeaderOrSuperAdmin = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const auth = getAuth(req);
    if (auth?.userId) {
      const claims = (req as any).auth?.sessionClaims ?? {};
      if (["leader", "super_admin"].includes(claims.role as string)) {
        req.body.sender_id = auth.userId;
        req.body.sender_role = claims.role;
        req.body.sender_name =
          [claims.given_name, claims.family_name].filter(Boolean).join(" ").trim() ||
          claims.first_name ||
          "Leader";
        return next();
      }
    }

    const h = req.headers["x-leader-session"];
    if (h) {
      const s = JSON.parse(h as string);
      if (typeof s?.expires_at === "number" && Date.now() < s.expires_at) {
        const profile = await mainDb.query.profilesTable.findFirst({
          where: eq(profilesTable.id, s.profile_id),
        });
        if (profile && ["leader", "super_admin"].includes(profile.role as string)) {
          req.body.sender_id = profile.id;
          req.body.sender_role = profile.role;
          req.body.sender_name = profile.full_name;
          return next();
        }
      }
    }

    res.status(403).json({ message: "Forbidden" });
    return;
  } catch (err) {
    res.status(403).json({ message: "Forbidden" });
    return;
  }
};

// Middleware to check for super_admin role from either Clerk or PIN leader session
const resolveSuperAdmin = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const auth = getAuth(req);
    if (auth?.userId) {
      const claims = (req as any).auth?.sessionClaims ?? {};
      if (claims.role === "super_admin") {
        return next();
      }
    }

    const h = req.headers["x-leader-session"];
    if (h) {
      const s = JSON.parse(h as string);
      if (typeof s?.expires_at === "number" && Date.now() < s.expires_at) {
        if (s.role === "super_admin") {
          return next();
        }
      }
    }

    res.status(403).json({ message: "Forbidden" });
    return;
  } catch (err) {
    res.status(403).json({ message: "Forbidden" });
    return;
  }
};

// GET /api/messages: Fetch chat history (leaders/super admins only)
messagesRouter.get("/messages", resolveLeaderOrSuperAdmin, async (req, res) => {
  try {
    const messages = await messagesDb
      .select()
      .from(messagesTable)
      .orderBy(asc(messagesTable.created_at));
    return res.json(messages);
  } catch (error) {
    console.error("Error fetching messages:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
});

// GET /api/messages/stream: Real-time SSE stream (leaders/super admins only)
messagesRouter.get("/messages/stream", resolveLeaderOrSuperAdmin, (req, res) => {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    "Connection": "keep-alive",
  });
  res.flushHeaders();

  const clientId = Math.random().toString(36).substring(2);
  clients.push({ id: clientId, res });

  // Send initial keep-alive comment
  res.write(": keepalive\n\n");

  // Keep-alive heartbeat interval to prevent Railway/Vercel link timeouts
  const heartbeat = setInterval(() => {
    res.write(": keepalive\n\n");
  }, 15_000);

  req.on("close", () => {
    clearInterval(heartbeat);
    clients = clients.filter((c) => c.id !== clientId);
  });
});

// POST /api/messages: Send new message (leaders/super admins only)
messagesRouter.post("/messages", resolveLeaderOrSuperAdmin, async (req, res) => {
  const { content, sender_id, sender_name, sender_role } = req.body;

  if (!content || typeof content !== "string" || !content.trim()) {
    return res.status(400).json({ message: "content is required" });
  }

  try {
    const [newMessage] = await messagesDb
      .insert(messagesTable)
      .values({
        content: content.trim(),
        sender_id,
        sender_name,
        sender_role,
      })
      .returning();

    // Broadcast new message to all active clients
    const sseData = `data: ${JSON.stringify(newMessage)}\n\n`;
    clients.forEach((c) => c.res.write(sseData));

    return res.status(201).json(newMessage);
  } catch (error) {
    console.error("Error creating message:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
});

// DELETE /api/messages/:id: Moderation delete (super admins only)
messagesRouter.delete("/messages/:id", resolveSuperAdmin, async (req, res) => {
  const id = req.params.id as string;

  try {
    const deletedMessages = await messagesDb
      .delete(messagesTable)
      .where(eq(messagesTable.id, id))
      .returning();

    if (deletedMessages.length === 0) {
      return res.status(404).json({ message: "Message not found" });
    }

    // Broadcast deletion event to all active clients
    const sseData = `event: delete\ndata: ${JSON.stringify({ id })}\n\n`;
    clients.forEach((c) => c.res.write(sseData));

    return res.status(204).send();
  } catch (error) {
    console.error("Error deleting message:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
});

export default messagesRouter;

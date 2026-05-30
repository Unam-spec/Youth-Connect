import { NextFunction, Request, Response, Router } from "express";
import { getAuth } from "@clerk/express";
import { db } from "../db";
import { messagesTable } from "../db/schema/messages";
import { eq } from "drizzle-orm";

const messagesRouter = Router();

// Middleware to check for leader or super_admin role
const checkLeaderOrSuperAdmin = (
  req: Request,
  res: Response,
  next: NextFunction,
): void => {
  const { sessionClaims } = getAuth(req);
  if (
    !sessionClaims ||
    !["leader", "super_admin"].includes(sessionClaims.role as string)
  ) {
    res.status(403).json({ message: "Forbidden" });
    return;
  }
  next();
};

// Middleware to check for super_admin role
const checkSuperAdmin = (req: Request, res: Response, next: NextFunction): void => {
  const { sessionClaims } = getAuth(req);
  if (!sessionClaims || sessionClaims.role !== "super_admin") {
    res.status(403).json({ message: "Forbidden" });
    return;
  }
  next();
};

// GET /api/messages: leaders/super admins only
messagesRouter.get("/", checkLeaderOrSuperAdmin, async (req, res) => {
  try {
    const messages = await db.select().from(messagesTable);
    return res.json(messages);
  } catch (error) {
    console.error("Error fetching messages:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
});

// POST /api/messages: leaders/super admins only
messagesRouter.post("/", checkLeaderOrSuperAdmin, async (req, res) => {
  const { content, sender_name, sender_role } = req.body;
  const { userId } = getAuth(req);

  if (!content || !sender_name || !sender_role || !userId) {
    return res.status(400).json({ message: "Missing required fields" });
  }

  try {
    const newMessage = await db
      .insert(messagesTable)
      .values({
        content,
        sender_id: userId,
        sender_name,
        sender_role,
      })
      .returning();
    return res.status(201).json(newMessage[0]);
  } catch (error) {
    console.error("Error creating message:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
});

// DELETE /api/messages/:id: super admins only
messagesRouter.delete("/:id", checkSuperAdmin, async (req, res) => {
  const id = req.params.id as string;

  try {
    const deletedMessages = await db
      .delete(messagesTable)
      .where(eq(messagesTable.id, id))
      .returning();

    if (deletedMessages.length === 0) {
      return res.status(404).json({ message: "Message not found" });
    }

    return res.status(204).send();
  } catch (error) {
    console.error("Error deleting message:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
});

export default messagesRouter;

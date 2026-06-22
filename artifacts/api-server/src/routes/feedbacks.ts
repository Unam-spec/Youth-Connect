import { Router, type Request, type Response } from "express";
import { eq, desc } from "drizzle-orm";
import {
  db,
  feedbacksTable,
  feedbackSettingsTable,
  profilesTable,
  insertFeedbackSchema,
  insertFeedbackSettingsSchema,
} from "@workspace/db";
import { requireLeaderSession } from "../middlewares/requireLeaderSession";

const router = Router();

// Fallbacks if the settings row hasn't been seeded yet (boot SCHEMA_PATCHES seeds it).
const DEFAULT_FEEDBACK_SETTINGS = {
  enabled: true,
  interval_days: 14,
  title: "How's your JG Youth experience?",
  body: "We'd love a quick word — what's going well, or what could be better?",
  examples: [
    "What's something you loved recently? 🙌",
    "Anything we could do better at sessions?",
    "An event or topic you'd love to see",
  ],
};

// POST /feedbacks - Submit feedback (public: members, visitors, or anonymous)
router.post("/feedbacks", async (req: Request, res: Response) => {
  try {
    const parsed = insertFeedbackSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.flatten() });
    }
    // Anonymous submissions never persist a user_id, even if one is supplied.
    const user_id = parsed.data.anonymous ? null : (parsed.data.user_id ?? null);
    const [feedback] = await db
      .insert(feedbacksTable)
      .values({
        content: parsed.data.content,
        anonymous: parsed.data.anonymous ?? false,
        user_id,
      })
      .returning();
    return res.status(201).json(feedback);
  } catch (err) {
    req.log.error(err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// GET /feedbacks/settings - Public read of the prompt copy + cadence (used by the
// member feedback modal). Declared before /feedbacks/:id so "settings" isn't an id.
router.get("/feedbacks/settings", async (req: Request, res: Response) => {
  try {
    const [row] = await db.select().from(feedbackSettingsTable).limit(1);
    return res.json(row ?? DEFAULT_FEEDBACK_SETTINGS);
  } catch (err) {
    req.log.error(err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// PATCH /feedbacks/settings - Update prompt copy/cadence (protected: leader)
router.patch("/feedbacks/settings", requireLeaderSession("leader"), async (req: Request, res: Response) => {
  try {
    const parsed = insertFeedbackSettingsSchema.partial().safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.flatten() });
    }
    const patch = {
      ...parsed.data,
      updated_at: new Date(),
      updated_by: req.leaderId ?? null,
    };
    const [existing] = await db.select().from(feedbackSettingsTable).limit(1);
    if (existing) {
      const [updated] = await db
        .update(feedbackSettingsTable)
        .set(patch)
        .where(eq(feedbackSettingsTable.id, existing.id))
        .returning();
      return res.json(updated);
    }
    // No row yet — create one, filling required fields from defaults.
    const [created] = await db
      .insert(feedbackSettingsTable)
      .values({
        title: parsed.data.title ?? DEFAULT_FEEDBACK_SETTINGS.title,
        body: parsed.data.body ?? DEFAULT_FEEDBACK_SETTINGS.body,
        ...patch,
      })
      .returning();
    return res.json(created);
  } catch (err) {
    req.log.error(err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// GET /feedbacks - List feedback (protected: leader). Anonymous entries hide the author.
router.get("/feedbacks", requireLeaderSession("leader"), async (req: Request, res: Response) => {
  try {
    const rows = await db
      .select({
        id: feedbacksTable.id,
        content: feedbacksTable.content,
        anonymous: feedbacksTable.anonymous,
        user_id: feedbacksTable.user_id,
        created_at: feedbacksTable.created_at,
        author: {
          id: profilesTable.id,
          full_name: profilesTable.full_name,
        },
      })
      .from(feedbacksTable)
      .leftJoin(profilesTable, eq(feedbacksTable.user_id, profilesTable.id))
      .orderBy(desc(feedbacksTable.created_at));

    // Strip identifying fields from anonymous feedback before returning.
    const result = rows.map((row) =>
      row.anonymous ? { ...row, user_id: null, author: null } : row,
    );
    return res.json(result);
  } catch (err) {
    req.log.error(err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// GET /feedbacks/:id - View a single feedback entry (protected: leader)
router.get("/feedbacks/:id", requireLeaderSession("leader"), async (req: Request, res: Response) => {
  try {
    const feedback = await db.query.feedbacksTable.findFirst({
      where: eq(feedbacksTable.id, req.params.id as string),
    });
    if (!feedback) {
      return res.status(404).json({ error: "Feedback not found" });
    }
    if (feedback.anonymous) {
      return res.json({ ...feedback, user_id: null });
    }
    return res.json(feedback);
  } catch (err) {
    req.log.error(err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// PATCH /feedbacks/:id - Update feedback content/flags (protected: leader)
router.patch("/feedbacks/:id", requireLeaderSession("leader"), async (req: Request, res: Response) => {
  try {
    const parsed = insertFeedbackSchema.partial().safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.flatten() });
    }
    const [updated] = await db
      .update(feedbacksTable)
      .set(parsed.data)
      .where(eq(feedbacksTable.id, req.params.id as string))
      .returning();
    if (!updated) {
      return res.status(404).json({ error: "Feedback not found" });
    }
    return res.json(updated);
  } catch (err) {
    req.log.error(err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// DELETE /feedbacks/:id - Delete feedback (protected: leader)
router.delete("/feedbacks/:id", requireLeaderSession("leader"), async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    const [deleted] = await db
      .delete(feedbacksTable)
      .where(eq(feedbacksTable.id, id))
      .returning({ id: feedbacksTable.id });
    if (!deleted) {
      return res.status(404).json({ error: "Feedback not found" });
    }
    return res.status(200).json({ success: true, deletedId: deleted.id });
  } catch (err) {
    req.log.error(err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

export default router;

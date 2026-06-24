import { Router, type Request, type Response } from "express";
import { eq, desc } from "drizzle-orm";
import {
  db,
  whatsappTemplatesTable,
  insertWhatsappTemplateSchema,
  followUpQueueTable,
  profilesTable,
} from "@workspace/db";
import { and } from "drizzle-orm";
import { requireLeaderSession } from "../middlewares/requireLeaderSession";

const router = Router();

// GET /whatsapp-templates - List templates (protected: leader)
router.get("/whatsapp-templates", requireLeaderSession("leader"), async (req: Request, res: Response) => {
  try {
    const { template_type } = req.query;
    const templates = await db
      .select()
      .from(whatsappTemplatesTable)
      .where(
        template_type
          ? eq(whatsappTemplatesTable.template_type, template_type as string)
          : undefined,
      )
      .orderBy(desc(whatsappTemplatesTable.created_at));
    return res.json(templates);
  } catch (err) {
    req.log.error(err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// POST /whatsapp-templates - Create a template (protected: leader)
router.post("/whatsapp-templates", requireLeaderSession("leader"), async (req: Request, res: Response) => {
  try {
    const parsed = insertWhatsappTemplateSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.flatten() });
    }
    const [template] = await db
      .insert(whatsappTemplatesTable)
      .values({
        template_type: parsed.data.template_type,
        stage_weeks: parsed.data.stage_weeks ?? null,
        message_text: parsed.data.message_text,
        content_sid: parsed.data.content_sid ?? null,
        content_var_map: parsed.data.content_var_map ?? null,
        ...(parsed.data.color_hex ? { color_hex: parsed.data.color_hex } : {}),
      })
      .returning();
    return res.status(201).json(template);
  } catch (err) {
    req.log.error(err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// GET /whatsapp-templates/:id - View a single template (protected: leader)
router.get("/whatsapp-templates/:id", requireLeaderSession("leader"), async (req: Request, res: Response) => {
  try {
    const template = await db.query.whatsappTemplatesTable.findFirst({
      where: eq(whatsappTemplatesTable.id, req.params.id as string),
    });
    if (!template) {
      return res.status(404).json({ error: "Template not found" });
    }
    return res.json(template);
  } catch (err) {
    req.log.error(err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// PATCH /whatsapp-templates/:id - Update a template (protected: leader)
router.patch("/whatsapp-templates/:id", requireLeaderSession("leader"), async (req: Request, res: Response) => {
  try {
    const parsed = insertWhatsappTemplateSchema.partial().safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.flatten() });
    }
    const [updated] = await db
      .update(whatsappTemplatesTable)
      .set(parsed.data)
      .where(eq(whatsappTemplatesTable.id, req.params.id as string))
      .returning();
    if (!updated) {
      return res.status(404).json({ error: "Template not found" });
    }

    // Sync updated template to pending follow-ups using it
    if (updated.message_text) {
      const pendingQueue = await db
        .select({
          id: followUpQueueTable.id,
          profile_id: followUpQueueTable.profile_id,
          full_name: profilesTable.full_name,
        })
        .from(followUpQueueTable)
        .innerJoin(profilesTable, eq(followUpQueueTable.profile_id, profilesTable.id))
        .where(
          and(
            eq(followUpQueueTable.template_id, updated.id),
            eq(followUpQueueTable.status, "pending")
          )
        );

      if (pendingQueue.length > 0) {
        for (const item of pendingQueue) {
          const firstName = item.full_name?.split(" ")[0] || "there";
          const newPreview = updated.message_text
            .split("[User]").join(firstName)
            .split("[Leader]").join("JG Youth Team");

          await db
            .update(followUpQueueTable)
            .set({ message_preview: newPreview })
            .where(eq(followUpQueueTable.id, item.id));
        }
      }
    }

    return res.json(updated);
  } catch (err) {
    req.log.error(err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// DELETE /whatsapp-templates/:id - Delete a template (protected: leader)
router.delete("/whatsapp-templates/:id", requireLeaderSession("leader"), async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    const [deleted] = await db
      .delete(whatsappTemplatesTable)
      .where(eq(whatsappTemplatesTable.id, id))
      .returning({ id: whatsappTemplatesTable.id });
    if (!deleted) {
      return res.status(404).json({ error: "Template not found" });
    }
    return res.status(200).json({ success: true, deletedId: deleted.id });
  } catch (err) {
    req.log.error(err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

export default router;

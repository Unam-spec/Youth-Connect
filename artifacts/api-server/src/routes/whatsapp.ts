import { Router, type Request, type Response } from "express";
import { eq, and, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import {
  db,
  profilesTable,
  attendanceTable,
  whatsappTemplatesTable,
} from "@workspace/db";
import { requireLeaderSession } from "../middlewares/requireLeaderSession";
import { applyTemplateVars, sendWhatsAppFromTemplate } from "../lib/twilio";

const router = Router();

// Follow-up milestones (weeks absent) that map to `whatsapp_templates.stage_weeks`.
const STAGES = [2, 4, 6, 8] as const;
type Stage = (typeof STAGES)[number];

/** Map weeks-absent to the highest milestone reached (>=2), else null. */
function stageFor(weeks: number | null | undefined): Stage | null {
  if (weeks == null || weeks < 2) return null;
  if (weeks >= 8) return 8;
  if (weeks >= 6) return 6;
  if (weeks >= 4) return 4;
  return 2;
}

function firstName(name: string | null | undefined): string {
  return (name ?? "").trim().split(/\s+/)[0] ?? "";
}

// GET /whatsapp/follow-ups — members/visitors absent 2+ weeks, grouped by the
// 2/4/6/8-week milestone (protected: leader).
router.get(
  "/whatsapp/follow-ups",
  requireLeaderSession("leader"),
  async (req: Request, res: Response) => {
    try {
      const rows = await db
        .select({
          id: profilesTable.id,
          full_name: profilesTable.full_name,
          phone: profilesTable.phone,
          whatsapp_opt_in: profilesTable.whatsapp_opt_in,
          last_checkin: sql<string>`max(${attendanceTable.session_date})`,
          weeks_absent: sql<number>`floor((current_date - max(${attendanceTable.session_date}::date)) / 7)::int`,
        })
        .from(profilesTable)
        .leftJoin(
          attendanceTable,
          eq(profilesTable.id, attendanceTable.profile_id),
        )
        .where(inArray(profilesTable.role, ["member", "visitor"]))
        .groupBy(
          profilesTable.id,
          profilesTable.full_name,
          profilesTable.phone,
          profilesTable.whatsapp_opt_in,
        )
        .having(
          sql`max(${attendanceTable.session_date}) IS NOT NULL AND max(${attendanceTable.session_date}::date) <= (current_date - interval '2 weeks')`,
        );

      const groups: Record<string, unknown[]> = { "2": [], "4": [], "6": [], "8": [] };
      let total = 0;
      for (const r of rows) {
        const weeks = Number(r.weeks_absent);
        const stage = stageFor(weeks);
        if (!stage) continue;
        groups[String(stage)].push({ ...r, weeks_absent: weeks, stage_weeks: stage });
        total++;
      }

      return res.json({ total, groups });
    } catch (err) {
      req.log.error(err);
      return res.status(500).json({ error: "Internal server error" });
    }
  },
);

const SendBody = z.object({
  user_id: z.string().uuid(),
  leader_id: z.string().uuid(),
  // Optional override; otherwise computed from the user's last check-in.
  weeks_absent: z.number().int().nonnegative().optional(),
});

// POST /whatsapp/send — send the stage-appropriate follow-up WhatsApp to a user
// (protected: leader). Picks the `follow_up` template matching the user's weeks
// absent, fills [User]/[Leader], and sends via Twilio.
router.post(
  "/whatsapp/send",
  requireLeaderSession("leader"),
  async (req: Request, res: Response) => {
    try {
      const parsed = SendBody.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: parsed.error.flatten() });
      }
      const { user_id, leader_id } = parsed.data;

      const [user, leader] = await Promise.all([
        db.query.profilesTable.findFirst({ where: eq(profilesTable.id, user_id) }),
        db.query.profilesTable.findFirst({ where: eq(profilesTable.id, leader_id) }),
      ]);
      if (!user) return res.status(404).json({ error: "User not found" });
      if (!leader) return res.status(404).json({ error: "Leader not found" });
      if (!user.phone) {
        return res.status(400).json({ error: "User has no phone number on file" });
      }

      // Determine weeks absent (explicit override, else from last check-in).
      let weeks = parsed.data.weeks_absent ?? null;
      if (weeks == null) {
        const [att] = await db
          .select({
            weeks: sql<number | null>`floor((current_date - max(${attendanceTable.session_date}::date)) / 7)::int`,
          })
          .from(attendanceTable)
          .where(eq(attendanceTable.profile_id, user_id));
        weeks = att?.weeks == null ? null : Number(att.weeks);
      }

      const stage = stageFor(weeks);
      if (!stage) {
        return res.status(400).json({
          error:
            "Could not determine a follow-up stage (user is not 2+ weeks absent, or has no check-in history). Pass weeks_absent to override.",
        });
      }

      const template = await db.query.whatsappTemplatesTable.findFirst({
        where: and(
          eq(whatsappTemplatesTable.template_type, "follow_up"),
          eq(whatsappTemplatesTable.stage_weeks, stage),
        ),
      });
      if (!template) {
        return res.status(404).json({
          error: `No 'follow_up' template configured for ${stage} weeks absent`,
        });
      }

      const vars = {
        User: firstName(user.full_name),
        Leader: leader.full_name,
      };
      const sid = await sendWhatsAppFromTemplate({ to: user.phone, template, vars });

      return res.json({
        sent: true,
        sid,
        to: user.phone,
        stage_weeks: stage,
        weeks_absent: weeks,
        // Human-readable preview (the actual send may use an approved Content template).
        message: applyTemplateVars(template.message_text, vars),
      });
    } catch (err) {
      req.log.error(err);
      const msg = err instanceof Error ? err.message : "Failed to send WhatsApp message";
      // Twilio/config failures surface a clear message to the leader UI.
      return res.status(502).json({ error: msg });
    }
  },
);

export default router;

import { Router, type Request, type Response } from "express";
import { eq, and, inArray, sql, desc } from "drizzle-orm";
import { z } from "zod";
import {
  db,
  profilesTable,
  attendanceTable,
  whatsappTemplatesTable,
  whatsappAutomationSettingsTable,
  followUpQueueTable,
} from "@workspace/db";
import { requireLeaderSession } from "../middlewares/requireLeaderSession";
import { generateFollowUpQueue } from "../jobs/followUpGenerator";

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

// ── GET /whatsapp/follow-ups ────────────────────────────────────────────────────
// Members/visitors absent 2+ weeks, grouped by 2/4/6/8-week milestone.
// Now includes people who registered but never attended (synced with Analytics).
router.get(
  "/whatsapp/follow-ups",
  requireLeaderSession("leader"),
  async (req: Request, res: Response) => {
    try {
      // People who HAVE checked in before
      const attendedRows = await db
        .select({
          id: profilesTable.id,
          full_name: profilesTable.full_name,
          phone: profilesTable.phone,
          whatsapp_opt_in: profilesTable.whatsapp_opt_in,
          last_checkin: sql<string>`max(${attendanceTable.session_date})`,
          weeks_absent: sql<number>`floor((current_date - max(${attendanceTable.session_date}::date)) / 7)::int`,
        })
        .from(profilesTable)
        .innerJoin(attendanceTable, eq(profilesTable.id, attendanceTable.profile_id))
        .where(inArray(profilesTable.role, ["member", "visitor"]))
        .groupBy(
          profilesTable.id,
          profilesTable.full_name,
          profilesTable.phone,
          profilesTable.whatsapp_opt_in,
        )
        .having(
          sql`max(${attendanceTable.session_date}::date) <= (current_date - interval '2 weeks')`,
        );

      // People who NEVER checked in (weeks since registration)
      const neverAttendedRows = await db
        .select({
          id: profilesTable.id,
          full_name: profilesTable.full_name,
          phone: profilesTable.phone,
          whatsapp_opt_in: profilesTable.whatsapp_opt_in,
          last_checkin: sql<string | null>`NULL`,
          weeks_absent: sql<number>`floor(EXTRACT(EPOCH FROM age(current_date, ${profilesTable.created_at}::date)) / 604800)::int`,
        })
        .from(profilesTable)
        .leftJoin(attendanceTable, eq(profilesTable.id, attendanceTable.profile_id))
        .where(
          and(
            inArray(profilesTable.role, ["member", "visitor"]),
            sql`${profilesTable.created_at}::date <= (current_date - interval '2 weeks')`,
          ),
        )
        .groupBy(
          profilesTable.id,
          profilesTable.full_name,
          profilesTable.phone,
          profilesTable.whatsapp_opt_in,
          profilesTable.created_at,
        )
        .having(sql`count(${attendanceTable.id}) = 0`);

      const allRows = [...attendedRows, ...neverAttendedRows];

      const groups: Record<string, unknown[]> = { "2": [], "4": [], "6": [], "8": [] };
      let total = 0;
      for (const r of allRows) {
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

// ── GET /whatsapp/event-recipients ────────────────────────────────────────────
// Returns opted-in members to broadcast an event to.
router.get(
  "/whatsapp/event-recipients",
  requireLeaderSession("leader"),
  async (req: Request, res: Response) => {
    try {
      const rows = await db
        .select({
          id: profilesTable.id,
          full_name: profilesTable.full_name,
          phone: profilesTable.phone,
        })
        .from(profilesTable)
        .where(
          and(
            eq(profilesTable.whatsapp_opt_in, true),
            sql`btrim(${profilesTable.phone}) <> ''`,
            inArray(profilesTable.role, ["member", "visitor"]),
          ),
        );

      return res.json(rows);
    } catch (err) {
      req.log.error(err);
      return res.status(500).json({ error: "Internal server error" });
    }
  },
);

// ═══════════════════════════════════════════════════════════════════════════════
//  Follow-up QUEUE routes (new)
// ═══════════════════════════════════════════════════════════════════════════════

// ── GET /whatsapp/queue ─────────────────────────────────────────────────────────
// Returns all pending (and recently sent) queue entries with profile info.
router.get(
  "/whatsapp/queue",
  requireLeaderSession("leader"),
  async (req: Request, res: Response) => {
    try {
      const statusFilter = (req.query.status as string) || "pending";
      const validStatuses = ["pending", "approved", "rejected", "sent", "failed"];
      const statuses = statusFilter
        .split(",")
        .filter((s) => validStatuses.includes(s));

      const rows = await db
        .select({
          id: followUpQueueTable.id,
          profile_id: followUpQueueTable.profile_id,
          full_name: profilesTable.full_name,
          phone: profilesTable.phone,
          stage_weeks: followUpQueueTable.stage_weeks,
          weeks_absent: followUpQueueTable.weeks_absent,
          message_preview: followUpQueueTable.message_preview,
          status: followUpQueueTable.status,
          created_at: followUpQueueTable.created_at,
          sent_at: followUpQueueTable.sent_at,
          error_message: followUpQueueTable.error_message,
        })
        .from(followUpQueueTable)
        .leftJoin(profilesTable, eq(followUpQueueTable.profile_id, profilesTable.id))
        .where(
          sql`${followUpQueueTable.status}::text IN (${sql.join(
            statuses.map((s) => sql`${s}`),
            sql`, `,
          )})`,
        )
        .orderBy(desc(followUpQueueTable.created_at));

      return res.json(rows);
    } catch (err) {
      req.log.error(err);
      return res.status(500).json({ error: "Internal server error" });
    }
  },
);

// ── POST /whatsapp/queue/generate ───────────────────────────────────────────────
// Manual trigger: generate the queue right now (doesn't wait for the cron).
router.post(
  "/whatsapp/queue/generate",
  requireLeaderSession("leader"),
  async (req: Request, res: Response) => {
    try {
      const count = await generateFollowUpQueue();
      return res.json({ generated: count });
    } catch (err) {
      req.log.error(err);
      return res.status(500).json({ error: "Internal server error" });
    }
  },
);

// ── POST /whatsapp/queue/mark-sent ───────────────────────────────────────────
// Mark selected queue entries as sent (after the leader sends them via wa.me).
const MarkSentBody = z.object({
  ids: z.array(z.string().uuid()),
});

router.post(
  "/whatsapp/queue/mark-sent",
  requireLeaderSession("leader"),
  async (req: Request, res: Response) => {
    try {
      const parsed = MarkSentBody.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: parsed.error.flatten() });
      }
      const { ids } = parsed.data;

      if (ids.length === 0) {
        return res.json({ updated: 0 });
      }

      await db
        .update(followUpQueueTable)
        .set({
          status: "sent",
          sent_at: new Date(),
          reviewed_by: req.leaderId ?? null,
          reviewed_at: new Date(),
        })
        .where(
          and(
            inArray(followUpQueueTable.id, ids),
            eq(followUpQueueTable.status, "pending"),
          ),
        );

      return res.json({ updated: ids.length });
    } catch (err) {
      req.log.error(err);
      return res.status(500).json({ error: "Internal server error" });
    }
  },
);

// ── POST /whatsapp/queue/reject ─────────────────────────────────────────────────
const RejectBody = z.object({
  ids: z.array(z.string().uuid()),
});

router.post(
  "/whatsapp/queue/reject",
  requireLeaderSession("leader"),
  async (req: Request, res: Response) => {
    try {
      const parsed = RejectBody.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: parsed.error.flatten() });
      }
      const { ids } = parsed.data;

      await db
        .update(followUpQueueTable)
        .set({
          status: "rejected",
          reviewed_by: req.leaderId ?? null,
          reviewed_at: new Date(),
        })
        .where(
          and(
            inArray(followUpQueueTable.id, ids),
            eq(followUpQueueTable.status, "pending"),
          ),
        );

      return res.json({ rejected: ids.length });
    } catch (err) {
      req.log.error(err);
      return res.status(500).json({ error: "Internal server error" });
    }
  },
);

// ═══════════════════════════════════════════════════════════════════════════════
//  Automation SETTINGS routes
// ═══════════════════════════════════════════════════════════════════════════════

// ── GET /whatsapp/automation-settings ────────────────────────────────────────────
router.get(
  "/whatsapp/automation-settings",
  requireLeaderSession("leader"),
  async (req: Request, res: Response) => {
    try {
      const [settings] = await db
        .select()
        .from(whatsappAutomationSettingsTable)
        .limit(1);
      return res.json(
        settings ?? {
          enabled: true,
          day_of_week: 5,
          time: "18:30",
          include_never_attended: true,
        },
      );
    } catch (err) {
      req.log.error(err);
      return res.status(500).json({ error: "Internal server error" });
    }
  },
);

// ── PATCH /whatsapp/automation-settings ──────────────────────────────────────────
const AutomationPatchBody = z.object({
  enabled: z.boolean().optional(),
  day_of_week: z.number().int().min(0).max(6).optional(),
  time: z
    .string()
    .regex(/^\d{2}:\d{2}$/, "Time must be HH:MM format")
    .optional(),
  include_never_attended: z.boolean().optional(),
});

router.patch(
  "/whatsapp/automation-settings",
  requireLeaderSession("leader"),
  async (req: Request, res: Response) => {
    try {
      const parsed = AutomationPatchBody.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: parsed.error.flatten() });
      }

      const patch = {
        ...parsed.data,
        updated_at: new Date(),
        updated_by: req.leaderId ?? null,
      };

      const [existing] = await db
        .select()
        .from(whatsappAutomationSettingsTable)
        .limit(1);

      if (existing) {
        const [updated] = await db
          .update(whatsappAutomationSettingsTable)
          .set(patch)
          .where(eq(whatsappAutomationSettingsTable.id, existing.id))
          .returning();
        return res.json(updated);
      }

      // No row yet — create one
      const [created] = await db
        .insert(whatsappAutomationSettingsTable)
        .values({
          enabled: parsed.data.enabled ?? true,
          day_of_week: parsed.data.day_of_week ?? 5,
          time: parsed.data.time ?? "18:30",
          include_never_attended: parsed.data.include_never_attended ?? true,
          ...patch,
        })
        .returning();
      return res.json(created);
    } catch (err) {
      req.log.error(err);
      return res.status(500).json({ error: "Internal server error" });
    }
  },
);

export default router;


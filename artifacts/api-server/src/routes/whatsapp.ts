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
import { applyTemplateVars, sendWhatsAppFromTemplate } from "../lib/twilio";
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

// ── POST /whatsapp/send ─────────────────────────────────────────────────────────
const SendBody = z.object({
  user_id: z.string().uuid(),
  leader_id: z.string().uuid(),
  weeks_absent: z.number().int().nonnegative().optional(),
});

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
        message: applyTemplateVars(template.message_text, vars),
      });
    } catch (err) {
      req.log.error(err);
      const msg = err instanceof Error ? err.message : "Failed to send WhatsApp message";
      return res.status(502).json({ error: msg });
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

// ── POST /whatsapp/queue/approve ────────────────────────────────────────────────
// Approve & send selected queue entries (or all pending if ids=[] / omitted).
const ApproveBody = z.object({
  ids: z.array(z.string().uuid()).optional(), // empty/omitted = approve all
  leader_id: z.string().uuid(),
});

router.post(
  "/whatsapp/queue/approve",
  requireLeaderSession("leader"),
  async (req: Request, res: Response) => {
    try {
      const parsed = ApproveBody.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: parsed.error.flatten() });
      }
      const { ids, leader_id } = parsed.data;

      // Fetch queue entries to approve
      let entries;
      if (ids && ids.length > 0) {
        entries = await db
          .select()
          .from(followUpQueueTable)
          .where(
            and(
              inArray(followUpQueueTable.id, ids),
              eq(followUpQueueTable.status, "pending"),
            ),
          );
      } else {
        entries = await db
          .select()
          .from(followUpQueueTable)
          .where(eq(followUpQueueTable.status, "pending"));
      }

      if (entries.length === 0) {
        return res.json({ sent: 0, failed: 0, results: [] });
      }

      // Load leader name for template vars
      const leader = await db.query.profilesTable.findFirst({
        where: eq(profilesTable.id, leader_id),
      });
      const leaderName = leader?.full_name ?? "JG Youth Team";

      // Process each entry
      const results: { id: string; status: string; error?: string }[] = [];
      let sentCount = 0;
      let failedCount = 0;

      for (const entry of entries) {
        // Get profile
        const profile = await db.query.profilesTable.findFirst({
          where: eq(profilesTable.id, entry.profile_id),
        });
        if (!profile?.phone) {
          await db
            .update(followUpQueueTable)
            .set({
              status: "failed",
              error_message: "No phone number on file",
              reviewed_by: leader_id,
              reviewed_at: new Date(),
            })
            .where(eq(followUpQueueTable.id, entry.id));
          results.push({ id: entry.id, status: "failed", error: "No phone" });
          failedCount++;
          continue;
        }

        // Get template
        let template = null;
        if (entry.template_id) {
          template = await db.query.whatsappTemplatesTable.findFirst({
            where: eq(whatsappTemplatesTable.id, entry.template_id),
          });
        }
        if (!template) {
          template = await db.query.whatsappTemplatesTable.findFirst({
            where: and(
              eq(whatsappTemplatesTable.template_type, "follow_up"),
              eq(whatsappTemplatesTable.stage_weeks, entry.stage_weeks),
            ),
          });
        }

        try {
          const vars = {
            User: firstName(profile.full_name),
            Leader: leaderName,
          };

          let sid: string;
          if (template) {
            sid = await sendWhatsAppFromTemplate({
              to: profile.phone,
              template,
              vars,
            });
          } else {
            // Fallback: import sendWhatsApp directly
            const { sendWhatsApp } = await import("../lib/twilio");
            sid = await sendWhatsApp({
              to: profile.phone,
              body: entry.message_preview,
            });
          }

          await db
            .update(followUpQueueTable)
            .set({
              status: "sent",
              twilio_sid: sid,
              sent_at: new Date(),
              reviewed_by: leader_id,
              reviewed_at: new Date(),
            })
            .where(eq(followUpQueueTable.id, entry.id));

          results.push({ id: entry.id, status: "sent" });
          sentCount++;
        } catch (sendErr) {
          const errMsg =
            sendErr instanceof Error ? sendErr.message : "Send failed";
          await db
            .update(followUpQueueTable)
            .set({
              status: "failed",
              error_message: errMsg,
              reviewed_by: leader_id,
              reviewed_at: new Date(),
            })
            .where(eq(followUpQueueTable.id, entry.id));

          results.push({ id: entry.id, status: "failed", error: errMsg });
          failedCount++;
        }
      }

      return res.json({ sent: sentCount, failed: failedCount, results });
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

// ── POST /whatsapp/queue/retry ──────────────────────────────────────────────────
const RetryBody = z.object({
  ids: z.array(z.string().uuid()),
});

router.post(
  "/whatsapp/queue/retry",
  requireLeaderSession("leader"),
  async (req: Request, res: Response) => {
    try {
      const parsed = RetryBody.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: parsed.error.flatten() });
      }
      const { ids } = parsed.data;

      // Only allow retrying "failed" or "rejected" entries
      await db
        .update(followUpQueueTable)
        .set({
          status: "pending",
          error_message: null,
          reviewed_by: null,
          reviewed_at: null,
        })
        .where(
          and(
            inArray(followUpQueueTable.id, ids),
            inArray(followUpQueueTable.status, ["failed", "rejected"]),
          ),
        );

      return res.json({ retried: ids.length });
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


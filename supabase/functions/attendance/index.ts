// Supabase Edge Function: attendance
// Port of artifacts/api-server/src/routes/attendance.ts (every route).
//
// Mirrors the porting conventions established in profiles/rsvps/leaders/index.ts:
//  - createApp() from ../_shared/router.ts; FULL paths incl /attendance segment.
//  - getAuth(req).userId -> await getClerkUserId(c.req.raw).
//  - req.log.error -> console.error.
//  - zod -> npm:zod@3 (inline, mirroring api-zod CheckInBody/CheckInByNameBody).
//  - exact response shapes/status codes preserved.

import { createApp } from "../_shared/router.ts";
import { db } from "../_shared/db.ts";
import {
  attendanceTable,
  profilesTable,
  eventsTable,
} from "../_shared/schema.ts";
import { getClerkUserId } from "../_shared/auth.ts";
import { and, desc, eq, ilike } from "npm:drizzle-orm@0.45.2";
import { z } from "npm:zod@3";

const app = createApp();

// ── Inline zod body schemas (ported from @workspace/api-zod) ─────────────────
const CheckInBody = z.object({
  profile_id: z.string(),
  event_id: z.string().optional(),
  check_in_method: z.enum(["manual", "self", "qr"]),
});

const CheckInByNameBody = z.object({
  name: z.string().optional(),
  phone: z.string().optional(),
});

// ── Routes ───────────────────────────────────────────────────────────────────

app.get("/attendance", async (c) => {
  try {
    const userId = await getClerkUserId(c.req.raw);
    if (!userId) return c.json({ error: "Unauthorized" }, 401);
    const requester = await db.query.profilesTable.findFirst({
      where: eq(profilesTable.clerk_id, userId),
    });
    const isPrivileged =
      requester?.role === "leader" || requester?.role === "super_admin";
    const query = c.req.query();
    const requestedProfileId = query.profile_id
      ? String(query.profile_id)
      : undefined;
    if (
      requestedProfileId &&
      !isPrivileged &&
      requestedProfileId !== requester?.id
    ) {
      return c.json({ error: "Forbidden" }, 403);
    }
    const { session_date, event_id, profile_id } = query;
    const conditions: any[] = [];
    if (session_date)
      conditions.push(eq(attendanceTable.session_date, String(session_date)));
    if (event_id)
      conditions.push(eq(attendanceTable.event_id, String(event_id)));
    if (profile_id)
      conditions.push(eq(attendanceTable.profile_id, String(profile_id)));

    const records = await db
      .select({
        id: attendanceTable.id,
        profile_id: attendanceTable.profile_id,
        event_id: attendanceTable.event_id,
        checked_in_at: attendanceTable.checked_in_at,
        session_date: attendanceTable.session_date,
        check_in_method: attendanceTable.check_in_method,
        profile: {
          id: profilesTable.id,
          full_name: profilesTable.full_name,
          role: profilesTable.role,
          phone: profilesTable.phone,
          email: profilesTable.email,
          gender: profilesTable.gender,
          age: profilesTable.age,
          heard_from: profilesTable.heard_from,
          clerk_id: profilesTable.clerk_id,
          created_at: profilesTable.created_at,
        },
      })
      .from(attendanceTable)
      .leftJoin(profilesTable, eq(attendanceTable.profile_id, profilesTable.id))
      .where(conditions.length > 0 ? and(...conditions) : undefined);
    return c.json(records);
  } catch (err) {
    console.error(err);
    return c.json({ error: "Internal server error" }, 500);
  }
});

app.post("/attendance", async (c) => {
  try {
    const body = await c.req.json();
    const parsed = CheckInBody.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: parsed.error.flatten() }, 400);
    }
    const today = new Date().toISOString().split("T")[0];
    const [record] = await db
      .insert(attendanceTable)
      .values({
        profile_id: parsed.data.profile_id,
        event_id: parsed.data.event_id ?? null,
        session_date: today,
        check_in_method: parsed.data.check_in_method,
      })
      .returning();
    const profile = await db.query.profilesTable.findFirst({
      where: eq(profilesTable.id, parsed.data.profile_id),
    });
    return c.json({ ...record, profile }, 201);
  } catch (err) {
    console.error(err);
    return c.json({ error: "Internal server error" }, 500);
  }
});

app.get("/attendance/today", async (c) => {
  try {
    const today = new Date().toISOString().split("T")[0];
    const records = await db
      .select({
        id: attendanceTable.id,
        profile_id: attendanceTable.profile_id,
        event_id: attendanceTable.event_id,
        checked_in_at: attendanceTable.checked_in_at,
        session_date: attendanceTable.session_date,
        check_in_method: attendanceTable.check_in_method,
        profile: {
          id: profilesTable.id,
          full_name: profilesTable.full_name,
          role: profilesTable.role,
          phone: profilesTable.phone,
          email: profilesTable.email,
          gender: profilesTable.gender,
          age: profilesTable.age,
          heard_from: profilesTable.heard_from,
          clerk_id: profilesTable.clerk_id,
          created_at: profilesTable.created_at,
        },
      })
      .from(attendanceTable)
      .leftJoin(profilesTable, eq(attendanceTable.profile_id, profilesTable.id))
      .where(eq(attendanceTable.session_date, today));
    return c.json(records);
  } catch (err) {
    console.error(err);
    return c.json({ error: "Internal server error" }, 500);
  }
});

// GET /attendance/my - the authenticated member's own attendance history
app.get("/attendance/my", async (c) => {
  try {
    const userId = await getClerkUserId(c.req.raw);
    if (!userId) return c.json({ error: "Unauthorized" }, 401);

    const profile = await db.query.profilesTable.findFirst({
      where: eq(profilesTable.clerk_id, userId),
    });
    if (!profile) return c.json({ error: "Profile not found" }, 404);

    const rows = await db
      .select({
        id: attendanceTable.id,
        session_date: attendanceTable.session_date,
        check_in_method: attendanceTable.check_in_method,
        checked_in_at: attendanceTable.checked_in_at,
        event_title: eventsTable.title,
      })
      .from(attendanceTable)
      .leftJoin(eventsTable, eq(attendanceTable.event_id, eventsTable.id))
      .where(eq(attendanceTable.profile_id, profile.id))
      .orderBy(
        desc(attendanceTable.session_date),
        desc(attendanceTable.checked_in_at),
      );

    return c.json(rows);
  } catch (err) {
    console.error(err);
    return c.json({ error: "Internal server error" }, 500);
  }
});

app.post("/attendance/checkin-by-name", async (c) => {
  try {
    const body = await c.req.json();
    const parsed = CheckInByNameBody.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: parsed.error.flatten() }, 400);
    }
    const { name, phone } = parsed.data;
    let profile = null;
    if (phone) {
      profile = await db.query.profilesTable.findFirst({
        where: eq(profilesTable.phone, phone),
      });
    } else if (name) {
      profile = await db.query.profilesTable.findFirst({
        where: ilike(profilesTable.full_name, `%${name}%`),
      });
    }
    if (!profile) {
      return c.json({ error: "Person not found" }, 404);
    }
    const today = new Date().toISOString().split("T")[0];
    const [record] = await db
      .insert(attendanceTable)
      .values({
        profile_id: profile.id,
        session_date: today,
        check_in_method: "self",
      })
      .returning();
    return c.json({ ...record, profile }, 201);
  } catch (err) {
    console.error(err);
    return c.json({ error: "Internal server error" }, 500);
  }
});

Deno.serve(app.fetch);

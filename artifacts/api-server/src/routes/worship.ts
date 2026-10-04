import { Router, type Request, type Response } from "express";
import bcrypt from "bcrypt";
import { and, asc, count, desc, eq, ilike, isNull, or, sql } from "drizzle-orm";
import {
  db,
  worshipAccountsTable,
  worshipMemberSongsTable,
  worshipNotificationsTable,
  worshipPushSubscriptionsTable,
  worshipSongsTable,
  type WorshipAccount,
} from "@workspace/db";
import { validatePin } from "../lib/pin";
import { generatePin } from "../lib/kioskAccount";
import {
  createWorshipSession,
  publicAccount,
  requireWorship,
  revokeAllWorshipSessions,
  revokeWorshipSession,
} from "../lib/worshipAuth";
import {
  canEditSong,
  checkLeaderChange,
  LoginLimiter,
  normalizeInstruments,
  normalizeKey,
  normalizeWorshipPhone,
  optionalText,
  validateSongInput,
} from "../lib/worshipRules";
import { inBackground, notifyJoinRequest, notifySongAdded } from "../lib/worshipNotify";

/**
 * Worship Team API — its own membership, separate from JG Youth. Every route
 * except join/login needs an `x-worship-session` token (see worshipAuth.ts).
 */
const router = Router();
const loginLimiter = new LoginLimiter();

// Serializes "first account becomes leader" and "keep at least one leader"
// checks so two requests can't race past them.
const LEADER_LOCK = sql`select pg_advisory_xact_lock(hashtext('worship_leaders'))`;

function body(req: Request): Record<string, unknown> {
  return (req.body ?? {}) as Record<string, unknown>;
}

function me(req: Request): WorshipAccount {
  return req.worshipAccount!;
}

function fail(req: Request, res: Response, err: unknown) {
  req.log.error(err);
  return res.status(500).json({ error: "Internal server error" });
}

function ownAccount(a: WorshipAccount) {
  return { ...publicAccount(a), phone: a.phone, notifications_muted: a.notifications_muted };
}

// ── Joining & signing in ──────────────────────────────────────────────────────

// POST /worship/auth/join — public. Creates a join request (or, for the very
// first person, an approved leader account) and signs the device in.
router.post("/worship/auth/join", async (req, res) => {
  try {
    const b = body(req);
    const fullName = typeof b.full_name === "string" ? b.full_name.trim() : "";
    if (!fullName || fullName.length > 80) {
      return res.status(400).json({ error: "Please enter your name." });
    }
    const phone = normalizeWorshipPhone(b.phone);
    if (!phone) return res.status(400).json({ error: "Please enter a valid phone number." });
    const pin = validatePin(b.pin);
    if (!pin.ok) return res.status(400).json({ error: pin.error });
    const instruments = normalizeInstruments(b.instruments);
    if (instruments === undefined) return res.status(400).json({ error: "Unknown instrument." });

    const pinHash = await bcrypt.hash(pin.value, 12);
    const account = await db.transaction(async (tx) => {
      await tx.execute(LEADER_LOCK);
      const existing = await tx.query.worshipAccountsTable.findFirst({
        where: eq(worshipAccountsTable.phone, phone),
      });
      if (existing) return null;
      const [{ leaders }] = await tx
        .select({ leaders: count() })
        .from(worshipAccountsTable)
        .where(and(eq(worshipAccountsTable.role, "leader"), eq(worshipAccountsTable.status, "approved")));
      const isFirst = leaders === 0;
      const [row] = await tx
        .insert(worshipAccountsTable)
        .values({
          full_name: fullName,
          phone,
          pin_hash: pinHash,
          instruments,
          role: isFirst ? "leader" : "member",
          status: isFirst ? "approved" : "pending",
          approved_at: isFirst ? new Date() : null,
        })
        .returning();
      return row;
    });
    if (!account) {
      return res.status(409).json({ error: "That phone number is already on the worship team. Try signing in." });
    }

    if (account.status === "pending") {
      inBackground("join request notify", notifyJoinRequest(account));
    }
    const session = await createWorshipSession(account.id, req.headers["user-agent"]);
    return res.status(201).json({ ...session, account: ownAccount(account) });
  } catch (err) {
    return fail(req, res, err);
  }
});

// POST /worship/auth/login — public. Phone + PIN.
router.post("/worship/auth/login", async (req, res) => {
  try {
    const b = body(req);
    const phone = normalizeWorshipPhone(b.phone);
    const pin = typeof b.pin === "string" ? b.pin : "";
    if (!phone || !pin) return res.status(400).json({ error: "Phone number and PIN are required." });
    if (loginLimiter.isBlocked(phone)) {
      return res.status(429).json({ error: "Too many tries. Wait 15 minutes and try again." });
    }
    if (pin.length > 8) return res.status(401).json({ error: "Wrong phone number or PIN." });

    const account = await db.query.worshipAccountsTable.findFirst({
      where: eq(worshipAccountsTable.phone, phone),
    });
    const valid = account ? await bcrypt.compare(pin, account.pin_hash) : false;
    if (!account || !valid) {
      loginLimiter.recordFailure(phone);
      return res.status(401).json({ error: "Wrong phone number or PIN." });
    }
    loginLimiter.reset(phone);
    const session = await createWorshipSession(account.id, req.headers["user-agent"]);
    return res.json({ ...session, account: ownAccount(account) });
  } catch (err) {
    return fail(req, res, err);
  }
});

router.post("/worship/auth/logout", requireWorship({ allowPending: true }), async (req, res) => {
  try {
    await revokeWorshipSession(req.worshipToken!);
    return res.json({ ok: true });
  } catch (err) {
    return fail(req, res, err);
  }
});

// ── Me ────────────────────────────────────────────────────────────────────────

router.get("/worship/me", requireWorship({ allowPending: true }), (req, res) => {
  return res.json({ account: ownAccount(me(req)) });
});

// DELETE /worship/me — cancel a pending request or leave the team.
router.delete("/worship/me", requireWorship({ allowPending: true }), async (req, res) => {
  try {
    const account = me(req);
    const result = await db.transaction(async (tx) => {
      await tx.execute(LEADER_LOCK);
      const leaders = await approvedLeaderCount(tx);
      const check = checkLeaderChange(account, "remove", leaders);
      if (!check.ok) return check;
      await tx.delete(worshipAccountsTable).where(eq(worshipAccountsTable.id, account.id));
      return check;
    });
    if (!result.ok) return res.status(400).json({ error: result.error });
    return res.json({ ok: true });
  } catch (err) {
    return fail(req, res, err);
  }
});

router.patch("/worship/me", requireWorship(), async (req, res) => {
  try {
    const b = body(req);
    const set: Partial<typeof worshipAccountsTable.$inferInsert> = {};
    if (b.full_name !== undefined) {
      const name = typeof b.full_name === "string" ? b.full_name.trim() : "";
      if (!name || name.length > 80) return res.status(400).json({ error: "Please enter your name." });
      set.full_name = name;
    }
    if (b.instruments !== undefined) {
      const instruments = normalizeInstruments(b.instruments);
      if (instruments === undefined) return res.status(400).json({ error: "Unknown instrument." });
      set.instruments = instruments;
    }
    if (b.vocal_range !== undefined) {
      const v = optionalText(b.vocal_range, 40);
      if (v === undefined) return res.status(400).json({ error: "Vocal range is too long." });
      set.vocal_range = v;
    }
    if (b.bio !== undefined) {
      const v = optionalText(b.bio, 300);
      if (v === undefined) return res.status(400).json({ error: "Bio is too long (300 characters max)." });
      set.bio = v;
    }
    if (b.notifications_muted !== undefined) {
      if (typeof b.notifications_muted !== "boolean") return res.status(400).json({ error: "Invalid setting." });
      set.notifications_muted = b.notifications_muted;
    }
    if (Object.keys(set).length === 0) return res.json({ account: ownAccount(me(req)) });
    const [updated] = await db
      .update(worshipAccountsTable)
      .set(set)
      .where(eq(worshipAccountsTable.id, me(req).id))
      .returning();
    return res.json({ account: ownAccount(updated) });
  } catch (err) {
    return fail(req, res, err);
  }
});

router.post("/worship/me/pin", requireWorship(), async (req, res) => {
  try {
    const b = body(req);
    const current = typeof b.current_pin === "string" ? b.current_pin : "";
    if (!(await bcrypt.compare(current, me(req).pin_hash))) {
      return res.status(400).json({ error: "Your current PIN is wrong." });
    }
    const pin = validatePin(b.new_pin);
    if (!pin.ok) return res.status(400).json({ error: pin.error });
    await db
      .update(worshipAccountsTable)
      .set({ pin_hash: await bcrypt.hash(pin.value, 12) })
      .where(eq(worshipAccountsTable.id, me(req).id));
    return res.json({ ok: true });
  } catch (err) {
    return fail(req, res, err);
  }
});

// ── Team ──────────────────────────────────────────────────────────────────────

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

async function approvedLeaderCount(tx: Tx | typeof db): Promise<number> {
  const [{ n }] = await tx
    .select({ n: count() })
    .from(worshipAccountsTable)
    .where(and(eq(worshipAccountsTable.role, "leader"), eq(worshipAccountsTable.status, "approved")));
  return n;
}

router.get("/worship/members", requireWorship(), async (req, res) => {
  try {
    const rows = await db
      .select({ account: worshipAccountsTable, song_count: count(worshipMemberSongsTable.id) })
      .from(worshipAccountsTable)
      .leftJoin(worshipMemberSongsTable, eq(worshipMemberSongsTable.account_id, worshipAccountsTable.id))
      .where(eq(worshipAccountsTable.status, "approved"))
      .groupBy(worshipAccountsTable.id)
      .orderBy(desc(sql`${worshipAccountsTable.role} = 'leader'`), asc(worshipAccountsTable.full_name));
    return res.json({
      members: rows.map((r) => ({ ...publicAccount(r.account), song_count: r.song_count })),
    });
  } catch (err) {
    return fail(req, res, err);
  }
});

router.get("/worship/members/:id", requireWorship(), async (req, res) => {
  try {
    const account = await db.query.worshipAccountsTable.findFirst({
      where: and(
        eq(worshipAccountsTable.id, String(req.params.id)),
        eq(worshipAccountsTable.status, "approved"),
      ),
    });
    if (!account) return res.status(404).json({ error: "Team member not found." });
    const songs = await db
      .select({
        song_id: worshipSongsTable.id,
        title: worshipSongsTable.title,
        artist: worshipSongsTable.artist,
        original_key: worshipSongsTable.original_key,
        tempo_bpm: worshipSongsTable.tempo_bpm,
        preferred_key: worshipMemberSongsTable.preferred_key,
        notes: worshipMemberSongsTable.notes,
        added_at: worshipMemberSongsTable.created_at,
      })
      .from(worshipMemberSongsTable)
      .innerJoin(worshipSongsTable, eq(worshipMemberSongsTable.song_id, worshipSongsTable.id))
      .where(eq(worshipMemberSongsTable.account_id, account.id))
      .orderBy(asc(worshipSongsTable.title));
    return res.json({ member: publicAccount(account), songs });
  } catch (err) {
    return fail(req, res, err);
  }
});

// ── Leader: requests & roles ──────────────────────────────────────────────────

router.get("/worship/requests", requireWorship({ leader: true }), async (req, res) => {
  try {
    const rows = await db
      .select()
      .from(worshipAccountsTable)
      .where(eq(worshipAccountsTable.status, "pending"))
      .orderBy(asc(worshipAccountsTable.created_at));
    return res.json({ requests: rows.map(publicAccount) });
  } catch (err) {
    return fail(req, res, err);
  }
});

router.post("/worship/requests/:id/approve", requireWorship({ leader: true }), async (req, res) => {
  try {
    const [updated] = await db
      .update(worshipAccountsTable)
      .set({ status: "approved", approved_at: new Date() })
      .where(
        and(
          eq(worshipAccountsTable.id, String(req.params.id)),
          eq(worshipAccountsTable.status, "pending"),
        ),
      )
      .returning();
    if (!updated) return res.status(404).json({ error: "That request is no longer waiting." });
    return res.json({ member: publicAccount(updated) });
  } catch (err) {
    return fail(req, res, err);
  }
});

// Declining deletes the request so the person can ask again later.
router.post("/worship/requests/:id/decline", requireWorship({ leader: true }), async (req, res) => {
  try {
    const deleted = await db
      .delete(worshipAccountsTable)
      .where(
        and(
          eq(worshipAccountsTable.id, String(req.params.id)),
          eq(worshipAccountsTable.status, "pending"),
        ),
      )
      .returning({ id: worshipAccountsTable.id });
    if (deleted.length === 0) return res.status(404).json({ error: "That request is no longer waiting." });
    return res.json({ ok: true });
  } catch (err) {
    return fail(req, res, err);
  }
});

router.patch("/worship/members/:id/role", requireWorship({ leader: true }), async (req, res) => {
  try {
    const role = body(req).role;
    if (role !== "leader" && role !== "member") return res.status(400).json({ error: "Invalid role." });
    const result = await db.transaction(async (tx) => {
      await tx.execute(LEADER_LOCK);
      const target = await tx.query.worshipAccountsTable.findFirst({
        where: eq(worshipAccountsTable.id, String(req.params.id)),
      });
      if (!target) return { status: 404, error: "Team member not found." } as const;
      const check = checkLeaderChange(
        target,
        role === "leader" ? "make_leader" : "make_member",
        await approvedLeaderCount(tx),
      );
      if (!check.ok) return { status: 400, error: check.error } as const;
      const [updated] = await tx
        .update(worshipAccountsTable)
        .set({ role })
        .where(eq(worshipAccountsTable.id, target.id))
        .returning();
      return { status: 200, member: publicAccount(updated) } as const;
    });
    if (result.status !== 200) return res.status(result.status).json({ error: result.error });
    return res.json({ member: result.member });
  } catch (err) {
    return fail(req, res, err);
  }
});

router.delete("/worship/members/:id", requireWorship({ leader: true }), async (req, res) => {
  try {
    const result = await db.transaction(async (tx) => {
      await tx.execute(LEADER_LOCK);
      const target = await tx.query.worshipAccountsTable.findFirst({
        where: eq(worshipAccountsTable.id, String(req.params.id)),
      });
      if (!target) return { status: 404, error: "Team member not found." } as const;
      const check = checkLeaderChange(target, "remove", await approvedLeaderCount(tx));
      if (!check.ok) return { status: 400, error: check.error } as const;
      await tx.delete(worshipAccountsTable).where(eq(worshipAccountsTable.id, target.id));
      return { status: 200 } as const;
    });
    if (result.status !== 200) return res.status(result.status).json({ error: result.error });
    return res.json({ ok: true });
  } catch (err) {
    return fail(req, res, err);
  }
});

// Leader resets a forgotten PIN; the new PIN is returned once to hand over.
router.post("/worship/members/:id/reset-pin", requireWorship({ leader: true }), async (req, res) => {
  try {
    const pin = generatePin();
    const [updated] = await db
      .update(worshipAccountsTable)
      .set({ pin_hash: await bcrypt.hash(pin, 12) })
      .where(eq(worshipAccountsTable.id, String(req.params.id)))
      .returning({ id: worshipAccountsTable.id });
    if (!updated) return res.status(404).json({ error: "Team member not found." });
    await revokeAllWorshipSessions(updated.id);
    return res.json({ pin });
  } catch (err) {
    return fail(req, res, err);
  }
});

// ── Songs ─────────────────────────────────────────────────────────────────────

router.get("/worship/songs", requireWorship(), async (req, res) => {
  try {
    const q = typeof req.query.q === "string" ? req.query.q.trim().slice(0, 80) : "";
    const pattern = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    const mine = db
      .select({ song_id: worshipMemberSongsTable.song_id, preferred_key: worshipMemberSongsTable.preferred_key })
      .from(worshipMemberSongsTable)
      .where(eq(worshipMemberSongsTable.account_id, me(req).id))
      .as("mine");
    const rows = await db
      .select({
        id: worshipSongsTable.id,
        title: worshipSongsTable.title,
        artist: worshipSongsTable.artist,
        original_key: worshipSongsTable.original_key,
        tempo_bpm: worshipSongsTable.tempo_bpm,
        my_key: mine.preferred_key,
        in_my_list: sql<boolean>`${mine.song_id} is not null`,
        member_count: sql<number>`(select count(*)::int from ${worshipMemberSongsTable} where ${worshipMemberSongsTable.song_id} = ${worshipSongsTable.id})`,
      })
      .from(worshipSongsTable)
      .leftJoin(mine, eq(mine.song_id, worshipSongsTable.id))
      .where(q ? or(ilike(worshipSongsTable.title, pattern), ilike(worshipSongsTable.artist, pattern)) : undefined)
      .orderBy(asc(worshipSongsTable.title))
      .limit(500);
    return res.json({ songs: rows });
  } catch (err) {
    return fail(req, res, err);
  }
});

router.get("/worship/songs/:id", requireWorship(), async (req, res) => {
  try {
    const song = await db.query.worshipSongsTable.findFirst({
      where: eq(worshipSongsTable.id, String(req.params.id)),
    });
    if (!song) return res.status(404).json({ error: "Song not found." });
    const members = await db
      .select({
        id: worshipAccountsTable.id,
        full_name: worshipAccountsTable.full_name,
        preferred_key: worshipMemberSongsTable.preferred_key,
        notes: worshipMemberSongsTable.notes,
      })
      .from(worshipMemberSongsTable)
      .innerJoin(worshipAccountsTable, eq(worshipMemberSongsTable.account_id, worshipAccountsTable.id))
      .where(and(eq(worshipMemberSongsTable.song_id, song.id), eq(worshipAccountsTable.status, "approved")))
      .orderBy(asc(worshipAccountsTable.full_name));
    const mine = members.find((m) => m.id === me(req).id) ?? null;
    return res.json({
      song,
      members,
      my_entry: mine ? { preferred_key: mine.preferred_key, notes: mine.notes } : null,
      can_edit: canEditSong(me(req), song),
    });
  } catch (err) {
    return fail(req, res, err);
  }
});

// POST /worship/songs — add to the library; optionally straight to my list.
router.post("/worship/songs", requireWorship(), async (req, res) => {
  try {
    const b = body(req);
    const input = validateSongInput(b);
    if (!input.ok) return res.status(400).json({ error: input.error });
    const addToMine = b.add_to_my_list === true;
    const myKey = normalizeKey(b.my_key);
    if (myKey === undefined) return res.status(400).json({ error: "Key must look like G, Bb or F#m." });

    const song = await db.transaction(async (tx) => {
      const [created] = await tx
        .insert(worshipSongsTable)
        .values({ ...input.value, created_by: me(req).id })
        .returning();
      if (addToMine) {
        await tx.insert(worshipMemberSongsTable).values({
          account_id: me(req).id,
          song_id: created.id,
          preferred_key: myKey ?? created.original_key,
        });
      }
      return created;
    });
    if (addToMine) {
      inBackground("song added notify", notifySongAdded(me(req), song, myKey ?? song.original_key));
    }
    return res.status(201).json({ song });
  } catch (err) {
    return fail(req, res, err);
  }
});

router.patch("/worship/songs/:id", requireWorship(), async (req, res) => {
  try {
    const song = await db.query.worshipSongsTable.findFirst({
      where: eq(worshipSongsTable.id, String(req.params.id)),
    });
    if (!song) return res.status(404).json({ error: "Song not found." });
    if (!canEditSong(me(req), song)) {
      return res.status(403).json({ error: "Only the person who added this song or a leader can edit it." });
    }
    const input = validateSongInput({ ...song, ...body(req) });
    if (!input.ok) return res.status(400).json({ error: input.error });
    const [updated] = await db
      .update(worshipSongsTable)
      .set({ ...input.value, updated_at: new Date() })
      .where(eq(worshipSongsTable.id, song.id))
      .returning();
    return res.json({ song: updated });
  } catch (err) {
    return fail(req, res, err);
  }
});

router.delete("/worship/songs/:id", requireWorship(), async (req, res) => {
  try {
    const song = await db.query.worshipSongsTable.findFirst({
      where: eq(worshipSongsTable.id, String(req.params.id)),
    });
    if (!song) return res.status(404).json({ error: "Song not found." });
    if (!canEditSong(me(req), song)) {
      return res.status(403).json({ error: "Only the person who added this song or a leader can delete it." });
    }
    await db.delete(worshipSongsTable).where(eq(worshipSongsTable.id, song.id));
    return res.json({ ok: true });
  } catch (err) {
    return fail(req, res, err);
  }
});

// PUT /worship/me/songs/:songId — add a library song to my list, or update my
// key/notes for it. Adding (not updating) notifies the rest of the team.
router.put("/worship/me/songs/:songId", requireWorship(), async (req, res) => {
  try {
    const b = body(req);
    const song = await db.query.worshipSongsTable.findFirst({
      where: eq(worshipSongsTable.id, String(req.params.songId)),
    });
    if (!song) return res.status(404).json({ error: "Song not found." });
    const key = normalizeKey(b.preferred_key);
    if (key === undefined) return res.status(400).json({ error: "Key must look like G, Bb or F#m." });
    const notes = optionalText(b.notes, 300);
    if (notes === undefined) return res.status(400).json({ error: "Notes are too long (300 characters max)." });

    const existing = await db.query.worshipMemberSongsTable.findFirst({
      where: and(
        eq(worshipMemberSongsTable.account_id, me(req).id),
        eq(worshipMemberSongsTable.song_id, song.id),
      ),
    });
    if (existing) {
      await db
        .update(worshipMemberSongsTable)
        .set({ preferred_key: key, notes })
        .where(eq(worshipMemberSongsTable.id, existing.id));
      return res.json({ added: false });
    }
    const inserted = await db
      .insert(worshipMemberSongsTable)
      .values({
        account_id: me(req).id,
        song_id: song.id,
        preferred_key: key ?? song.original_key,
        notes,
      })
      .onConflictDoNothing()
      .returning({ id: worshipMemberSongsTable.id });
    if (inserted.length > 0) {
      inBackground("song added notify", notifySongAdded(me(req), song, key ?? song.original_key));
    }
    return res.status(201).json({ added: inserted.length > 0 });
  } catch (err) {
    return fail(req, res, err);
  }
});

router.delete("/worship/me/songs/:songId", requireWorship(), async (req, res) => {
  try {
    await db
      .delete(worshipMemberSongsTable)
      .where(
        and(
          eq(worshipMemberSongsTable.account_id, me(req).id),
          eq(worshipMemberSongsTable.song_id, String(req.params.songId)),
        ),
      );
    return res.json({ ok: true });
  } catch (err) {
    return fail(req, res, err);
  }
});

// ── Notifications ─────────────────────────────────────────────────────────────

router.get("/worship/notifications", requireWorship(), async (req, res) => {
  try {
    const items = await db
      .select()
      .from(worshipNotificationsTable)
      .where(eq(worshipNotificationsTable.recipient_id, me(req).id))
      .orderBy(desc(worshipNotificationsTable.created_at))
      .limit(30);
    const [{ unread }] = await db
      .select({ unread: count() })
      .from(worshipNotificationsTable)
      .where(
        and(
          eq(worshipNotificationsTable.recipient_id, me(req).id),
          isNull(worshipNotificationsTable.read_at),
        ),
      );
    return res.json({ notifications: items, unread });
  } catch (err) {
    return fail(req, res, err);
  }
});

router.post("/worship/notifications/read", requireWorship(), async (req, res) => {
  try {
    await db
      .update(worshipNotificationsTable)
      .set({ read_at: new Date() })
      .where(
        and(
          eq(worshipNotificationsTable.recipient_id, me(req).id),
          isNull(worshipNotificationsTable.read_at),
        ),
      );
    return res.json({ ok: true });
  } catch (err) {
    return fail(req, res, err);
  }
});

// Worship devices live in their own table so only the team gets these pushes.
router.post("/worship/push/subscribe", requireWorship(), async (req, res) => {
  try {
    const b = req.body as { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } };
    if (
      typeof b?.endpoint !== "string" ||
      !b.endpoint ||
      typeof b?.keys?.p256dh !== "string" ||
      typeof b?.keys?.auth !== "string"
    ) {
      return res.status(400).json({ error: "Invalid push subscription" });
    }
    await db
      .insert(worshipPushSubscriptionsTable)
      .values({ account_id: me(req).id, endpoint: b.endpoint, p256dh: b.keys.p256dh, auth: b.keys.auth })
      .onConflictDoUpdate({
        target: worshipPushSubscriptionsTable.endpoint,
        set: { account_id: me(req).id, p256dh: b.keys.p256dh, auth: b.keys.auth },
      });
    return res.status(201).json({ ok: true });
  } catch (err) {
    return fail(req, res, err);
  }
});

router.post("/worship/push/unsubscribe", requireWorship({ allowPending: true }), async (req, res) => {
  try {
    const endpoint = body(req).endpoint;
    if (typeof endpoint !== "string" || !endpoint) return res.status(400).json({ error: "endpoint required" });
    await db
      .delete(worshipPushSubscriptionsTable)
      .where(
        and(
          eq(worshipPushSubscriptionsTable.endpoint, endpoint),
          eq(worshipPushSubscriptionsTable.account_id, me(req).id),
        ),
      );
    return res.json({ ok: true });
  } catch (err) {
    return fail(req, res, err);
  }
});

export default router;

import { Router, type Request, type Response } from "express";
import bcrypt from "bcrypt";
import { and, asc, count, desc, eq, ilike, isNull, or, sql } from "drizzle-orm";
import {
  db,
  worshipAccountsTable,
  worshipMemberSongsTable,
  worshipNotificationsTable,
  worshipPushSubscriptionsTable,
  worshipSetlistSongsTable,
  worshipSetlistsTable,
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
  canApprove,
  canEditSong,
  checkMemberChange,
  isOwner,
  LoginLimiter,
  normalizeInstruments,
  normalizeKey,
  normalizeWorshipPhone,
  optionalText,
  validateSetlistInput,
  validateSongInput,
  type SetlistInput,
} from "../lib/worshipRules";
import {
  inBackground,
  notifyAccepted,
  notifyJoinRequest,
  notifyPinResetRequest,
  notifySetlistPosted,
  notifySongAdded,
} from "../lib/worshipNotify";

/**
 * Worship Team API — its own membership, separate from JG Youth. Every route
 * except join/login needs an `x-worship-session` token (see worshipAuth.ts).
 */
const router = Router();
const loginLimiter = new LoginLimiter();
// 15-minute lockout after 5 wrong PINs. Set to false to pause it.
const LOGIN_LOCKOUT_ENABLED = true;

// Serializes "first account becomes head leader" so two sign-ups can't both
// claim it.
const OWNER_LOCK = sql`select pg_advisory_xact_lock(hashtext('worship_owner'))`;

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
  return {
    ...publicAccount(a),
    phone: a.phone,
    notifications_muted: a.notifications_muted,
    onboarded_at: a.onboarded_at,
  };
}

// ── Joining & signing in ──────────────────────────────────────────────────────

// POST /worship/auth/join — public. Creates a join request (or, for the very
// first person, the approved head leader account) and signs the device in.
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
      await tx.execute(OWNER_LOCK);
      const existing = await tx.query.worshipAccountsTable.findFirst({
        where: eq(worshipAccountsTable.phone, phone),
      });
      if (existing) return null;
      const owner = await tx.query.worshipAccountsTable.findFirst({
        where: eq(worshipAccountsTable.role, "owner"),
      });
      const isFirst = !owner;
      const [row] = await tx
        .insert(worshipAccountsTable)
        .values({
          full_name: fullName,
          phone,
          pin_hash: pinHash,
          instruments,
          role: isFirst ? "owner" : "member",
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
    if (LOGIN_LOCKOUT_ENABLED && loginLimiter.isBlocked(phone)) {
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

// One forgot-PIN request per number every 10 minutes, so the head leader
// isn't spammed.
const forgotPinRequests = new Map<string, number>();
const FORGOT_PIN_EVERY_MS = 10 * 60 * 1000;

/** wa.me link: digits only, no "+". */
function waLink(phone: string, text: string): string {
  return `https://wa.me/${phone.replace(/\D/g, "")}?text=${encodeURIComponent(text)}`;
}

// POST /worship/auth/forgot-pin — public. Tells the head leader (push + bell)
// that this person needs a new PIN, and gives a team member a ready-made
// WhatsApp message to the head leader's number. Unknown numbers get the same
// "sent" reply and no number, so this can't be used to find who's on the team.
router.post("/worship/auth/forgot-pin", async (req, res) => {
  try {
    const phone = normalizeWorshipPhone(body(req).phone);
    if (!phone) return res.status(400).json({ error: "Please enter a valid phone number." });
    const generic = { ok: true, whatsapp_url: null as string | null, is_head_leader: false };

    const account = await db.query.worshipAccountsTable.findFirst({
      where: eq(worshipAccountsTable.phone, phone),
    });
    if (!account) return res.json(generic);
    if (account.role === "owner") return res.json({ ...generic, is_head_leader: true });

    const owner = await db.query.worshipAccountsTable.findFirst({
      where: and(eq(worshipAccountsTable.role, "owner"), eq(worshipAccountsTable.status, "approved")),
    });
    const last = forgotPinRequests.get(phone) ?? 0;
    if (Date.now() - last > FORGOT_PIN_EVERY_MS) {
      forgotPinRequests.set(phone, Date.now());
      inBackground("forgot pin notify", notifyPinResetRequest(account));
    }
    const text =
      `Hi${owner ? ` ${owner.full_name.split(" ")[0]}` : ""}, it's ${account.full_name} (${account.phone}) ` +
      `from the worship team 🙏 I forgot my PIN for the Worship Team app. Please could you reset it for me?`;
    return res.json({ ...generic, whatsapp_url: owner ? waLink(owner.phone, text) : null });
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
    if (isOwner(account)) {
      return res.status(400).json({ error: "The head leader can't leave the team." });
    }
    await db.delete(worshipAccountsTable).where(eq(worshipAccountsTable.id, account.id));
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

// POST /worship/me/onboarded — they finished (or skipped) the welcome sequence.
router.post("/worship/me/onboarded", requireWorship(), async (req, res) => {
  try {
    const [updated] = await db
      .update(worshipAccountsTable)
      .set({ onboarded_at: new Date() })
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

router.get("/worship/members", requireWorship(), async (req, res) => {
  try {
    const rows = await db
      .select({ account: worshipAccountsTable, song_count: count(worshipMemberSongsTable.id) })
      .from(worshipAccountsTable)
      .leftJoin(worshipMemberSongsTable, eq(worshipMemberSongsTable.account_id, worshipAccountsTable.id))
      .where(eq(worshipAccountsTable.status, "approved"))
      .groupBy(worshipAccountsTable.id)
      .orderBy(
        desc(sql`${worshipAccountsTable.role} = 'owner'`),
        desc(sql`${worshipAccountsTable.role} = 'leader'`),
        asc(worshipAccountsTable.full_name),
      );
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

// ── Join requests (head leader + leaders) ─────────────────────────────────────

router.get("/worship/requests", requireWorship({ approver: true }), async (req, res) => {
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

router.post("/worship/requests/:id/approve", requireWorship({ approver: true }), async (req, res) => {
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
    inBackground("accepted notify", notifyAccepted(updated, me(req)));
    return res.json({ member: publicAccount(updated) });
  } catch (err) {
    return fail(req, res, err);
  }
});

// Declining deletes the request so the person can ask again later.
router.post("/worship/requests/:id/decline", requireWorship({ approver: true }), async (req, res) => {
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

// ── Head leader only: roles, removal, PIN resets ──────────────────────────────

async function findAccount(id: string) {
  return db.query.worshipAccountsTable.findFirst({ where: eq(worshipAccountsTable.id, id) });
}

router.patch("/worship/members/:id/role", requireWorship({ owner: true }), async (req, res) => {
  try {
    const role = body(req).role;
    if (role !== "leader" && role !== "member") return res.status(400).json({ error: "Invalid role." });
    const target = await findAccount(String(req.params.id));
    if (!target) return res.status(404).json({ error: "Team member not found." });
    const check = checkMemberChange(target, role === "leader" ? "make_leader" : "make_member");
    if (!check.ok) return res.status(400).json({ error: check.error });
    const [updated] = await db
      .update(worshipAccountsTable)
      .set({ role })
      .where(eq(worshipAccountsTable.id, target.id))
      .returning();
    return res.json({ member: publicAccount(updated) });
  } catch (err) {
    return fail(req, res, err);
  }
});

router.delete("/worship/members/:id", requireWorship({ owner: true }), async (req, res) => {
  try {
    const target = await findAccount(String(req.params.id));
    if (!target) return res.status(404).json({ error: "Team member not found." });
    const check = checkMemberChange(target, "remove");
    if (!check.ok) return res.status(400).json({ error: check.error });
    await db.delete(worshipAccountsTable).where(eq(worshipAccountsTable.id, target.id));
    return res.json({ ok: true });
  } catch (err) {
    return fail(req, res, err);
  }
});

// Head leader resets a forgotten PIN; the new PIN is returned once to hand over.
router.post("/worship/members/:id/reset-pin", requireWorship({ owner: true }), async (req, res) => {
  try {
    const target = await findAccount(String(req.params.id));
    if (!target) return res.status(404).json({ error: "Team member not found." });
    if (target.id === me(req).id) {
      return res.status(400).json({ error: "Change your own PIN from your profile." });
    }
    const pin = generatePin();
    await db
      .update(worshipAccountsTable)
      .set({ pin_hash: await bcrypt.hash(pin, 12) })
      .where(eq(worshipAccountsTable.id, target.id));
    await revokeAllWorshipSessions(target.id);
    // Phone + name so the head leader can WhatsApp the new PIN straight to them.
    return res.json({ pin, phone: target.phone, full_name: target.full_name });
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
      return res.status(403).json({ error: "Only the person who added this song or the head leader can edit it." });
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
      return res.status(403).json({ error: "Only the person who added this song or the head leader can delete it." });
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

// ── Sunday setlists (everyone views; head leader + leaders build) ─────────────

router.get("/worship/setlists", requireWorship(), async (req, res) => {
  try {
    const rows = await db
      .select({
        id: worshipSetlistsTable.id,
        service_date: worshipSetlistsTable.service_date,
        title: worshipSetlistsTable.title,
        song_count: sql<number>`(select count(*)::int from ${worshipSetlistSongsTable} where ${worshipSetlistSongsTable.setlist_id} = ${worshipSetlistsTable.id})`,
      })
      .from(worshipSetlistsTable)
      .orderBy(desc(worshipSetlistsTable.service_date), desc(worshipSetlistsTable.created_at))
      .limit(60);
    return res.json({ setlists: rows });
  } catch (err) {
    return fail(req, res, err);
  }
});

async function loadSetlist(id: string) {
  const setlist = await db.query.worshipSetlistsTable.findFirst({
    where: eq(worshipSetlistsTable.id, id),
  });
  if (!setlist) return null;
  const songs = await db
    .select({
      song_id: worshipSongsTable.id,
      title: worshipSongsTable.title,
      artist: worshipSongsTable.artist,
      original_key: worshipSongsTable.original_key,
      tempo_bpm: worshipSongsTable.tempo_bpm,
      song_key: worshipSetlistSongsTable.song_key,
      lead_id: worshipSetlistSongsTable.lead_id,
      lead_name: worshipAccountsTable.full_name,
    })
    .from(worshipSetlistSongsTable)
    .innerJoin(worshipSongsTable, eq(worshipSetlistSongsTable.song_id, worshipSongsTable.id))
    .leftJoin(worshipAccountsTable, eq(worshipSetlistSongsTable.lead_id, worshipAccountsTable.id))
    .where(eq(worshipSetlistSongsTable.setlist_id, id))
    .orderBy(asc(worshipSetlistSongsTable.position));
  return { setlist, songs };
}

router.get("/worship/setlists/:id", requireWorship(), async (req, res) => {
  try {
    const data = await loadSetlist(String(req.params.id));
    if (!data) return res.status(404).json({ error: "Setlist not found." });
    return res.json({ ...data, can_edit: canApprove(me(req)) });
  } catch (err) {
    return fail(req, res, err);
  }
});

/**
 * Writes a setlist's songs. A song without a key gets its leader's own key
 * for it (from their song list), else the song's original key.
 */
async function writeSetlistSongs(tx: Tx, setlistId: string, songs: SetlistInput["songs"]) {
  await tx.delete(worshipSetlistSongsTable).where(eq(worshipSetlistSongsTable.setlist_id, setlistId));
  const rows = [];
  for (const [i, s] of songs.entries()) {
    const song = await tx.query.worshipSongsTable.findFirst({ where: eq(worshipSongsTable.id, s.song_id) });
    if (!song) throw new SetlistError("One of the songs is no longer in the library.");
    if (s.lead_id) {
      const lead = await tx.query.worshipAccountsTable.findFirst({
        where: and(eq(worshipAccountsTable.id, s.lead_id), eq(worshipAccountsTable.status, "approved")),
      });
      if (!lead) throw new SetlistError("One of the song leaders isn't on the team.");
    }
    let key = s.song_key;
    if (!key && s.lead_id) {
      const theirs = await tx.query.worshipMemberSongsTable.findFirst({
        where: and(
          eq(worshipMemberSongsTable.account_id, s.lead_id),
          eq(worshipMemberSongsTable.song_id, s.song_id),
        ),
      });
      key = theirs?.preferred_key ?? null;
    }
    rows.push({
      setlist_id: setlistId,
      song_id: s.song_id,
      lead_id: s.lead_id,
      song_key: key ?? song.original_key,
      position: i,
    });
  }
  await tx.insert(worshipSetlistSongsTable).values(rows);
}

class SetlistError extends Error {}
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

router.post("/worship/setlists", requireWorship({ approver: true }), async (req, res) => {
  try {
    const input = validateSetlistInput(body(req));
    if (!input.ok) return res.status(400).json({ error: input.error });
    const { songs, ...fields } = input.value;
    const created = await db.transaction(async (tx) => {
      const [row] = await tx
        .insert(worshipSetlistsTable)
        .values({ ...fields, created_by: me(req).id })
        .returning();
      await writeSetlistSongs(tx, row.id, songs);
      return row;
    });
    inBackground("setlist notify", notifySetlistPosted(me(req), created));
    return res.status(201).json({ setlist: created });
  } catch (err) {
    if (err instanceof SetlistError) return res.status(400).json({ error: err.message });
    return fail(req, res, err);
  }
});

router.put("/worship/setlists/:id", requireWorship({ approver: true }), async (req, res) => {
  try {
    const input = validateSetlistInput(body(req));
    if (!input.ok) return res.status(400).json({ error: input.error });
    const { songs, ...fields } = input.value;
    const updated = await db.transaction(async (tx) => {
      const [row] = await tx
        .update(worshipSetlistsTable)
        .set({ ...fields, updated_at: new Date() })
        .where(eq(worshipSetlistsTable.id, String(req.params.id)))
        .returning();
      if (!row) return null;
      await writeSetlistSongs(tx, row.id, songs);
      return row;
    });
    if (!updated) return res.status(404).json({ error: "Setlist not found." });
    return res.json({ setlist: updated });
  } catch (err) {
    if (err instanceof SetlistError) return res.status(400).json({ error: err.message });
    return fail(req, res, err);
  }
});

router.delete("/worship/setlists/:id", requireWorship({ approver: true }), async (req, res) => {
  try {
    await db.delete(worshipSetlistsTable).where(eq(worshipSetlistsTable.id, String(req.params.id)));
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
// Pending requests can subscribe too, so they hear when they're accepted.
router.post("/worship/push/subscribe", requireWorship({ allowPending: true }), async (req, res) => {
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

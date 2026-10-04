import type { Request, Response, NextFunction } from "express";
import { and, eq, gt } from "drizzle-orm";
import {
  db,
  worshipAccountsTable,
  worshipSessionsTable,
  type WorshipAccount,
} from "@workspace/db";
import { isUuid, SESSION_TTL_MS } from "./sessions";

/**
 * Worship Team sessions. Completely separate from JG Youth logins: the token
 * travels in its own `x-worship-session` header and is only checked against
 * worship_sessions, so a JG Youth or leader session never opens worship data.
 */
export const WORSHIP_SESSION_HEADER = "x-worship-session";

export async function createWorshipSession(
  accountId: string,
  userAgent?: string | null,
): Promise<{ session_token: string; expires_at: number }> {
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  const [row] = await db
    .insert(worshipSessionsTable)
    .values({
      account_id: accountId,
      expires_at: expiresAt,
      user_agent: userAgent ? userAgent.slice(0, 300) : null,
    })
    .returning({ token: worshipSessionsTable.token });
  return { session_token: row.token, expires_at: expiresAt.getTime() };
}

export async function revokeWorshipSession(token: string): Promise<void> {
  if (!isUuid(token)) return;
  await db.delete(worshipSessionsTable).where(eq(worshipSessionsTable.token, token));
}

export async function revokeAllWorshipSessions(accountId: string): Promise<void> {
  await db.delete(worshipSessionsTable).where(eq(worshipSessionsTable.account_id, accountId));
}

export function worshipTokenFrom(req: Request): string | null {
  const raw = req.headers[WORSHIP_SESSION_HEADER];
  return typeof raw === "string" && isUuid(raw) ? raw : null;
}

async function accountForToken(token: string): Promise<WorshipAccount | null> {
  const [row] = await db
    .select({ account: worshipAccountsTable })
    .from(worshipSessionsTable)
    .innerJoin(worshipAccountsTable, eq(worshipSessionsTable.account_id, worshipAccountsTable.id))
    .where(
      and(eq(worshipSessionsTable.token, token), gt(worshipSessionsTable.expires_at, new Date())),
    )
    .limit(1);
  return row?.account ?? null;
}

/**
 * Requires a worship session. By default the account must be approved;
 * `allowPending` lets a waiting join request read its own status. `leader`
 * restricts to worship leaders.
 */
export function requireWorship(opts: { allowPending?: boolean; leader?: boolean } = {}) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const token = worshipTokenFrom(req);
      if (!token) return res.status(401).json({ error: "Please sign in to the worship team." });
      const account = await accountForToken(token);
      if (!account) return res.status(401).json({ error: "Your worship sign-in has expired." });
      if (account.status !== "approved" && !opts.allowPending) {
        return res.status(403).json({ error: "A worship leader still needs to approve you." });
      }
      if (opts.leader && account.role !== "leader") {
        return res.status(403).json({ error: "Only worship leaders can do that." });
      }
      req.worshipAccount = account;
      req.worshipToken = token;
      return next();
    } catch (err) {
      req.log.error(err);
      return res.status(500).json({ error: "Internal server error" });
    }
  };
}

/** The fields other team members may see (never the PIN hash or phone). */
export function publicAccount(a: WorshipAccount) {
  return {
    id: a.id,
    full_name: a.full_name,
    role: a.role,
    status: a.status,
    instruments: a.instruments,
    vocal_range: a.vocal_range,
    bio: a.bio,
    created_at: a.created_at,
  };
}

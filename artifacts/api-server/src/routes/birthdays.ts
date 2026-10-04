import { Router, Request, Response } from "express";
import { isNotNull } from "drizzle-orm";
import { db, profilesTable } from "@workspace/db";
import { requireLeaderSession } from "../middlewares/requireLeaderSession";
import { todaySAST } from "../lib/age";
import { selectBirthdays } from "../lib/birthdays";
import { resolveAccount } from "../lib/resolveAccount";

const router = Router();

// GET /birthdays — today's & this-week's birthdays across all profiles with a
// date_of_birth (leaders only). Display data for the dashboard widget.
router.get("/birthdays", requireLeaderSession("leader"), async (req: Request, res: Response) => {
  try {
    const rows = await db
      .select({
        id: profilesTable.id,
        full_name: profilesTable.full_name,
        avatar_url: profilesTable.avatar_url,
        date_of_birth: profilesTable.date_of_birth,
      })
      .from(profilesTable)
      .where(isNotNull(profilesTable.date_of_birth));

    return res.json(selectBirthdays(rows, todaySAST()));
  } catch (err) {
    req.log.error(err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// GET /birthdays/today — whose birthday it is today, for any signed-in member
// (email or PIN), so the member dashboard can show a birthday banner.
router.get("/birthdays/today", async (req: Request, res: Response) => {
  try {
    const me = await resolveAccount(req);
    if (!me) return res.status(401).json({ error: "Not signed in" });
    const rows = await db
      .select({
        id: profilesTable.id,
        full_name: profilesTable.full_name,
        avatar_url: profilesTable.avatar_url,
        date_of_birth: profilesTable.date_of_birth,
      })
      .from(profilesTable)
      .where(isNotNull(profilesTable.date_of_birth));
    const { today } = selectBirthdays(rows, todaySAST());
    // Only what the banner shows: no dates of birth or ages.
    return res.json({
      today: today.map((b) => ({ id: b.id, full_name: b.full_name, avatar_url: b.avatar_url, is_me: b.id === me.id })),
    });
  } catch (err) {
    req.log.error(err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

export default router;

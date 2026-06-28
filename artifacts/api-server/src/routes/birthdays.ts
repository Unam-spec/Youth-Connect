import { Router, Request, Response } from "express";
import { isNotNull } from "drizzle-orm";
import { db, profilesTable } from "@workspace/db";
import { requireLeaderSession } from "../middlewares/requireLeaderSession";
import { todaySAST } from "../lib/age";
import { selectBirthdays } from "../lib/birthdays";

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

export default router;

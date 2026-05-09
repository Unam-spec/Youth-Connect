import { Router } from "express";
import { ilike, or } from "drizzle-orm";
import { db, profilesTable } from "@workspace/db";

const router = Router();

router.get("/checkin/search", async (req, res) => {
  try {
    const query = typeof req.query.query === "string" ? req.query.query : "";
    if (!query || query.length < 2) {
      return res.json([]);
    }
    const profiles = await db
      .select()
      .from(profilesTable)
      .where(
        or(
          ilike(profilesTable.full_name, `%${query}%`),
          ilike(profilesTable.phone ?? "", `%${query}%`),
        ),
      )
      .limit(20);
    return res.json(profiles);
  } catch (err) {
    req.log.error(err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

export default router;

import { sql } from "drizzle-orm";

export async function up(db: any) {
  await db.execute(sql`
    COMMENT ON COLUMN "profiles"."avatar_url" IS 'text (URL only, no base64)';
  `);
}

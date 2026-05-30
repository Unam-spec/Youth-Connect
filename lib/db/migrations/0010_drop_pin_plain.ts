import { sql } from "drizzle-orm";

export async function up(db: any) {
  await db.execute(sql`ALTER TABLE profiles DROP COLUMN IF EXISTS pin_plain`);
}

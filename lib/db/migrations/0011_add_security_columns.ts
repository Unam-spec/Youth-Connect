import { sql } from "drizzle-orm";

export async function up(db: any) {
  await db.execute(sql`
    ALTER TABLE "profiles" ADD COLUMN IF NOT EXISTS "link_token" text;
    ALTER TABLE "profiles" ADD COLUMN IF NOT EXISTS "link_token_expires_at" timestamp with time zone;
    ALTER TABLE "profiles" ADD COLUMN IF NOT EXISTS "link_token_used" boolean NOT NULL DEFAULT false;
    ALTER TABLE "profiles" ADD COLUMN IF NOT EXISTS "session_token" uuid;
  `);
}

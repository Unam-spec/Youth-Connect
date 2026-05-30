import { sql } from "drizzle-orm";

export async function up(db: any) {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "pending_emails" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      "to_address" text NOT NULL,
      "subject" text NOT NULL,
      "body_html" text NOT NULL,
      "created_at" timestamp with time zone DEFAULT now(),
      "sent_at" timestamp with time zone,
      "attempts" integer DEFAULT 0,
      "last_error" text
    );
  `);
}

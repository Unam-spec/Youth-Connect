import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { sql, eq } from "drizzle-orm";
import { pendingEmailsTable } from "./lib/db/src/schema/index.ts";
import * as dotenv from "dotenv";

dotenv.config({ path: "./artifacts/api-server/.env" });

async function run() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const db = drizzle(pool);

  // Use raw SQL for the atomic lock
  const result = await db.execute(sql`
    SELECT id, to_address, subject, body_html, attempts
    FROM pending_emails
    ORDER BY created_at ASC
    LIMIT 10
  `);

  console.log("Result:", result);
  console.log("Is array?", Array.isArray(result));

  const pending = Array.isArray(result) ? result : (result as any).rows;
  console.log("Pending rows:", pending);
  
  process.exit(0);
}

run().catch(console.error);

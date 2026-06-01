import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { sql, eq, isNotNull } from "drizzle-orm";
import { pendingEmailsTable } from "./lib/db/src/schema/index.ts";
import * as dotenv from "dotenv";

dotenv.config({ path: "./artifacts/api-server/.env" });

async function run() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const db = drizzle(pool);

  const errors = await db.select({
    id: pendingEmailsTable.id,
    to: pendingEmailsTable.to_address,
    attempts: pendingEmailsTable.attempts,
    last_error: pendingEmailsTable.last_error
  }).from(pendingEmailsTable).where(isNotNull(pendingEmailsTable.last_error)).limit(5);

  console.log("Recent errors in production:");
  console.log(errors);
  
  process.exit(0);
}

run().catch(console.error);

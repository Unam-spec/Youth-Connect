import { Client } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { messagesTable, roleEnum } from "./schema/messages";

const client = new Client({
  connectionString: process.env.DATABASE_URL,
});

async function connectDb() {
  await client.connect();
}

connectDb();

export const db = drizzle(client, { schema: { messagesTable, roleEnum } });

export async function runMigrations() {
  console.log("Running migrations...");
  await migrate(db, { migrationsFolder: "./drizzle" });
  console.log("Migrations finished!");
}

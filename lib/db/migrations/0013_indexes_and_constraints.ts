import { sql } from "drizzle-orm";

export async function up(db: any) {
  await db.execute(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_super_admin_limit ON profiles (role) WHERE role = 'super_admin';
    CREATE INDEX IF NOT EXISTS idx_profiles_clerk_id ON profiles (clerk_id);
    CREATE INDEX IF NOT EXISTS idx_profiles_email ON profiles (email);
    CREATE INDEX IF NOT EXISTS idx_profiles_phone ON profiles (phone);
  `);
}

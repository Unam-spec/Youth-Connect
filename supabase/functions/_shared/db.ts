import postgres from "npm:postgres@3";
import { drizzle } from "npm:drizzle-orm@0.45.2/postgres-js";
import * as schema from "./schema.ts";

// SUPABASE_DB_URL is injected automatically into Edge Functions (Supavisor pooler).
// prepare:false is required for transaction-mode pooling.
const sql = postgres(Deno.env.get("SUPABASE_DB_URL")!, { prepare: false });

export const db = drizzle(sql, { schema });
export { schema, sql };

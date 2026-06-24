import { Pool } from "pg";
import { config } from "dotenv";
import { join } from "path";

config({ path: join(process.cwd(), ".env") });

const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  console.error("DATABASE_URL is required in .env");
  process.exit(1);
}

const pool = new Pool({ connectionString: DATABASE_URL });

function toE164(phone: string, defaultCc: string): string | null {
  if (typeof phone !== "string") return null;
  let p = phone.trim().replace(/[\s\-().]/g, "");
  if (!p) return null;

  if (p.startsWith("+")) {
    // keep as-is
  } else if (p.startsWith("00")) {
    p = "+" + p.slice(2);
  } else if (p.startsWith("0")) {
    p = defaultCc + p.slice(1);
  } else if (/^\d{6,15}$/.test(p)) {
    if (p.startsWith("27") || p.startsWith("267")) {
      p = "+" + p;
    } else {
      p = defaultCc + p;
    }
  } else {
    return null;
  }

  const digits = p.replace(/\D/g, "");
  if (digits.length < 8 || digits.length > 15) return null;
  return "+" + digits;
}

async function run() {
  console.log("Connecting to database...");
  const client = await pool.connect();
  
  try {
    await client.query("BEGIN");
    
    // 1. Migrate Profiles Table
    const { rows: profiles } = await client.query('SELECT id, full_name, phone, parent_phone FROM profiles');
    console.log(`Found ${profiles.length} profiles to check.`);
    
    let profileUpdates = 0;
    for (const p of profiles) {
      const defaultCc = p.full_name?.toLowerCase().includes("kgosi quincy") ? "+267" : "+27";
      let updated = false;
      let newPhone = p.phone;
      let newParentPhone = p.parent_phone;
      
      if (p.phone && !p.phone.startsWith("+")) {
        const e = toE164(p.phone, defaultCc);
        if (e && e !== p.phone) {
          newPhone = e;
          updated = true;
        }
      }
      
      if (p.parent_phone && !p.parent_phone.startsWith("+")) {
        const e = toE164(p.parent_phone, defaultCc);
        if (e && e !== p.parent_phone) {
          newParentPhone = e;
          updated = true;
        }
      }
      
      if (updated) {
        await client.query('UPDATE profiles SET phone = $1, parent_phone = $2 WHERE id = $3', [newPhone, newParentPhone, p.id]);
        profileUpdates++;
      }
    }
    console.log(`Updated ${profileUpdates} profiles.`);

    // 2. Migrate Visitors Table
    const { rows: visitors } = await client.query('SELECT id, full_name, phone_number, parent_phone FROM visitors');
    console.log(`Found ${visitors.length} visitors to check.`);
    
    let visitorUpdates = 0;
    for (const v of visitors) {
      const defaultCc = v.full_name?.toLowerCase().includes("kgosi quincy") ? "+267" : "+27";
      let updated = false;
      let newPhone = v.phone_number;
      let newParentPhone = v.parent_phone;
      
      if (v.phone_number && !v.phone_number.startsWith("+")) {
        const e = toE164(v.phone_number, defaultCc);
        if (e && e !== v.phone_number) {
          newPhone = e;
          updated = true;
        }
      }
      
      if (v.parent_phone && !v.parent_phone.startsWith("+")) {
        const e = toE164(v.parent_phone, defaultCc);
        if (e && e !== v.parent_phone) {
          newParentPhone = e;
          updated = true;
        }
      }
      
      if (updated) {
        await client.query('UPDATE visitors SET phone_number = $1, parent_phone = $2 WHERE id = $3', [newPhone, newParentPhone, v.id]);
        visitorUpdates++;
      }
    }
    console.log(`Updated ${visitorUpdates} visitors.`);
    
    await client.query("COMMIT");
    console.log("Migration completed successfully.");
    
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Migration failed:", error);
  } finally {
    client.release();
    pool.end();
  }
}

run();

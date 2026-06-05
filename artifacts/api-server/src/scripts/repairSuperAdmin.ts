import { eq, and } from "drizzle-orm";
import { db, profilesTable } from "@workspace/db";
import dotenv from "dotenv";

dotenv.config();

async function main() {
  console.log("Starting super admin profile repair...");

  // 1. Find the profile with role = 'super_admin'
  const superAdminProfiles = await db.select().from(profilesTable).where(eq(profilesTable.role, 'super_admin'));
  
  if (superAdminProfiles.length === 0) {
    console.error("❌ No super_admin profile found.");
    process.exit(1);
  }

  if (superAdminProfiles.length > 1) {
    console.warn(`⚠️ Found ${superAdminProfiles.length} super_admin profiles. Using the first one for email matching.`);
  }

  const superAdmin = superAdminProfiles[0];
  const superAdminEmail = superAdmin.email;

  if (!superAdminEmail) {
    console.error("❌ Super admin profile does not have an email address.");
    process.exit(1);
  }

  console.log(`Found super_admin: ID=${superAdmin.id}, Email=${superAdminEmail}, Current Clerk ID=${superAdmin.clerk_id}`);

  // 2. Find the duplicate visitor profile with the same email
  const visitorProfiles = await db.select().from(profilesTable).where(
    and(
      eq(profilesTable.role, 'visitor'),
      eq(profilesTable.email, superAdminEmail)
    )
  );

  if (visitorProfiles.length === 0) {
    console.log("✅ No duplicate visitor profile found for this email. Nothing to repair.");
    process.exit(0);
  }

  const visitorProfile = visitorProfiles[0];
  const newClerkId = visitorProfile.clerk_id;

  if (!newClerkId) {
     console.error("❌ The duplicate visitor profile does not have a clerk_id.");
     process.exit(1);
  }

  console.log(`Found duplicate visitor: ID=${visitorProfile.id}, New Clerk ID=${newClerkId}`);

  // 3. Update the super_admin profile with the new clerk_id
  console.log(`Updating super_admin with new Clerk ID...`);
  await db.update(profilesTable).set({ clerk_id: newClerkId }).where(eq(profilesTable.id, superAdmin.id));
  console.log("✅ Successfully updated super_admin profile.");

  // 4. Delete the duplicate visitor profile
  console.log(`Deleting duplicate visitor profile...`);
  await db.delete(profilesTable).where(eq(profilesTable.id, visitorProfile.id));
  console.log("✅ Successfully deleted duplicate visitor profile.");

  // 5. Verify
  const verify = await db.select().from(profilesTable).where(eq(profilesTable.email, superAdminEmail));
  console.log("Verification - Remaining profiles for this email:");
  console.log(verify.map(v => ({ id: v.id, role: v.role, clerk_id: v.clerk_id })));

  console.log("🎉 Repair complete!");
  process.exit(0);
}

main().catch(err => {
  console.error("❌ Fatal error:", err);
  process.exit(1);
});

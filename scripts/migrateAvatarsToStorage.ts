import "dotenv/config";
import { eq, like } from "drizzle-orm";
import { db, profilesTable } from "@workspace/db";
import { uploadAvatar } from "../artifacts/api-server/src/storage/avatarUpload";

async function run() {
  console.log("Starting one-time avatar base64-to-storage migration script...");
  
  // 1. Query all profiles where avatar_url LIKE 'data:%'
  const profiles = await db.query.profilesTable.findMany({
    where: like(profilesTable.avatar_url, "data:%"),
  });

  console.log(`Found ${profiles.length} profile(s) with base64 data URI avatars.`);

  let succeeded = 0;
  let failed = 0;

  for (const profile of profiles) {
    try {
      const dataUri = profile.avatar_url!;
      const match = dataUri.match(/^data:([^;]+);base64,(.+)$/);
      if (!match) {
        console.warn(`[Profile ID: ${profile.id}] Invalid base64 data URI format. Skipping.`);
        failed++;
        continue;
      }

      const mimeType = match[1];
      const base64Data = match[2];
      const buffer = Buffer.from(base64Data, "base64");

      // 2. Upload raw buffer to Supabase Storage avatars bucket
      const publicUrl = await uploadAvatar(profile.id, buffer, mimeType);

      // 3. Update database record with new Supabase public URL
      await db.update(profilesTable)
        .set({ avatar_url: publicUrl })
        .where(eq(profilesTable.id, profile.id));

      console.log(`[Profile ID: ${profile.id}] Migrated successfully. Public URL: ${publicUrl}`);
      succeeded++;
    } catch (err: any) {
      console.error(`[Profile ID: ${profile.id}] Failed to migrate avatar:`, err.message || err);
      failed++;
    }
  }

  console.log("\n==============================================");
  console.log("Avatar Migration Execution Summary:");
  console.log(`Total Found:            ${profiles.length}`);
  console.log(`Migrated Successfully:  ${succeeded}`);
  console.log(`Failed / Skipped:       ${failed}`);
  console.log("==============================================");
}

run().catch((err) => {
  console.error("Fatal error in migration execution:", err);
  process.exit(1);
});

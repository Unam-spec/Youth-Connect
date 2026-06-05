import { db, profilesTable } from "@workspace/db";
import { like, eq } from "drizzle-orm";
import { uploadAvatar } from "../storage/avatarUpload";
import { logger } from "../lib/logger";

async function run() {
  logger.info("[migrateAvatars] Starting avatar migration script...");
  
  try {
    const profiles = await db.query.profilesTable.findMany({
      where: like(profilesTable.avatar_url, "data:%"),
    });

    logger.info(`[migrateAvatars] Found ${profiles.length} profiles with base64 avatars.`);

    for (const profile of profiles) {
      if (!profile.avatar_url) continue;

      try {
        const matches = profile.avatar_url.match(/^data:([^;]+);base64,(.+)$/);
        if (!matches || matches.length !== 3) {
          logger.warn(`[migrateAvatars] Invalid data URI for profile ${profile.id}, skipping...`);
          continue;
        }

        const mimeType = matches[1];
        const base64Data = matches[2];
        const buffer = Buffer.from(base64Data, "base64");

        const publicUrl = await uploadAvatar(profile.id, buffer, mimeType);

        await db.update(profilesTable)
          .set({ avatar_url: publicUrl })
          .where(eq(profilesTable.id, profile.id));

        logger.info(`[migrateAvatars] Successfully migrated avatar for profile ${profile.id}`);
      } catch (err) {
        logger.error({ err, profileId: profile.id }, `[migrateAvatars] Failed to migrate avatar for profile ${profile.id}`);
      }
    }

    logger.info("[migrateAvatars] Migration script completed successfully.");
    process.exit(0);
  } catch (err) {
    logger.error({ err }, "[migrateAvatars] Critical error during migration");
    process.exit(1);
  }
}

run();

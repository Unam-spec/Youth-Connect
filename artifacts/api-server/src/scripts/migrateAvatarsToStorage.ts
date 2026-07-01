import "dotenv/config";
import { db, profilesTable } from "@workspace/db";
import { like, eq } from "drizzle-orm";
import { uploadAvatar } from "../storage/avatarUpload";
import { parseDataUri } from "../storage/parseDataUri";
import { logger } from "../lib/logger";

/**
 * One-shot backfill: find every profile whose avatar_url is an inline base64
 * `data:` URI, compress it (uploadAvatar downscales to <=100KB), upload it to
 * Cloudinary, and repoint the row at the hosted URL. Because it never writes to
 * Supabase Storage, it works even while the Supabase project is egress-restricted.
 *
 * Idempotent: rows already pointing at a URL are skipped, so it is safe to
 * re-run. Run locally against production with DATABASE_URL, CLOUDINARY_CLOUD_NAME,
 * CLOUDINARY_API_KEY and CLOUDINARY_API_SECRET set:
 *
 *   pnpm --filter @workspace/api-server run migrate:avatars
 */
async function run() {
  logger.info("[migrateAvatars] Starting avatar migration...");

  let migrated = 0;
  let skipped = 0;
  let failed = 0;

  try {
    const profiles = await db.query.profilesTable.findMany({
      where: like(profilesTable.avatar_url, "data:%"),
    });

    logger.info(`[migrateAvatars] Found ${profiles.length} profiles with base64 avatars.`);

    for (const profile of profiles) {
      if (!profile.avatar_url) {
        skipped++;
        continue;
      }

      const parsed = parseDataUri(profile.avatar_url);
      if (!parsed) {
        logger.warn(`[migrateAvatars] Not a base64 data URI for profile ${profile.id}, skipping.`);
        skipped++;
        continue;
      }

      try {
        const beforeBytes = parsed.buffer.length;
        // uploadAvatar downscales/compresses to a <=100KB JPEG before storing.
        const publicUrl = await uploadAvatar(profile.id, parsed.buffer, parsed.mimeType);

        await db
          .update(profilesTable)
          .set({ avatar_url: publicUrl })
          .where(eq(profilesTable.id, profile.id));

        migrated++;
        logger.info(
          `[migrateAvatars] Migrated ${profile.id}: ${(beforeBytes / 1024).toFixed(0)}KB decoded → Storage (${publicUrl})`,
        );
      } catch (err) {
        failed++;
        logger.error({ err, profileId: profile.id }, `[migrateAvatars] Failed for profile ${profile.id}`);
      }
    }

    logger.info(
      `[migrateAvatars] Done. migrated=${migrated} skipped=${skipped} failed=${failed}`,
    );
    process.exit(failed > 0 ? 1 : 0);
  } catch (err) {
    logger.error({ err }, "[migrateAvatars] Critical error during migration");
    process.exit(1);
  }
}

run();

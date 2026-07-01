import { logger } from "../lib/logger";
import { downscaleAvatar } from "./downscaleAvatar";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

/**
 * Upper bound on an uploaded avatar before compression. This is just a memory
 * guard — the image is always downscaled to <=100KB afterwards, so we can
 * comfortably accept full-resolution phone photos.
 */
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024; // 10 MB

export class FileTooLargeError extends Error {
  constructor(message = "File exceeds the 10MB size limit") {
    super(message);
    this.name = "FileTooLargeError";
  }
}

export async function uploadAvatar(
  profileId: string,
  buffer: Buffer,
  mimeType: string
): Promise<string> {
  if (buffer.length > MAX_UPLOAD_BYTES) {
    throw new FileTooLargeError();
  }

  if (!mimeType.startsWith("image/")) {
    throw new Error(`Unsupported avatar type: ${mimeType}`);
  }

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    logger.warn("[supabase-storage] SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is missing — skipping storage upload");
    throw new Error("Supabase Storage credentials are not configured");
  }

  // Normalise + compress to a <=100KB JPEG regardless of what was uploaded.
  const processed = await downscaleAvatar(buffer);
  const filename = `${profileId}-${Date.now()}.jpg`;
  const uploadUrl = `${SUPABASE_URL}/storage/v1/object/avatars/${filename}`;

  logger.info(
    `[supabase-storage] Uploading avatar ${filename} (${buffer.length} → ${processed.length} bytes) to Supabase...`,
  );

  const response = await fetch(uploadUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      "Content-Type": "image/jpeg",
      "x-upsert": "true",
    },
    body: processed,
  });

  if (!response.ok) {
    const errorText = await response.text();
    logger.error({ errorText, status: response.status }, "[supabase-storage] Failed to upload avatar to Supabase Storage");
    throw new Error(`Failed to upload avatar to Supabase: ${errorText}`);
  }

  const publicUrl = `${SUPABASE_URL}/storage/v1/object/public/avatars/${filename}`;
  logger.info(`[supabase-storage] Successfully uploaded avatar. Public URL: ${publicUrl}`);
  return publicUrl;
}

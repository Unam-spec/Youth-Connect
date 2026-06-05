import { logger } from "../lib/logger";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

export class FileTooLargeError extends Error {
  constructor(message = "File exceeds the 2MB size limit") {
    super(message);
    this.name = "FileTooLargeError";
  }
}

export async function uploadAvatar(
  profileId: string,
  buffer: Buffer,
  mimeType: string
): Promise<string> {
  // Enforce 2MB file size limit (2,097,152 bytes)
  const maxBytes = 2 * 1024 * 1024;
  if (buffer.length > maxBytes) {
    throw new FileTooLargeError();
  }

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    logger.warn("[supabase-storage] SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is missing — skipping storage upload");
    throw new Error("Supabase Storage credentials are not configured");
  }

  const ext = mimeType.split("/")[1]?.split(";")[0]?.replace("jpeg", "jpg") || "png";
  const filename = `${profileId}-${Date.now()}.${ext}`;
  const uploadUrl = `${SUPABASE_URL}/storage/v1/object/avatars/${filename}`;

  logger.info(`[supabase-storage] Uploading avatar file ${filename} (${buffer.length} bytes) to Supabase...`);

  const response = await fetch(uploadUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      "Content-Type": mimeType,
      "x-upsert": "true",
    },
    body: buffer,
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

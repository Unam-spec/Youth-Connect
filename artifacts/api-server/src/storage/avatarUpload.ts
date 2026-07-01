import crypto from "node:crypto";
import { logger } from "../lib/logger";
import { downscaleAvatar } from "./downscaleAvatar";

// Avatars are hosted on Cloudinary (free tier, separate bandwidth quota) so they
// never count against Supabase's egress cap. The image is still compressed to
// <=100KB before upload.
const CLOUDINARY_CLOUD_NAME = process.env.CLOUDINARY_CLOUD_NAME;
const CLOUDINARY_API_KEY = process.env.CLOUDINARY_API_KEY;
const CLOUDINARY_API_SECRET = process.env.CLOUDINARY_API_SECRET;

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

  if (!CLOUDINARY_CLOUD_NAME || !CLOUDINARY_API_KEY || !CLOUDINARY_API_SECRET) {
    logger.warn("[cloudinary] CLOUDINARY_CLOUD_NAME / API_KEY / API_SECRET missing — skipping avatar upload");
    throw new Error("Cloudinary credentials are not configured");
  }

  // Normalise + compress to a <=100KB JPEG regardless of what was uploaded.
  const processed = await downscaleAvatar(buffer);

  // Signed upload: sign every param we send except file, api_key and
  // resource_type, sorted alphabetically, then append the API secret (SHA-1).
  const timestamp = Math.floor(Date.now() / 1000);
  const publicId = `avatars/${profileId}`;
  const signable = `overwrite=true&public_id=${publicId}&timestamp=${timestamp}`;
  const signature = crypto
    .createHash("sha1")
    .update(signable + CLOUDINARY_API_SECRET)
    .digest("hex");

  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(processed)], { type: "image/jpeg" }), "avatar.jpg");
  form.append("api_key", CLOUDINARY_API_KEY);
  form.append("timestamp", String(timestamp));
  form.append("public_id", publicId);
  form.append("overwrite", "true");
  form.append("signature", signature);

  logger.info(
    `[cloudinary] Uploading avatar ${publicId} (${buffer.length} → ${processed.length} bytes)...`,
  );

  const response = await fetch(
    `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/image/upload`,
    { method: "POST", body: form },
  );

  if (!response.ok) {
    const errorText = await response.text();
    logger.error({ errorText, status: response.status }, "[cloudinary] Failed to upload avatar");
    throw new Error(`Failed to upload avatar to Cloudinary: ${errorText}`);
  }

  const data = (await response.json()) as { secure_url?: string };
  if (!data.secure_url) {
    throw new Error("Cloudinary response did not include a secure_url");
  }
  logger.info(`[cloudinary] Uploaded avatar. URL: ${data.secure_url}`);
  return data.secure_url;
}

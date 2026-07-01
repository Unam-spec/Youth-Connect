import sharp from "sharp";

/** Longest edge (px) an avatar is resized down to. */
export const MAX_EDGE = 512;
/** Hard ceiling for the encoded avatar. */
export const MAX_BYTES = 100 * 1024; // 100 KB
const MIN_QUALITY = 40;
const START_QUALITY = 82;
const QUALITY_STEP = 8;

async function encodeAt(input: Buffer, quality: number): Promise<Buffer> {
  return sharp(input)
    .rotate() // honour EXIF orientation, then metadata is dropped on re-encode
    .resize(MAX_EDGE, MAX_EDGE, { fit: "inside", withoutEnlargement: true })
    .jpeg({ quality, mozjpeg: true })
    .toBuffer();
}

/**
 * Normalise an uploaded avatar: resize so the longest edge is <= 512px and
 * re-encode as JPEG, stepping quality down until the result is <= 100 KB.
 *
 * Always returns a valid JPEG buffer. Small inputs come back small (well under
 * the ceiling); large/noisy inputs are compressed down to fit.
 */
export async function downscaleAvatar(input: Buffer): Promise<Buffer> {
  let quality = START_QUALITY;
  let out = await encodeAt(input, quality);
  while (out.length > MAX_BYTES && quality - QUALITY_STEP >= MIN_QUALITY) {
    quality -= QUALITY_STEP;
    out = await encodeAt(input, quality);
  }
  return out;
}

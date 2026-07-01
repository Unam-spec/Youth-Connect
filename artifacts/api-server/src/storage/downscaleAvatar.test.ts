import { describe, it, expect } from "vitest";
import sharp from "sharp";
import { downscaleAvatar, MAX_BYTES, MAX_EDGE } from "./downscaleAvatar";

/** Build a large, high-entropy JPEG that will NOT compress small on its own. */
async function makeBigNoisyJpeg(size = 1400): Promise<Buffer> {
  const channels = 3;
  const raw = Buffer.alloc(size * size * channels);
  for (let i = 0; i < raw.length; i++) raw[i] = Math.floor(Math.random() * 256);
  return sharp(raw, { raw: { width: size, height: size, channels } })
    .jpeg({ quality: 100 })
    .toBuffer();
}

describe("downscaleAvatar", () => {
  it("shrinks a large noisy image to <=100KB and <=512px, still a JPEG", async () => {
    const big = await makeBigNoisyJpeg();
    expect(big.length).toBeGreaterThan(MAX_BYTES); // sanity: the input really is fat

    const out = await downscaleAvatar(big);

    expect(out.length).toBeLessThanOrEqual(MAX_BYTES);
    const meta = await sharp(out).metadata();
    expect(Math.max(meta.width ?? 0, meta.height ?? 0)).toBeLessThanOrEqual(MAX_EDGE);
    expect(meta.format).toBe("jpeg");
  });

  it("leaves a small image valid and small", async () => {
    const small = await sharp({
      create: { width: 128, height: 128, channels: 3, background: { r: 20, g: 150, b: 140 } },
    })
      .jpeg()
      .toBuffer();

    const out = await downscaleAvatar(small);

    expect(out.length).toBeLessThanOrEqual(MAX_BYTES);
    const meta = await sharp(out).metadata();
    expect(meta.width).toBeLessThanOrEqual(MAX_EDGE);
    expect(meta.format).toBe("jpeg");
  });
});

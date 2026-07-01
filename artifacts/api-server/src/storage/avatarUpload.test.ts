import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import sharp from "sharp";

async function makeBigNoisyJpeg(size = 1400): Promise<Buffer> {
  const channels = 3;
  const raw = Buffer.alloc(size * size * channels);
  for (let i = 0; i < raw.length; i++) raw[i] = Math.floor(Math.random() * 256);
  return sharp(raw, { raw: { width: size, height: size, channels } })
    .jpeg({ quality: 100 })
    .toBuffer();
}

describe("uploadAvatar (Cloudinary)", () => {
  beforeEach(() => {
    process.env.CLOUDINARY_CLOUD_NAME = "demo";
    process.env.CLOUDINARY_API_KEY = "test-key";
    process.env.CLOUDINARY_API_SECRET = "test-secret";
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("uploads a compressed (<=100KB) jpeg and returns the secure_url", async () => {
    const big = await makeBigNoisyJpeg();
    expect(big.length).toBeGreaterThan(100 * 1024);

    let capturedUrl: string | undefined;
    let capturedBody: unknown;
    const fetchMock = vi.fn(async (url: string, init: any) => {
      capturedUrl = url;
      capturedBody = init.body;
      return {
        ok: true,
        json: async () => ({
          secure_url:
            "https://res.cloudinary.com/demo/image/upload/v1/avatars/profile-123.jpg",
        }),
      } as Response;
    });
    vi.stubGlobal("fetch", fetchMock);

    const { uploadAvatar } = await import("./avatarUpload");
    const url = await uploadAvatar("profile-123", big, "image/png");

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(capturedUrl).toBe("https://api.cloudinary.com/v1_1/demo/image/upload");

    // The file sent to Cloudinary is the compressed JPEG.
    const file = (capturedBody as FormData).get("file") as Blob;
    expect(file.size).toBeLessThanOrEqual(100 * 1024);
    // A signature is included (signed upload).
    expect((capturedBody as FormData).get("signature")).toBeTruthy();

    expect(url).toBe(
      "https://res.cloudinary.com/demo/image/upload/v1/avatars/profile-123.jpg",
    );
  });

  it("rejects a non-image mime type", async () => {
    vi.stubGlobal("fetch", vi.fn());
    const { uploadAvatar } = await import("./avatarUpload");
    await expect(
      uploadAvatar("profile-123", Buffer.from("not an image"), "application/pdf"),
    ).rejects.toThrow(/Unsupported avatar type/);
  });

  it("throws when Cloudinary credentials are missing", async () => {
    delete process.env.CLOUDINARY_CLOUD_NAME;
    delete process.env.CLOUDINARY_API_KEY;
    delete process.env.CLOUDINARY_API_SECRET;
    vi.resetModules();
    vi.stubGlobal("fetch", vi.fn());
    const small = await sharp({
      create: { width: 64, height: 64, channels: 3, background: { r: 1, g: 2, b: 3 } },
    })
      .jpeg()
      .toBuffer();
    const { uploadAvatar } = await import("./avatarUpload");
    await expect(uploadAvatar("p1", small, "image/jpeg")).rejects.toThrow(
      /Cloudinary credentials are not configured/,
    );
  });
});

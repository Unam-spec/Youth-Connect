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

describe("uploadAvatar", () => {
  beforeEach(() => {
    process.env.SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-key";
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("uploads a compressed (<=100KB) jpeg and returns a public URL", async () => {
    const big = await makeBigNoisyJpeg();
    expect(big.length).toBeGreaterThan(100 * 1024);

    let capturedBody: Buffer | undefined;
    let capturedContentType: string | undefined;
    const fetchMock = vi.fn(async (_url: string, init: any) => {
      capturedBody = init.body as Buffer;
      capturedContentType = init.headers["Content-Type"];
      return { ok: true, text: async () => "" } as Response;
    });
    vi.stubGlobal("fetch", fetchMock);

    const { uploadAvatar } = await import("./avatarUpload");
    const url = await uploadAvatar("profile-123", big, "image/png");

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(capturedBody!.length).toBeLessThanOrEqual(100 * 1024);
    expect(capturedContentType).toBe("image/jpeg");
    expect(url).toContain("/storage/v1/object/public/avatars/profile-123-");
    expect(url).toMatch(/\.jpg$/);
  });

  it("rejects a non-image mime type", async () => {
    vi.stubGlobal("fetch", vi.fn());
    const { uploadAvatar } = await import("./avatarUpload");
    await expect(
      uploadAvatar("profile-123", Buffer.from("not an image"), "application/pdf"),
    ).rejects.toThrow(/Unsupported avatar type/);
  });
});

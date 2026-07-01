import { describe, it, expect } from "vitest";
import { parseDataUri } from "./parseDataUri";

describe("parseDataUri", () => {
  it("decodes a base64 data URI into mime + bytes", () => {
    // "hello" in base64 is aGVsbG8=
    const result = parseDataUri("data:image/png;base64,aGVsbG8=");
    expect(result?.mimeType).toBe("image/png");
    expect(result?.buffer.toString("utf8")).toBe("hello");
  });

  it("returns null for a normal URL", () => {
    expect(parseDataUri("https://example.com/avatars/x.jpg")).toBeNull();
  });

  it("returns null for a gradient placeholder", () => {
    expect(parseDataUri("gradient:linear-gradient(...)")).toBeNull();
  });
});

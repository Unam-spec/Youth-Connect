import { describe, it, expect } from "vitest";
import { isPrivateAddress, fetchPublicText, FetchBlockedError } from "./safeFetch";

describe("isPrivateAddress", () => {
  it("blocks internal addresses", () => {
    for (const ip of ["127.0.0.1", "10.1.2.3", "172.16.0.1", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "::1", "fd00::1", "fe80::1", "::ffff:127.0.0.1"]) {
      expect(isPrivateAddress(ip), ip).toBe(true);
    }
  });
  it("allows public addresses", () => {
    for (const ip of ["8.8.8.8", "104.16.1.1", "2606:4700::1111"]) expect(isPrivateAddress(ip), ip).toBe(false);
  });
});

describe("fetchPublicText", () => {
  it("refuses non-web and internal links before fetching", async () => {
    await expect(fetchPublicText("file:///etc/passwd")).rejects.toBeInstanceOf(FetchBlockedError);
    await expect(fetchPublicText("http://127.0.0.1:8080/api")).rejects.toBeInstanceOf(FetchBlockedError);
    await expect(fetchPublicText("http://169.254.169.254/latest/meta-data")).rejects.toBeInstanceOf(FetchBlockedError);
    await expect(fetchPublicText("not a url")).rejects.toBeInstanceOf(FetchBlockedError);
  });
});

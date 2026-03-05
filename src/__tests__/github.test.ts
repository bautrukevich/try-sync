import { describe, it, expect } from "vitest";
import { verifySignature, mapEventToStatus } from "../lib/github";

// ---------------------------------------------------------------------------
// Helper: compute a real HMAC-SHA256 hex digest (mirrors production code)
// ---------------------------------------------------------------------------
async function sign(secret: string, body: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const mac = await crypto.subtle.sign("HMAC", key, encoder.encode(body));
  const hex = Array.from(new Uint8Array(mac))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return `sha256=${hex}`;
}

// ---------------------------------------------------------------------------
// verifySignature
// ---------------------------------------------------------------------------
describe("verifySignature", () => {
  const secret = "test-secret";
  const body = '{"action":"opened"}';

  it("returns true for a valid signature", async () => {
    const sig = await sign(secret, body);
    expect(await verifySignature(secret, body, sig)).toBe(true);
  });

  it("returns false when the signature is wrong", async () => {
    expect(
      await verifySignature(secret, body, "sha256=deadbeef")
    ).toBe(false);
  });

  it("returns false when the header is null", async () => {
    expect(await verifySignature(secret, body, null)).toBe(false);
  });

  it("returns false when the header is missing the sha256= prefix", async () => {
    const sig = await sign(secret, body);
    expect(
      await verifySignature(secret, body, sig.replace("sha256=", ""))
    ).toBe(false);
  });

  it("returns false when the body differs from what was signed", async () => {
    const sig = await sign(secret, body);
    expect(
      await verifySignature(secret, '{"action":"closed"}', sig)
    ).toBe(false);
  });

  it("returns false when the secret is wrong", async () => {
    const sig = await sign("wrong-secret", body);
    expect(await verifySignature(secret, body, sig)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// mapEventToStatus
// ---------------------------------------------------------------------------
describe("mapEventToStatus", () => {
  it("maps opened → In Progress", () => {
    expect(mapEventToStatus("opened", false)).toBe("In Progress");
  });

  it("maps edited → In Progress", () => {
    expect(mapEventToStatus("edited", false)).toBe("In Progress");
  });

  it("maps review_requested → In Review", () => {
    expect(mapEventToStatus("review_requested", false)).toBe("In Review");
  });

  it("maps closed+merged=true → Done", () => {
    expect(mapEventToStatus("closed", true)).toBe("Done");
  });

  it("returns null for closed+merged=false (not a merge, just a close)", () => {
    expect(mapEventToStatus("closed", false)).toBeNull();
  });

  it("returns null for unhandled actions", () => {
    expect(mapEventToStatus("labeled", false)).toBeNull();
    expect(mapEventToStatus("synchronize", false)).toBeNull();
    expect(mapEventToStatus("assigned", false)).toBeNull();
  });
});

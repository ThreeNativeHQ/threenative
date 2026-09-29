import { createHash, randomBytes } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";

import { sha256Hex, sha256Portable } from "../src/sha256.js";

const node = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");
const hex = (bytes: Uint8Array): string => Buffer.from(bytes).toString("hex");

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("sha256 on a host without WebCrypto", () => {
  it("should match Node's SHA-256 across every padding boundary and a multi-block buffer", () => {
    const lengths = [0, 1, 3, 55, 56, 57, 63, 64, 65, 119, 120, 128, 1_000_003];
    for (const length of lengths) {
      const bytes = new Uint8Array(randomBytes(length));
      expect(hex(sha256Portable(bytes)), `length ${length}`).toBe(node(bytes));
    }
    expect(hex(sha256Portable(new TextEncoder().encode("abc")))).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });

  it("should hash through the portable path when the runtime installs no crypto global", async () => {
    // The native hosts install no `crypto`: `sha256Hex` used to throw "crypto is not defined".
    vi.stubGlobal("crypto", undefined);
    const bytes = new Uint8Array(randomBytes(4096));
    await expect(sha256Hex(bytes)).resolves.toBe(node(bytes));
  });
});

import { readFileSync } from "node:fs";
import { expect, test } from "vitest";

const smoke = readFileSync(
  new URL("../../../examples/native-smoke/src/game.ts", import.meta.url),
  "utf8",
);
const verifier = readFileSync(
  new URL("../scripts/verify-desktop-loading.mjs", import.meta.url),
  "utf8",
);

test("the deliberate loading stall uses a black overlay instead of the magenta contract marker", () => {
  expect(smoke).toMatch(/const LOADING_PROOF_OVERLAY_COLOR = 0x000000;/u);
  expect(smoke).toMatch(
    /color: __TN_LOADING_PROOF__ \? LOADING_PROOF_OVERLAY_COLOR : OVERLAY_COLOR/u,
  );
  expect(verifier).not.toMatch(/0xff00ff|magenta/u);
  expect(verifier).toMatch(/const LOADING_PROOF_BACKDROP_COLOR = 0x101820;/u);
});

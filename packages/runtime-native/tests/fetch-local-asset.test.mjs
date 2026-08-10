import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test } from "vitest";

import {
  assertLocalAssetProof,
  fetchLocalAssetProof,
  LOCAL_ASSET_MARKER,
} from "../conformance/scenes/shared/fetch-local-asset.js";

const scenePath = fileURLToPath(
  new URL("../conformance/scenes/shared/fetch-local-asset.js", import.meta.url),
);

test("row 82 fetches exact text and bytes, exposes response metadata, and revokes the URL", async () => {
  const proof = await fetchLocalAssetProof();
  assert.equal(proof.status, 200);
  assert.equal(proof.statusText, "OK");
  assert.equal(proof.contentType, "text/plain;charset=utf-8");
  assert.equal(proof.text, LOCAL_ASSET_MARKER);
  assert.equal(proof.decodedBytes, LOCAL_ASSET_MARKER);
  assert.equal(proof.bytes, new TextEncoder().encode(LOCAL_ASSET_MARKER).byteLength);
  assert.equal(proof.revoked, true);
});

test("row 82 fails closed for wrong status, headers, text, bytes, or revocation", () => {
  const valid = {
    bytes: new TextEncoder().encode(LOCAL_ASSET_MARKER).byteLength,
    contentType: "text/plain;charset=utf-8",
    decodedBytes: LOCAL_ASSET_MARKER,
    revoked: true,
    status: 200,
    statusText: "OK",
    text: LOCAL_ASSET_MARKER,
  };
  const cases = [
    [{ ...valid, status: 404 }, /status 404/u],
    [{ ...valid, contentType: null }, /content type/u],
    [{ ...valid, text: "wrong" }, /text marker/u],
    [{ ...valid, bytes: 0 }, /byte count/u],
    [{ ...valid, decodedBytes: "wrong" }, /exact UTF-8 bytes/u],
    [{ ...valid, revoked: false }, /invalidate/u],
  ];
  for (const [proof, message] of cases) {
    assert.throws(() => assertLocalAssetProof(proof), message);
  }
});

test("row 82 has no server, image, network, or target-specific fallback", () => {
  const source = readFileSync(scenePath, "utf8");
  assert.doesNotMatch(
    source,
    /__TN_ASSET_BASE__|conformance\/README|https?:\/\/|createImageBitmap|CanvasTexture|android|desktop/u,
  );
  assert.match(source, /new Blob/u);
  assert.match(source, /new Request/u);
  assert.match(source, /response\.headers\.get|textResponse\.headers\.get/u);
  assert.match(source, /response\.text|textResponse\.text/u);
  assert.match(source, /arrayBuffer/u);
  assert.match(source, /URL\.revokeObjectURL/u);
});

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, test } from "vitest";

import {
  assertStaticGlb,
  loadStaticGlbFixture,
} from "../conformance/scenes/shared/gltf-loader-glb.js";
import {
  assertExternalGltf,
  loadExternalGltfFixture,
} from "../conformance/scenes/shared/gltf-loader-external.js";

const root = fileURLToPath(new URL("../", import.meta.url));

beforeAll(() => {
  globalThis.self = globalThis;
  if (typeof globalThis.ProgressEvent !== "function") {
    globalThis.ProgressEvent = class ProgressEvent {
      constructor(type, init = {}) {
        this.type = type;
        Object.assign(this, init);
      }
    };
  }
  globalThis.createImageBitmap = async (blob) => {
    assert.equal(blob.type, "image/png");
    assert.ok((await blob.arrayBuffer()).byteLength > 60);
    return { close() {}, height: 1, width: 1 };
  };
});

test("rows 42 and 84 load a real GLB and reject an aborted Request", async () => {
  const proof = await loadStaticGlbFixture();
  assert.equal(proof.mesh.geometry.getAttribute("position").count, 3);
  assert.equal(proof.abortProof.aborted, true);
  assert.ok(proof.events.includes("start"));
  assert.ok(proof.events.includes("load"));
  assert.throws(
    () => assertStaticGlb({ scene: { getObjectByName: () => null } }, [], []),
    /StaticGlbMesh/u,
  );

});

test("rows 43 and 44 fetch an external buffer and decode an external texture", async () => {
  const proof = await loadExternalGltfFixture();
  assert.equal(proof.mesh.geometry.getAttribute("position").count, 3);
  assert.equal(proof.mesh.material.map.isTexture, true);
  assert.ok(proof.requested.some((url) => url.endsWith("fixture.bin")));
  assert.ok(proof.requested.some((url) => url.endsWith("fixture.png")));
  assert.throws(
    () => assertExternalGltf({ scene: { getObjectByName: () => null } }, [], [], []),
    /ExternalGltfMesh/u,
  );
});

test("fixtures have no missing asset, network, or target-specific fallback", () => {
  const source = ["gltf-loader-fixtures.js", "gltf-loader-glb.js", "gltf-loader-external.js"]
    .map((name) => readFileSync(join(root, "conformance/scenes/shared", name), "utf8"))
    .join("\n");
  assert.doesNotMatch(source, /DamagedHelmet|examples\/assets|https?:\/\/|android|desktop/u);
  assert.match(source, /new GLTFLoader/u);
  assert.match(source, /new AbortController/u);
  assert.match(source, /new Request/u);
  assert.match(source, /setURLModifier/u);
  assert.match(source, /fixture\.bin/u);
  assert.match(source, /fixture\.png/u);
});

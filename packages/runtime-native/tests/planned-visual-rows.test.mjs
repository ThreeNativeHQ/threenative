import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import * as THREE from "three/webgpu";
import { test } from "vitest";
import { assertAnimatedShadowProof } from "../conformance/scenes/shared/animated-shadows.js";
import { assertBufferGeometryProof } from "../conformance/scenes/shared/buffer-geometry.js";
import { assertColorManagementProof } from "../conformance/scenes/shared/color-management.js";
import { assertDepthPrecisionProof } from "../conformance/scenes/shared/depth-precision.js";
import { assertHierarchyProof } from "../conformance/scenes/shared/hierarchy.js";
import { assertOffscreenPixels } from "../conformance/scenes/shared/offscreen-screenshot.js";
import { assertOrthographicCameraProof } from "../conformance/scenes/shared/orthographic-camera.js";
import { assertPerspectiveCameraProof } from "../conformance/scenes/shared/perspective-camera.js";
import { assertJpegBitmap, decodeJpegBytes } from "../conformance/scenes/shared/texture-jpeg.js";

const runtimeRoot = fileURLToPath(new URL("../", import.meta.url));

function makeIndexedQuad() {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute([-1.2, -1, 0, 1.2, -1, 0, 1.2, 1, 0, -1.2, 1, 0], 3),
  );
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(new Array(12).fill(0.5), 3));
  geometry.setIndex([0, 1, 2, 0, 2, 3]);
  return geometry;
}

test("row 02 fails closed on missing BufferGeometry attributes and indices", () => {
  const geometry = makeIndexedQuad();
  assert.doesNotThrow(() => assertBufferGeometryProof(geometry));
  const noColors = makeIndexedQuad();
  noColors.deleteAttribute("color");
  assert.throws(() => assertBufferGeometryProof(noColors), /color count/u);
  const noIndex = makeIndexedQuad();
  noIndex.setIndex(null);
  assert.throws(() => assertBufferGeometryProof(noIndex), /indexed quad/u);
});

test("rows 03 and 04 distinguish perspective depth scaling from orthographic invariance", () => {
  const perspective = new THREE.PerspectiveCamera(55, 16 / 9, 0.1, 50);
  const orthographic = new THREE.OrthographicCamera(-3, 3, 2, -2, 0.1, 20);
  orthographic.position.z = 4;
  const perspectiveProof = assertPerspectiveCameraProof(perspective);
  const orthographicProof = assertOrthographicCameraProof(orthographic);
  assert.ok(perspectiveProof.nearWidth > perspectiveProof.farWidth * 2.9);
  assert.equal(orthographicProof.nearWidth, orthographicProof.farWidth);
  assert.throws(() => assertPerspectiveCameraProof(orthographic), /PerspectiveCamera/u);
  assert.throws(() => assertOrthographicCameraProof(perspective), /OrthographicCamera/u);
});

test("row 05 proves the third-level world transform rather than only object membership", () => {
  const parent = new THREE.Group();
  parent.position.set(-0.8, -0.2, 0);
  parent.scale.setScalar(1.5);
  const child = new THREE.Group();
  child.position.set(0.8, 0.3, 0);
  const grandchild = new THREE.Object3D();
  grandchild.position.set(-0.2, 0.5, 0.18);
  parent.add(child);
  child.add(grandchild);
  const world = assertHierarchyProof(parent, child, grandchild);
  assert.ok(new THREE.Vector3(...world).distanceTo(new THREE.Vector3(0.1, 1, 0.27)) < 1e-12);
  child.position.x = 0.7;
  assert.throws(() => assertHierarchyProof(parent, child, grandchild), /world transform/u);
});

test("row 32 requires an evaluated animation plus caster, receiver, and shadow light", () => {
  const renderer = { shadowMap: { enabled: true } };
  const caster = new THREE.Object3D();
  caster.castShadow = true;
  const floor = new THREE.Object3D();
  floor.receiveShadow = true;
  const light = new THREE.Object3D();
  light.castShadow = true;
  const clip = new THREE.AnimationClip("move", 1, [
    new THREE.NumberKeyframeTrack(".position[x]", [0, 1], [-0.75, 0.75]),
  ]);
  const proof = { renderer, caster, floor, light, clip, before: -0.75, after: 0.375 };
  assert.doesNotThrow(() => assertAnimatedShadowProof(proof));
  assert.throws(
    () => assertAnimatedShadowProof({ ...proof, after: proof.before }),
    /did not move/u,
  );
  assert.throws(
    () => assertAnimatedShadowProof({ ...proof, floor: new THREE.Object3D() }),
    /must receive/u,
  );
});

test("row 41 contains a complete local JPEG and rejects a wrong decode size", () => {
  const bytes = decodeJpegBytes();
  assert.deepEqual([...bytes.slice(0, 2)], [0xff, 0xd8]);
  assert.deepEqual([...bytes.slice(-2)], [0xff, 0xd9]);
  assert.equal(bytes.byteLength, 393);
  assert.doesNotThrow(() => assertJpegBitmap({ width: 8, height: 8 }));
  assert.throws(() => assertJpegBitmap({ width: 1, height: 1 }), /must be 8x8/u);
  assert.throws(() => decodeJpegBytes("ffd8ffd9"), /byte length mismatch/u);
  assert.throws(() => decodeJpegBytes("not-hex"), /hexadecimal string/u);
});

test("row 61 rejects an empty, short, or uniform render-target readback", () => {
  const nonuniform = new Uint8Array([10, 20, 30, 255, 90, 80, 70, 255]);
  assert.doesNotThrow(() => assertOffscreenPixels(nonuniform, 2, 1));
  assert.throws(() => assertOffscreenPixels([10, 20, 30, 255], 1, 1), /typed array/u);
  assert.throws(
    () => assertOffscreenPixels(new Uint8Array([10, 20, 30, 255]), 2, 1),
    /size mismatch/u,
  );
  assert.throws(
    () => assertOffscreenPixels(new Uint8Array([10, 20, 30, 255, 10, 20, 30, 255]), 2, 1),
    /single color/u,
  );
});

test("row 63 proves sRGB-to-linear conversion and its encoded round trip", () => {
  const encoded = new THREE.Color().setRGB(0.5, 0.5, 0.5, THREE.SRGBColorSpace);
  const roundTrip = encoded.clone();
  THREE.ColorManagement.workingToColorSpace(roundTrip, THREE.SRGBColorSpace);
  assert.doesNotThrow(() => assertColorManagementProof(encoded, roundTrip));
  assert.throws(
    () => assertColorManagementProof(new THREE.Color(0.5, 0.5, 0.5), roundTrip),
    /not converted/u,
  );
  assert.throws(() => assertColorManagementProof(encoded, encoded), /round-trip/u);
});

test("row 64 requires two close but strictly ordered projected depths", () => {
  const camera = new THREE.PerspectiveCamera(55, 16 / 9, 0.01, 10_000);
  camera.position.z = 3.2;
  const proof = assertDepthPrecisionProof(camera);
  assert.ok(proof.separation > 1e-7 && proof.separation < 1e-3);
  assert.throws(() => assertDepthPrecisionProof(camera, -0.002, 0), /near depth/u);
  assert.throws(() => assertDepthPrecisionProof(camera, 0, -2), /not precise/u);
});

test("all nine visual rows are shared deterministic sources without target branches", () => {
  const files = [
    "buffer-geometry.js",
    "perspective-camera.js",
    "orthographic-camera.js",
    "hierarchy.js",
    "animated-shadows.js",
    "texture-jpeg.js",
    "offscreen-screenshot.js",
    "color-management.js",
    "depth-precision.js",
  ];
  const source = files
    .map((file) => readFileSync(join(runtimeRoot, "conformance/scenes/shared", file), "utf8"))
    .join("\n");
  assert.doesNotMatch(
    source,
    /navigator\.|process\.|window\.|document\.|\batob\b|\bbtoa\b|android|desktop/u,
  );
  assert.doesNotMatch(source, /fetch\(|https?:\/\//u);
  for (const file of files) {
    const fileSource = readFileSync(join(runtimeRoot, "conformance/scenes/shared", file), "utf8");
    assert.match(fileSource, /export (async )?function startScene/u, `${file} lacks startScene`);
    assert.match(fileSource, /assert[A-Z]/u, `${file} lacks a named semantic assertion`);
  }
});

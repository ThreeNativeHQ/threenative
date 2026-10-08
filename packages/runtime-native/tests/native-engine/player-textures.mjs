// Midway's texture and picking imports through the bundler, the V8 facade and the real V8 player:
// DataUtils, HalfFloatType ripples re-sent on needsUpdate, CanvasTexture, ImageBitmapLoader,
// HDRLoader from a cooked Buffer entry and MeshBVH picking. CPU only (--check-game).
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { rmSync } from "node:fs";
import { mkdtemp, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { bundleNativeEngine } from "../../scripts/bundle-native-engine.mjs";

const native = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const executable = process.argv[2];
assert(executable, "Usage: player-textures.mjs <tn-native-engine-player-v8>");
const work = await mkdtemp(resolve(native, "build/player-textures-"));
process.once("exit", () => rmSync(work, { recursive: true, force: true }));
const require = createRequire(resolve(native, "package.json"));
const three = require("three");
const { build } = require("esbuild");

// The pinned three's answers, baked into the game as its oracle.
const halfInputs = [0, -0, 1, -2, 0.5, 1 / 3, 65504, 1e9, 6.1e-5, 1e-10];
const halves = halfInputs.map((value) => three.DataUtils.toHalfFloat(value));
const halfSource = halfInputs.map((value) => (Object.is(value, -0) ? "-0" : String(value))).join(", ");

// A run-length encoded 8x2 Radiance file (its decode is proven against three in addons.spec.ts).
const width = 8;
const height = 2;
const header = `#?RADIANCE\nFORMAT=32-bit_rle_rgbe\n\n-Y ${height} +X ${width}\n`;
const body = [];
for (let y = 0; y < height; ++y) {
  body.push(2, 2, 0, width);
  for (const value of [64 + y, 128, 200, 129]) body.push(128 + width, value);
}
const hdr = Buffer.concat([Buffer.from(header, "latin1"), Buffer.from(body)]);

const writer = resolve(work, "package-writer.mjs");
await build({ entryPoints: [resolve(native, "../assets/src/native-package.ts")], outfile: writer,
  bundle: true, platform: "node", format: "esm", logLevel: "silent" });
const { writeNativePackage } = await import(writer);
const texel = Buffer.alloc(16);
texel.writeUInt32LE(1, 0); texel.writeUInt32LE(1, 4); texel.writeUInt32LE(19, 8);
texel.set([255, 32, 16, 255], 12);
const packagePath = resolve(work, "assets.tnpk");
await writeFile(packagePath, writeNativePackage([
  { name: "/assets/cockpit/dial.png", kind: 2, data: texel, uploadSize: 4 },
  { name: "/assets/sky.hdr", kind: 1, data: hdr, uploadSize: hdr.length },
]));

const entry = resolve(work, "game.ts");
const outfile = resolve(work, "game.js");
await writeFile(entry, `
import ${JSON.stringify(resolve(native, "src/engine/player/core-host.mjs"))};
import * as THREE from "three";
import { DataTexture, DataUtils, HalfFloatType, RGBAFormat, LinearFilter } from "three";
import { HDRLoader } from "three/addons/loaders/HDRLoader.js";
import { MeshBVH } from "three-mesh-bvh";
function check(value, name) { if (!value) throw Error("TEXTURES_CHECK: " + name); }
function refuses(run, pattern, name) {
  try { run(); } catch (error) { check(pattern.test(String(error.message)), name + ": " + error.message); return; }
  check(false, name + " did not throw");
}
async function rejects(run, pattern, name) {
  try { await run(); } catch (error) { check(pattern.test(String(error.message)), name + ": " + error.message); return; }
  check(false, name + " did not reject");
}

// DataUtils and HalfFloatType are three's, bit for bit.
check(HalfFloatType === ${three.HalfFloatType}, "HalfFloatType");
check(JSON.stringify([${halfSource}].map((value) => DataUtils.toHalfFloat(value))) === ${JSON.stringify(JSON.stringify(halves))}, "toHalfFloat");
check(DataUtils.fromHalfFloat(0xc000) === -2, "fromHalfFloat");

// Midway's ripples: a HalfFloatType DataTexture over a Uint16Array edited in place.
const n = 4, data = new Uint16Array(n * n * 4);
const map = new DataTexture(data, n, n, RGBAFormat, HalfFloatType);
map.minFilter = map.magFilter = LinearFilter; map.needsUpdate = true;
check(map instanceof THREE.DataTexture && map instanceof THREE.Texture && map.image.data === data, "data texture source");
const packed = map.version;
for (let i = 0; i < data.length; i++) data[i] = DataUtils.toHalfFloat(i / 7);
map.needsUpdate = true;
check(map.version === packed + 1, "one upload per needsUpdate");
map.image = { data: new Uint16Array(4), width: 1, height: 1 };
refuses(() => { map.needsUpdate = true; }, /image.data must be a typed array of width \\* height \\* 4 values/, "resized source");
refuses(() => new DataTexture(new Float32Array([0.5, 0, 0, 1]), 1, 1, RGBAFormat, HalfFloatType), /binary16 bits/, "float data as half");

// CanvasTexture reads any canvas through the standard 2D API, and again on needsUpdate.
let reads = 0;
const canvas = { width: 2, height: 1, getContext: (kind) => kind === "2d" ? {
  getImageData: () => { reads++; return { data: new Uint8ClampedArray(8).fill(200) }; } } : null };
const drawn = new THREE.CanvasTexture(canvas);
check(drawn.isCanvasTexture && drawn instanceof THREE.Texture && drawn.flipY === true && drawn.image === canvas, "canvas texture");
const drawnVersion = drawn.version;
drawn.needsUpdate = true;
check(reads === 3 && drawn.version === drawnVersion + 1, "canvas re-read on needsUpdate");
refuses(() => new THREE.CanvasTexture({ width: 1, height: 1 }), /TN_NATIVE_CANVAS_TEXTURE_SOURCE/, "canvas without 2D context");

// A Texture takes an ImageBitmapLoader result or nothing; any other image is refused, not blank.
check(new THREE.Texture() instanceof THREE.Texture, "empty texture");
refuses(() => new THREE.Texture({ width: 1, height: 1 }), /TN_NATIVE_TEXTURE_IMAGE_UNSUPPORTED/, "foreign image");

// Fail closed: the player reads this after its microtask checkpoint, so an unfinished chain fails.
globalThis.tn.__startupError = "TEXTURES_CHECK: the async checks did not finish";
(async () => {
  const loader = new THREE.ImageBitmapLoader();
  loader.setOptions({ imageOrientation: "flipY" });
  const bitmap = await loader.loadAsync("/assets/cockpit/dial.png");
  const dial = new THREE.Texture(bitmap);
  dial.flipY = false;
  check(dial instanceof THREE.Texture && dial.flipY === false, "bitmap texture");
  refuses(() => new THREE.Texture(bitmap), /TN_NATIVE_IMAGE_BITMAP_CLOSED/, "adopted twice");
  await rejects(() => loader.loadAsync("/assets/cockpit/absent.png"), /TN_NATIVE_ASSET_MISSING/, "missing bitmap");

  const sky = await new HDRLoader().loadAsync("tnpk:/assets/sky.hdr");
  check(sky instanceof THREE.DataTexture && sky.flipY === true && sky.magFilter === LinearFilter, "hdr texture");
  const floatSky = await new HDRLoader().setDataType(THREE.FloatType).loadAsync("/assets/sky.hdr");
  check(floatSky instanceof THREE.DataTexture, "float hdr");
  await rejects(() => new HDRLoader().loadAsync("/assets/cockpit/dial.png"), /TN_NATIVE_ASSET_KIND_MISMATCH: buffer/, "hdr from a texture entry");

  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.MeshBasicMaterial());
  mesh.updateMatrixWorld(true);
  const raycaster = new THREE.Raycaster(new THREE.Vector3(0.2, -0.3, 5), new THREE.Vector3(0, 0, -1));
  raycaster.firstHitOnly = true;
  const hits = new MeshBVH(mesh.geometry).raycastObject3D(mesh, raycaster, []);
  check(hits.length === 1 && hits[0].object === mesh && Math.abs(hits[0].distance - 5) < 1e-6, "MeshBVH picking");
  globalThis.tn.__startupError = undefined;
})().catch((error) => { globalThis.tn.__startupError = error.stack ?? String(error); });
globalThis.tn.scene = new THREE.Scene(); globalThis.tn.camera = new THREE.PerspectiveCamera();
globalThis.tn.onUpdate(() => {});
`);
await bundleNativeEngine({ entry, outfile, boot: false });
const run = spawnSync(resolve(executable), ["--check-game", outfile], { encoding: "utf8",
  env: { ...process.env, TN_NATIVE_ASSET_PACKAGE: packagePath } });
assert.equal(run.status, 0, `${run.stdout}\n${run.stderr}`);
assert.match(run.stdout, /startup=passed/);
console.log("PASS native textures, HDR, ImageBitmap, CanvasTexture and MeshBVH");

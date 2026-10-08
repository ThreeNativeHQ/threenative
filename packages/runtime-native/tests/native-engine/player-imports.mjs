// CPU-only integration of the game bundler, native import facade and real V8 player.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { rmSync } from "node:fs";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { bundleNativeEngine } from "../../scripts/bundle-native-engine.mjs";

const native = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const executable = process.argv[2];
assert(executable, "Usage: player-imports.mjs <tn-native-engine-player-v8>");
const work = await mkdtemp(resolve(native, "build/player-imports-"));
process.once("exit", () => rmSync(work, { recursive: true, force: true }));
const entry = resolve(work, "imports.ts");
const outfile = resolve(work, "imports.js");
const three = createRequire(resolve(native, "package.json"))("three");
const constants = ["ACESFilmicToneMapping", "AgXToneMapping", "NeutralToneMapping", "PCFSoftShadowMap",
  "NoColorSpace", "LinearSRGBColorSpace", "SRGBColorSpace", "RepeatWrapping", "ClampToEdgeWrapping",
  "NearestFilter", "LinearFilter", "LinearMipmapLinearFilter", "UnsignedByteType", "FloatType",
  "RGBAFormat", "EquirectangularReflectionMapping", "NoToneMapping", "LoopOnce", "LoopRepeat", "AttachedBindMode",
  "FrontSide", "BackSide", "DoubleSide", "StaticDrawUsage", "DynamicDrawUsage",
  "NoBlending", "NormalBlending", "AdditiveBlending"];
const names = ["PerspectiveCamera", "Camera", "Object3D", "Mesh", "PlaneGeometry", "MeshStandardMaterial",
  "SkinnedMesh", "CylinderGeometry", "BufferGeometry", "Float32BufferAttribute", "BufferAttribute",
  "DataTexture", "Texture", "Color", "PropertyBinding", "getConsoleFunction", "setConsoleFunction", "MathUtils", "Scene", "Raycaster", "Vector3", "LOD", "MeshBasicMaterial", "LatheGeometry", "Vector2", "CatmullRomCurve3", "TubeGeometry", "AnimationClip",
  "QuaternionKeyframeTrack", "VectorKeyframeTrack", "NumberKeyframeTrack", "AudioListener", "PositionalAudio", "Audio", "Shape", "Path", "ShapeGeometry",
  "ExtrudeGeometry", ...constants];
const panel = (T) => {
  const shape = new T.Shape();
  shape.moveTo(-0.3, -0.2); shape.lineTo(0.25, -0.2); shape.quadraticCurveTo(0.3, -0.2, 0.3, -0.15);
  shape.lineTo(0.3, 0.2); shape.absarc(0.2, 0.2, 0.1, 0, Math.PI / 2, false); shape.lineTo(-0.3, 0.3);
  const gauge = new T.Path(); gauge.absarc(0, 0, 0.08, 0, Math.PI * 2, true);
  shape.holes.push(gauge);
  return [new T.ExtrudeGeometry(shape, { depth: 0.026, bevelEnabled: true, bevelThickness: 0.006, bevelSize: 0.006, bevelSegments: 2, curveSegments: 8 }),
    new T.ExtrudeGeometry(shape, { depth: 0.1, steps: 2, bevelEnabled: false, curveSegments: 12 }),
    new T.ShapeGeometry(shape, 16), shape.holes.length];
};
const answers = (geometries) => JSON.stringify(geometries.slice(0, 3).map((g) => [g.getAttribute("position").array, g.getAttribute("uv").array,
  g.getAttribute("normal").array, g.groups].map((v) => Array.isArray(v) ? v : Array.from(v))).concat([geometries[3]]));
await writeFile(entry, `
import ${JSON.stringify(resolve(native, "src/engine/player/core-host.mjs"))};
import { ${names.join(", ")} } from "three";
const THREE = { ${names.join(", ")} };
import { MeshStandardNodeMaterial, MeshBasicNodeMaterial, Vector3 } from "three/webgpu";
import { AudioBus } from "@threenative/core";
import { clone } from "three/addons/utils/SkeletonUtils.js";
import { vec3, float, clamp, texture, uv, Fn, color, nodeObject, ivec2, reflect, textureLoad, cameraViewMatrix } from "three/tsl";
function check(condition, name) { if (!condition) throw Error("IMPORT_CHECK: " + name); }
check(globalThis.__THREENATIVE_NATIVE__.platform.runtime === "native", "native platform marker");
const camera = new THREE.PerspectiveCamera();
check(camera instanceof THREE.Camera && camera instanceof THREE.Object3D, "camera inheritance");
const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.MeshStandardMaterial());
check(mesh instanceof THREE.Object3D && mesh.isMesh && mesh.isObject3D, "mesh identity");
check(new THREE.SkinnedMesh() instanceof THREE.Mesh, "skinned inheritance");
check(new THREE.CylinderGeometry() instanceof THREE.BufferGeometry, "geometry inheritance");
const profile = [[0.055, 0], [0.098, 0], [0.103, 0.025], [0.091, 0.18]];
const lathe = new THREE.LatheGeometry(profile.map(([x, y]) => new THREE.Vector2(x, y)), 6);
check(lathe instanceof THREE.BufferGeometry && JSON.stringify(Array.from(lathe.getAttribute("position").array)) ===
  ${JSON.stringify(JSON.stringify(Array.from(new three.LatheGeometry([[0.055, 0], [0.098, 0], [0.103, 0.025], [0.091, 0.18]].map(([x, y]) => new three.Vector2(x, y)), 6).attributes.position.array)))}, "lathe geometry");
const grip = [[0, -0.11, 1.21], [0.02, -0.24, 1.26], [0.06, -0.35, 1.32], [0.085, -0.42, 1.37]];
const gripPoints = grip.map(([x, y, z]) => new THREE.Vector3(x, y, z));
const curve = new THREE.CatmullRomCurve3(gripPoints, false, "centripetal");
check(curve.isCatmullRomCurve3 && curve.points[0] === gripPoints[0], "curve keeps the caller's points");
const curveAnswers = [...curve.getPoints(4), curve.getTangent(0.25), curve.getPointAt(0.6), curve.getTangentAt(0.9)]
  .map((v) => v.toArray()).concat([curve.getLength()]);
check(JSON.stringify(curveAnswers) === ${JSON.stringify(JSON.stringify((() => {
  const c = new three.CatmullRomCurve3([[0, -0.11, 1.21], [0.02, -0.24, 1.26], [0.06, -0.35, 1.32], [0.085, -0.42, 1.37]].map(([x, y, z]) => new three.Vector3(x, y, z)), false, "centripetal");
  return [...c.getPoints(4), c.getTangent(0.25), c.getPointAt(0.6), c.getTangentAt(0.9)].map((v) => v.toArray()).concat([c.getLength()]);
})()))}, "CatmullRomCurve3 answers");
const tube = new THREE.TubeGeometry(curve, 12, 0.05, 10, false);
check(tube instanceof THREE.BufferGeometry && JSON.stringify(Array.from(tube.getAttribute("position").array)) ===
  ${JSON.stringify(JSON.stringify(Array.from(new three.TubeGeometry(new three.CatmullRomCurve3([[0, -0.11, 1.21], [0.02, -0.24, 1.26], [0.06, -0.35, 1.32], [0.085, -0.42, 1.37]].map(([x, y, z]) => new three.Vector3(x, y, z)), false, "centripetal"), 12, 0.05, 10, false).attributes.position.array)))}, "tube geometry");
const streamed = new THREE.Float32BufferAttribute([0, 1, 2], 3).setUsage(THREE.DynamicDrawUsage);
check(streamed.usage === THREE.DynamicDrawUsage, "attribute usage");
const sit = new THREE.AnimationClip("sit", 2, [new THREE.VectorKeyframeTrack("hip.position", [0, 2], [0, 0, 0, 1, 2, 3]),
  new THREE.QuaternionKeyframeTrack("arm.quaternion", [0, 2], [0, 0, 0, 1, 0, 0, 0, 1])]);
const gripTracks = sit.tracks.map((track) => track.name.endsWith(".quaternion")
  ? new THREE.QuaternionKeyframeTrack(track.name, [0, sit.duration], [0, 0.6, 0, 0.8, 0, 0.6, 0, 0.8]) : track.clone());
const gripClip = new THREE.AnimationClip("grip", sit.duration, gripTracks);
check(gripClip.duration === 2 && gripClip.tracks.length === 2 && gripClip.tracks[0].name === "hip.position" &&
  gripClip.tracks[1].ValueTypeName === "quaternion" && Array.from(gripClip.tracks[1].values).join() === Array.from(new Float32Array([0, 0.6, 0, 0.8, 0, 0.6, 0, 0.8])).join() &&
  gripClip.tracks[0] instanceof THREE.VectorKeyframeTrack, "authored clip from cloned and new tracks");
const glow = new THREE.MeshBasicMaterial(); glow.blending = THREE.AdditiveBlending;
check(glow.blending === THREE.AdditiveBlending, "additive blending");
const authored = new THREE.BufferGeometry();
authored.setAttribute("position", new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3));
authored.setAttribute("instanceOffset", new THREE.Float32BufferAttribute([0, 0, 0], 3));
check(authored.attributes === authored.attributes && authored.attributes.position === authored.getAttribute("position") &&
  authored.attributes.position.count === 3 && "instanceOffset" in authored.attributes && !("normal" in authored.attributes) &&
  Object.keys(authored.attributes).sort().join() === "instanceOffset,position", "geometry.attributes");
authored.deleteAttribute("instanceOffset");
check(Object.keys(authored.attributes).join() === "position" && authored.attributes.instanceOffset === undefined, "attributes after delete");
check(Object.keys(new THREE.PlaneGeometry().attributes).join() === "position,normal,uv", "generator attributes");
const panel = (T) => {
  const shape = new T.Shape();
  shape.moveTo(-0.3, -0.2); shape.lineTo(0.25, -0.2); shape.quadraticCurveTo(0.3, -0.2, 0.3, -0.15);
  shape.lineTo(0.3, 0.2); shape.absarc(0.2, 0.2, 0.1, 0, Math.PI / 2, false); shape.lineTo(-0.3, 0.3);
  const gauge = new T.Path(); gauge.absarc(0, 0, 0.08, 0, Math.PI * 2, true);
  shape.holes.push(gauge);
  return [new T.ExtrudeGeometry(shape, { depth: 0.026, bevelEnabled: true, bevelThickness: 0.006, bevelSize: 0.006, bevelSegments: 2, curveSegments: 8 }),
    new T.ExtrudeGeometry(shape, { depth: 0.1, steps: 2, bevelEnabled: false, curveSegments: 12 }),
    new T.ShapeGeometry(shape, 16), shape.holes.length];
};
const answers = (geometries) => JSON.stringify(geometries.slice(0, 3).map((g) => [g.getAttribute("position").array, g.getAttribute("uv").array,
  g.getAttribute("normal").array, g.groups].map((v) => Array.isArray(v) ? v : Array.from(v))).concat([geometries[3]]));
const panels = panel(THREE);
check(panels[0] instanceof THREE.BufferGeometry && answers(panels) === ${JSON.stringify(answers(panel(three)))}, "Shape, holes and ExtrudeGeometry as three");
const refuses = (make, pattern) => { try { make(); return false; } catch (error) { return pattern.test(String(error.message)); } };
check(refuses(() => new THREE.ExtrudeGeometry(new THREE.Shape([new THREE.Vector2(0, 0), new THREE.Vector2(1, 0), new THREE.Vector2(0, 1)]),
  { extrudePath: curve }), /extrudePath is not supported/), "extrudePath refused");
check(refuses(() => new THREE.MeshBasicMaterial({ color: 0xff0000 }), /parameters object is not supported/), "material parameters still refused");
const sided = new THREE.MeshBasicMaterial(); sided.side = THREE.DoubleSide;
check(new THREE.Mesh(lathe, sided).material.side === THREE.DoubleSide, "double-sided material");
check(new THREE.Float32BufferAttribute([0.1, 0.2], 2) instanceof THREE.BufferAttribute, "attribute inheritance");
check(new THREE.DataTexture(new Uint8Array([255, 0, 0, 255]), 1, 1) instanceof THREE.Texture, "texture inheritance");
check(Vector3 === THREE.Vector3, "cross-entry identity");
check(Math.abs(THREE.MathUtils.euclideanModulo(-1, 3) - 2) < 1e-6, "MathUtils namespace");
const scene = new THREE.Scene(); scene.add(mesh); scene.updateMatrixWorld(true);
check(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(scene.uuid) && scene.uuid !== mesh.uuid, "native object UUID");
check(scene.children[0] === mesh && mesh.parent === scene, "native child identity");
let visited = 0; scene.traverse(object => { check(object instanceof THREE.Object3D, "traversed identity"); visited++; });
check(visited === 2, "native traversal");
const binding = new THREE.PropertyBinding(scene, '.position'); binding.bind();
check(binding.targetObject === scene && THREE.PropertyBinding.findNode(scene, undefined) === scene, "native PropertyBinding");
const copied = clone(mesh);
check(copied instanceof THREE.Mesh && copied.geometry === mesh.geometry && copied.material === mesh.material, "clone native resources");
const ray = new THREE.Raycaster(new THREE.Vector3(0.2, -0.3, 5), new THREE.Vector3(0, 0, -1));
check(ray.intersectObject(mesh).length > 0, "native picking");
const lod = new THREE.LOD(); lod.addLevel(mesh, 0); check(lod.levels[0].object === mesh, "native LOD");
const material = new MeshStandardNodeMaterial();
check(material instanceof THREE.MeshStandardMaterial && material.isNodeMaterial, "node material inheritance");
material.colorNode = vec3(1, 0.5, 0).normalize().mul(0.5).clamp(0, 1).rgb;
const basic = new MeshBasicNodeMaterial();
check(basic instanceof THREE.MeshBasicMaterial, "basic node material inheritance");
const source = new THREE.Texture(); source.name = "testTexture";
basic.colorNode = texture(source, uv()).rgb;
check(nodeObject(basic.colorNode) === basic.colorNode, "nodeObject identity");
basic.colorNode = color("#808080");
basic.colorNode = color(new THREE.Color(0.1, 0.2, 0.3));
basic.colorNode = color(0.1, 0.2, 0.3);
basic.colorNode = reflect(vec3(1, -1, 0), vec3(0, 1, 0));
basic.colorNode = textureLoad(source, ivec2(0, 0)).rgb;
check(cameraViewMatrix !== undefined, "camera view uniform");
const graph = Fn(() => float(0.5).pow(2).min(1).max(0).smoothstep(0, 1).mix(1, 0.5))();
basic.opacityNode = clamp(graph, 0, 1);
for (const [name, expected] of Object.entries(${JSON.stringify(Object.fromEntries(constants.map((name) => [name, three[name]])))}))
  check(THREE[name] === expected, name + " differs from pinned Three.js");
// three's audio classes are engine objects over the player's WebAudio, and the native tick pushes
// world poses to it: the listener on the camera, a voice on a moving mesh.
const context = new THREE.AudioListener().context;
const heard = [];
const createPanner = context.createPanner.bind(context);
let panners = 0;
context.createPanner = () => {
  const panner = createPanner();
  const setPosition = panner.setPosition.bind(panner);
  const who = "voice" + panners++;
  panner.setPosition = (x, y, z) => { heard.push([who, x, y, z]); setPosition(x, y, z); };
  return panner;
};
const setListener = context.listener.setPosition.bind(context.listener);
context.listener.setPosition = (x, y, z) => { heard.push(["listener", x, y, z]); setListener(x, y, z); };
const pose = (who) => heard.filter((entry) => entry[0] === who).at(-1)?.slice(1).map((v) => Math.round(v * 1000) / 1000).join(",");
camera.position.set(0, 1, 5); scene.add(camera);
const bus = new AudioBus({ camera, maxVoices: 4, gestureTarget: null });
check(bus.listener instanceof THREE.AudioListener && bus.listener instanceof THREE.Object3D, "listener identity");
check(camera.children.includes(bus.listener) && bus.listener.parent === camera, "listener on the camera");
const buffer = context.createBuffer(1, 4410, 44100);
bus.unlock().then(() => {
  const fixed = bus.playAt(buffer, new THREE.Vector3(3, 0, -2));
  check(fixed instanceof THREE.PositionalAudio && fixed.isPlaying, "fixed positional voice");
  const welded = bus.playAt(buffer, mesh);
  check(welded.parent === mesh && mesh.children.includes(welded), "voice welded to the mesh");
  check(bus.play(buffer) instanceof THREE.Audio, "flat voice");
  mesh.position.set(-4, 0, 1);
  globalThis.tn.__update(1 / 60);
  check(pose("voice0") === "3,0,-2", "fixed voice position " + pose("voice0"));
  check(pose("voice1") === "-4,0,1", "voice follows its mesh on the tick " + pose("voice1"));
  check(pose("listener") === "0,1,5", "listener follows the camera on the tick " + pose("listener"));
  globalThis.tn.scene = scene; globalThis.tn.camera = camera; globalThis.tn.onUpdate(() => {});
}).catch((error) => { globalThis.tn.__startupError = String(error.stack ?? error); });
`);
await bundleNativeEngine({ entry, outfile, boot: false });
// The dummy driver keeps the check hermetic: the context runs with no sound card.
const run = spawnSync(resolve(executable), ["--check-game", outfile], {
  encoding: "utf8", env: { ...process.env, SDL_AUDIO_DRIVER: "dummy" } });
assert.equal(run.status, 0, `${run.stdout}\n${run.stderr}`);
assert.match(run.stdout, /engine=native gameRuntime=v8 startup=passed/);
// BufferGeometryUtils.mergeGeometries over engine geometries equals three's over its own: indexed
// parts with groups and morph targets, the arrays' types included; then core's mergeParts on it.
{
  const fromNative = createRequire(resolve(native, "package.json"));
  const T = await import(pathToFileURL(fromNative.resolve("three/webgpu")).href);
  const { mergeGeometries } = await import(pathToFileURL(fromNative.resolve("three/addons/utils/BufferGeometryUtils.js")).href);
  const parts = (K) => {
    const box = new K.BoxGeometry(1, 2, 3);
    const sphere = new K.SphereGeometry(1, 5, 4);
    for (const g of [box, sphere]) {
      const p = g.getAttribute("position");
      g.morphAttributes.position = [new K.Float32BufferAttribute(new Float32Array(p.count * 3).map((_, i) => i / 9), 3)];
    }
    return [box, sphere];
  };
  const dump = (g) => JSON.stringify([g.index.array.constructor.name, ...["position", "normal", "uv"].map((n) =>
    [g.getAttribute(n).array.constructor.name, Array.from(g.getAttribute(n).array)]), Array.from(g.index.array),
    g.morphAttributes.position.map((a) => Array.from(a.array)), g.groups]);
  const expected = dump(mergeGeometries(parts(T), true));
  await writeFile(entry, `
import ${JSON.stringify(resolve(native, "src/engine/player/core-host.mjs"))};
import { BoxGeometry, SphereGeometry, Float32BufferAttribute, Scene, PerspectiveCamera, Color } from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { mergeParts } from "@threenative/core";
function check(value, name) { if (!value) throw Error("MERGE_CHECK: " + name); }
const parts = ${parts.toString()};
const merged = mergeGeometries(parts({ BoxGeometry, SphereGeometry, Float32BufferAttribute }), true);
check((${dump.toString()})(merged) === ${JSON.stringify(expected)}, "mergeGeometries equals three's");
const baked = mergeParts([{ geometry: new BoxGeometry(), color: new Color(1, 0, 0) },
  { geometry: new SphereGeometry(1, 5, 4), color: new Color(0, 0, 1), position: [2, 0, 0] }], { label: "probe" });
check(baked.getAttribute("color").count === baked.getAttribute("position").count, "mergeParts paints every vertex");
globalThis.tn.scene = new Scene(); globalThis.tn.camera = new PerspectiveCamera(); globalThis.tn.onUpdate(() => {});
`);
  await bundleNativeEngine({ entry, outfile, boot: false });
  const merged = spawnSync(resolve(executable), ["--check-game", outfile], { encoding: "utf8" });
  assert.equal(merged.status, 0, `${merged.stdout}\n${merged.stderr}`);
}
const { build } = createRequire(resolve(native, "package.json"))("esbuild");
const writer = resolve(work, "package-writer.mjs");
await build({ entryPoints: [resolve(native, "../assets/src/native-package.ts")], outfile: writer,
  bundle: true, platform: "node", format: "esm", logLevel: "silent" });
const { writeNativePackage } = await import(writer);
// Cooked audio is a Buffer entry of encoded bytes, any length; WebAudio decodes it on the worker.
await mkdir(resolve(work, "audio"));
const audioPackage = resolve(work, "audio/assets.tnpk");
await writeFile(audioPackage, writeNativePackage([
  { name: "beep.ogg", kind: 1, data: Buffer.from("OggS!"), uploadSize: 0 },
  { name: "sky.jpg", kind: 2, data: Buffer.alloc(16), uploadSize: 4 },
]));
await writeFile(entry, `
import ${JSON.stringify(resolve(native, "src/engine/player/core-host.mjs"))};
import { createAssetLoader } from ${JSON.stringify(resolve(native, "src/engine/player/core-assets.mjs"))};
import { Scene, PerspectiveCamera, AudioLoader } from "three";
function check(value, name) { if (!value) throw Error("AUDIO_ASSET_CHECK: " + name); }
const record = globalThis.tn.loadAsset("audio", "beep.ogg");
check(record.value instanceof ArrayBuffer && String.fromCharCode(...new Uint8Array(record.value)) === "OggS!", "cooked audio bytes");
let mismatch = false;
try { globalThis.tn.loadAsset("audio", "sky.jpg"); } catch (error) { mismatch = /TN_NATIVE_ASSET_KIND_MISMATCH/.test(error.message); }
check(mismatch, "a texture entry is not audio");
// A decode settles on the first tick's drain, which a check never runs: reaching the decoder leaves
// both pending, and any refusal before it rejects inside this check's microtasks.
for (const [name, decoding] of [["assets.audio", createAssetLoader().audio("beep.ogg")],
  ["AudioLoader", new AudioLoader().loadAsync("beep.ogg")]])
  decoding.catch((error) => { globalThis.tn.__startupError = name + " refused: " + error.message; });
globalThis.tn.scene = new Scene(); globalThis.tn.camera = new PerspectiveCamera(); globalThis.tn.onUpdate(() => {});
`);
await bundleNativeEngine({ entry, outfile, boot: false });
const audioRun = spawnSync(resolve(executable), ["--check-game", outfile], { encoding: "utf8",
  env: { ...process.env, SDL_AUDIO_DRIVER: "dummy", TN_NATIVE_ASSET_PACKAGE: audioPackage } });
assert.equal(audioRun.status, 0, `${audioRun.stdout}\n${audioRun.stderr}`);
if (process.argv.includes("--imports-only")) {
  console.log("PASS native imports, identity, picking, clone, TSL and audio");
  process.exit(0);
}
// Same resident, package reader, native handles and installed bridge as the desktop player.
const textureBytes = Buffer.alloc(16);
textureBytes.writeUInt32LE(1, 0); textureBytes.writeUInt32LE(1, 4); textureBytes.writeUInt32LE(19, 8);
textureBytes.set([255, 32, 16, 255], 12);
const packageBytes = writeNativePackage([
  { name: "sky.jpg", kind: 2, data: textureBytes, uploadSize: 4 },
  { name: "model.glb", kind: 6, data: Buffer.from(JSON.stringify({ asset: { version: "2.0" },
    scene: 0, scenes: [{ nodes: [0] }], nodes: [{ name: "cooked-child" }] })), uploadSize: 0 },
]);
await mkdir(resolve(work, "native"));
const packagePath = resolve(work, "native/assets.tnpk");
await writeFile(packagePath, packageBytes);
await writeFile(entry, `
import ${JSON.stringify(resolve(native, "src/engine/player/core-host.mjs"))};
import { createAssetLoader } from ${JSON.stringify(resolve(native, "src/engine/player/core-assets.mjs"))};
import { Scene, PerspectiveCamera, Mesh, BoxGeometry, MeshBasicMaterial } from "three";
import { WebGPURenderer, RenderPipeline } from "three/webgpu";
import { vec4, convertToTexture, screenUV } from "three/tsl";
import { installThreePlaytestBridge } from "@threenative/playtest/three";
function check(value, name) { if (!value) throw Error("SERVICE_CHECK: " + name); }
const host = globalThis.__THREENATIVE_NATIVE__.physics;
check(host && typeof host.version === "string", "native Rapier resident");
const physics = host.createSimulation({ gravity: { x: 0, y: -9.81, z: 0 } });
physics.createBody({ type: "dynamic", mass: 1, position: { x: 0, y: 3, z: 0 },
  rotation: { x: 0, y: 0, z: 0, w: 1 }, collisionLayer: 1, collisionMask: 65535,
  sensor: false, continuousCollision: false,
  shape: { kind: "box", x: 0.5, y: 0.5, z: 0.5, collisionLayer: 1, collisionMask: 65535, sensor: false } });
for (let i = 0; i < 30; i++) physics.step(1 / 60);
const positions = new Float32Array(8);
check(physics.readVisibleTransforms(positions) > 0 && positions[2] < 3, "native Rapier gravity");
physics.dispose();
const scene = new Scene(); const camera = new PerspectiveCamera(); camera.position.z = 5;
const player = new Mesh(new BoxGeometry(), new MeshBasicMaterial()); scene.add(player);
scene.updateMatrixWorld(true); camera.updateMatrixWorld(true);
const renderer = new WebGPURenderer({ canvas: { width: 1280, height: 720 } });
renderer.render(scene, camera);
const pipeline = new RenderPipeline(renderer); pipeline.outputNode = vec4(0.2, 0.3, 0.4, 1);
pipeline.render();
const target = convertToTexture(vec4(0.2, 0.3, 0.4, 1)).setResolutionScale(0.5);
pipeline.outputNode = target.sample(screenUV); pipeline.render();
check(convertToTexture(target) !== undefined, "native post RTT graph");
globalThis.tn.setPostGraph(JSON.stringify({ version: 1, root: 0, nodes: [
  { kind: "ConstNode", type: "vec4", value: [1, 0.5, 0.25, 1], args: [], dependencies: [] }] }));
let refused = false;
try { globalThis.tn.setPostGraph(JSON.stringify({ version: 1, root: 0, nodes: [
  { kind: "NotANativePostNode", args: [], dependencies: [] }] })); } catch (error) { refused = /TN_NATIVE_POST_INVALID/.test(error.message); }
check(refused, "unknown post nodes refuse");
installThreePlaytestBridge({ scene, camera, renderer,
  entities: [{ id: "registered-player", object: player }],
  components: () => ({ player: { position: [0, 0, 0] } }),
  startup: () => ({ phase: "ready", progress: 1 }),
  resources: { read: () => ({ score: { value: 7 } }) },
  renderChain: () => ({ tier: "high", requested: [], stages: [], dropped: [], contributions: [],
    velocity: { provisioned: false, required: false, source: null } }) });
const assets = createAssetLoader();
Promise.all([assets.texture("sky.jpg"), assets.model("model.glb")]).then(async ([sky, model]) => {
  check(sky.name === "sky.jpg" && sky.colorSpace === "srgb", "cooked native texture");
  check(model.scene.children[0].name === "cooked-child", "native cgltf hierarchy");
  check(await assets.texture("sky.jpg") === sky, "asset cache identity");
  check(assets.progress.requested === 2 && assets.progress.settled === 2 && assets.progress.pending.length === 0, "asset progress");
  check(assets.resolved.get("sky.jpg").via === "manifest", "asset resolution");
  let missing = false;
  try { await assets.texture("absent.jpg"); } catch (error) { missing = /TN_NATIVE_ASSET_MISSING/.test(error.message); }
  check(missing, "missing cooked asset refuses");
}).catch(error => { globalThis.tn.__startupError = error.stack; });
`);
await bundleNativeEngine({ entry, outfile, boot: false });
const checked = spawnSync(resolve(executable), ["--check-game", "--check-request", JSON.stringify({
  id: "observations", method: "sample", argument: { entities: ["registered-player"] },
}), outfile], { encoding: "utf8", env: { ...process.env, TN_NATIVE_ASSET_PACKAGE: packagePath } });
assert.equal(checked.status, 0, `${checked.stdout}\n${checked.stderr}`);
assert.match(checked.stdout, /"id":"registered-player"/);
assert.match(checked.stdout, /"tier":"high"/);
assert.match(checked.stdout, /"score":\{"value":7\}/);
const corrupt = packageBytes.slice(); corrupt[corrupt.length - 1] ^= 1;
await writeFile(packagePath, corrupt);
const rejected = spawnSync(resolve(executable), ["--check-game", outfile], {
  encoding: "utf8", env: { ...process.env, TN_NATIVE_ASSET_PACKAGE: packagePath },
});
assert.equal(rejected.status, 1);
assert.match(rejected.stderr, /TN_PACKAGE_HASH/);
await writeFile(packagePath, packageBytes);
await writeFile(entry, `
import { defineGame, Scene as GameScene, getPlatform } from "@threenative/core";
import { Mesh, BoxGeometry, MeshBasicMaterial } from "three";
class Play extends GameScene {
  static initialState = {};
  enter(ctx) {
    if (getPlatform().runtime !== "native") throw Error("native platform marker missing");
    const player = ctx.add(new Mesh(new BoxGeometry(), new MeshBasicMaterial()));
    player.name = "player";
    return () => {};
  }
}
export default defineGame({ scenes: { play: Play }, start: "play", frameBudget: false,
  render: { projection: false, matrixWorld: "all" } });
`);
// Native assets avoid browser codecs. Picking's MeshBVH is bound; core's TSL context nodes are not yet.
await assert.rejects(bundleNativeEngine({ entry, outfile }), (error) =>
  /TN_NATIVE_ENGINE_UNBOUND: three\/tsl:/.test(error.message) && !/three-mesh-bvh/.test(error.message));
const accepted = await readFile(outfile, "utf8");
await writeFile(entry, 'import { NativeBindingThatDoesNotExist } from "three"; globalThis.tn.scene = new NativeBindingThatDoesNotExist();');
await assert.rejects(bundleNativeEngine({ entry, outfile, boot: false }), /TN_NATIVE_ENGINE_UNBOUND: three:NativeBindingThatDoesNotExist/);
assert.equal(await readFile(outfile, "utf8"), accepted, "failed build must preserve the prior artifact");
await writeFile(entry, `import { Scene } from ${JSON.stringify(createRequire(resolve(native, "package.json")).resolve("three"))}; globalThis.tn.scene = new Scene();`);
await assert.rejects(bundleNativeEngine({ entry, outfile, boot: false }), /TN_NATIVE_ENGINE_UPSTREAM/);
assert.equal(await readFile(outfile, "utf8"), accepted);
await assert.rejects(bundleNativeEngine({ entry, outfile: entry, boot: false }), /TN_NATIVE_ENGINE_OUTPUT/);
await writeFile(entry, 'globalThis.tn.onUpdate(async () => { const { GLTFLoader } = await import("three/addons/loaders/GLTFLoader.js"); globalThis.tn.scene = new GLTFLoader(); });');
await assert.rejects(bundleNativeEngine({ entry, outfile, boot: false }), /TN_NATIVE_ENGINE_UNBOUND: three\/addons\/loaders\/GLTFLoader.js:GLTFLoader/);
assert.equal(await readFile(outfile, "utf8"), accepted);
await writeFile(resolve(work, "bad.js"), 'globalThis.tn.__startupError = "deliberate startup failure";');
const bad = spawnSync(resolve(executable), ["--check-game", resolve(work, "bad.js")], { encoding: "utf8" });
assert.equal(bad.status, 1);
assert.match(bad.stderr, /deliberate startup failure/);
console.log("PASS native imports, TSL/RTT post, cooked assets/hash refusals, native Rapier, installed bridge and fail-closed publication");

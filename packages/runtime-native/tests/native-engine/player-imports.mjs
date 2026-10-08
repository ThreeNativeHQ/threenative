// CPU-only integration of the game bundler, native import facade and real V8 player.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { rmSync } from "node:fs";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
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
  "RGBAFormat", "EquirectangularReflectionMapping", "NoToneMapping", "LoopOnce", "LoopRepeat", "AttachedBindMode"];
const names = ["PerspectiveCamera", "Camera", "Object3D", "Mesh", "PlaneGeometry", "MeshStandardMaterial",
  "SkinnedMesh", "CylinderGeometry", "BufferGeometry", "Float32BufferAttribute", "BufferAttribute",
  "DataTexture", "Texture", "Color", "DirectionalLight", "OrthographicCamera", "Vector2", "PropertyBinding", "getConsoleFunction", "setConsoleFunction", "MathUtils", "Scene", "Raycaster", "Vector3", "LOD", "MeshBasicMaterial", ...constants];
await writeFile(entry, `
import ${JSON.stringify(resolve(native, "src/engine/player/core-host.mjs"))};
import { ${names.join(", ")} } from "three";
const THREE = { ${names.join(", ")} };
import { MeshStandardNodeMaterial, MeshBasicNodeMaterial, Vector3, NodeUpdateType } from "three/webgpu";
import { screenCoordinate, positionGeometry, normalGeometry, tangentGeometry, positionViewDirection } from "three/tsl";
import { clone } from "three/addons/utils/SkeletonUtils.js";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { Material } from "three";
import { vec3, float, clamp, texture, uv, Fn, color, nodeObject, ivec2, reflect, textureLoad, cameraViewMatrix } from "three/tsl";
function check(condition, name) { if (!condition) throw Error("IMPORT_CHECK: " + name); }
check(globalThis.__THREENATIVE_NATIVE__.platform.runtime === "native", "native platform marker");
const camera = new THREE.PerspectiveCamera();
check(camera instanceof THREE.Camera && camera instanceof THREE.Object3D, "camera inheritance");
const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.MeshStandardMaterial());
check(mesh instanceof THREE.Object3D && mesh.isMesh && mesh.isObject3D, "mesh identity");
check(new THREE.SkinnedMesh() instanceof THREE.Mesh, "skinned inheritance");
check(new THREE.CylinderGeometry() instanceof THREE.BufferGeometry, "geometry inheritance");
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
check(NodeUpdateType.FRAME === "frame" && NodeUpdateType.RENDER === "render", "NodeUpdateType");
basic.colorNode = vec3(screenCoordinate.mul(0.001), positionViewDirection.z);
basic.positionNode = positionGeometry.add(normalGeometry.mul(tangentGeometry.w.mul(0)));
check(basic.colorNode !== null && basic.positionNode !== null, "screen coordinate, geometry attributes, view direction");
const hex = new THREE.Color(0xff0000);
check(hex.isColor && hex.r === 1 && hex.g === 0 && hex.b === 0, "Color(hex)");
check(new THREE.Color("#00ff00").g === 1 && new THREE.Color(hex).r === 1, "Color(style), Color(color)");
check(hex.set(0x0000ff).b === 1 && hex.set("red").r === 1 && hex.set(0.5, 0.25, 0).g === 0.25, "Color.set");
const parameters = new THREE.MeshStandardMaterial({ color: 0x00ff00, roughness: 0.25, transparent: true, map: null });
check(parameters.color.r === 0 && parameters.color.g === 1 && parameters.roughness === 0.25 && parameters.transparent, "material parameters");
let unboundParameter = false;
try { new THREE.MeshBasicMaterial({ notAMaterialProperty: 1 }); }
catch (error) { unboundParameter = /TN_NATIVE_MATERIAL_PARAMETER: MeshBasicMaterial\.notAMaterialProperty/.test(error.message); }
check(unboundParameter, "an unbound material parameter refuses by name");
const sun = new THREE.DirectionalLight();
sun.shadow.mapSize.set(1024, 2048); sun.shadow.camera.near = 2; sun.shadow.bias = -0.5; sun.shadow.radius = 3;
check(sun.shadow === sun.shadow && sun.shadow.mapSize.y === 2048 && sun.shadow.camera.near === 2 &&
  sun.shadow.camera instanceof THREE.OrthographicCamera && sun.shadow.bias === -0.5 && sun.shadow.radius === 3, "light shadow");
const rounded = new RoundedBoxGeometry(2, 1, 1, 2, 0.1);
check(rounded instanceof THREE.BufferGeometry && rounded.index === null && rounded.type === "RoundedBoxGeometry", "RoundedBoxGeometry");
check(new THREE.Vector3().fromBufferAttribute(rounded.getAttribute("position"), 0).length() > 0.5, "fromBufferAttribute");
const grid = new THREE.DataTexture(new Uint8Array([1, 2, 3, 4]), 1, 1);
const version = grid.source.version;
grid.generateMipmaps = true; grid.anisotropy = 16; grid.needsUpdate = true;
check(grid.generateMipmaps && grid.anisotropy === 16 && grid.source === grid.source && grid.source.version === grid.version && grid.version > version, "texture sampling fields and source");
const lit = new THREE.MeshStandardMaterial({ normalMap: grid, normalScale: new THREE.Vector2(0.5, 0.25) });
check(lit.normalMap === grid && lit.normalScale.y === 0.25 && lit.normalScale === lit.normalScale, "normalMap and normalScale");
const before = grid.version; grid.needsUpdate = true;
check(grid.version === before + 1 && !Object.hasOwn(grid, "needsUpdate"), "needsUpdate reaches the engine");
check(lit instanceof Material && lit.onBeforeCompile === Material.prototype.onBeforeCompile && lit.isMaterial, "Material base");
const vertex = new THREE.Vector3();
check(new THREE.Mesh(rounded, lit).getVertexPosition(0, vertex) === vertex && vertex.equals(new THREE.Vector3().fromBufferAttribute(rounded.getAttribute("position"), 0)), "getVertexPosition");
const graph = Fn(() => float(0.5).pow(2).min(1).max(0).smoothstep(0, 1).mix(1, 0.5))();
basic.opacityNode = clamp(graph, 0, 1);
for (const [name, expected] of Object.entries(${JSON.stringify(Object.fromEntries(constants.map((name) => [name, three[name]])))}))
  check(THREE[name] === expected, name + " differs from pinned Three.js");
globalThis.tn.scene = scene; globalThis.tn.camera = camera; globalThis.tn.onUpdate(() => {});
`);
await bundleNativeEngine({ entry, outfile, boot: false });
const run = spawnSync(resolve(executable), ["--check-game", outfile], { encoding: "utf8" });
assert.equal(run.status, 0, `${run.stdout}\n${run.stderr}`);
assert.match(run.stdout, /engine=native gameRuntime=v8 startup=passed/);
if (process.argv.includes("--imports-only")) {
  console.log("PASS native imports, identity, picking, clone and TSL");
  process.exit(0);
}
// Same resident, package reader, native handles and installed bridge as the desktop player.
const { build } = createRequire(resolve(native, "package.json"))("esbuild");
const writer = resolve(work, "package-writer.mjs");
await build({ entryPoints: [resolve(native, "../assets/src/native-package.ts")], outfile: writer,
  bundle: true, platform: "node", format: "esm", logLevel: "silent" });
const { writeNativePackage } = await import(writer);
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
import { vec4, convertToTexture, screenUV, pass, mrt, output, normalView, metalness, roughness } from "three/tsl";
import { ao } from "three/addons/tsl/display/GTAONode.js";
import { denoise } from "three/addons/tsl/display/DenoiseNode.js";
import { bloom } from "three/addons/tsl/display/BloomNode.js";
import { smaa } from "three/addons/tsl/display/SMAANode.js";
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
check(renderer.toneMapping === 0 && renderer.outputColorSpace === "srgb" && !renderer.shadowMap.enabled, "renderer defaults");
renderer.toneMapping = 4; renderer.toneMappingExposure = 0.62; renderer.shadowMap.enabled = true; renderer.shadowMap.type = 2;
renderer.render(scene, camera);
renderer.toneMapping = 5;
let customRefused = false;
try { renderer.render(scene, camera); } catch (error) { customRefused = /TN_NATIVE_RENDERER_STATE: toneMapping 5/.test(error.message); }
check(customRefused, "an unimplemented tone mapping refuses");
check(renderer.info.render.drawCalls === 0 && renderer.info.render.triangles === 0 && renderer.info.render.calls === 0,
  "renderer.info counts the last drawn frame (none in a check)");
renderer.toneMapping = 4;
const pipeline = new RenderPipeline(renderer); pipeline.outputNode = vec4(0.2, 0.3, 0.4, 1);
pipeline.render();
const target = convertToTexture(vec4(0.2, 0.3, 0.4, 1)).setResolutionScale(0.5);
pipeline.outputNode = target.sample(screenUV); pipeline.render();
check(convertToTexture(target) !== undefined, "native post RTT graph");
// The minimal template's live post chain (PRD-531 slice 4): pass, MRT normals and the four addons.
const scenePass = pass(scene, camera);
let refusedNormal = false;
try { scenePass.getTextureNode("normal"); } catch (error) { refusedNormal = /TN_NATIVE_PASS_TEXTURE_UNSUPPORTED/.test(error.message); }
check(refusedNormal, "normals need the MRT that asks for them");
scenePass.setMRT(mrt({ output, normal: normalView, metalness, roughness }));
const sceneDepth = scenePass.getTextureNode("depth"), sceneNormal = scenePass.getTextureNode("normal");
let refusedMetal = false;
try { scenePass.getTextureNode("metalness"); } catch (error) { refusedMetal = /TN_NATIVE_PASS_TEXTURE_UNSUPPORTED/.test(error.message); }
check(refusedMetal && scenePass.isPassNode && scenePass.scene === scene, "the native scene pass has colour, depth and normals only");
const contact = ao(sceneDepth, sceneNormal, camera);
contact.radius.value = 0.35; contact.resolutionScale = 0.5;
check(contact.radius.value === Math.fround(0.35) && contact.resolutionScale === 0.5 && contact.getTextureNode() === contact, "GTAO uniforms");
const occlusion = denoise(contact.getTextureNode(), sceneDepth, sceneNormal, camera);
let composed = scenePass.getTextureNode().mul(occlusion.r);
composed = composed.add(bloom(convertToTexture(composed), 0.22, 0.6, 1));
const fall = screenUV.sub(0.5).length().oneMinus();
pipeline.outputNode = smaa(composed.mul(fall));
pipeline.render(); pipeline.render();
let refusedSlot = false;
try { mrt({ normal: metalness }); } catch (error) { refusedSlot = /TN_NATIVE_MRT_UNSUPPORTED/.test(error.message); }
check(refusedSlot, "an MRT slot under another name refuses");
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
// Native assets avoid browser codecs. Picking still needs its own native MeshBVH binding.
await assert.rejects(bundleNativeEngine({ entry, outfile }), /TN_NATIVE_ENGINE_UNBOUND: three-mesh-bvh:MeshBVH/);
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

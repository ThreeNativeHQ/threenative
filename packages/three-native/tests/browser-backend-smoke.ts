// PRD-532: the browser-JS back end over the real Wasm ABI (tn-native-engine-abi-module), under node.
//   tsx tests/browser-backend-smoke.ts <path to tn-native-engine-abi-module.js>
// Prints TN_BROWSER_BACKEND_OK and exits 0 when every check holds; names the first that fails.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";

import type * as THREE from "three";

import { defineBufferGeometryUtils } from "../src/addons/merge-geometries.js";
import type { defineAudioClasses } from "../src/audio.js";
import {
  type IRegistryDump,
  type TnAbiModule,
  createWasmRuntime,
  defineBrowserClasses,
  engineRef,
} from "../src/browser-backend.js";
import { bindWebEngine } from "../src/browser-entry.js";
import { defineTsl } from "../src/browser-tsl.js";
import { defineReflector } from "../src/reflector.js";

const modulePath = process.argv[2];
if (modulePath === undefined) throw new Error("usage: browser-backend-smoke.ts <abi module .js>");
const createTnAbi = createRequire(import.meta.url)(
  path.resolve(modulePath),
) as () => Promise<TnAbiModule>;
const registry = JSON.parse(
  readFileSync(path.join(import.meta.dirname, "..", "api", "native-registry.json"), "utf8"),
) as IRegistryDump;

// The back end mirrors three's API, so three's declarations type it.
const abi = await createTnAbi();
const runtime = createWasmRuntime(abi);
const engine = defineBrowserClasses(registry, runtime);
const {
  Box3,
  BoxGeometry,
  Mesh,
  MeshStandardMaterial,
  PerspectiveCamera,
  Quaternion,
  Scene,
  Vector3,
} = engine.classes as unknown as typeof THREE;

function check(condition: boolean, what: string): void {
  if (!condition) {
    process.stderr.write(`TN_BROWSER_BACKEND_FAILED: ${what}\n`);
    process.exit(1);
  }
}

const v = new Vector3(1, 2, 3);
check(v.add(new Vector3(1, 1, 1)) === v, "a chaining method returns its own wrapper");
check(v.x === 2 && v.y === 3 && v.z === 4, `Vector3.add (${v.x}, ${v.y}, ${v.z})`);
v.x = 7;
check(v.x === 7, "a setter reaches the engine");

const material = new MeshStandardMaterial();
const mesh = new Mesh(new BoxGeometry(1, 1, 1), material);
const position = mesh.position;
check(position === mesh.position, "a member object keeps one identity");
mesh.position.x = 5;
mesh.updateMatrixWorld();
check(
  mesh.matrixWorld.elements[12] === 5,
  `matrixWorld.elements[12] is ${mesh.matrixWorld.elements[12]}`,
);
check(mesh.material === material, "the material member is the constructor's material");
material.color.r = 0.25;
check(
  (mesh.material as THREE.MeshStandardMaterial).color.r === 0.25,
  "a member chain writes through",
);
const geometry = mesh.geometry;
check(geometry === mesh.geometry, "the geometry member keeps one identity");
const bounds = new Box3().setFromObject(mesh);
check(bounds.min.x === 4.5 && bounds.max.x === 5.5, "object bounds include the world transform");
check(new Box3().setFromObject(mesh, true).equals(bounds), "precise object bounds reach vertices");
check(
  new Box3().expandByObject(mesh).equals(bounds),
  "expandByObject reaches the same scene bounds",
);
const worldPosition = new Vector3();
const worldScale = new Vector3();
const worldDirection = new Vector3();
const worldQuaternion = new Quaternion();
check(
  mesh.getWorldPosition(worldPosition) === worldPosition && worldPosition.x === 5,
  "world position returns its target",
);
check(
  mesh.getWorldScale(worldScale) === worldScale && worldScale.x === 1,
  "world scale returns its target",
);
check(
  mesh.getWorldDirection(worldDirection) === worldDirection && worldDirection.z === 1,
  "world direction returns its target",
);
check(
  mesh.getWorldQuaternion(worldQuaternion) === worldQuaternion && worldQuaternion.w === 1,
  "world quaternion returns its target",
);
const camera = new PerspectiveCamera(60, 1, 0.1, 100);
camera.position.z = 5;
camera.updateMatrixWorld();
const projected = new Vector3();
check(
  projected.project(camera) === projected && projected.z > 0,
  "camera projection returns the vector",
);
check(
  projected.unproject(camera) === projected && Math.abs(projected.z) < 1e-12,
  "camera unprojection reverses projection",
);
let refused = "";
try {
  mesh.applyMatrix4("not a matrix" as never);
} catch (error) {
  refused = String(error);
}
check(refused.includes("TN_ABI_"), `an engine refusal surfaces as an error (${refused || "none"})`);

// Callbacks: the engine fires onBeforeRender (here through the module's test hook, as the renderer
// would before a draw) and the closure gets three's arguments and the mesh as `this`.
const scene = new Scene();
scene.add(mesh);
let seen = "";
const callback = function (
  this: unknown,
  renderer: unknown,
  s: unknown,
  camera: unknown,
  g: unknown,
  m: unknown,
  group: unknown,
) {
  seen = [
    renderer === null,
    s === scene,
    camera === null,
    g === mesh.geometry,
    m === mesh.material,
    group === null,
    this === mesh,
  ].join();
};
mesh.onBeforeRender = callback as never;
check(mesh.onBeforeRender === (callback as never), "the callback reads back");
const fire = () => {
  const ref = engineRef(mesh);
  if (ref === undefined) throw new Error("no engine ref");
  const [type, context, index, generation] = ref.key.split(":").map(Number) as [
    number,
    number,
    number,
    number,
  ];
  const pointer = abi._malloc(12);
  const view = new DataView(abi.HEAPU8.buffer);
  view.setUint16(pointer, type, true);
  view.setUint16(pointer + 2, context, true);
  view.setUint32(pointer + 4, index, true);
  view.setUint32(pointer + 8, generation, true);
  const status = (
    abi as unknown as { _tnw_fire_before_render(p: number): number }
  )._tnw_fire_before_render(pointer);
  abi._free(pointer);
  return status;
};
check(fire() === 0, "the engine ran the callback");
check(seen === "true,true,true,true,true,true,true", `callback arguments ${seen}`);
mesh.onBeforeRender = (() => {
  throw new Error("boom");
}) as never;
check(fire() === 1, "a throw comes back as a failure, not a crash");
mesh.onBeforeRender = null as never;
check(mesh.onBeforeRender === null && fire() === 2, "a cleared callback is gone from the engine");
let rejected = "";
try {
  mesh.onBeforeRender = 42 as never;
} catch (error) {
  rejected = String(error);
}
check(rejected.includes("must be a function"), "a non-function callback is refused");
engine.collect();

// three's audio classes on the web engine: bound by the entry over the engine's Object3D, reading
// world poses off the Wasm scene. Node has no WebAudio; a recording context
// stands in for it, so only the engine side is under test here (the WebAudio side: audio.spec.ts).
{
  const web = (await bindWebEngine(createTnAbi, [
    "AudioContext",
    "AudioListener",
    "Audio",
    "PositionalAudio",
    "AudioLoader",
    "Object3D",
    "PerspectiveCamera",
    "Mesh",
    "Scene",
  ])) as unknown as typeof THREE;
  const sound = web as unknown as ReturnType<typeof defineAudioClasses>;
  const heard: string[] = [];
  const spatial = (who: string) => ({
    setPosition: (x: number, y: number, z: number) => heard.push(`${who}:${x},${y},${z}`),
    setOrientation: () => undefined,
  });
  const node = (extra: object = {}) => ({
    connect: () => undefined,
    disconnect: () => undefined,
    ...extra,
  });
  const param = { value: 1, setTargetAtTime: () => undefined };
  sound.AudioContext.setContext({
    currentTime: 0,
    destination: node(),
    listener: spatial("listener"),
    createGain: () => node({ gain: param }),
    createPanner: () => node(spatial("voice")),
    createBufferSource: () =>
      node({ start: () => undefined, stop: () => undefined, playbackRate: param, detune: param }),
  } as never);
  const scene = new web.Scene();
  const camera = new web.PerspectiveCamera();
  const listener = new sound.AudioListener();
  camera.add(listener as never);
  scene.add(camera);
  camera.position.set(0, 1, 5);
  const boat = new web.Mesh();
  scene.add(boat);
  const voice = new sound.PositionalAudio(listener);
  boat.add(voice as never);
  voice.setBuffer({ duration: 1 } as AudioBuffer);
  voice.play();
  boat.position.set(-4, 0, 1);
  check(
    listener instanceof web.Object3D && listener.parent === camera,
    "the listener is an engine child",
  );
  check(voice instanceof sound.Audio && voice.parent === boat, "the voice is welded to the mesh");
  // What three's renderer does each frame: world matrices, then each audio object's override.
  scene.updateMatrixWorld(true);
  listener.updateMatrixWorld(true);
  voice.updateMatrixWorld(true);
  check(heard.includes("listener:0,1,5"), `listener pose ${heard.join(" ")}`);
  check(heard.includes("voice:-4,0,1"), `voice pose ${heard.join(" ")}`);
}
// The engine's Shape and ExtrudeGeometry on the web: a hole pushed onto shape.holes is cut, and the
// options object reaches the generator; positions, normals and uvs equal the pinned three's.
{
  type Ctor = new (...args: unknown[]) => Record<string, unknown>;
  const names = ["Shape", "Path", "Vector2", "ExtrudeGeometry", "ShapeGeometry", "BufferGeometry"];
  const web = (await bindWebEngine(createTnAbi, names)) as Record<string, Ctor>;
  // three/webgpu carries every core class; tsx would map a bare `three` to the generated d.ts.
  const upstream = (await import(
    pathToFileURL(
      createRequire(path.join(import.meta.dirname, "../../core/package.json")).resolve(
        "three/webgpu",
      ),
    ).href
  )) as Record<string, Ctor>;
  const build = (K: Record<string, Ctor>): string => {
    const V = K.Vector2 as Ctor;
    const shape = new (K.Shape as Ctor)([new V(-1, -1), new V(1, -1), new V(1, 1), new V(-1, 1)]);
    const hole = new (K.Path as Ctor)() as { absellipse(...args: unknown[]): unknown };
    hole.absellipse(0, 0, 0.5, 0.3, 0, Math.PI * 2, false, 0.4);
    (shape.holes as unknown[]).push(hole);
    const geometries = [
      new (K.ExtrudeGeometry as Ctor)(shape, {
        depth: 0.2,
        bevelSegments: 2,
        curveSegments: 6,
        steps: 2,
      }),
      new (K.ShapeGeometry as Ctor)(shape, 6),
    ] as unknown as { getAttribute(name: string): { array: ArrayLike<number> } }[];
    return JSON.stringify(
      geometries.map((g) =>
        ["position", "normal", "uv"].map((n) => Array.from(g.getAttribute(n).array)),
      ),
    );
  };
  check(build(web) === build(upstream), "web shape geometries equal three's");
  check(
    new (web.ExtrudeGeometry as Ctor)() instanceof (web.BufferGeometry as Ctor),
    "extrude is a BufferGeometry",
  );
}
// three's attribute.array is the attribute's own JS typed array (PRD-540): of its scalar type, one
// per attribute, kept across Wasm memory growth; an element write is what the engine reads back
// before its next call, BufferAttribute keeps the array it is handed, and needsUpdate sends a write.
{
  let grown: TnAbiModule | undefined;
  const web = (await bindWebEngine(async () => {
    grown = await createTnAbi();
    return grown;
  }, [
    "BufferGeometry",
    "Float32BufferAttribute",
    "BufferAttribute",
    "BoxGeometry",
  ])) as unknown as typeof THREE;
  const g = new web.BufferGeometry();
  g.setAttribute(
    "position",
    new web.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0] as never, 3),
  );
  const p = g.getAttribute("position") as InstanceType<typeof THREE.BufferAttribute>;
  const a = p.array;
  a[3] = 5;
  // A kept array stays the attribute's across memory growth: grow the heap by 64 MB.
  const heap = grown as TnAbiModule;
  const before = heap.HEAPU8.buffer.byteLength;
  heap._free(heap._malloc(64 << 20));
  check(heap.HEAPU8.buffer.byteLength > before, "the heap grew");
  a[4] = 7;
  check(
    a.length === 9 && a[3] === 5 && p.getY(1) === 7,
    `a kept array survives growth: ${String(a.length)}`,
  );
  g.computeBoundingBox();
  g.translate(1, 0, 0);
  const index = new web.BoxGeometry().getIndex() as InstanceType<typeof THREE.BufferAttribute>;
  const handed = new Uint32Array([7, 8]);
  const wide = new web.BufferAttribute(handed, 1);
  wide.array[1] = 9;
  const late = new web.Float32BufferAttribute([0, 0, 0] as never, 3);
  const lateArray = late.array;
  lateArray[2] = 4;
  (late as unknown as { needsUpdate: boolean }).needsUpdate = true;
  const got = [
    a instanceof Float32Array,
    p.array === a,
    p.getX(1),
    g.boundingBox?.max.x,
    a[3],
    index.array instanceof Uint16Array,
    index.array.length,
    wide.array === handed,
    wide.getX(1),
    late.getZ(0),
    late.version,
  ].join();
  check(got === "true,true,6,6,6,true,36,true,9,4,1", `attribute arrays ${got}`);
}
// three's geometry.clone() is a deep copy of the same class, dispose() leaves the CPU data usable,
// and morphAttributes reads back the attributes it was given, on the web as on V8.
{
  const web = (await bindWebEngine(createTnAbi, [
    "BoxGeometry",
    "Float32BufferAttribute",
  ])) as unknown as typeof THREE;
  const box = new web.BoxGeometry(2, 1, 1);
  const target = new web.Float32BufferAttribute(new Float32Array(72) as never, 3);
  box.morphAttributes.position = [target];
  const copy = box.clone();
  (copy.getAttribute("position") as InstanceType<typeof THREE.BufferAttribute>).setX(0, 9);
  box.dispose();
  const morphs = box.morphAttributes as { position: unknown[]; normal: unknown[] };
  const got = [
    copy instanceof web.BoxGeometry,
    copy.type,
    copy !== box,
    (box.getAttribute("position") as InstanceType<typeof THREE.BufferAttribute>).getX(0),
    (copy.getAttribute("position") as InstanceType<typeof THREE.BufferAttribute>).getX(0),
    copy.getIndex()?.count,
    morphs.position.length,
    morphs.position[0] === target,
    morphs.normal.length,
  ].join();
  check(got === "true,BoxGeometry,true,1,9,36,1,true,0", `geometry lifecycle ${got}`);
}
// BufferGeometryUtils.mergeGeometries over the web engine's geometries equals three's over its own:
// indexed parts with groups and morph targets, the arrays' types included.
{
  // biome-ignore lint/suspicious/noExplicitAny: three's and the engine's classes, compared by value.
  type Loose = any;
  const fromCore = createRequire(path.join(import.meta.dirname, "../../core/package.json"));
  const T: Loose = await import(pathToFileURL(fromCore.resolve("three/webgpu")).href);
  const utils: Loose = await import(
    pathToFileURL(fromCore.resolve("three/addons/utils/BufferGeometryUtils.js")).href
  );
  const web: Loose = await bindWebEngine(createTnAbi, [
    "BoxGeometry",
    "SphereGeometry",
    "Float32BufferAttribute",
    "BufferAttribute",
    "BufferGeometry",
  ]);
  const parts = (K: Loose) => {
    const box = new K.BoxGeometry(1, 2, 3);
    const sphere = new K.SphereGeometry(1, 5, 4);
    for (const g of [box, sphere]) {
      const count = g.getAttribute("position").count;
      g.morphAttributes.position = [
        new K.Float32BufferAttribute(
          new Float32Array(count * 3).map((_, i) => i / 9),
          3,
        ),
      ];
    }
    return [box, sphere];
  };
  const dump = (g: Loose) =>
    JSON.stringify([
      g.index.array.constructor.name,
      ...["position", "normal", "uv"].map((n) => [
        g.getAttribute(n).array.constructor.name,
        Array.from(g.getAttribute(n).array),
      ]),
      Array.from(g.index.array),
      g.morphAttributes.position.map((a: Loose) => Array.from(a.array)),
      g.groups,
    ]);
  const ported = defineBufferGeometryUtils(web).mergeGeometries(parts(web) as never, true);
  check(
    dump(ported) === dump(utils.mergeGeometries(parts(T), true)),
    "web mergeGeometries equals three's",
  );
}
// TSL by name over the real ABI: pmremTexture's texture crosses as a handle in tn_tsl_arg_t.
check(runtime.tsl !== undefined, "the module answers TSL by name");
if (runtime.tsl !== undefined) {
  const tsl = defineTsl(runtime.tsl).exports as Record<string, (...args: unknown[]) => unknown>;
  const { DataTexture } = engine.classes as unknown as typeof THREE;
  const direction = tsl.vec3?.(0, 1, 0);
  check(
    tsl.pmremTexture?.(new DataTexture(), direction, 0.5) !== undefined,
    "pmremTexture over a texture",
  );
  let refused = "";
  try {
    tsl.pmremTexture?.(new MeshStandardMaterial(), direction, 0.5);
  } catch (error) {
    refused = String(error);
  }
  check(refused.includes("pmremTexture"), `pmremTexture refuses a material: ${refused}`);
  const { Object3D, PerspectiveCamera } = engine.classes as unknown as typeof THREE;
  const reflector = defineReflector(tsl.reflector as never, { Object3D, PerspectiveCamera });
  const mirror = reflector({ resolutionScale: 0.5 }) as { target: unknown };
  check(mirror.target instanceof Object3D, "reflector builds its target over the real module");
  let wrong = "";
  try {
    tsl.reflector?.(new PerspectiveCamera(), new PerspectiveCamera(), 1, 1, 0, 0, 0);
  } catch (error) {
    wrong = String(error);
  }
  check(wrong.includes("reflector"), `reflector refuses a camera as its target: ${wrong}`);
}
process.stdout.write("TN_BROWSER_BACKEND_OK\n");

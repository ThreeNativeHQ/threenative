// PRD-532: the browser-JS back end over the real Wasm ABI (tn-native-engine-abi-module), under node.
//   tsx tests/browser-backend-smoke.ts <path to tn-native-engine-abi-module.js>
// Prints TN_BROWSER_BACKEND_OK and exits 0 when every check holds; names the first that fails.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

import type * as THREE from "three";

import type { defineAudioClasses } from "../src/audio.js";
import {
  type IRegistryDump,
  type TnAbiModule,
  createWasmRuntime,
  defineBrowserClasses,
  engineRef,
} from "../src/browser-backend.js";
import { bindWebEngine } from "../src/browser-entry.js";

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
const engine = defineBrowserClasses(registry, createWasmRuntime(abi));
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
process.stdout.write("TN_BROWSER_BACKEND_OK\n");

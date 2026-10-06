import registry from "../../../../three-native/api/native-registry.json";
import type * as THREE from "../../../../three-native/generated/three.js";
import {
  type IRegistryDump,
  type TnAbiModule,
  createWasmRuntime,
  defineBrowserClasses,
  engineRef,
} from "../../../../three-native/src/browser-backend.js";

export interface IWasmAssetsState {
  initialized: boolean;
  rendered: number;
  packageLoaded: boolean;
  uploadedBytes?: number;
  draws?: number;
  triangles?: number;
  covered?: number;
  adapter?: Record<string, string>;
  error?: string;
  ticks?: number;
}

export interface IWasmAssetsOutcome {
  boot?: IWasmAssetsState;
  cooked?: IWasmAssetsState;
  error?: string;
}

export type BrowserModule = TnAbiModule & {
  _tnw_init(): number;
  _tnw_render(scene: number, camera: number): number;
  _tnw_verify_package(bytes: number, size: number): number;
  _tnw_load_package(bytes: number, size: number, geometry: number): number;
};

declare global {
  var createTnBrowser: () => Promise<BrowserModule>;
  var __tnWasmAssets: IWasmAssetsState;
  var __tnWasmAssetsDone: IWasmAssetsOutcome | undefined;
}

// The existing scenario runner can exercise this page as well as the PNG capture harness.
const started = performance.now();
Object.assign(globalThis, {
  __THREENATIVE_PLAYTEST_BRIDGE__: {
    describe: () => ({
      name: "native-core-wasm-assets",
      protocolVersion: 1,
      capabilities: ["runtime.components", "runtime.fixedStep"],
      limits: {
        maxEntitiesPerSample: 100,
        maxEventsPerDrain: 1000,
        maxPayloadBytes: 1000000,
        operationTimeoutMs: 5000,
      },
    }),
    ready: async () => {
      while (!globalThis.__tnWasmAssetsDone)
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      return { ready: true };
    },
    advance: async (count: number) => {
      const target = (globalThis.__tnWasmAssets?.ticks ?? 0) + count;
      while ((globalThis.__tnWasmAssets?.ticks ?? 0) < target)
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      return { clock: { mode: "fixed-step", tick: globalThis.__tnWasmAssets.ticks }, ticks: count };
    },
    sample: () => ({
      clock: {
        mode: "fixed-step",
        tick: globalThis.__tnWasmAssets?.ticks ?? 0,
        timeMs: performance.now() - started,
      },
      components: {
        "native-core": {
          assets: {
            ...globalThis.__tnWasmAssets,
            error: globalThis.__tnWasmAssetsDone?.error ?? globalThis.__tnWasmAssets?.error ?? "",
            bootTriangles: globalThis.__tnWasmAssetsDone?.boot?.triangles ?? 0,
          },
        },
      },
    }),
  },
});

/** Only the host seam needs a handle's wasm32 layout; object authoring uses the catalog wrappers. */
function withHandles(abi: BrowserModule, objects: object[], work: (handles: number[]) => void) {
  const pointer = abi._malloc(objects.length * 12);
  if (pointer === 0) throw new Error("TN_WASM_ALLOC: handles");
  try {
    const view = new DataView(abi.HEAPU8.buffer);
    for (const [i, object] of objects.entries()) {
      const ref = engineRef(object);
      if (ref === undefined) throw new Error("TN_WASM_HANDLE: not an engine object");
      const [type, context, index, generation] = ref.key.split(":").map(Number);
      view.setUint16(pointer + i * 12, type ?? 0, true);
      view.setUint16(pointer + i * 12 + 2, context ?? 0, true);
      view.setUint32(pointer + i * 12 + 4, index ?? 0, true);
      view.setUint32(pointer + i * 12 + 8, generation ?? 0, true);
    }
    work(objects.map((_, i) => pointer + i * 12));
  } finally {
    abi._free(pointer);
  }
}

async function waitFor(predicate: (state: IWasmAssetsState) => boolean) {
  const deadline = performance.now() + 60_000;
  for (;;) {
    const state = globalThis.__tnWasmAssets;
    if (state.error) throw new Error(state.error);
    if (predicate(state)) return { ...state };
    if (performance.now() > deadline) throw new Error("TN_WASM_ASSETS_TIMEOUT");
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  }
}

async function run(): Promise<IWasmAssetsOutcome> {
  const abi = await globalThis.createTnBrowser();
  const engine = defineBrowserClasses(registry as IRegistryDump, createWasmRuntime(abi));
  const { Scene, PerspectiveCamera, Mesh, BoxGeometry, BufferGeometry, MeshBasicMaterial } =
    engine.classes as unknown as typeof THREE;
  const scene = new Scene();
  const camera = new PerspectiveCamera();
  camera.fov = 50;
  camera.aspect = 4 / 3;
  camera.near = 0.1;
  camera.far = 100;
  camera.updateProjectionMatrix();
  camera.position.z = 3;
  const material = new MeshBasicMaterial();
  material.color.setRGB(0.1, 0.75, 0.35);
  const box = new Mesh(new BoxGeometry(1, 1, 1), material);
  scene.add(box);
  if (abi._tnw_init() !== 0) throw new Error(globalThis.__tnWasmAssets.error);
  await waitFor((state) => state.initialized);
  const render = () => {
    withHandles(abi, [scene, camera], ([s, c]) => {
      if (abi._tnw_render(s ?? 0, c ?? 0) !== 0) throw new Error(globalThis.__tnWasmAssets.error);
    });
  };
  render();
  const boot = await waitFor((state) => state.rendered === 1);
  // renderer.info includes the output pass: the box plus one fullscreen triangle.
  if (!(boot.covered && boot.covered > 0.01) || boot.draws !== 2 || boot.triangles !== 13)
    throw new Error(`TN_WASM_BOOT_FRAME: ${JSON.stringify(boot)}`);

  const response = await fetch("assets.tnpk");
  if (!response.ok) throw new Error(`TN_WASM_FETCH: ${response.status}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  const pointer = abi._malloc(bytes.length);
  if (pointer === 0) throw new Error("TN_WASM_ALLOC: package");
  const geometry = new BufferGeometry();
  try {
    abi.HEAPU8.set(bytes, pointer);
    withHandles(abi, [geometry], ([g]) => {
      if (abi._tnw_load_package(pointer, bytes.length, g ?? 0) !== 0)
        throw new Error(globalThis.__tnWasmAssets.error);
    });
    await waitFor((state) => state.packageLoaded);
  } catch (error) {
    console.error("TN_WASM_PACKAGE_LOAD_FAILED:", globalThis.__tnWasmAssets.error ?? String(error));
    throw error;
  } finally {
    abi._free(pointer); // native readback retains its own copy, never a JS-owned view
  }
  scene.remove(box);
  scene.add(new Mesh(geometry, material));
  engine.collect();
  render();
  const cooked = await waitFor((state) => state.rendered === 2);
  if (
    cooked.uploadedBytes !== 36 ||
    cooked.draws !== 2 ||
    cooked.triangles !== 2 ||
    !(cooked.covered && cooked.covered > 0.01 && cooked.covered < 0.8)
  )
    throw new Error(`TN_WASM_COOKED_FRAME: ${JSON.stringify(cooked)}`);
  return { boot, cooked };
}

run().then(
  (outcome) => {
    globalThis.__tnWasmAssetsDone = outcome;
  },
  (error: unknown) => {
    globalThis.__tnWasmAssetsDone = { error: error instanceof Error ? error.stack : String(error) };
  },
);

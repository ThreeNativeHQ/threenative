import * as Three from "three/webgpu";
import { MatrixWorldPass } from "../../../packages/core/src/matrix-world.js";
import { RenderCameraCull } from "../../../packages/core/src/render-camera-cull.js";
import { SceneRenderProjection } from "../../../packages/core/src/renderProjection.js";
import registry from "../../../packages/three-native/api/native-registry.json";
import {
  type IRegistryDump,
  type TnAbiModule,
  createWasmRuntime,
  defineBrowserClasses,
  engineRef,
} from "../../../packages/three-native/src/browser-backend.js";
import { loadPackedPerry } from "../../../scripts/engine-load-test/perry-packed.js";
import { createPlacements, uniqueMaterialColor } from "./workload.js";

type Abi = TnAbiModule & {
  wasmMemory: WebAssembly.Memory;
  _tnw_bench_init(width: number, height: number): number;
  _tnw_render(scene: number, camera: number): number;
  _tnw_bench_step(): number;
  _tnw_bench_stats(): number;
  _tnw_bulk_transforms(handles: number, values: number, count: number): number;
};
type State = { initialized?: boolean; error?: string; adapter?: Record<string, string> };
declare const TN_CURRENT: boolean;
const scope = globalThis as unknown as {
  createTnBrowser(): Promise<Abi>;
  __tnWasmAssets: State;
  __ENGINE_LOAD_TEST__: unknown;
  __ENGINE_LOAD_TEST_PROGRESS__: { stage: string; frame: number };
  __ENGINE_LOAD_TEST_ERROR__: string;
  __ENGINE_LOAD_TEST_PROFILE__?: () => Promise<void>;
  tn_inputs(): number[];
  tn_values(): number[] | Float64Array;
  tn_submit(values: number[]): void;
  tn_ready(update: (frame: number) => void): void;
};

async function run() {
  // Count actual browser WebGPU method calls, including Emdawn's bindings and bundle recording.
  let webgpuCalls = 0;
  let writeBuffers = 0;
  let directDraws = 0;
  let executeBundles = 0;
  let bundleDraws = 0;
  const gpuPrototypes = [
    "GPUDevice",
    "GPUQueue",
    "GPUBuffer",
    "GPUTexture",
    "GPUCommandEncoder",
    "GPURenderPassEncoder",
    "GPUComputePassEncoder",
    "GPURenderBundleEncoder",
    "GPUCanvasContext",
  ];
  const restored: (() => void)[] = [];
  for (const type of gpuPrototypes) {
    const prototype = (globalThis as unknown as Record<string, { prototype: object }>)[type]
      ?.prototype;
    if (!prototype) continue;
    for (const name of Object.getOwnPropertyNames(prototype)) {
      const descriptor = Object.getOwnPropertyDescriptor(prototype, name);
      if (name === "constructor" || typeof descriptor?.value !== "function") continue;
      const method = descriptor.value;
      const writes = type === "GPUQueue" && name === "writeBuffer";
      const draws = name.startsWith("draw");
      const recordsBundle = type === "GPURenderBundleEncoder";
      const replaysBundle = name === "executeBundles";
      Object.defineProperty(prototype, name, {
        ...descriptor,
        value: function (this: unknown, ...args: unknown[]) {
          webgpuCalls++;
          if (writes) writeBuffers++;
          if (draws) {
            if (recordsBundle) bundleDraws++;
            else directDraws++;
          }
          if (replaysBundle) executeBundles++;
          return Reflect.apply(method, this, args);
        },
      });
      restored.push(() => Object.defineProperty(prototype, name, descriptor));
    }
  }
  scope.__ENGINE_LOAD_TEST_PROGRESS__ = { stage: "module", frame: -1 };
  const params = new URLSearchParams(location.search);
  const arm = params.get("arm") ?? "current";
  const objects = Number(params.get("objects"));
  const width = Number(params.get("width"));
  const height = Number(params.get("height"));
  const warmup = Number(params.get("warmup"));
  const frames = Number(params.get("frames"));
  const canvas = document.querySelector("#c") as HTMLCanvasElement;
  canvas.width = width;
  canvas.height = height;
  const abi = TN_CURRENT ? null : await scope.createTnBrowser();
  const classes = TN_CURRENT
    ? Three
    : (defineBrowserClasses(registry as IRegistryDump, createWasmRuntime(abi as Abi))
        .classes as unknown as typeof Three);
  const {
    Scene,
    PerspectiveCamera,
    Mesh,
    BoxGeometry,
    PlaneGeometry,
    MeshStandardMaterial,
    DirectionalLight,
  } = classes;
  const scene = new Scene();
  const camera = new PerspectiveCamera();
  camera.fov = 60;
  camera.aspect = width / height;
  camera.near = 0.1;
  camera.far = 4000;
  camera.updateProjectionMatrix();
  const material = new MeshStandardMaterial();
  material.color.setHex(0xb8c4cc);
  material.roughness = 0.75;
  material.metalness = 0;
  const ground = new Mesh(new PlaneGeometry(200, 200), material);
  ground.rotation.x = -Math.PI / 2;
  ground.matrixAutoUpdate = false;
  ground.updateMatrix();
  scene.add(ground);
  const light = new DirectionalLight(0xffffff, 2.4);
  light.position.set(40, 80, 25);
  scene.add(light);
  const geometry = new BoxGeometry(1, 1, 1);
  const placements = createPlacements(objects);
  const cubes = placements.map((p, index) => {
    const own = new MeshStandardMaterial();
    own.color.setHex(uniqueMaterialColor(index));
    own.roughness = 0.75;
    own.metalness = 0;
    const cube = new Mesh(geometry, own);
    cube.position.set(p.x, p.y, p.z);
    scene.add(cube);
    return cube;
  });
  let renderer: Three.WebGPURenderer | undefined;
  let adapter: Record<string, string> = {};
  let handles = 0;
  let valuesPointer = 0;
  let statsPointer = 0;
  let packedView: Float64Array | undefined;
  let submittedView: number[] | Float64Array | undefined;
  let perryAllocations: (() => number) | undefined;
  let calls = 0;
  let mallocCalls = 0;
  let mallocBytes = 0;
  let freeCalls = 0;
  let viewCreations = 0;
  let boundaryMs = 0;
  let bulkMs = 0;
  let submissions = 0;
  const breakdown = {
    game: [] as number[],
    boundary: [] as number[],
    engineUpdate: [] as number[],
    encodeSubmit: [] as number[],
    remainder: [] as number[],
  };
  const boundary = {
    calls: [] as number[],
    mallocCalls: [] as number[],
    mallocBytes: [] as number[],
    freeCalls: [] as number[],
    copyBytes: [] as number[],
    transformViewCreations: [] as number[],
    heapGrowthBytes: [] as number[],
    draws: [] as number[],
    webgpuCalls: [] as number[],
    writeBuffers: [] as number[],
    directDraws: [] as number[],
    executeBundles: [] as number[],
    bundleDraws: [] as number[],
    recordRebuilds: [] as number[],
    instancedBatches: [] as number[],
    batchedObjects: [] as number[],
    matrixUpdateMs: [] as number[],
    recordProjectionMs: [] as number[],
    batchingMs: [] as number[],
    prepareOtherMs: [] as number[],
    perryArrayAllocations: [] as number[],
  };
  const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  const check = (code: number) => {
    if (code || scope.__tnWasmAssets?.error)
      throw new Error(scope.__tnWasmAssets?.error ?? `Wasm status ${code}`);
  };
  if (!TN_CURRENT && abi) {
    scope.__ENGINE_LOAD_TEST_PROGRESS__.stage = "device";
    check(abi._tnw_bench_init(width, height));
    const deadline = performance.now() + 60_000;
    while (!scope.__tnWasmAssets.initialized) {
      check(0);
      if (performance.now() > deadline) throw new Error("TN_WEB_BENCH_DEVICE_TIMEOUT");
      await nextFrame();
    }
    adapter = scope.__tnWasmAssets.adapter ?? {};
    handles = abi._malloc((objects + 2) * 12);
    valuesPointer = abi._malloc((6 + objects * 5) * 8);
    if (!handles || !valuesPointer) throw new Error("TN_WEB_BENCH_ALLOC");
    statsPointer = abi._tnw_bench_stats();
    if (!statsPointer) throw new Error("TN_WEB_BENCH_STATS");
    const view = new DataView(abi.HEAPU8.buffer);
    for (const [index, object] of [...cubes, scene, camera].entries()) {
      const ref = engineRef(object);
      if (!ref) throw new Error("TN_WEB_BENCH_HANDLE");
      const [type, context, slot, generation] = ref.key.split(":").map(Number);
      view.setUint16(handles + index * 12, type as number, true);
      view.setUint16(handles + index * 12 + 2, context as number, true);
      view.setUint32(handles + index * 12 + 4, slot as number, true);
      view.setUint32(handles + index * 12 + 8, generation as number, true);
    }
    check(abi._tnw_render(handles + objects * 12, handles + (objects + 1) * 12));
  } else if (TN_CURRENT) {
    renderer = new Three.WebGPURenderer({ canvas, antialias: false });
    renderer.setPixelRatio(1);
    renderer.setSize(width, height, false);
    renderer.toneMapping = Three.NoToneMapping;
    renderer.setClearColor(new Three.Color().setRGB(0.02, 0.03, 0.04), 1);
    await renderer.init();
    const backend = renderer.backend as unknown as { adapter: GPUAdapter };
    const info = backend.adapter.info;
    adapter = {
      vendor: info.vendor,
      architecture: info.architecture,
      description: info.description,
      device: info.device,
    };
  }
  const inputs = placements.flatMap((p) => [p.x, p.y, p.z]);
  const output = () => {
    if (!packedView || (abi && packedView.buffer !== abi.HEAPU8.buffer)) {
      packedView = abi
        ? new Float64Array(abi.HEAPU8.buffer, valuesPointer, 6 + objects * 5)
        : new Float64Array(6 + objects * 5);
    }
    return packedView;
  };
  const matrixWorld = TN_CURRENT ? new MatrixWorldPass() : undefined;
  const cull = TN_CURRENT ? new RenderCameraCull() : undefined;
  const projection = TN_CURRENT ? new SceneRenderProjection(scene, { matrixWorld }) : undefined;
  if (TN_CURRENT) scene.matrixWorldAutoUpdate = false;
  let update: ((frame: number) => void) | undefined;
  const submit = (values: number[] | Float64Array) => {
    const start = performance.now();
    submissions++;
    if (values !== submittedView) {
      submittedView = values;
      viewCreations++;
    }
    if (values.length !== 6 + objects * 5 || values.some((value) => !Number.isFinite(value)))
      throw new Error("TN_WEB_BENCH_TRANSFORMS");
    if (
      abi &&
      (!(values instanceof Float64Array) ||
        values.buffer !== abi.HEAPU8.buffer ||
        values.byteOffset !== valuesPointer)
    )
      throw new Error("TN_WEB_BENCH_PACKED_BUFFER");
    // Catalog camera calls can grow memory. Read the six camera values before entering them.
    const [x, y, z, targetX, targetY, targetZ] = values;
    camera.position.set(x as number, y as number, z as number);
    camera.lookAt(targetX as number, targetY as number, targetZ as number);
    if (abi) {
      const bulkStart = performance.now();
      check(abi._tnw_bulk_transforms(handles, valuesPointer + 6 * 8, objects));
      bulkMs += performance.now() - bulkStart;
    } else
      for (const [index, cube] of cubes.entries()) {
        const offset = 6 + index * 5;
        cube.position.set(
          values[offset] as number,
          values[offset + 1] as number,
          values[offset + 2] as number,
        );
        cube.rotation.set(values[offset + 3] as number, values[offset + 4] as number, 0);
      }
    boundaryMs += performance.now() - start;
  };
  scope.__ENGINE_LOAD_TEST_PROGRESS__.stage = "game-import";
  if (arm === "wasm-perry") {
    if (!abi) throw new Error("TN_WEB_BENCH_PERRY_ENGINE");
    const perry = await loadPackedPerry(inputs, submit, {
      memory: abi.wasmMemory,
      byteOffset: valuesPointer,
    });
    update = perry;
    perryAllocations = perry.allocations;
  } else {
    scope.tn_inputs = () => inputs;
    scope.tn_values = output;
    scope.tn_submit = submit;
    scope.tn_ready = (callback) => {
      update = callback;
    };
    const gameUrl = "./game.js";
    await import(gameUrl);
  }
  if (!update) throw new Error("TN_WEB_BENCH_GAME_NOT_REGISTERED");
  // Count the actual engine exports, including malloc/free hidden by the camera catalog ABI.
  if (abi)
    for (const name of Object.keys(abi)) {
      const record = abi as unknown as Record<string, unknown>;
      const fn = record[name];
      if (!name.startsWith("_") || typeof fn !== "function") continue;
      record[name] = (...args: number[]) => {
        calls++;
        if (name === "_malloc") {
          mallocCalls++;
          mallocBytes += args[0] as number;
        }
        if (name === "_free") freeCalls++;
        return fn(...args);
      };
    }
  const cpuMs: number[] = [];
  scope.__ENGINE_LOAD_TEST_PROGRESS__.stage = "frames";
  for (let frame = 0; frame < warmup + frames; frame++) {
    if (frame === warmup) await scope.__ENGINE_LOAD_TEST_PROFILE__?.();
    await nextFrame();
    calls = mallocCalls = mallocBytes = freeCalls = viewCreations = 0;
    webgpuCalls = writeBuffers = directDraws = executeBundles = bundleDraws = 0;
    boundaryMs = bulkMs = submissions = 0;
    const heapBytes = abi?.HEAPU8.byteLength ?? 0;
    const arrayAllocations = perryAllocations?.() ?? 0;
    const start = performance.now();
    update(frame);
    const updated = performance.now();
    if (submissions !== 1)
      throw new Error(`TN_WEB_BENCH_GAME_SUBMIT: ${arm}: frame ${frame}: ${submissions}`);
    let engineUpdateMs = bulkMs;
    let encodeSubmitMs = 0;
    if (abi) {
      check(abi._tnw_bench_step());
      engineUpdateMs += abi.HEAPF64[statsPointer / 8] as number;
      encodeSubmitMs =
        (abi.HEAPF64[statsPointer / 8 + 1] as number) +
        (abi.HEAPF64[statsPointer / 8 + 2] as number);
    } else if (renderer && projection && matrixWorld && cull) {
      matrixWorld.beginFrame();
      projection.reconcile();
      const root = projection.root;
      cull.apply(root, camera, height);
      root.matrixWorldAutoUpdate = false;
      matrixWorld.apply(root);
      renderer.info.reset();
      const prepared = performance.now();
      engineUpdateMs += prepared - updated;
      renderer.render(root, camera);
      cull.restore();
      encodeSubmitMs = performance.now() - prepared;
    }
    const elapsed = performance.now() - start;
    if (frame >= warmup) {
      cpuMs.push(elapsed);
      const gameMs = updated - start - boundaryMs;
      const crossingMs = boundaryMs - bulkMs;
      breakdown.game.push(gameMs);
      breakdown.boundary.push(crossingMs);
      breakdown.engineUpdate.push(engineUpdateMs);
      breakdown.encodeSubmit.push(encodeSubmitMs);
      breakdown.remainder.push(elapsed - gameMs - crossingMs - engineUpdateMs - encodeSubmitMs);
      boundary.calls.push(calls);
      boundary.mallocCalls.push(mallocCalls);
      boundary.mallocBytes.push(mallocBytes);
      boundary.freeCalls.push(freeCalls);
      boundary.copyBytes.push(0); // both Wasm games write the engine allocation directly
      if (perryAllocations)
        boundary.perryArrayAllocations.push(perryAllocations() - arrayAllocations);
      boundary.transformViewCreations.push(viewCreations);
      boundary.heapGrowthBytes.push((abi?.HEAPU8.byteLength ?? 0) - heapBytes);
      boundary.draws.push(
        abi ? (abi.HEAPF64[statsPointer / 8 + 3] as number) : (renderer?.info.render.calls ?? 0),
      );
      boundary.webgpuCalls.push(webgpuCalls);
      boundary.writeBuffers.push(writeBuffers);
      boundary.directDraws.push(directDraws);
      boundary.executeBundles.push(executeBundles);
      boundary.bundleDraws.push(bundleDraws);
      if (abi) {
        boundary.recordRebuilds.push(abi.HEAPF64[statsPointer / 8 + 4] as number);
        boundary.instancedBatches.push(abi.HEAPF64[statsPointer / 8 + 5] as number);
        boundary.batchedObjects.push(abi.HEAPF64[statsPointer / 8 + 6] as number);
        boundary.matrixUpdateMs.push(abi.HEAPF64[statsPointer / 8 + 7] as number);
        boundary.recordProjectionMs.push(abi.HEAPF64[statsPointer / 8 + 8] as number);
        boundary.batchingMs.push(abi.HEAPF64[statsPointer / 8 + 9] as number);
        boundary.prepareOtherMs.push(abi.HEAPF64[statsPointer / 8 + 10] as number);
      }
    }
    scope.__ENGINE_LOAD_TEST_PROGRESS__.frame = frame;
  }
  // Freeze exactly the last measured frame for the collector's conformance comparison.
  for (const restore of restored) restore();
  scope.__ENGINE_LOAD_TEST__ = {
    arm,
    cpuMs,
    breakdown,
    boundary: Object.fromEntries(Object.entries(boundary).filter(([, samples]) => samples.length)),
    adapter,
    captureFrame: warmup + frames - 1,
  };
}
run().catch((error: unknown) => {
  scope.__ENGINE_LOAD_TEST_ERROR__ = `TN_WEB_BENCH_PAGE: ${scope.__ENGINE_LOAD_TEST_PROGRESS__?.stage}: ${error instanceof Error ? error.stack : String(error)}`;
  console.error(scope.__ENGINE_LOAD_TEST_ERROR__);
});

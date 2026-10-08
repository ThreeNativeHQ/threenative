/** Export the paused real starter, without replacing the legacy scene or its installed graph. */
import { Mesh, MeshStandardMaterial, PerspectiveCamera, PlaneGeometry, Vector3 } from "three";
import type { Texture } from "three";
import { GLTFExporter } from "three/addons/exporters/GLTFExporter.js";
import { clone } from "three/addons/utils/SkeletonUtils.js";
import type { IStarterMeter } from "./starter-meter.js";
import {
  type IStarterVisualSnapshot,
  prepareStarterExportTextures,
} from "./starter-visual-cook.js";
import { exportTslGraph } from "./tsl-export.js";
export type { IStarterMeter } from "./starter-meter.js";

const quantile = (samples: number[], fraction: number): number => {
  const sorted = [...samples].sort((a, b) => a - b);
  return (
    sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(fraction * sorted.length) - 1))] ?? 0
  );
};
const series = (samples: number[]) => ({
  p50: quantile(samples, 0.5),
  p95: quantile(samples, 0.95),
});

/**
 * The paused starter drawn `frames` more times through its own renderer wrapper, post chain and
 * all: the legacy arm of the GPU-heavy holdout. Run before prepareStarterSnapshot, which stubs
 * the render calls.
 */
export async function meterStarterFrames(frames: number): Promise<IStarterMeter> {
  const gameUrl = "/src/game.ts";
  const { default: game } = await import(/* @vite-ignore */ gameUrl);
  const ctx = game.ctx;
  if (!ctx || !ctx.camera?.isPerspectiveCamera || !ctx.scene?.isScene || !ctx.renderer?.raw)
    throw new Error("TN_VISUAL_STARTER_NOT_READY");
  game.pause();
  // pause() stops the simulation, not the draw: the game's own animation loop keeps rendering and
  // presenting between these calls, which is the frame being measured plus every frame it draws
  // itself. End it (the pending callback fires once and cannot re-arm) and measure alone.
  window.requestAnimationFrame = () => 0;
  await new Promise((resolve) => setTimeout(resolve, 500));
  const raw = ctx.renderer.raw;
  // A post chain renders several times per frame; three would reset its counters at each, leaving
  // only the last pass. The frame's totals are the sum, so this loop owns the reset.
  raw.info.autoReset = false;
  const device = raw.backend?.device;
  if (typeof device?.queue?.onSubmittedWorkDone !== "function")
    throw new Error("TN_VISUAL_GPU_QUEUE_MISSING: ctx.renderer.raw.backend.device.queue");
  const nodeFrame = raw._nodes?.nodeFrame;
  if (typeof nodeFrame?.update !== "function") throw new Error("TN_VISUAL_NODE_FRAME_MISSING");
  const warmup = Math.min(30, Math.floor(frames / 4));
  const submit: number[] = [];
  const wall: number[] = [];
  const gpu: number[] = [];
  let draws = 0;
  let triangles = 0;
  let gpuPasses = 0;
  for (let i = 0; i < frames + warmup; i += 1) {
    raw.info.reset?.();
    // The world pass updates once per node frame, and three advances that clock in its own animation
    // loop, which is stopped above: advance it as the loop would, or only the output quad redraws.
    nodeFrame.update();
    const t0 = performance.now();
    ctx.renderer.render(ctx.scene, ctx.camera);
    const t1 = performance.now();
    await device.queue.onSubmittedWorkDone();
    const t2 = performance.now();
    // The wrapper tracks timestamps on a stride; only a tracked frame has a GPU reading to resolve.
    const tracked = raw.backend.trackTimestamp === true;
    let timestamp: number | undefined;
    if (tracked) timestamp = await raw.resolveTimestampsAsync?.("render");
    if (tracked && i >= warmup) {
      // The pool names each pass `<context>:f<frame>`; its `frames` list ends at the resolved frame.
      const pool = raw.backend.timestampQueryPool?.render;
      const last = pool?.frames?.[pool.frames.length - 1];
      gpuPasses =
        pool && last !== undefined
          ? [...pool.timestamps.keys()].filter((uid: string) => uid.endsWith(`:f${last}`)).length
          : 0;
    }
    if (i < warmup) continue;
    submit.push(t1 - t0);
    wall.push(t2 - t0);
    if (typeof timestamp === "number" && timestamp > 0) gpu.push(timestamp);
    draws = raw.info.render.drawCalls;
    triangles = raw.info.render.triangles;
  }
  // Back to back with one wait: the cost a game loop without vsync pays per frame.
  const burst = 30;
  const b0 = performance.now();
  for (let i = 0; i < burst; i += 1) {
    nodeFrame.update();
    ctx.renderer.render(ctx.scene, ctx.camera);
  }
  await device.queue.onSubmittedWorkDone();
  const throughputMs = (performance.now() - b0) / burst;
  let sceneMeshes = 0;
  let sceneTriangles = 0;
  ctx.scene.traverseVisible((object: import("three").Object3D) => {
    if (Reflect.get(object, "isMesh") !== true) return;
    const geometry = (object as import("three").Mesh).geometry;
    sceneMeshes += 1;
    const counted = geometry.index ?? geometry.getAttribute("position");
    if (!counted)
      throw new Error("TN_HOLDOUT_SCENE_GEOMETRY_EMPTY: a visible mesh has no position");
    sceneTriangles += counted.count / 3;
  });
  const adapter = device.adapterInfo;
  return {
    frames,
    warmup,
    size: [raw.domElement.width, raw.domElement.height],
    submitMs: series(submit),
    frameMs: series(wall),
    gpuMs: gpu.length === 0 ? null : series(gpu),
    throughputMs,
    gpuPasses,
    gpuSamples: gpu.length,
    gpuSample: gpu.slice(0, 12),
    draws,
    triangles,
    sceneMeshes,
    sceneTriangles,
    adapter: adapter
      ? {
          vendor: adapter.vendor,
          architecture: adapter.architecture,
          device: adapter.device,
          description: adapter.description,
        }
      : null,
  };
}

export async function prepareStarterSnapshot(): Promise<IStarterVisualSnapshot> {
  const gameUrl = "/src/game.ts";
  const { default: game } = await import(/* @vite-ignore */ gameUrl);
  const ctx = game.ctx;
  if (!ctx || !ctx.camera?.isPerspectiveCamera || !ctx.scene?.isScene)
    throw new Error("TN_VISUAL_STARTER_NOT_READY");
  game.pause();
  const tier = ctx.entities.get("quality")?.tier;
  if (!["high", "medium", "low"].includes(tier)) throw new Error("TN_VISUAL_TIER_MISSING");
  // The capture hook observes the actual installation, including scene-specific graph inputs.
  const graph = Reflect.get(globalThis, "__tnVisualGraph");
  if (!graph?.isNode || typeof graph.traverse !== "function")
    throw new Error("TN_VISUAL_POST_GRAPH_MISSING");
  const renderer = ctx.renderer;
  if (!renderer) throw new Error("TN_VISUAL_RENDERER_MISSING: ctx.renderer");
  const raw = renderer.raw;
  if (typeof raw?.shadowMap?.enabled !== "boolean")
    throw new Error("TN_VISUAL_SHADOW_MAP_MISSING: ctx.renderer.raw.shadowMap.enabled");
  const shadowMap = raw.shadowMap.enabled;
  if (!Number.isInteger(raw.toneMapping) || !Number.isFinite(raw.toneMappingExposure))
    throw new Error("TN_VISUAL_TONE_MAPPING_MISSING: ctx.renderer.raw.toneMapping");
  const backend = raw.backend;
  // WebGPURenderer can run a WebGL backend; that arm has no GPUDevice queue to drain.
  if (
    !backend ||
    (backend.isWebGLBackend !== true &&
      typeof backend.device?.queue?.onSubmittedWorkDone !== "function")
  )
    throw new Error("TN_VISUAL_GPU_QUEUE_MISSING: ctx.renderer.raw.backend.device.queue");
  renderer.render = () => {};
  renderer.renderOverlay = () => {};
  ctx.scene.updateMatrixWorld(true);
  const source = clone(ctx.scene);
  const lights: IStarterVisualSnapshot["lights"] = [];
  const nodes: IStarterVisualSnapshot["nodes"] = [];
  const detached: import("three").Object3D[] = [];
  source.traverse((object) => {
    if (object instanceof PerspectiveCamera || Reflect.get(object, "isCamera"))
      detached.push(object);
    if (Reflect.get(object, "isLight")) {
      if (object.type !== "DirectionalLight" && object.type !== "AmbientLight")
        throw new Error(`TN_VISUAL_LIGHT_UNSUPPORTED: ${object.type}`);
      const light = object as import("three").DirectionalLight;
      const shadow: Record<string, number> = {};
      if (object.type === "DirectionalLight") {
        if (!light.shadow?.mapSize || !light.shadow.camera || !light.target)
          throw new Error("TN_VISUAL_DIRECTIONAL_LIGHT_INVALID: shadow or target missing");
        for (const key of ["bias", "normalBias", "radius", "intensity"])
          shadow[`shadow.${key}`] = Reflect.get(light.shadow, key);
        for (const key of ["x", "y"])
          shadow[`shadow.mapSize.${key}`] = Reflect.get(light.shadow.mapSize, key);
        for (const key of ["left", "right", "top", "bottom", "near", "far"])
          shadow[`shadow.camera.${key}`] = Reflect.get(light.shadow.camera, key);
        for (const [key, value] of Object.entries(shadow))
          if (!Number.isFinite(value))
            throw new Error(`TN_VISUAL_DIRECTIONAL_LIGHT_INVALID: ${key}`);
      }
      lights.push({
        type: object.type,
        color: light.color.toArray(),
        intensity: light.intensity,
        position: light.getWorldPosition(new Vector3()).toArray(),
        target: light.target?.getWorldPosition(new Vector3()).toArray() ?? [0, 0, 0],
        castShadow: light.castShadow,
        shadow,
      });
      detached.push(object);
    }
    object.name = `tn-capture-${nodes.length}`;
    nodes.push({
      name: object.name,
      castShadow: object.castShadow,
      receiveShadow: object.receiveShadow,
    });
  });
  for (const object of detached) object.removeFromParent();
  const textures: IStarterVisualSnapshot["world"]["textures"] = [];
  const textureIds = new Map<Texture, number>();
  function texture(texture: Texture): number {
    const existing = textureIds.get(texture);
    if (existing !== undefined) return existing;
    if (texture.mapping !== 303) throw new Error("TN_VISUAL_SKY_MAPPING_UNSUPPORTED");
    const image = texture.image as { width?: unknown; height?: unknown } | null | undefined;
    const width = image?.width;
    const height = image?.height;
    if (
      typeof width !== "number" ||
      typeof height !== "number" ||
      !Number.isSafeInteger(width) ||
      !Number.isSafeInteger(height) ||
      width < 1 ||
      height < 1
    )
      throw new Error("TN_VISUAL_SKY_IMAGE_MISSING");
    // glTF's existing image decoder transports a full-resolution sky without a >512MB
    // typed-array fixture line. These carriers are hidden before the native draw.
    const copy = texture.clone();
    copy.flipY = false;
    copy.mapping = 300;
    const carrier = new Mesh(new PlaneGeometry(1, 1), new MeshStandardMaterial({ map: copy }));
    carrier.name = `tn-sky-${textures.length}`;
    source.add(carrier);
    const id = textures.length;
    textures.push({
      node: carrier.name,
      width,
      height,
      mapping: texture.mapping,
      colorSpace: texture.colorSpace,
      flipY: texture.flipY,
      wrapS: texture.wrapS,
      wrapT: texture.wrapT,
      magFilter: texture.magFilter,
      minFilter: texture.minFilter,
    });
    textureIds.set(texture, id);
    return id;
  }
  const scene = ctx.scene;
  const background = scene.background?.isTexture
    ? texture(scene.background)
    : scene.background?.isColor
      ? scene.background.toArray()
      : null;
  if (!scene.background || background === null) throw new Error("TN_VISUAL_STARTER_SKY_MISSING");
  // setupSky deliberately omits environment fill on a named software adapter.
  if (!scene.environment && renderer.softwareAdapter === undefined)
    throw new Error("TN_VISUAL_STARTER_ENVIRONMENT_MISSING");
  const environment = scene.environment ? texture(scene.environment) : null;
  await prepareStarterExportTextures(source);
  const gltf = await new GLTFExporter().parseAsync(source, { binary: false, onlyVisible: true });
  if (gltf instanceof ArrayBuffer) throw new Error("TN_VISUAL_EXPECTED_GLTF_JSON");
  const exportedNames = new Set((gltf.nodes ?? []).map((node: { name?: string }) => node.name));

  const camera = ctx.camera.clone();
  camera.position.copy(ctx.camera.getWorldPosition(new Vector3()));
  camera.quaternion.copy(ctx.camera.getWorldQuaternion(camera.quaternion));
  // Native SMAA consumes the installed graph's actual lookup images, not replacement tables.
  const tables: HTMLImageElement[] = [];
  graph.traverse((node: Record<string, unknown>) => {
    if ((node.constructor as { name: string }).name !== "SMAANode") return;
    for (const key of ["_areaTexture", "_searchTexture"]) {
      const texture = node[key] as Texture | undefined;
      const image = texture?.image as HTMLImageElement | undefined;
      if (!texture?.isTexture || !image || typeof image.decode !== "function")
        throw new Error(`TN_VISUAL_SMAA_IMAGE_MISSING: ${key}`);
      tables.push(image);
    }
  });
  for (const image of tables) {
    await image.decode();
    if (image.width < 1 || image.height < 1)
      throw new Error("TN_VISUAL_SMAA_DECODE_FAILED: empty image");
    const canvas = document.createElement("canvas");
    canvas.width = image.width;
    canvas.height = image.height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("TN_VISUAL_SMAA_DECODE_FAILED");
    context.drawImage(image, 0, 0);
    Object.assign(image, { data: context.getImageData(0, 0, image.width, image.height).data });
  }
  if (backend.isWebGLBackend !== true) await backend.device.queue.onSubmittedWorkDone();
  return {
    gltf,
    lights,
    nodes: nodes.filter((node) => exportedNames.has(node.name)),
    tier,
    shadowMap,
    toneMapping: raw.toneMapping,
    toneMappingExposure: raw.toneMappingExposure,
    postGraph: exportTslGraph(graph),
    world: {
      textures,
      background,
      environment,
      backgroundIntensity: scene.backgroundIntensity,
      environmentIntensity: scene.environmentIntensity,
      backgroundBlurriness: scene.backgroundBlurriness,
      backgroundRotation: scene.backgroundRotation.toArray().slice(0, 3),
      environmentRotation: scene.environmentRotation.toArray().slice(0, 3),
      fog: scene.fog
        ? {
            type: scene.fog.isFogExp2 ? "FogExp2" : "Fog",
            color: scene.fog.color.toArray(),
            near: scene.fog.near ?? 1,
            far: scene.fog.far ?? 1000,
            density: scene.fog.density ?? 0,
          }
        : null,
    },
    camera: {
      fov: camera.fov,
      aspect: camera.aspect,
      near: camera.near,
      far: camera.far,
      zoom: camera.zoom,
      position: camera.position.toArray(),
      quaternion: camera.quaternion.toArray(),
    },
  };
}

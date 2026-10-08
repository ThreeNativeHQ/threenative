/** Export the paused real starter, without replacing the legacy scene or its installed graph. */
import { Mesh, MeshStandardMaterial, PerspectiveCamera, PlaneGeometry, Vector3 } from "three";
import type { Texture } from "three";
import { GLTFExporter } from "three/addons/exporters/GLTFExporter.js";
import { clone } from "three/addons/utils/SkeletonUtils.js";
import {
  type IStarterVisualSnapshot,
  prepareStarterExportTextures,
} from "./starter-visual-cook.js";
import { exportTslGraph } from "./tsl-export.js";

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
    const image = texture.image;
    if (
      !image ||
      !Number.isSafeInteger(image.width) ||
      !Number.isSafeInteger(image.height) ||
      image.width < 1 ||
      image.height < 1
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
      width: image.width,
      height: image.height,
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

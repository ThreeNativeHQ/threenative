import { Color, PerspectiveCamera, Scene, Vector3 } from "three";
/** Browser-only capture adapter. This is a bounded cooked-scene comparison, not TS gameplay. */
import { GLTFExporter } from "three/addons/exporters/GLTFExporter.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { clone } from "three/addons/utils/SkeletonUtils.js";
import { stripCookedExtensions } from "./starter-visual-cook.js";
import { exportTslGraph } from "./tsl-export.js";

export async function prepareStarterSnapshot() {
  // Vite serves the actual scaffolded starter, with the gate's locally packed packages.
  const gameUrl = "/src/game.ts";
  const postUrl = "/src/render/postprocessing.ts";
  const { default: game } = await import(/* @vite-ignore */ gameUrl);
  const { setupPost } = await import(/* @vite-ignore */ postUrl);
  const ctx = game.ctx;
  if (!ctx || !ctx.camera.isPerspectiveCamera) throw new Error("TN_VISUAL_STARTER_NOT_READY");
  game.pause();
  const tier = ctx.entities.get("quality")?.tier;
  if (!["high", "medium", "low"].includes(tier)) throw new Error("TN_VISUAL_TIER_MISSING");
  ctx.scene.updateMatrixWorld(true);
  const source = clone(ctx.scene);
  const lights: {
    type: string;
    color: number[];
    intensity: number;
    position: number[];
    target: number[];
  }[] = [];
  const detached: import("three").Object3D[] = [];
  source.traverse((object) => {
    if (object instanceof PerspectiveCamera || Reflect.get(object, "isCamera"))
      detached.push(object);
    if (Reflect.get(object, "isLight")) {
      if (object.type !== "DirectionalLight" && object.type !== "AmbientLight")
        throw new Error(`TN_VISUAL_LIGHT_UNSUPPORTED: ${object.type}`);
      const light = object as import("three").DirectionalLight;
      lights.push({
        type: object.type,
        color: light.color.toArray(),
        intensity: light.intensity,
        position: light.getWorldPosition(new Vector3()).toArray(),
        target: light.target?.getWorldPosition(new Vector3()).toArray() ?? [0, 0, 0],
      });
      detached.push(object);
    }
  });
  for (const object of detached) object.removeFromParent();
  const gltf = await new GLTFExporter().parseAsync(source, { binary: false, onlyVisible: true });
  if (gltf instanceof ArrayBuffer) throw new Error("TN_VISUAL_EXPECTED_GLTF_JSON");
  const removedExtensions = stripCookedExtensions(gltf);
  const cooked = await new GLTFLoader().parseAsync(JSON.stringify(gltf), "");
  const scene = new Scene();
  scene.add(cooked.scene);
  // Use constructors from the game's own Vite module rather than guess its dependency URL.
  const constructors = new Map<string, new (...args: unknown[]) => import("three").Object3D>();
  ctx.scene.traverse((object: import("three").Object3D) => {
    if (Reflect.get(object, "isLight")) constructors.set(object.type, object.constructor as never);
  });
  for (const light of lights) {
    const Constructor = constructors.get(light.type);
    if (!Constructor) throw new Error(`TN_VISUAL_LIGHT_UNSUPPORTED: ${light.type}`);
    const object = new Constructor(
      new Color(...(light.color as [number, number, number])),
      light.intensity,
    ) as import("three").DirectionalLight;
    object.position.fromArray(light.position);
    if (object.target) {
      object.target.position.fromArray(light.target);
      scene.add(object.target);
    }
    scene.add(object);
  }
  const camera = ctx.camera.clone();
  camera.position.copy(ctx.camera.getWorldPosition(new Vector3()));
  camera.quaternion.copy(ctx.camera.getWorldQuaternion(camera.quaternion));
  camera.scale.set(1, 1, 1);
  camera.aspect = 1280 / 720;
  camera.updateProjectionMatrix();
  scene.add(camera);
  const renderer = ctx.renderer;
  const draw = renderer.render.bind(renderer);
  // Freeze the gate's captured pose; game RAF cannot overwrite either scoring image.
  renderer.render = () => {};
  renderer.renderOverlay = () => {};
  let graph: unknown;
  const install = renderer.setOutputNode.bind(renderer);
  renderer.setOutputNode = (node: unknown, worldPass: unknown) => {
    graph = node;
    return install(node, worldPass);
  };
  setupPost(renderer, scene, camera, { tier });
  if (graph === undefined) throw new Error("TN_VISUAL_POST_GRAPH_MISSING");
  const tables: HTMLImageElement[] = [];
  (graph as { traverse(visit: (node: Record<string, unknown>) => void): void }).traverse((node) => {
    if (node.constructor.name !== "SMAANode") return;
    for (const key of ["_areaTexture", "_searchTexture"]) {
      const image = (node[key] as { image: HTMLImageElement }).image;
      tables.push(image);
    }
  });
  for (const image of tables) {
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = image.width;
    canvas.height = image.height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("TN_VISUAL_SMAA_DECODE_FAILED");
    context.drawImage(image, 0, 0);
    Object.assign(image, { data: context.getImageData(0, 0, image.width, image.height).data });
  }
  await renderer.compileAsync(scene, camera);
  draw(scene, camera);
  await renderer.raw.backend.device.queue.onSubmittedWorkDone();
  await new Promise<void>((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
  );
  const postGraph = exportTslGraph(graph);
  return {
    gltf,
    lights,
    tier,
    postGraph,
    removedExtensions,
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

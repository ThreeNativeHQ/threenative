import {
  BoxGeometry,
  type BufferAttribute,
  CapsuleGeometry,
  Color,
  CylinderGeometry,
  DirectionalLight,
  HemisphereLight,
  type Light,
  type Material,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  PerspectiveCamera,
  PointLight,
  REVISION,
  RenderTarget,
  Scene,
  SphereGeometry,
  SpotLight,
  Vector3,
  WebGPURenderer,
} from "three/webgpu";
import { SceneRenderProjection } from "../../../packages/core/src/renderProjection.js";
import {
  CULL_VIEWPORT,
  type CullingAuthoring,
  type ICullFixture,
  type ICullTransform,
  type ICullVariant,
  cullRenderedTimeAccum,
  cullTransform,
} from "./cull-fixture.js";

/**
 * The counterpart arm's scene. Two authoring modes, and every record names which one ran:
 *
 * - `scene-node-independent` puts one renderable per object in the scene graph, the closest
 *   counterpart to the pinned Godot source's 10,000 `RenderingServer` instance RIDs. Neither arm then
 *   authors through its ordinary high-level node API, which is the distinction §5.1 of the PRD
 *   requires the comparison to name rather than hide.
 * - `clustered-default` is the framework's own ordinary answer to "draw many copies of this", so the
 *   `default` optimization class is measured as what a game actually gets.
 */

export interface ICullTopologyReport {
  readonly albedo: readonly number[];
  /** What the pinned Godot source's primitive produced, so a difference is visible not implied. */
  readonly counterpartTriangles: number;
  readonly kind: string;
  readonly tnIndices: number;
  readonly tnTriangles: number;
  readonly tnVertices: number;
}

export interface ICullScene {
  readonly camera: PerspectiveCamera;
  dispose(): void;
  readonly independentlyUpdatedObjects: number;
  readonly lightCount: { directional: number; omni: number; spot: number };
  readonly projection: {
    reasonCode: string;
    sourceRenderables: number;
    resultDrawCandidates: number;
  } | null;
  /** The scene the renderer must be handed: the authored one, or the projection's mirror. */
  readonly renderRoot: Object3D;
  readonly scene: Scene;
  setLightShadows(enabled: boolean): void;
  setLightsVisible(visible: boolean): void;
  step(frame: number): void;
  readonly topology: readonly ICullTopologyReport[];
}

const GRID_COLUMNS = 24;
const GRID_ROWS = 15;
const X_AXIS = new Vector3(1, 0, 0);

/** Segment counts follow the pinned source's primitive defaults; each engine's real counts are
 * reported rather than assumed equal, because independent tessellations are a disclosed difference. */
function geometryFor(index: number): { geometry: Mesh["geometry"]; kind: string } {
  switch (index) {
    case 0:
      return { geometry: new BoxGeometry(1, 1, 1), kind: "BoxMesh" };
    case 1:
      return { geometry: new SphereGeometry(0.5, 64, 32), kind: "SphereMesh" };
    case 2:
      return { geometry: new CapsuleGeometry(0.5, 1, 8, 64), kind: "CapsuleMesh" };
    case 3:
      return { geometry: new CylinderGeometry(0.5, 0.5, 2, 64, 1, false), kind: "CylinderMesh" };
    default:
      return { geometry: new CylinderGeometry(0.5, 0.5, 1, 3, 1, false), kind: "PrismMesh" };
  }
}

export function buildCullScene(
  fixture: ICullFixture,
  variant: ICullVariant,
  authoring: CullingAuthoring,
): ICullScene {
  // A real `Scene`, not an `Object3D` cast to one: the projection reads the scene's own background
  // and environment rotations, and a cast object simply has none of them.
  const scene = new Scene();
  // The pinned project's environment sets `background_mode` to BG_COLOR and never sets that colour,
  // so its observed background is black; each arm measures its own background from its own pixels.
  scene.background = new Color(0, 0, 0);
  const camera = new PerspectiveCamera(
    fixture.camera.fovDegrees,
    CULL_VIEWPORT.width / CULL_VIEWPORT.height,
    fixture.camera.near,
    fixture.camera.far,
  );
  camera.position.set(...(fixture.camera.position as unknown as [number, number, number]));
  camera.lookAt(...(fixture.camera.lookAt as unknown as [number, number, number]));
  const geometries = fixture.meshes.map((_, index) => geometryFor(index).geometry);
  const materials: Material[] = fixture.meshes.map((mesh) => {
    const color = new Color(...(mesh.albedo as unknown as [number, number, number]));
    return variant.unshaded
      ? new MeshBasicMaterial({ color })
      : new MeshStandardMaterial({ color, metalness: 0, roughness: 1 });
  });
  const objects: Object3D[] = [];
  for (let index = 0; index < fixture.objects; index++) {
    const placement = fixture.placements[index] as readonly number[];
    const mesh = new Mesh(
      geometries[index % geometries.length] as Mesh["geometry"],
      materials[index % materials.length] as Material,
    );
    mesh.position.set(placement[0] as number, placement[1] as number, placement[2] as number);
    scene.add(mesh);
    objects.push(mesh);
  }

  const lights: Light[] = [];
  const lightRigs: Object3D[] = [];
  // Godot's world environment takes its ambient from a Sky resource with no sun disk — white above,
  // black below — and the pinned source's unshaded variant is the one that has no environment light
  // at all. A hemisphere light is the lit counterpart, and it is a disclosed difference, not one of
  // the workload's light instances: `lightCount` names the instances the plan counts.
  if (!variant.unshaded) {
    const ambient = new HemisphereLight(0xffffff, 0x000000, 1);
    scene.add(ambient);
  }
  for (let index = 0; index < variant.lights.omni; index++) {
    const light = new PointLight(0xffffff, 1, fixture.lights.range ?? 10, 2);
    light.castShadow = variant.lightShadows;
    scene.add(light);
    lights.push(light);
    lightRigs.push(light);
  }
  for (let index = 0; index < variant.lights.spot; index++) {
    const light = new SpotLight(0xffffff, 1, fixture.lights.range ?? 10, Math.PI / 4, 0, 2);
    light.castShadow = variant.lightShadows;
    // The pinned source creates the spot RID with no target, so it points down its own -Z; three
    // defaults a spot to the world origin, which would aim all hundred lights at the same place.
    const target = new Object3D();
    target.position.set(0, 0, -1);
    light.add(target);
    light.target = target;
    scene.add(light);
    lights.push(light);
    lightRigs.push(light);
  }
  if (variant.lights.directional === 1) {
    const light = new DirectionalLight(0xffffff, 1);
    light.castShadow = variant.directionalShadows;
    if (fixture.directional.rotation !== null)
      light.rotation.set(
        fixture.directional.rotation[0] as number,
        fixture.directional.rotation[1] as number,
        fixture.directional.rotation[2] as number,
      );
    light.position.set(fixture.directional.positionX ?? 0, 0, 0);
    scene.add(light);
    lights.push(light);
  }
  for (let index = 0; index < lightRigs.length; index++) {
    const placement = fixture.lights.placements[index];
    if (placement === undefined) break;
    const rig = lightRigs[index] as Object3D;
    rig.position.set(placement[0] as number, placement[1] as number, placement[2] as number);
  }

  const projection =
    authoring === "clustered-default" ? new SceneRenderProjection(scene) : undefined;
  const place = (target: Object3D, moved: ICullTransform): void => {
    target.position.set(
      moved.origin[0] as number,
      moved.origin[1] as number,
      moved.origin[2] as number,
    );
  };
  const step = (frame: number): void => {
    const timeAccum = cullRenderedTimeAccum(frame);
    if (variant.dynamic === "objects") {
      for (let index = 0; index < objects.length; index++) {
        const base = fixture.placements[index] as readonly number[];
        const object = objects[index] as Object3D;
        place(object, cullTransform(base, index, objects.length, timeAccum, variant.dynamicRotate));
        if (variant.dynamicRotate)
          object.quaternion.setFromAxisAngle(
            X_AXIS,
            ((index * Math.PI * 2) / objects.length) * Math.sin(timeAccum) * 2,
          );
      }
    } else if (variant.dynamic === "lights") {
      for (let index = 0; index < lightRigs.length; index++) {
        const base = fixture.lights.placements[index];
        if (base === undefined) break;
        place(
          lightRigs[index] as Object3D,
          cullTransform(base, index, lightRigs.length, timeAccum, variant.dynamicRotate),
        );
      }
    }
    projection?.reconcile();
  };
  step(0);
  const topology: ICullTopologyReport[] = fixture.meshes.map((mesh, index) => {
    const geometry = geometries[index] as Mesh["geometry"];
    const position = geometry.getAttribute("position") as BufferAttribute;
    const indices = geometry.getIndex();
    return {
      albedo: mesh.albedo,
      counterpartTriangles: mesh.triangles,
      kind: mesh.kind,
      tnIndices: indices?.count ?? 0,
      tnTriangles: (indices?.count ?? position.count) / 3,
      tnVertices: position.count,
    };
  });
  return {
    camera,
    dispose: () => {
      projection?.dispose();
      for (const geometry of geometries) geometry.dispose();
      for (const material of materials) material.dispose();
    },
    independentlyUpdatedObjects:
      variant.dynamic === "objects"
        ? fixture.objects
        : variant.dynamic === "lights"
          ? lightRigs.length
          : 0,
    lightCount: variant.lights,
    projection: projection
      ? {
          ...projection.report,
          sourceRenderables: projection.report.sourceRenderables,
          resultDrawCandidates: projection.report.resultDrawCandidates,
        }
      : null,
    renderRoot: projection?.root ?? scene,
    scene,
    setLightShadows: (enabled) => {
      for (const light of lights) light.castShadow = enabled;
    },
    setLightsVisible: (visible) => {
      for (const light of lights) light.visible = visible;
    },
    step,
    topology,
  };
}

export interface ICullCapture {
  readonly backgroundLuma: number;
  /** `null` when there is no earlier captured frame, which is not the same as an unchanged frame. */
  readonly changedPixels: number | null;
  readonly coveredFraction: number;
  readonly coverageCells: readonly number[];
  readonly meanLuma: number;
  /** The sampled luma row-major, so the next capture can difference against this one. */
  readonly luma: Float32Array;
  readonly sampledPixels: number;
}

/** The pinned Godot arm samples one pixel in eight and folds the rest into a 24x15 coverage grid. */
const SAMPLE_STEP = 8;

/**
 * Coverage from a readback of the captured frame itself, with the background taken as the most
 * common luma rather than one corner: the two arms' pixels arrive through different readback paths,
 * so a corner sample would not be a like-for-like reference. The sample lattice is the competitor's
 * own, so `coveredFraction` and `changedPixels` count the same pixels in both arms; the previous
 * frame enters as the luma this one is differenced against, never as its raw bytes.
 */
export function cullCapture(
  pixels: Uint8Array,
  width: number,
  height: number,
  previous: Float32Array | null,
): ICullCapture {
  const stride = Math.ceil((width * 4) / 256) * 256;
  const columns = Math.ceil(width / SAMPLE_STEP);
  const rows = Math.ceil(height / SAMPLE_STEP);
  const luma = new Float32Array(columns * rows);
  const histogram = new Uint32Array(256);
  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) {
      const offset = row * SAMPLE_STEP * stride + column * SAMPLE_STEP * 4;
      const value =
        0.2126 * (pixels[offset] as number) +
        0.7152 * (pixels[offset + 1] as number) +
        0.0722 * (pixels[offset + 2] as number);
      luma[row * columns + column] = value / 255;
      const bucket = Math.min(255, Math.round(value));
      histogram[bucket] = (histogram[bucket] as number) + 1;
    }
  }
  let backgroundBucket = 0;
  for (let bucket = 1; bucket < 256; bucket++)
    if ((histogram[bucket] as number) > (histogram[backgroundBucket] as number))
      backgroundBucket = bucket;
  const background = backgroundBucket / 255;
  const cells = new Array<number>(GRID_COLUMNS * GRID_ROWS).fill(0);
  let covered = 0;
  let total = 0;
  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) {
      const value = luma[row * columns + column] as number;
      total += value;
      if (Math.abs(value - background) > 0.02) {
        covered += 1;
        const cell =
          Math.floor((row / rows) * GRID_ROWS) * GRID_COLUMNS +
          Math.floor((column / columns) * GRID_COLUMNS);
        cells[cell] = (cells[cell] as number) + 1;
      }
    }
  }
  let changed: number | null = null;
  if (previous !== null && previous.length === luma.length) {
    changed = 0;
    for (let index = 0; index < luma.length; index++)
      if (Math.abs((luma[index] as number) - (previous[index] as number)) > 0.02) changed += 1;
  }
  return {
    backgroundLuma: background,
    changedPixels: changed,
    coveredFraction: covered / luma.length,
    coverageCells: cells,
    luma,
    meanLuma: total / luma.length,
    sampledPixels: luma.length,
  };
}

export interface ICullAdapterIdentity {
  readonly architecture: string | null;
  readonly description: string | null;
  readonly device: string | null;
  readonly vendor: string | null;
}

export interface ICullHarness extends ICullScene {
  readonly adapter: ICullAdapterIdentity;
  readonly threeRevision: string;
  capture(): Promise<{ capture: ICullCapture; png: Uint8Array | null }>;
  drain(): Promise<void>;
  render(): Promise<void>;
  stats(): { drawCalls: number; triangles: number };
}

/** Read from the adapter the runtime actually handed out, field by field: a bare stringify is `{}`. */
async function describeAdapter(): Promise<ICullAdapterIdentity> {
  const gpu = (navigator as unknown as { gpu?: { requestAdapter(): Promise<unknown> } }).gpu;
  if (gpu === undefined) throw new Error("TN_BENCH_IDENTITY_MISSING:gpu");
  const adapter = (await gpu.requestAdapter()) as {
    info?: Record<string, string | undefined>;
  } | null;
  const info = adapter?.info;
  if (info === undefined || info === null) throw new Error("TN_BENCH_IDENTITY_MISSING:gpu");
  const read = (value: string | undefined): string | null =>
    value === undefined || value.length === 0 ? null : value;
  const identity: ICullAdapterIdentity = {
    architecture: read(info.architecture),
    description: read(info.description),
    device: read(info.device),
    vendor: read(info.vendor),
  };
  if (Object.values(identity).every((value) => value === null))
    throw new Error("TN_BENCH_IDENTITY_MISSING:gpu");
  return identity;
}

export async function createCullHarness(
  canvas: HTMLCanvasElement,
  fixture: ICullFixture,
  variant: ICullVariant,
  authoring: CullingAuthoring,
): Promise<ICullHarness> {
  const renderer = new WebGPURenderer({ antialias: false, canvas });
  renderer.setPixelRatio(1);
  renderer.setSize(CULL_VIEWPORT.width, CULL_VIEWPORT.height, false);
  await renderer.init();
  renderer.info.autoReset = false;
  renderer.shadowMap.enabled = true;
  const built = buildCullScene(fixture, variant, authoring);
  const backend = renderer.backend as unknown as {
    device?: { queue?: { onSubmittedWorkDone?: () => Promise<void> } };
  };
  const adapter = await describeAdapter();
  let previous: Float32Array | null = null;
  const renderTo = async (target: unknown): Promise<void> => {
    renderer.info.reset();
    (renderer as unknown as { setRenderTarget(target: unknown): void }).setRenderTarget(target);
    await renderer.render(built.renderRoot, built.camera);
    (renderer as unknown as { setRenderTarget(target: unknown): void }).setRenderTarget(null);
  };
  return {
    ...built,
    adapter,
    capture: async () => {
      // Two renders of one untimed frame: the canvas keeps the presented image, the target is what
      // the coverage numbers are read from, so both describe the same state.
      await renderTo(null);
      const readTarget = renderer as unknown as {
        getRenderTarget(): unknown;
        readRenderTargetPixelsAsync(
          target: unknown,
          x: number,
          y: number,
          width: number,
          height: number,
        ): Promise<Uint8Array>;
      };
      if (typeof readTarget.readRenderTargetPixelsAsync !== "function")
        throw new Error("TN_BENCH_CULL_READBACK_UNAVAILABLE");
      const renderTarget = new RenderTarget(CULL_VIEWPORT.width, CULL_VIEWPORT.height);
      await renderTo(renderTarget);
      const pixels = await readTarget.readRenderTargetPixelsAsync(
        renderTarget,
        0,
        0,
        CULL_VIEWPORT.width,
        CULL_VIEWPORT.height,
      );
      renderTarget.dispose();
      const capture = cullCapture(pixels, CULL_VIEWPORT.width, CULL_VIEWPORT.height, previous);
      previous = capture.luma;
      let png: Uint8Array | null = null;
      const convert = (
        canvas as unknown as {
          convertToBlob?: () => Promise<{ arrayBuffer(): Promise<ArrayBuffer> }>;
        }
      ).convertToBlob;
      if (typeof convert === "function") {
        const blob = await (convert as () => Promise<{ arrayBuffer(): Promise<ArrayBuffer> }>).call(
          canvas,
        );
        png = new Uint8Array(await blob.arrayBuffer());
      }
      return { capture, png };
    },
    dispose: () => {
      built.dispose();
      renderer.dispose();
    },
    drain: async () => {
      if (backend.device?.queue?.onSubmittedWorkDone === undefined)
        throw new Error("TN_BENCH_GPU_COMPLETION_UNAVAILABLE");
      await backend.device.queue.onSubmittedWorkDone();
    },
    render: () => renderTo(null),
    stats: () => ({
      drawCalls: renderer.info.render.drawCalls,
      triangles: renderer.info.render.triangles,
    }),
    threeRevision: REVISION,
  };
}

import {
  BufferAttribute,
  BufferGeometry,
  Color,
  DirectionalLight,
  type Material,
  Mesh,
  MeshStandardMaterial,
  type Object3D,
  PerspectiveCamera,
  Quaternion,
  REVISION,
  RenderTarget,
  Scene,
  Vector3,
  WebGPURenderer,
} from "three/webgpu";
import { SceneRenderProjection } from "../../../packages/core/src/renderProjection.js";
import {
  CUBES_TOLERANCE,
  type ICubesFixture,
  type ICubesMeshChannels,
  cubesCameraRotation,
  cubesFixtureHash,
  cubesMeshBufferBytes,
  cubesMeshChannels,
  cubesObjectStepRotation,
  parseCubesFixture,
} from "./cubes-fixture.js";
import { cullCapture } from "./cull-harness.js";
import { sha256 } from "./identity.js";

/**
 * PRD-449 `bevy-many-cubes`: the ThreeNative counterpart arm. It renders the fixture the pinned Bevy
 * arm exported — its Fibonacci sphere placement, its seeded mesh and material choice, its enclosing
 * box, its camera, its light and its frame schedule — and reports the same raw series, the same
 * conformance samples and the same work counters the comparator checks.
 *
 * The authoring is TN's *default*: one `Mesh` per cube, no explicit instancing, and the package's
 * ordinary `SceneRenderProjection` left in place. §3.1 of the PRD makes `default` the primary native
 * comparison, and this arm states it rather than quietly measuring an instanced diagnostic.
 */

declare global {
  var canvas: HTMLCanvasElement | undefined;
}

declare const __TN_CUBES_CONFIG__: Readonly<{
  authoring: string;
  fixtureJson: string;
}>;

const STATE_FRAMES = [0, 1, 60, 120, 300, 599];

function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

function percentile(samples: readonly number[], fraction: number): number {
  const sorted = [...samples].sort((a, b) => a - b);
  return sorted[Math.ceil(fraction * samples.length) - 1] as number;
}

function base64(bytes: Uint8Array): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  let out = "";
  for (let index = 0; index < bytes.length; index += 3) {
    const a = bytes[index] as number;
    const b = bytes[index + 1];
    const c = bytes[index + 2];
    out += alphabet[a >> 2];
    out += alphabet[((a & 3) << 4) | ((b ?? 0) >> 4)];
    out += b === undefined ? "=" : alphabet[((b & 15) << 2) | ((c ?? 0) >> 6)];
    out += c === undefined ? "=" : alphabet[c & 63];
  }
  return out;
}

/**
 * The geometry is the exporting arm's own vertex and index buffers, and the digest is re-derived from
 * the arrays that reached the GPU rather than inherited from the file, so a decode mistake cannot
 * pass as byte-identical geometry.
 */
async function geometryFor(
  fixture: ICubesFixture,
  index: number,
): Promise<{ geometry: BufferGeometry; sha256: string }> {
  const mesh = fixture.meshes[index];
  if (mesh === undefined) throw new Error(`TN_BENCH_CUBES_MESH:${index}`);
  const channels: ICubesMeshChannels = cubesMeshChannels(mesh);
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(channels.positions, 3));
  geometry.setAttribute("normal", new BufferAttribute(channels.normals, 3));
  geometry.setAttribute("uv", new BufferAttribute(channels.uvs, 2));
  geometry.setIndex(new BufferAttribute(channels.indices, 1));
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  const uploaded: ICubesMeshChannels = {
    indices: (geometry.getIndex()?.array as Uint32Array) ?? new Uint32Array(0),
    normals: geometry.getAttribute("normal").array as Float32Array,
    positions: geometry.getAttribute("position").array as Float32Array,
    uvs: geometry.getAttribute("uv").array as Float32Array,
  };
  const observed = await sha256(cubesMeshBufferBytes(mesh, index, uploaded));
  return { geometry, sha256: observed };
}

function applyObject(
  target: Object3D,
  entry: {
    rotation: readonly number[];
    scale?: readonly number[];
    translation?: readonly number[];
  },
): void {
  target.position.set(
    entry.translation?.[0] ?? 0,
    entry.translation?.[1] ?? 0,
    entry.translation?.[2] ?? 0,
  );
  target.quaternion.set(
    entry.rotation[0] as number,
    entry.rotation[1] as number,
    entry.rotation[2] as number,
    entry.rotation[3] as number,
  );
  target.scale.set(entry.scale?.[0] ?? 1, entry.scale?.[1] ?? 1, entry.scale?.[2] ?? 1);
}

function multiplyQuaternions(
  a: readonly number[],
  b: readonly number[],
): [number, number, number, number] {
  return [
    (a[3] as number) * (b[0] as number) +
      (a[0] as number) * (b[3] as number) +
      (a[1] as number) * (b[2] as number) -
      (a[2] as number) * (b[1] as number),
    (a[3] as number) * (b[1] as number) -
      (a[0] as number) * (b[2] as number) +
      (a[1] as number) * (b[3] as number) +
      (a[2] as number) * (b[0] as number),
    (a[3] as number) * (b[2] as number) +
      (a[0] as number) * (b[1] as number) -
      (a[1] as number) * (b[0] as number) +
      (a[2] as number) * (b[3] as number),
    (a[3] as number) * (b[3] as number) -
      (a[0] as number) * (b[0] as number) -
      (a[1] as number) * (b[1] as number) -
      (a[2] as number) * (b[2] as number),
  ];
}

function toArray(quaternion: Quaternion): number[] {
  return [quaternion.x, quaternion.y, quaternion.z, quaternion.w];
}

async function main(): Promise<void> {
  const config = __TN_CUBES_CONFIG__;
  const surface = globalThis.canvas;
  if (surface === undefined) throw new Error("TN_BENCH_NO_CANVAS");
  if (config.authoring !== "default")
    throw new Error(`TN_BENCH_CUBES_BAD_AUTHORING:${config.authoring}`);
  const fixture = parseCubesFixture(config.fixtureJson);
  const fixtureHash = await cubesFixtureHash(config.fixtureJson);
  const { width, height } = fixture.viewport;
  surface.width = width;
  surface.height = height;

  const renderer = new WebGPURenderer({ antialias: false, canvas: surface });
  renderer.setPixelRatio(1);
  renderer.setSize(width, height, false);
  await renderer.init();
  renderer.info.autoReset = false;
  renderer.shadowMap.enabled = fixture.environment.shadowMapsEnabled;

  const scene = new Scene();
  scene.background = new Color(0, 0, 0);
  const camera = new PerspectiveCamera(
    fixture.camera.fovDegrees,
    width / height,
    fixture.camera.near,
    fixture.camera.far,
  );
  applyObject(camera, fixture.camera);
  // The package's ordinary authoring: what a game gets without asking for anything.
  const projection = new SceneRenderProjection(scene);

  const built = await Promise.all(
    fixture.meshes.map((_mesh, index) => geometryFor(fixture, index)),
  );
  const geometries = built.map((entry) => entry.geometry);
  const materials: Material[] = fixture.materials.map((material) => {
    const [r, g, b] = material.baseColor as unknown as [number, number, number];
    return new MeshStandardMaterial({
      color: new Color().setRGB(r, g, b, "srgb-linear"),
      metalness: material.metallic,
      roughness: material.perceptualRoughness,
    });
  });

  const cubes: Object3D[] = [];
  for (const entry of fixture.objects) {
    const mesh = new Mesh(
      geometries[entry.geometryId] as BufferGeometry,
      materials[entry.materialId] as Material,
    );
    applyObject(mesh, entry);
    scene.add(mesh);
    cubes.push(mesh);
  }
  for (const entry of fixture.enclosing) {
    const mesh = new Mesh(
      geometries[entry.geometryId] as BufferGeometry,
      materials[entry.materialId] as Material,
    );
    applyObject(mesh, entry);
    scene.add(mesh);
  }

  // Bevy's `DirectionalLight` shines along its own -Z after `looking_at`, and three's shines from
  // `position` toward `target`, so the direction the pinned source chose is carried over and only the
  // distance — which a directional light ignores — is this arm's choice.
  const lightRotation = new Quaternion(
    fixture.light.rotation[0] as number,
    fixture.light.rotation[1] as number,
    fixture.light.rotation[2] as number,
    fixture.light.rotation[3] as number,
  );
  const light = new DirectionalLight(0xffffff, 1);
  light.castShadow = fixture.light.shadowMapsEnabled;
  light.target.position.set(0, 0, 0);
  scene.add(light.target);
  light.position
    .set(0, 0, -1)
    .applyQuaternion(lightRotation)
    .multiplyScalar(-1000)
    .add(light.target.position);
  scene.add(light);

  // The state a frame must reach, composed in f64 from the fixture's own schedule rather than
  // accumulated in f32, so a 600-step composition cannot drift into a conformance failure that is
  // the arm's arithmetic rather than the scene's. The per-frame work is still one quaternion
  // composition per object: that work is the rotating arm's update cost.
  const cubeBaseRotations = fixture.objects.map((entry) => entry.rotation);
  const stepCamera = (frame: number): void => {
    const rotation = cubesCameraRotation(fixture, frame);
    camera.quaternion.set(rotation[0], rotation[1], rotation[2], rotation[3]);
  };
  const stepCubes = (frame: number): void => {
    // One composition of the frame's rotation, then one quaternion multiply per object. Bevy spends
    // one `rotate_y` per object; computing the step once and applying it per object is the same work
    // per object, and it keeps the f64 oracle from being re-derived 1,000 times a frame.
    const step = cubesObjectStepRotation(fixture, frame);
    for (let index = 0; index < cubes.length; index += 1) {
      const base = cubeBaseRotations[index] as readonly number[];
      const rotation = multiplyQuaternions(step, base);
      (cubes[index] as Object3D).quaternion.set(rotation[0], rotation[1], rotation[2], rotation[3]);
    }
  };

  const backend = renderer.backend as unknown as {
    device?: { queue?: { onSubmittedWorkDone?: () => Promise<void> } };
  };
  const drain = async (): Promise<void> => {
    if (backend.device?.queue?.onSubmittedWorkDone === undefined)
      throw new Error("TN_BENCH_GPU_COMPLETION_UNAVAILABLE");
    await backend.device.queue.onSubmittedWorkDone();
  };
  const renderTo = async (target: unknown): Promise<void> => {
    renderer.info.reset();
    (renderer as unknown as { setRenderTarget(target: unknown): void }).setRenderTarget(target);
    await renderer.render(projection.root, camera);
    (renderer as unknown as { setRenderTarget(target: unknown): void }).setRenderTarget(null);
  };

  const adapter = await describeAdapter();
  const schedule = fixture.frameSchedule;
  const states: { frameId: number; cameraRotation: number[]; probes: unknown[] }[] = [];
  const captures: Record<string, unknown>[] = [];
  const pngs: { name: string; bytes: Uint8Array }[] = [];
  let previous: Float32Array | null = null;
  let work: Record<string, unknown> | null = null;

  try {
    // Untimed warmup, ending so the scored frames carry the same number of steps the exporting arm
    // applied before its own first boundary. The camera and the cubes read different things on the
    // upstream side (a constant step and `Res<Time>`), so the count each needs is taken from the
    // schedule rather than guessed from one number.
    const warmupFrames = schedule.firstScoredFrameClockSteps - 1;
    for (let frame = -1; frame < warmupFrames; frame += 1) {
      stepCamera(Math.max(frame, 0));
      stepCubes(Math.max(frame, 0));
      await renderTo(null);
      await nextFrame();
    }
    await drain();
    const start = performance.now();
    const boundaries = [{ frameId: 0, monotonicMs: start }];
    for (let frame = 0; frame < schedule.measuredFrames; frame += 1) {
      stepCamera(frame);
      stepCubes(frame);
      await renderTo(null);
      await nextFrame();
      boundaries.push({ frameId: frame + 1, monotonicMs: performance.now() });
      if (STATE_FRAMES.includes(frame)) {
        states.push({
          cameraRotation: toArray(camera.quaternion),
          frameId: frame,
          probes: fixture.probeIndices.map((index) => ({
            index,
            rotation: toArray((cubes[index] as Object3D).quaternion),
          })),
        });
      }
      if (frame === Math.floor(schedule.measuredFrames / 2)) {
        // The cube mesh carries a fixed triangle count, so the submitted triangles divide into the
        // number of cubes this engine's renderer admitted to the frame. That is the same quantity
        // Bevy's `ViewVisibility` counts, derived from this engine's own submitted work.
        const triangles = renderer.info.render.triangles;
        const perCube = fixture.meshes[fixture.objects[0]?.geometryId ?? 0]?.triangles ?? 0;
        work = {
          admittedCubes: perCube === 0 ? null : Math.round(triangles / perCube),
          authoredObjects: fixture.objects.length,
          note: "three does not expose its per-object visibility set, so the admitted count is derived from the submitted triangles and the fixture's per-mesh triangle count",
          projection: {
            reasonCode: projection.report.reasonCode,
            sourceRenderables: projection.report.sourceRenderables,
            resultDrawCandidates: projection.report.resultDrawCandidates,
          },
          sampledAtMeasuredFrame: frame,
          submittedDrawCalls: renderer.info.render.drawCalls,
          submittedTriangles: triangles,
        };
        // Untimed visual evidence at the same frame, read back from a render target so the coverage
        // grid describes this state rather than the next one.
        const renderTarget = new RenderTarget(width, height);
        await renderTo(renderTarget);
        const read = renderer as unknown as {
          readRenderTargetPixelsAsync(
            target: unknown,
            x: number,
            y: number,
            w: number,
            h: number,
          ): Promise<Uint8Array>;
        };
        if (typeof read.readRenderTargetPixelsAsync !== "function")
          throw new Error("TN_BENCH_CUBES_READBACK_UNAVAILABLE");
        const pixels = await read.readRenderTargetPixelsAsync(renderTarget, 0, 0, width, height);
        renderTarget.dispose();
        const captured = cullCapture(pixels, width, height, previous);
        previous = captured.luma;
        const { luma: _luma, ...capture } = captured;
        captures.push({ frameId: frame, name: "frame", scored: false, ...capture });
        const convert = (
          surface as unknown as {
            convertToBlob?: () => Promise<{ arrayBuffer(): Promise<ArrayBuffer> }>;
          }
        ).convertToBlob;
        if (typeof convert === "function") {
          const blob = await convert.call(surface);
          pngs.push({ bytes: new Uint8Array(await blob.arrayBuffer()), name: `frame-${frame}` });
        }
      }
    }
    await drain();
    const finalCompletionMs = performance.now();
    const intervals = boundaries
      .slice(1)
      .map(
        (boundary, index) =>
          boundary.monotonicMs - (boundaries[index] as { monotonicMs: number }).monotonicMs,
      );
    const record = {
      adapter,
      arm: "tn-desktop",
      authoring: config.authoring,
      // The coverage grid read back from this arm's own pixels at the midpoint frame, and only this
      // arm's: Bevy has no read-back in this slice, so the cross-arm picture comparison is open and
      // these numbers are the one side of it that exists.
      captures,
      boundarySemantics:
        "render-producing frame boundary at the next frame pump after this frame's render, so each interval carries the previous frame's update, its render submission and any GPU wait",
      drain: {
        boundaryFrame: schedule.measuredFrames,
        includesUntimedFrames: 1,
        method: "onSubmittedWorkDone",
      },
      family: "bevy-many-cubes",
      fixture: {
        hash: fixtureHash,
        objects: fixture.counts.cubes,
        sourceCommit: fixture.source.commit,
      },
      frameSchedule: schedule,
      frameP50Ms: percentile(intervals, 0.5),
      frameP95Ms: percentile(intervals, 0.95),
      frameP99Ms: percentile(intervals, 0.99),
      meanMs: (finalCompletionMs - start) / schedule.measuredFrames,
      meshBuffers: built.map((entry, index) => ({
        index,
        observedSha256: entry.sha256,
        triangles: fixture.meshes[index]?.triangles ?? 0,
        vertices: fixture.meshes[index]?.vertices ?? 0,
      })),
      profile: "smoke",
      rawSeries: { boundaries, finalCompletionMs, schemaVersion: 1, unit: "ms" },
      states,
      stateSource: "fixture-oracle-composed",
      threeRevision: REVISION,
      tolerance: CUBES_TOLERANCE,
      variant: fixture.variant,
      viewport: { height, width },
      warmupFrames,
      warmupStateSource: "fixture-oracle-composed",
      work,
    };
    for (const png of pngs) {
      const encoded = base64(png.bytes);
      for (let offset = 0; offset < encoded.length; offset += 800)
        console.log(`TNPNG:${png.name}:${offset}:${encoded.slice(offset, offset + 800)}`);
    }
    console.log("ENGINE_LOAD_TEST_PNG_END");
    const payload = JSON.stringify(record);
    console.log("ENGINE_LOAD_TEST_JSON_BEGIN");
    for (let offset = 0; offset < payload.length; offset += 800)
      console.log(`TNJSON:${payload.slice(offset, offset + 800)}`);
    console.log("ENGINE_LOAD_TEST_JSON_END");
  } finally {
    projection.dispose();
    for (const geometry of geometries) geometry.dispose();
    for (const material of materials) material.dispose();
    renderer.dispose();
  }
}

/** Read from the adapter the runtime actually handed out, field by field: a bare stringify is `{}`. */
async function describeAdapter(): Promise<Record<string, string | null>> {
  const gpu = (navigator as unknown as { gpu?: { requestAdapter(): Promise<unknown> } }).gpu;
  if (gpu === undefined) throw new Error("TN_BENCH_IDENTITY_MISSING:gpu");
  const adapter = (await gpu.requestAdapter()) as {
    info?: Record<string, string | undefined>;
  } | null;
  const info = adapter?.info;
  if (info === undefined || info === null) throw new Error("TN_BENCH_IDENTITY_MISSING:gpu");
  const read = (value: string | undefined): string | null =>
    value === undefined || value.length === 0 ? null : value;
  const identity = {
    architecture: read(info.architecture),
    description: read(info.description),
    device: read(info.device),
    vendor: read(info.vendor),
  };
  if (Object.values(identity).every((value) => value === null))
    throw new Error("TN_BENCH_IDENTITY_MISSING:gpu");
  return identity;
}

main().catch((error: unknown) => {
  console.log(
    `ENGINE_LOAD_TEST_FAILED ${String(error)} ${error instanceof Error ? (error.stack ?? "") : ""}`,
  );
});

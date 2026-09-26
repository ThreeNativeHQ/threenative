import {
  BufferAttribute,
  BufferGeometry,
  Color,
  DirectionalLight,
  type Material,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  PerspectiveCamera,
  Quaternion,
  REVISION,
  RenderTarget,
  SRGBColorSpace,
  Scene,
  Texture,
  Vector3,
  WebGPURenderer,
} from "three/webgpu";
import { SceneRenderProjection } from "../../../packages/core/src/renderProjection.js";
import {
  CITY_TOLERANCE,
  type ICityFixture,
  type ICityMeshChannels,
  cityCameraRotation,
  cityFixtureHash,
  cityImageBytes,
  cityMeshBufferBytes,
  cityMeshChannels,
  cityRoadLength,
  parseCityFixture,
} from "./city-fixture.js";
import { cullCapture } from "./cull-harness.js";
import { sha256 } from "./identity.js";

/**
 * PRD-449 `bevy-city`: the ThreeNative counterpart arm. It authors the fixture the pinned Bevy arm
 * exported — the same 14k-node hierarchy, the same geometry buffers, the same material bindings, the
 * same camera, the same light and the same car simulation — and reports the same raw series, the
 * same sampled states and the same work counters the comparator checks.
 *
 * **The authoring is TN's *default*, and the node boundaries are the point.** §5.1 requires the
 * export to "preserve node boundaries and material diversity rather than merging the whole city", so
 * every exported node becomes its own `Object3D` parented to its exported parent, and the package's
 * ordinary `SceneRenderProjection` is left in place. Nothing merges two nodes into one, so the
 * hierarchy the fixture froze is the hierarchy the renderer sees. `mergeParts` and `InstancedBatch`
 * both change that authoring and are not used for this equivalence.
 */

declare global {
  var canvas: HTMLCanvasElement | undefined;
}

declare const __TN_CITY_CONFIG__: Readonly<{
  authoring: string;
  fixtureJson: string;
}>;

/**
 * Bevy's `illuminance` is in lux and its scene asks for `Exposure::OVERCAST` on top; three's
 * `DirectionalLight` has neither unit nor exposure compensation. The direction, which decides the
 * shading, is carried over exactly; the magnitude is this arm's declared choice and the comparison
 * records it as a qualification rather than pretending the two lights are the same.
 */
const LIGHT_INTENSITY = 3;

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

function applyLocal(
  target: Object3D,
  entry: {
    rotation: readonly number[];
    scale: readonly number[];
    translation: readonly number[];
  },
): void {
  target.position.set(
    entry.translation[0] as number,
    entry.translation[1] as number,
    entry.translation[2] as number,
  );
  target.quaternion.set(
    entry.rotation[0] as number,
    entry.rotation[1] as number,
    entry.rotation[2] as number,
    entry.rotation[3] as number,
  );
  target.scale.set(entry.scale[0] as number, entry.scale[1] as number, entry.scale[2] as number);
}

/**
 * The geometry is the exporting arm's own vertex and index buffers, and the digest is re-derived from
 * the arrays that reached the GPU rather than inherited from the file, so a decode mistake cannot
 * pass as byte-identical geometry. Tangents go on as Bevy exported them, because three's normal map
 * path reads them and dropping them would be a rendering difference dressed as a saving.
 */
async function geometryFor(
  fixture: ICityFixture,
  index: number,
): Promise<{ geometry: BufferGeometry; sha256: string }> {
  const mesh = fixture.meshes[index] as ICityFixture["meshes"][number];
  const channels = cityMeshChannels(mesh);
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(channels.positions, 3));
  geometry.setAttribute("normal", new BufferAttribute(channels.normals, 3));
  geometry.setAttribute("uv", new BufferAttribute(channels.uvs, 2));
  if (channels.tangents.length > 0)
    geometry.setAttribute("tangent", new BufferAttribute(channels.tangents, 4));
  geometry.setIndex(new BufferAttribute(channels.indices, 1));
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  // Re-read the attributes back off the geometry, so the digest covers the arrays that reached the
  // GPU rather than the ones the decoder happened to produce.
  const uploaded: ICityMeshChannels = {
    indices: (geometry.getIndex()?.array as Uint32Array) ?? new Uint32Array(0),
    normals: geometry.getAttribute("normal").array as Float32Array,
    positions: geometry.getAttribute("position").array as Float32Array,
    tangents: (geometry.getAttribute("tangent")?.array as Float32Array) ?? new Float32Array(0),
    uvs: geometry.getAttribute("uv").array as Float32Array,
  };
  return { geometry, sha256: await sha256(cityMeshBufferBytes(mesh, index, uploaded)) };
}

/** The PNG bytes are the vendored file's own, so the runtime decodes what Bevy sampled. */
async function textureFor(image: ICityFixture["images"][number], index: number): Promise<Texture> {
  const bytes = cityImageBytes(image);
  if (typeof createImageBitmap !== "function")
    throw new Error(`TN_BENCH_CITY_IMAGE_DECODE_UNAVAILABLE:${index}`);
  // The runtime's own decoder, so the bytes Bevy sampled are the bytes this arm uploads. A
  // `Blob` is what the web signature takes; the native host's polyfill accepts one too.
  const bitmap = await createImageBitmap(new Blob([bytes], { type: "image/png" }));
  const texture = new Texture(bitmap as unknown as HTMLImageElement);
  texture.name = image.path;
  texture.colorSpace = SRGBColorSpace;
  texture.flipY = false;
  texture.needsUpdate = true;
  return texture;
}

async function main(): Promise<void> {
  const config = __TN_CITY_CONFIG__;
  const surface = globalThis.canvas;
  if (surface === undefined) throw new Error("TN_BENCH_NO_CANVAS");
  if (config.authoring !== "default")
    throw new Error(`TN_BENCH_CITY_BAD_AUTHORING:${config.authoring}`);
  const fixture = parseCityFixture(config.fixtureJson);
  const fixtureHash = await cityFixtureHash(config.fixtureJson);
  const { width, height } = fixture.viewport;
  surface.width = width;
  surface.height = height;

  const renderer = new WebGPURenderer({ antialias: false, canvas: surface });
  renderer.setPixelRatio(1);
  renderer.setSize(width, height, false);
  await renderer.init();
  renderer.info.autoReset = false;
  renderer.shadowMap.enabled = fixture.environment.shadowMapsEnabled === true;

  const scene = new Scene();
  scene.background = new Color(0, 0, 0);
  const camera = new PerspectiveCamera(
    fixture.camera.fovDegrees,
    width / height,
    fixture.camera.near,
    fixture.camera.far,
  );
  camera.position.set(
    fixture.camera.position[0] as number,
    fixture.camera.position[1] as number,
    fixture.camera.position[2] as number,
  );
  camera.quaternion.copy(cityCameraRotation(fixture));
  // The package's ordinary authoring: what a game gets without asking for anything.
  const projection = new SceneRenderProjection(scene);

  const built = await Promise.all(
    fixture.meshes.map((_mesh, index) => geometryFor(fixture, index)),
  );
  const geometries = built.map((entry) => entry.geometry);
  const textures: Texture[] = [];
  for (const [index, image] of fixture.images.entries())
    textures.push(await textureFor(image, index));
  const materials: Material[] = fixture.materials.map((material) => {
    const map =
      material.baseColorTexture === null ? null : (textures[material.baseColorTexture] as Texture);
    // glTF packs occlusion in R, roughness in G and metalness in B of one texture; three's
    // `roughnessMap` and `metalnessMap` read exactly those channels, so the counterpart binds the
    // same image to both rather than inventing a second one.
    const packed =
      material.metallicRoughnessTexture === null
        ? null
        : (textures[material.metallicRoughnessTexture] as Texture);
    const built = new MeshStandardMaterial({
      aoMap:
        material.occlusionTexture === null
          ? null
          : (textures[material.occlusionTexture] as Texture),
      aoMapIntensity: 1,
      color: new Color().setRGB(
        material.baseColor[0] as number,
        material.baseColor[1] as number,
        material.baseColor[2] as number,
        "srgb-linear",
      ),
      emissive: new Color().setRGB(
        material.emissive[0] as number,
        material.emissive[1] as number,
        material.emissive[2] as number,
        "srgb-linear",
      ),
      emissiveIntensity: material.emissiveExposureWeight,
      emissiveMap:
        material.emissiveTexture === null ? null : (textures[material.emissiveTexture] as Texture),
      map,
      metalness: material.metallic,
      metalnessMap: packed,
      normalMap:
        material.normalTexture === null ? null : (textures[material.normalTexture] as Texture),
      roughness: material.perceptualRoughness,
      roughnessMap: packed,
      side: material.cullMode === "Some(Front)" ? 2 : 0,
      transparent: material.alphaMode !== "Opaque",
    });
    if (material.baseColor[3] !== undefined && (material.baseColor[3] as number) < 1)
      built.opacity = material.baseColor[3] as number;
    return built;
  });

  // One `Object3D` per exported node, in the exporting arm's own walk order, each parented to the
  // node its `parent` column names. A grouping node with no geometry is still an `Object3D`, because
  // §5.1's node boundaries are the thing under test.
  const objects: Object3D[] = fixture.nodes.map((node) => {
    const target: Object3D =
      node.geometryId === null || node.materialId === null
        ? new Object3D()
        : new Mesh(
            geometries[node.geometryId] as BufferGeometry,
            materials[node.materialId] as Material,
          );
    applyLocal(target, node);
    return target;
  });
  for (const [index, node] of fixture.nodes.entries()) {
    const target = objects[index] as Object3D;
    if (node.parent < 0) {
      scene.add(target);
      continue;
    }
    (objects[node.parent] as Object3D).add(target);
  }

  // Bevy's `DirectionalLight` shines along its own -Z after `looking_at`, and three's shines from
  // `position` toward `target`, so the direction the pinned scene chose is carried over exactly.
  const lightRotation = new Quaternion(
    fixture.light.rotation[0] as number,
    fixture.light.rotation[1] as number,
    fixture.light.rotation[2] as number,
    fixture.light.rotation[3] as number,
  );
  const light = new DirectionalLight(0xffffff, LIGHT_INTENSITY);
  light.castShadow = fixture.environment.shadowMapsEnabled === true;
  light.target.position.set(0, 0, 0);
  scene.add(light.target);
  light.position
    .set(0, 0, -1)
    .applyQuaternion(lightRotation)
    .multiplyScalar(-1000)
    .add(light.target.position);
  scene.add(light);

  // `simulate_cars` keeps each car's distance in f32 and resets it to zero past the road's length.
  // This arm runs that recurrence itself rather than reading the f64 oracle's answer, so the
  // conformance comparison is between two independent evaluations of the same rule.
  const carObjects = fixture.cars.map((car) => objects[car.nodeIndex] as Object3D);
  const carDistances = new Float32Array(fixture.cars.length);
  const carRoadLengths = new Float32Array(fixture.cars.length);
  for (const [index, car] of fixture.cars.entries()) {
    carDistances[index] = car.distanceTraveled;
    carRoadLengths[index] = cityRoadLength(fixture, car.roadIndex);
  }
  const carStep = Math.fround(
    Math.fround(fixture.frameSchedule.carSpeedPerSecond) *
      Math.fround(fixture.frameSchedule.frameDelta),
  );
  const stepCars = (moving: boolean): void => {
    if (!moving) return;
    for (let index = 0; index < carObjects.length; index += 1) {
      let distance = (carDistances[index] as number) + carStep;
      const length = carRoadLengths[index] as number;
      if (distance > length) distance = 0;
      carDistances[index] = distance;
      const target = carObjects[index] as Object3D;
      const car = fixture.cars[index];
      if (car === undefined) throw new Error("TN_BENCH_CITY_CAR_CENSUS");
      const road = fixture.roads[car.roadIndex];
      if (road === undefined) throw new Error("TN_BENCH_CITY_ROAD_CENSUS");
      const sign = Math.sign(car.dir);
      const along = (sign * distance) / length;
      target.position.set(
        road.start[0] + car.offset[0] + (road.end[0] - road.start[0]) * along,
        road.start[1] + car.offset[1] + (road.end[1] - road.start[1]) * along,
        road.start[2] + car.offset[2] + (road.end[2] - road.start[2]) * along,
      );
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
  // §6.1's frames, clipped to this run's length so a 2-frame validation samples what it has.
  const stateFrames = [0, 1, 60, 120, 300, 599].filter((frame) => frame < schedule.measuredFrames);
  const states: Record<string, unknown>[] = [];
  const captures: Record<string, unknown>[] = [];
  const pngs: { name: string; bytes: Uint8Array }[] = [];
  let previous: Float32Array | null = null;
  let work: Record<string, unknown> | null = null;
  let applications = schedule.simulateCarsAtExport;
  const moving = fixture.variant === "moving";
  const sampleState = (frameId: number): void => {
    scene.updateMatrixWorld(true);
    states.push({
      camera: {
        rotation: [
          camera.quaternion.x,
          camera.quaternion.y,
          camera.quaternion.z,
          camera.quaternion.w,
        ],
        translation: [camera.position.x, camera.position.y, camera.position.z],
      },
      cars: fixture.probeCars.map((car) => {
        const object = carObjects[car] as Object3D;
        const position = new Vector3();
        object.getWorldPosition(position);
        return {
          distanceTraveled: carDistances[car] as number,
          index: car,
          translation: [position.x, position.y, position.z],
        };
      }),
      frameId,
      nodes: fixture.probeNodes.map((node) => {
        const object = objects[node] as Object3D;
        const position = new Vector3();
        object.getWorldPosition(position);
        return { index: node, translation: [position.x, position.y, position.z] };
      }),
      simulateCarsApplications: applications,
    });
  };

  try {
    // Untimed frames up to the measured window, so the arms are separated by the same number of
    // `simulate_cars` applications. The settle and warmup counts come from the fixture, not a guess.
    const untimed = schedule.settleFrames + schedule.warmupFrames;
    for (let frame = 0; frame < untimed; frame += 1) {
      stepCars(moving);
      applications += 1;
      await renderTo(null);
      await nextFrame();
    }
    await drain();
    const start = performance.now();
    const boundaries = [{ frameId: 0, monotonicMs: start }];
    if (stateFrames.includes(0)) sampleState(0);
    for (let frame = 0; frame < schedule.measuredFrames; frame += 1) {
      stepCars(moving);
      applications += 1;
      await renderTo(null);
      await nextFrame();
      boundaries.push({ frameId: frame + 1, monotonicMs: performance.now() });
      if (stateFrames.includes(frame + 1)) sampleState(frame + 1);
      if (frame === Math.floor(schedule.measuredFrames / 2)) {
        work = {
          admittedMeshNodes: null,
          authoredMeshNodes: fixture.census.meshNodes,
          authoredNodes: fixture.census.nodes,
          carNodes: fixture.cars.length,
          note: "three exposes no per-object visibility set, so the admitted count is null with a reason; the submitted draw and triangle counts are this engine's own",
          projection: {
            reasonCode: projection.report.reasonCode,
            resultDrawCandidates: projection.report.resultDrawCandidates,
            sourceRenderables: projection.report.sourceRenderables,
          },
          sampledAtMeasuredFrame: frame,
          simulateCarsApplications: applications,
          simulateCarsEnabled: moving,
          submittedDrawCalls: renderer.info.render.drawCalls,
          submittedTriangles: renderer.info.render.triangles,
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
          throw new Error("TN_BENCH_CITY_READBACK_UNAVAILABLE");
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
      boundarySemantics:
        "render-producing frame boundary after the update, render submission and GPU wait",
      captures,
      census: fixture.census,
      drain: {
        boundaryFrame: schedule.measuredFrames,
        includesUntimedFrames: 1,
        method: "onSubmittedWorkDone",
      },
      family: "bevy-city",
      fixture: {
        hash: fixtureHash,
        nodes: fixture.census.nodes,
        sourceCommit: fixture.source.commit,
      },
      frameP50Ms: percentile(intervals, 0.5),
      frameP95Ms: percentile(intervals, 0.95),
      frameP99Ms: percentile(intervals, 0.99),
      frameSchedule: schedule,
      lightIntensityMapping: `bevy ${fixture.light.illuminanceLux} lux with Exposure::OVERCAST has no three equivalent; this arm uses DirectionalLight intensity ${LIGHT_INTENSITY} and the comparison records it as a qualification`,
      meanMs: (finalCompletionMs - start) / schedule.measuredFrames,
      meshBuffers: built.map((entry, index) => ({
        index,
        observedSha256: entry.sha256,
        triangles: fixture.meshes[index]?.triangles ?? 0,
        vertices: fixture.meshes[index]?.vertices ?? 0,
      })),
      profile: "smoke",
      rawSeries: { boundaries, finalCompletionMs, schemaVersion: 1, unit: "ms" },
      settings: fixture.settings,
      simulateCarsApplications: {
        atExport: schedule.simulateCarsAtExport,
        atFirstScoredFrame: applications - schedule.measuredFrames,
      },
      states,
      stateSource: "fixture-oracle-composed",
      threeRevision: REVISION,
      tolerance: CITY_TOLERANCE,
      variant: fixture.variant,
      viewport: { height, width },
      warmupFrames: schedule.settleFrames + schedule.warmupFrames,
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
    for (const texture of textures) texture.dispose();
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

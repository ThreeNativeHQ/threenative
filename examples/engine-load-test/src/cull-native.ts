import {
  CULL_FRAME_DELTA,
  CULL_PROBE_INDICES,
  CULL_VIEWPORT,
  type CullingAuthoring,
  cullFixtureHash,
  cullProbe,
  cullTimeAccum,
  cullVariant,
  parseCullFixture,
} from "./cull-fixture.js";
import { createCullHarness } from "./cull-harness.js";

declare global {
  var canvas: HTMLCanvasElement | undefined;
}

declare const __TN_CULL_CONFIG__: Readonly<{
  authoring: string;
  frames: number;
  fixtureJson: string;
  variant: string;
  warmup: number;
}>;

function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

function percentile(samples: readonly number[], fraction: number): number {
  const sorted = [...samples].sort((a, b) => a - b);
  return sorted[Math.ceil(fraction * sorted.length) - 1] as number;
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

const STATE_FRAMES = [0, 1, 60, 120, 300, 599];

async function main(): Promise<void> {
  const config = __TN_CULL_CONFIG__;
  const surface = globalThis.canvas;
  if (surface === undefined) throw new Error("TN_BENCH_NO_CANVAS");
  surface.width = CULL_VIEWPORT.width;
  surface.height = CULL_VIEWPORT.height;
  const fixture = parseCullFixture(config.fixtureJson);
  const variant = cullVariant(config.variant);
  if (config.authoring !== "scene-node-independent" && config.authoring !== "clustered-default")
    throw new Error(`TN_BENCH_BAD_AUTHORING:${config.authoring}`);
  const authoring = config.authoring as CullingAuthoring;
  const fixtureHash = await cullFixtureHash(config.fixtureJson);
  const harness = await createCullHarness(surface, fixture, variant, authoring);
  const captures: Record<string, unknown>[] = [];
  const pngs: { name: string; bytes: Uint8Array }[] = [];
  try {
    if (authoring === "clustered-default" && harness.projection?.reasonCode !== "projected")
      throw new Error(`TN_BENCH_PROJECTION_NOT_APPLIED:${harness.projection?.reasonCode}`);
    // The fixture is the shared input; the arm proves it read the bytes it hashed.
    if (fixture.objects !== 10000) throw new Error("TN_BENCH_CULL_FIXTURE_OBJECTS");
    const captureFrames = [0, 1, 60, 119, 300, 599].filter((frame) => frame < config.warmup);
    const warmupStart = performance.now();
    for (let frame = 0; frame < config.warmup; frame++) {
      harness.step(frame);
      if (captureFrames.includes(frame)) {
        const shot = await harness.capture();
        // `luma` is the next capture's difference basis, not a record field: it is 32,400 samples of
        // scratch state and the record carries the numbers derived from it instead.
        const { luma: _luma, ...capture } = shot.capture;
        captures.push({ frameId: frame, name: "frame", scored: true, ...capture });
        if (shot.png !== null) pngs.push({ bytes: shot.png, name: `frame-${frame}` });
      } else {
        await harness.render();
      }
      await nextFrame();
    }
    harness.step(0);
    await harness.drain();
    const start = performance.now();
    const boundaries = [{ frameId: 0, monotonicMs: start }];
    let stats = { drawCalls: 0, triangles: 0 };
    for (let frame = 0; frame < config.frames; frame++) {
      harness.step(frame);
      await harness.render();
      if (frame === Math.floor(config.frames / 2)) stats = harness.stats();
      await nextFrame();
      boundaries.push({ frameId: frame + 1, monotonicMs: performance.now() });
    }
    await harness.drain();
    const finalCompletionMs = performance.now();
    const intervals = boundaries
      .slice(1)
      .map(
        (boundary, index) =>
          boundary.monotonicMs - (boundaries[index] as { monotonicMs: number }).monotonicMs,
      );
    const result = {
      adapter: harness.adapter,
      arm: "tn-desktop",
      authoring,
      captures,
      dynamic: {
        enabled: variant.dynamic !== "none",
        frameDelta: CULL_FRAME_DELTA,
        rotate: variant.dynamicRotate,
        rids: harness.independentlyUpdatedObjects,
        target: variant.dynamic,
      },
      environment: {
        // The counterpart of Godot's Sky-derived world ambient, and the reason `lights.omni` may be
        // zero on a lit variant without the frame being unlit.
        ambient: variant.unshaded ? "none" : "hemisphere-light",
        background: "black",
        source: fixture.environment.ambientSource,
      },
      family: "godot-culling",
      fixture: {
        hash: fixtureHash,
        objects: fixture.objects,
        sourceCommit: fixture.sourceCommit,
        viewport: CULL_VIEWPORT,
      },
      frameP50Ms: percentile(intervals, 0.5),
      frameP95Ms: percentile(intervals, 0.95),
      frameP99Ms: percentile(intervals, 0.99),
      independentlyUpdatedObjects: harness.independentlyUpdatedObjects,
      lights: {
        directional: harness.lightCount.directional,
        omni: harness.lightCount.omni,
        omniShadowMode: fixture.lights.omniShadowMode,
        requested:
          harness.lightCount.omni + harness.lightCount.spot + harness.lightCount.directional,
        shadowed: variant.lightShadows || variant.directionalShadows,
        spot: harness.lightCount.spot,
      },
      meanMs: (finalCompletionMs - start) / config.frames,
      profile: "smoke",
      projection: harness.projection,
      rawSeries: { boundaries, finalCompletionMs, schemaVersion: 1, unit: "ms" },
      scene: {
        cameraFar: fixture.camera.far,
        cameraFov: fixture.camera.fovDegrees,
        cameraNear: fixture.camera.near,
        cameraPosition: fixture.camera.position,
        objects: fixture.objects,
        primitives: fixture.meshes.length,
      },
      states: STATE_FRAMES.filter((frame) => frame < config.frames).map((frame) => ({
        dynamicTarget: variant.dynamic,
        frameId: frame,
        probes: CULL_PROBE_INDICES.filter(
          (index) =>
            (variant.dynamic === "lights"
              ? fixture.lights.placements.length
              : fixture.placements.length) > index,
        ).map((index) => ({
          index,
          ...cullProbe(fixture, variant, index, frame),
        })),
        timeAccum: cullTimeAccum(frame),
      })),
      stats,
      topology: harness.topology,
      threeRevision: harness.threeRevision,
      unshaded: variant.unshaded,
      variant: variant.godotVariant,
      viewport: CULL_VIEWPORT,
      warmupFrames: config.warmup,
      warmupMs: start - warmupStart,
    };
    for (const png of pngs) {
      const encoded = base64(png.bytes);
      for (let offset = 0; offset < encoded.length; offset += 800)
        console.log(`TNPNG:${png.name}:${offset}:${encoded.slice(offset, offset + 800)}`);
    }
    console.log("ENGINE_LOAD_TEST_PNG_END");
    const payload = JSON.stringify(result);
    console.log("ENGINE_LOAD_TEST_JSON_BEGIN");
    for (let offset = 0; offset < payload.length; offset += 800)
      console.log(`TNJSON:${payload.slice(offset, offset + 800)}`);
    console.log("ENGINE_LOAD_TEST_JSON_END");
  } finally {
    harness.dispose();
  }
}

main().catch((error: unknown) => {
  console.log(
    `ENGINE_LOAD_TEST_FAILED ${String(error)} ${error instanceof Error ? (error.stack ?? "") : ""}`,
  );
});

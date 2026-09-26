import { sha256 } from "./identity.js";

/**
 * PRD-449 `godot-culling`: the counterpart arm's half of the canonical fixture.
 *
 * The upstream `culling.gd` builds its scene from one `randf()` stream — five material colours and
 * then three floats per object — so no second implementation of Godot's PCG generator can be trusted
 * to reproduce it. Instead the Godot arm exports the fixture it actually rendered and both arms read
 * those bytes; the file's own SHA-256 is the fixture identity, and this module is the only reader.
 */

/** Godot runs the workload from one seeded global stream; the TS side never reseeds it. */
export const CULL_RNG_SEED = 0x60d07;
export const CULL_VIEWPORT = { height: 1080, width: 1920 } as const;
export const CULL_FRAME_DELTA = 1 / 60;
export const CULL_UPSTREAM_COMMIT = "b059e38a81230a87293828bbf65ab247b6b2d2a8";

/**
 * Declared before any comparison was run, from precision and not from a speedup: Godot computes the
 * workload transforms in float32 and three.js in float64 before uploading float32, so the two
 * pipelines differ by float32 rounding at placement magnitudes up to 200 m (float32 eps there is
 * ~1.5e-5) plus the accumulated sin/cos error of the same closed form. The origin tolerance is ~65x
 * that epsilon; the quaternion component tolerance covers a rotation built from the same angle in
 * the two precisions. Coverage is a count of lit samples on the 240x135 lattice the two arms share,
 * so one sample is 1/32400 of a frame; the tolerance admits the handful of samples a luma threshold
 * can flip on a shared silhouette edge and refuses a different picture. Mesh and index buffers are
 * not in this table: §6.1 requires them exactly equal, so no tolerance covers a count difference.
 */
export const CULL_TOLERANCE = {
  coveredFractionAbsolute: 0.002,
  originAbsoluteMetres: 1e-3,
  quaternionComponentAbsolute: 1e-4,
} as const;

export type CullingAuthoring = "scene-node-independent" | "clustered-default";

export interface ICullVariant {
  /** What the pinned upstream variant is, verbatim. */
  readonly godotVariant: string;
  /** `none`, the objects moving, or the light instances moving. */
  readonly dynamic: "none" | "lights" | "objects";
  readonly directionalShadows: boolean;
  readonly dynamicRotate: boolean;
  readonly lightShadows: boolean;
  readonly lights: { directional: number; omni: number; spot: number };
  readonly unshaded: boolean;
}

/**
 * The ten pinned variants, read off `culling.gd`'s own branches. Every Godot cell in the draft plan
 * must appear here, and each entry's flags must match the branch the source takes — a variant name
 * alone never decides what an arm renders.
 */
export const CULL_VARIANTS: readonly ICullVariant[] = [
  {
    godotVariant: "basic_cull",
    dynamic: "none",
    directionalShadows: false,
    dynamicRotate: false,
    lightShadows: false,
    lights: { directional: 0, omni: 0, spot: 0 },
    unshaded: true,
  },
  {
    godotVariant: "dynamic_cull",
    dynamic: "objects",
    directionalShadows: false,
    dynamicRotate: false,
    lightShadows: false,
    lights: { directional: 0, omni: 0, spot: 0 },
    unshaded: false,
  },
  {
    godotVariant: "dynamic_rotate_cull",
    dynamic: "objects",
    directionalShadows: false,
    dynamicRotate: true,
    lightShadows: false,
    lights: { directional: 0, omni: 0, spot: 0 },
    unshaded: false,
  },
  {
    godotVariant: "directional_light_cull",
    dynamic: "none",
    directionalShadows: true,
    dynamicRotate: false,
    lightShadows: false,
    lights: { directional: 1, omni: 0, spot: 0 },
    unshaded: false,
  },
  {
    godotVariant: "static_omni_light_cull",
    dynamic: "none",
    directionalShadows: false,
    dynamicRotate: false,
    lightShadows: false,
    lights: { directional: 0, omni: 100, spot: 0 },
    unshaded: false,
  },
  {
    godotVariant: "static_omni_light_cull_with_shadows",
    dynamic: "none",
    directionalShadows: false,
    dynamicRotate: false,
    lightShadows: true,
    lights: { directional: 0, omni: 100, spot: 0 },
    unshaded: false,
  },
  {
    godotVariant: "dynamic_omni_light_cull",
    dynamic: "lights",
    directionalShadows: false,
    dynamicRotate: false,
    lightShadows: false,
    lights: { directional: 0, omni: 100, spot: 0 },
    unshaded: false,
  },
  {
    godotVariant: "dynamic_omni_light_cull_with_shadows",
    dynamic: "lights",
    directionalShadows: false,
    dynamicRotate: false,
    lightShadows: true,
    lights: { directional: 0, omni: 100, spot: 0 },
    unshaded: false,
  },
  {
    godotVariant: "static_spot_light_cull_with_shadows",
    dynamic: "none",
    directionalShadows: false,
    dynamicRotate: false,
    lightShadows: true,
    lights: { directional: 0, omni: 0, spot: 100 },
    unshaded: false,
  },
  {
    godotVariant: "dynamic_spot_light_cull_with_shadows",
    dynamic: "lights",
    directionalShadows: false,
    dynamicRotate: false,
    lightShadows: true,
    lights: { directional: 0, omni: 0, spot: 100 },
    unshaded: false,
  },
] as const;

export function cullVariant(name: string): ICullVariant {
  const found = CULL_VARIANTS.find((entry) => entry.godotVariant === name);
  if (found === undefined) throw new Error(`TN_BENCH_BAD_GODOT_VARIANT:${name}`);
  return found;
}

export interface ICullTopology {
  readonly albedo: readonly number[];
  readonly aabb: { min: readonly number[]; size: readonly number[] };
  readonly indices: number;
  readonly kind: string;
  readonly triangles: number;
  readonly vertices: number;
}

export interface ICullFixture {
  readonly camera: {
    far: number;
    fovDegrees: number;
    lookAt: readonly number[];
    near: number;
    position: readonly number[];
  };
  readonly cullingSha256: string;
  readonly directional: {
    positionX: number | null;
    present: boolean;
    rotation: readonly number[] | null;
    shadow: boolean | null;
  };
  readonly environment: {
    readonly ambientSource: string;
    readonly backgroundMode: string;
    readonly clearColor: string;
    readonly groundBottom: readonly number[];
    readonly groundHorizon: readonly number[];
    readonly skyHorizon: readonly number[];
    readonly skyTop: readonly number[];
  };
  readonly lights: {
    instances: number;
    omni: number;
    omniShadowMode: string | null;
    placements: readonly (readonly number[])[];
    range: number | null;
    spot: number;
  };
  readonly meshes: readonly ICullTopology[];
  readonly objects: number;
  readonly placements: readonly (readonly number[])[];
  readonly rngSeed: number;
  readonly sourceCommit: string;
  readonly viewport: { height: number; width: number };
}

function fail(code: string, detail: string): never {
  throw new Error(`${code}:${detail}`);
}

function object(value: unknown, code: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    fail(code, "expected an object");
  return value as Record<string, unknown>;
}

function number(value: unknown, code: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) fail(code, "expected a finite number");
  return value;
}

function triple(value: unknown, code: string): readonly number[] {
  if (!Array.isArray(value) || value.length !== 3) fail(code, "expected three numbers");
  return value.map((entry) => number(entry, code));
}

/** Fail closed: a fixture the reader does not fully understand is never rendered. */
export function parseCullFixture(text: string): ICullFixture {
  const raw = object(JSON.parse(text) as unknown, "TN_BENCH_CULL_FIXTURE_MALFORMED");
  if (raw.schemaVersion !== 1) fail("TN_BENCH_CULL_FIXTURE_SCHEMA", String(raw.schemaVersion));
  if (raw.sourceCommit !== CULL_UPSTREAM_COMMIT)
    fail("TN_BENCH_CULL_FIXTURE_SOURCE", String(raw.sourceCommit));
  if (raw.objects !== 10000) fail("TN_BENCH_CULL_FIXTURE_OBJECTS", String(raw.objects));
  if (raw.rngSeed !== CULL_RNG_SEED) fail("TN_BENCH_CULL_FIXTURE_SEED", String(raw.rngSeed));
  const viewport = object(raw.viewport, "TN_BENCH_CULL_FIXTURE_MALFORMED");
  if (viewport.width !== CULL_VIEWPORT.width || viewport.height !== CULL_VIEWPORT.height)
    fail("TN_BENCH_CULL_FIXTURE_VIEWPORT", `${String(viewport.width)}x${String(viewport.height)}`);
  if (!Array.isArray(raw.meshes) || raw.meshes.length !== 5)
    fail("TN_BENCH_CULL_FIXTURE_MESHES", String((raw.meshes as unknown[] | undefined)?.length));
  if (!Array.isArray(raw.placements) || raw.placements.length !== raw.objects)
    fail(
      "TN_BENCH_CULL_FIXTURE_PLACEMENTS",
      String((raw.placements as unknown[] | undefined)?.length),
    );
  const meshes: ICullTopology[] = raw.meshes.map((entry) => {
    const mesh = object(entry, "TN_BENCH_CULL_FIXTURE_MESHES");
    const aabb = object(mesh.aabb, "TN_BENCH_CULL_FIXTURE_MESHES");
    return {
      aabb: {
        min: triple(aabb.min, "TN_BENCH_CULL_FIXTURE_MESHES"),
        size: triple(aabb.size, "TN_BENCH_CULL_FIXTURE_MESHES"),
      },
      albedo: triple(mesh.albedo, "TN_BENCH_CULL_FIXTURE_MESHES"),
      indices: number(mesh.indices, "TN_BENCH_CULL_FIXTURE_MESHES"),
      kind: String(mesh.kind),
      triangles: number(mesh.triangles, "TN_BENCH_CULL_FIXTURE_MESHES"),
      vertices: number(mesh.vertices, "TN_BENCH_CULL_FIXTURE_MESHES"),
    };
  });
  const camera = object(raw.camera, "TN_BENCH_CULL_FIXTURE_CAMERA");
  const lights = object(raw.lights, "TN_BENCH_CULL_FIXTURE_LIGHTS");
  const directional = object(raw.directional, "TN_BENCH_CULL_FIXTURE_LIGHTS");
  const environment = object(raw.environment, "TN_BENCH_CULL_FIXTURE_ENVIRONMENT");
  return {
    camera: {
      far: number(camera.far, "TN_BENCH_CULL_FIXTURE_CAMERA"),
      fovDegrees: number(camera.fovDegrees, "TN_BENCH_CULL_FIXTURE_CAMERA"),
      lookAt: triple(camera.lookAt, "TN_BENCH_CULL_FIXTURE_CAMERA"),
      near: number(camera.near, "TN_BENCH_CULL_FIXTURE_CAMERA"),
      position: triple(camera.position, "TN_BENCH_CULL_FIXTURE_CAMERA"),
    },
    cullingSha256: String(raw.cullingSha256),
    directional: {
      positionX:
        directional.positionX === null
          ? null
          : number(directional.positionX, "TN_BENCH_CULL_FIXTURE_LIGHTS"),
      present: directional.present === true,
      rotation: Array.isArray(directional.rotation)
        ? triple(directional.rotation, "TN_BENCH_CULL_FIXTURE_LIGHTS")
        : null,
      shadow: directional.shadow === null ? null : directional.shadow === true,
    },
    environment: {
      ambientSource: String(environment.ambientSource),
      backgroundMode: String(environment.backgroundMode),
      clearColor: String(environment.clearColor),
      groundBottom: triple(environment.groundBottom, "TN_BENCH_CULL_FIXTURE_ENVIRONMENT"),
      groundHorizon: triple(environment.groundHorizon, "TN_BENCH_CULL_FIXTURE_ENVIRONMENT"),
      skyHorizon: triple(environment.skyHorizon, "TN_BENCH_CULL_FIXTURE_ENVIRONMENT"),
      skyTop: triple(environment.skyTop, "TN_BENCH_CULL_FIXTURE_ENVIRONMENT"),
    },
    lights: {
      instances: number(lights.instances, "TN_BENCH_CULL_FIXTURE_LIGHTS"),
      omni: number(lights.omni, "TN_BENCH_CULL_FIXTURE_LIGHTS"),
      omniShadowMode: lights.omniShadowMode === null ? null : String(lights.omniShadowMode),
      placements: Array.isArray(lights.placements)
        ? lights.placements.map((entry) => triple(entry, "TN_BENCH_CULL_FIXTURE_LIGHTS"))
        : [],
      range: lights.range === null ? null : number(lights.range, "TN_BENCH_CULL_FIXTURE_LIGHTS"),
      spot: number(lights.spot, "TN_BENCH_CULL_FIXTURE_LIGHTS"),
    },
    meshes,
    objects: raw.objects,
    placements: raw.placements.map((entry) => triple(entry, "TN_BENCH_CULL_FIXTURE_PLACEMENTS")),
    rngSeed: raw.rngSeed,
    sourceCommit: String(raw.sourceCommit),
    viewport: { height: viewport.height as number, width: viewport.width as number },
  };
}

export async function cullFixtureHash(text: string): Promise<string> {
  return sha256(new TextEncoder().encode(text));
}

/** The workload clock the pinned source advances by `delta * 4.0` per rendered frame. */
export function cullTimeAccum(frame: number): number {
  if (!Number.isInteger(frame) || frame < 0) throw new Error("TN_BENCH_BAD_FRAME_ID");
  return frame * CULL_FRAME_DELTA * 4;
}

/**
 * The clock the pinned source renders frame `frame` at. Its loop advances the clock and *then*
 * renders, so the first frame of an interval is one advance in, not zero — and the counterpart arm
 * has to order its own step the same way or its frame `k` is a different workload state and the
 * per-frame transform oracle rejects a pair that is in fact running the same frames.
 */
export function cullRenderedTimeAccum(frame: number): number {
  return cullTimeAccum(frame + 1);
}

export interface ICullTransform {
  readonly axisX: readonly number[];
  readonly origin: readonly number[];
}

/**
 * The pinned source's closed form, in the counterpart's precision: `sin(time)` displaces along
 * `Vector3(sin(angle), cos(angle), 0)` by `2 * sin(time)`, or rotates the authored transform about
 * local `X` by `angle * sin(time) * 2`. `total` is the dynamic set's size, which is 10,000 for the
 * object variants and 100 for the light ones.
 */
export function cullTransform(
  base: readonly number[],
  index: number,
  total: number,
  timeAccum: number,
  rotate: boolean,
): ICullTransform {
  if (total < 1) throw new Error("TN_BENCH_BAD_DYNAMIC_TOTAL");
  const angle = (index * Math.PI * 2) / total;
  if (rotate) {
    const half = (angle * Math.sin(timeAccum) * 2) / 2;
    return {
      axisX: [Math.cos(half), 0, Math.sin(half)],
      origin: [base[0] as number, base[1] as number, base[2] as number],
    };
  }
  const scale = Math.sin(timeAccum) * 2;
  return {
    axisX: [1, 0, 0],
    origin: [
      (base[0] as number) + Math.sin(angle) * scale,
      (base[1] as number) + Math.cos(angle) * scale,
      base[2] as number,
    ],
  };
}

/** The three indices both arms sample, so neither picks a different witness. */
export const CULL_PROBE_INDICES = [0, 4999, 9999] as const;

/**
 * The transform the pinned workload puts on one sampled index at `frame`'s clock value. The dynamic
 * set is the objects for the object variants and the light instances for the light ones, so those
 * are what move; a static variant moves neither, and its objects are reported as authored. A light
 * variant has a hundred instances, so an index past that set is not sampled rather than invented.
 */
export function cullProbe(
  fixture: ICullFixture,
  variant: ICullVariant,
  index: number,
  frame: number,
): ICullTransform {
  const bases = variant.dynamic === "lights" ? fixture.lights.placements : fixture.placements;
  const base = bases[index];
  if (base === undefined) throw new Error(`TN_BENCH_CULL_PROBE_MISSING:${index}`);
  if (variant.dynamic === "none") return { axisX: [1, 0, 0], origin: base };
  return cullTransform(
    base,
    index,
    bases.length,
    cullRenderedTimeAccum(frame),
    variant.dynamicRotate,
  );
}

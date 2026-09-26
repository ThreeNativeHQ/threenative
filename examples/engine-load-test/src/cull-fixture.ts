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
/** Bumped when the fixture stops carrying the rendered buffers: a v1 file has counts, not geometry. */
export const CULL_FIXTURE_SCHEMA = 2;
/** The canonical mesh-buffer byte layout both arms hash; see `cullMeshBufferBytes`. */
export const CULL_MESH_BUFFER_VERSION = "threenative-cull-mesh-buffer/1";

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

/**
 * One rendered primitive's channels, exactly as the pinned scene's `PrimitiveMesh.get_mesh_arrays()`
 * produced them: base64 of the raw little-endian buffers, so the fixture carries the bytes themselves
 * rather than a decimal approximation of them. `PackedVector3Array`/`PackedVector2Array` are three and
 * two IEEE-754 binary32 components and `PackedInt32Array` is two's-complement 32-bit, so a decoded
 * channel is exactly `count * stride` bytes and the reader checks that rather than assuming it.
 */
export interface ICullMeshBuffers {
  readonly indices: string;
  readonly normals: string;
  readonly positions: string;
  readonly uvs: string;
}

export interface ICullTopology {
  readonly albedo: readonly number[];
  readonly aabb: { min: readonly number[]; size: readonly number[] };
  /** SHA-256 over `cullMeshBufferBytes`, which is the whole per-mesh buffer identity §6.1 asks for. */
  readonly bufferSha256: string;
  readonly buffers: ICullMeshBuffers;
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

function digest(value: unknown, code: string): string {
  if (typeof value !== "string" || !/^[0-9a-f]{64}$/.test(value)) fail(code, "SHA-256 digest");
  return value;
}

const BASE64_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/** The native JS host has no `atob`, and one decoder beats a browser check the host never takes. */
export function base64ToBytes(text: string, code: string): Uint8Array {
  const padded = text.replace(/=+$/, "");
  if (padded.length % 4 === 1) fail(code, "not base64");
  const out = new Uint8Array(Math.floor((padded.length * 3) / 4));
  let written = 0;
  let accumulator = 0;
  let bits = 0;
  for (const character of padded) {
    const value = BASE64_ALPHABET.indexOf(character);
    if (value < 0) fail(code, "not base64");
    accumulator = (accumulator << 6) | value;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[written] = (accumulator >> bits) & 0xff;
      written += 1;
    }
  }
  return out.subarray(0, written);
}

/**
 * The canonical byte stream a mesh's identity is a SHA-256 over: the version line, the primitive's
 * class name, the vertex and index counts as two little-endian `u32`, then positions, normals, UVs
 * and indices in that order. `benchmark/godot-prd449/culling_arm.gd` lays down the same bytes from
 * the pinned scene's own packed arrays, and the counterpart arm re-derives them from the arrays it
 * actually uploaded — so the digest covers what was rendered rather than what a name implies.
 */
export function cullMeshBufferBytes(
  mesh: Pick<ICullMeshSource, "indices" | "kind" | "vertices">,
  channels: ICullMeshChannels,
): Uint8Array {
  const header = new TextEncoder().encode(`${CULL_MESH_BUFFER_VERSION}\n${mesh.kind}\n`);
  // Derived from the arrays actually written below, so the allocation cannot drift from the loop.
  const total =
    header.length +
    8 +
    channels.positions.byteLength +
    channels.normals.byteLength +
    channels.uvs.byteLength +
    channels.indices.byteLength;
  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);
  out.set(header, 0);
  let offset = header.length;
  view.setUint32(offset, mesh.vertices, true);
  offset += 4;
  view.setUint32(offset, mesh.indices, true);
  offset += 4;
  for (const floats of [channels.positions, channels.normals, channels.uvs]) {
    for (const value of floats) {
      view.setFloat32(offset, value, true);
      offset += 4;
    }
  }
  for (const index of channels.indices) {
    view.setUint32(offset, index, true);
    offset += 4;
  }
  return out;
}

/** One primitive's four channels as typed arrays, decoded once and checked against its own counts. */
export interface ICullMeshChannels {
  readonly indices: Uint32Array;
  readonly normals: Float32Array;
  readonly positions: Float32Array;
  readonly uvs: Float32Array;
}

/** The fields a channel decode needs. `godot-lights-meshes` carries the same four channels, so the
 *  decoder and the digest are shared rather than forked per family. */
export type ICullMeshSource = Pick<ICullTopology, "buffers" | "indices" | "kind" | "vertices">;

/**
 * Decode and check. The declared counts and the decoded channel lengths are two independent
 * statements about the same buffers, and an index outside the vertex array is a buffer that would
 * read memory the mesh does not own — so both fail here, at the reader, rather than at the draw.
 */
export function cullMeshChannels(mesh: ICullMeshSource): ICullMeshChannels {
  const code = "TN_BENCH_CULL_FIXTURE_BUFFERS";
  // Bytes per element: three binary32, three binary32, two binary32, one two's-complement int32.
  const channel = (name: keyof ICullMeshBuffers, elements: number, stride: number): Uint8Array => {
    const bytes = base64ToBytes(mesh.buffers[name], code);
    if (bytes.length !== elements * stride)
      fail(code, `${mesh.kind} ${name} ${bytes.length} bytes, expected ${elements * stride}`);
    return bytes;
  };
  const positions = channel("positions", mesh.vertices, 12);
  const normals = channel("normals", mesh.vertices, 12);
  const uvs = channel("uvs", mesh.vertices, 8);
  const indices = channel("indices", mesh.indices, 4);
  const decoded: ICullMeshChannels = {
    indices: new Uint32Array(indices.buffer, indices.byteOffset, mesh.indices),
    normals: new Float32Array(normals.buffer, normals.byteOffset, mesh.vertices * 3),
    positions: new Float32Array(positions.buffer, positions.byteOffset, mesh.vertices * 3),
    uvs: new Float32Array(uvs.buffer, uvs.byteOffset, mesh.vertices * 2),
  };
  for (const index of decoded.indices)
    if (index >= mesh.vertices)
      fail(code, `${mesh.kind} index ${index} is past ${mesh.vertices} vertices`);
  return decoded;
}

/** Fail closed: a fixture the reader does not fully understand is never rendered. */
export function parseCullFixture(text: string): ICullFixture {
  const raw = object(JSON.parse(text) as unknown, "TN_BENCH_CULL_FIXTURE_MALFORMED");
  if (raw.schemaVersion !== CULL_FIXTURE_SCHEMA)
    fail("TN_BENCH_CULL_FIXTURE_SCHEMA", String(raw.schemaVersion));
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
    const buffers = object(mesh.buffers, "TN_BENCH_CULL_FIXTURE_BUFFERS") as unknown as Record<
      keyof ICullMeshBuffers,
      unknown
    >;
    const topology: ICullTopology = {
      aabb: {
        min: triple(aabb.min, "TN_BENCH_CULL_FIXTURE_MESHES"),
        size: triple(aabb.size, "TN_BENCH_CULL_FIXTURE_MESHES"),
      },
      albedo: triple(mesh.albedo, "TN_BENCH_CULL_FIXTURE_MESHES"),
      bufferSha256: digest(mesh.bufferSha256, "TN_BENCH_CULL_FIXTURE_BUFFERS"),
      buffers: {
        indices: String(buffers.indices),
        normals: String(buffers.normals),
        positions: String(buffers.positions),
        uvs: String(buffers.uvs),
      },
      indices: number(mesh.indices, "TN_BENCH_CULL_FIXTURE_MESHES"),
      kind: String(mesh.kind),
      triangles: number(mesh.triangles, "TN_BENCH_CULL_FIXTURE_MESHES"),
      vertices: number(mesh.vertices, "TN_BENCH_CULL_FIXTURE_MESHES"),
    };
    // Decoding here is the fixture's own self-check: an undecodable, wrongly sized or out-of-range
    // buffer never reaches the scene builder, which is the only other reader of these bytes.
    cullMeshChannels(topology);
    return topology;
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

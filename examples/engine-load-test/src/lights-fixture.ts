import { cullMeshBufferBytes, cullMeshChannels } from "./cull-fixture.js";
import { sha256 } from "./identity.js";

/**
 * PRD-449 `godot-lights-meshes`: the counterpart arm's half of the canonical fixture, plus the
 * workload oracle.
 *
 * The pinned `lights_and_meshes.gd` builds its scene from one seeded global stream — 100 mesh-cell
 * placements, then nine light-cell placements, then each `Lighter`'s opening `accum` — so no second
 * implementation of Godot's PCG generator can be trusted to reproduce it. The Godot arm therefore
 * exports the fixture it actually rendered, both arms read those bytes, and the file's own SHA-256
 * is the fixture identity. The mesh-buffer layout is the one `threenative-cull-mesh-buffer/1` already
 * versions, so the decoder and the digest are shared with the culling family rather than forked.
 *
 * The cell this slice measures is `box-100-omni-10-slow`: the composition of the pinned source's own
 * named axes. It is not one of the thirteen `benchmark_*` functions — `benchmark_box_100` keeps the
 * default spot light — so the arm calls upstream's `create_scene` with those settings instead of
 * naming a function it is not.
 */

/** The one cell this slice covers. Every other upstream named variant stays open. */
export const LIGHTS_CELL = "box-100-omni-10-slow";
export const LIGHTS_VIEWPORT = { height: 1080, width: 1920 } as const;
export const LIGHTS_FIXTURE_SCHEMA = 1;
export const LIGHTS_UPSTREAM_COMMIT = "b059e38a81230a87293828bbf65ab247b6b2d2a8";
/** The pinned Manager's `RANDOM_SEED`, the whole fixture's one RNG draw. */
export const LIGHTS_RNG_SEED = 0x60d07;
/** `create_scattered(count)` makes `round(sqrt(count))^2`, so these are the requests, not the counts. */
export const LIGHTS_REQUESTED_OBJECTS = 100;
export const LIGHTS_REQUESTED_LIGHTS = 10;
export const LIGHTS_ACTUAL_OBJECTS = 100;
export const LIGHTS_ACTUAL_LIGHTS = 9;

/** The indices both arms sample, so neither picks a different witness. */
export const LIGHTS_MESH_PROBES = [0, 49, 99] as const;
export const LIGHTS_LIGHT_PROBES = [0, 4, 8] as const;

/**
 * Declared before any comparison was run, from precision and not from a speedup.
 *
 * - Origins: the counterpart computes the world transform in float64 from the same cell positions the
 *   pinned scene used, and the pinned scene's own `Node3D` transform is float32. At this cell's
 *   placement magnitudes — cells within +/-1 m — float32 eps is ~1.2e-7, and the composition adds a
 *   handful of roundings, so 1e-4 m is about three orders of magnitude of headroom on a term the
 *   whole comparison turns on.
 * - Rotations: `Rotater.rotate_y(delta * speed)` accumulates a quaternion in float32. Over the 600
 *   scored frames of the smoke profile that is 600 roundings at ~1.2e-7 rad, worst case 7.2e-5 rad;
 *   1e-3 rad is a 14x margin on that bound.
 * - Energy: `Lighter.accum` is a GDScript `float`, which is binary64, and the counterpart sums the
 *   same `delta * speed * 2.0` in the same order, so the two agree to within a `sin` ULP or two.
 *   1e-6 is a wide band around that and still far below any energy the frame can show.
 * - Coverage: both arms render byte-identical geometry through the exported camera basis, so the
 *   silhouette can differ only by rasterizer fill-rule and depth-precision edge effects. One sample
 *   of the shared 240x135 lattice is 1/32400 of a frame, and 0.01 admits ~324 samples of edge
 *   disagreement — the kind of bound an identical-geometry, identical-camera pair can justify from
 *   first principles. It is not lowered if a pair fails it.
 */
export const LIGHTS_TOLERANCE = {
  accumAbsolute: 1e-6,
  coveredFractionAbsolute: 0.01,
  energyAbsolute: 1e-6,
  originAbsoluteMetres: 1e-4,
  rotationAbsoluteRadians: 1e-3,
} as const;

/** A light toggle is a crossing of `sin(accum) * energyScale`, so it happens every pi/2 of accum. */
export const LIGHTS_TOGGLE_ARC_RADIANS = Math.PI / 2;

export interface ILightsCellTransform {
  readonly position: readonly number[];
  readonly scale: readonly number[];
}

export interface ILightsMesh {
  readonly aabb: { min: readonly number[]; size: readonly number[] };
  readonly bufferSha256: string;
  readonly buffers: { indices: string; normals: string; positions: string; uvs: string };
  readonly indices: number;
  readonly kind: string;
  readonly triangles: number;
  readonly vertices: number;
}

export interface ILightsFixture {
  readonly camera: {
    readonly basisX: readonly number[];
    readonly basisY: readonly number[];
    readonly basisZ: readonly number[];
    readonly far: number;
    readonly fovDegrees: number;
    readonly near: number;
    readonly position: readonly number[];
  };
  readonly cell: string;
  readonly environment: {
    readonly ambientColor: readonly number[];
    readonly ambientEnergy: number;
    readonly ambientSource: string;
    readonly backgroundColor: readonly number[];
    readonly backgroundMode: string;
  };
  readonly lightGrid: {
    readonly accumSeeds: readonly number[];
    readonly cells: readonly ILightsCellTransform[];
    readonly rotaterSpeed: number;
  };
  readonly lights: {
    readonly actual: number;
    readonly attenuation: number;
    readonly color: readonly number[];
    readonly kind: string;
    readonly localPosition: readonly number[];
    readonly openingEnergy: number;
    readonly range: number;
    readonly requested: number;
    readonly shadowEnabled: boolean;
  };
  readonly meshGrid: {
    readonly cells: readonly ILightsCellTransform[];
    readonly rotaterSpeed: number;
  };
  readonly meshModel: { readonly position: readonly number[]; readonly scale: readonly number[] };
  readonly meshes: readonly ILightsMesh[];
  readonly rngSeed: number;
  readonly schedule: {
    readonly advanceOrder: string;
    readonly energyScale: number;
    readonly frameDelta: number;
    readonly lightSpeed: number;
  };
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

function integer(value: unknown, code: string): number {
  const read = number(value, code);
  if (!Number.isInteger(read) || read < 0) fail(code, "expected a non-negative integer");
  return read;
}

function triple(value: unknown, code: string): readonly number[] {
  if (!Array.isArray(value) || value.length !== 3) fail(code, "expected three numbers");
  return value.map((entry) => number(entry, code));
}

function digest(value: unknown, code: string): string {
  if (typeof value !== "string" || !/^[0-9a-f]{64}$/.test(value)) fail(code, "SHA-256 digest");
  return value;
}

function cells(value: unknown, code: string): ILightsCellTransform[] {
  if (!Array.isArray(value) || value.length === 0) fail(code, "expected a non-empty cell list");
  return value.map((entry) => {
    const cell = object(entry, code);
    return { position: triple(cell.position, code), scale: triple(cell.scale, code) };
  });
}

/** Fail closed: a fixture the reader does not fully understand is never rendered. */
export function parseLightsFixture(text: string): ILightsFixture {
  const code = "TN_BENCH_LIGHTS_FIXTURE";
  const raw = object(JSON.parse(text) as unknown, `${code}_MALFORMED`);
  if (raw.schemaVersion !== LIGHTS_FIXTURE_SCHEMA)
    fail(`${code}_SCHEMA`, String(raw.schemaVersion));
  if (raw.sourceCommit !== LIGHTS_UPSTREAM_COMMIT) fail(`${code}_SOURCE`, String(raw.sourceCommit));
  if (raw.cell !== LIGHTS_CELL) fail(`${code}_CELL`, String(raw.cell));
  if (raw.rngSeed !== LIGHTS_RNG_SEED) fail(`${code}_SEED`, String(raw.rngSeed));
  const viewport = object(raw.viewport, code);
  if (viewport.width !== LIGHTS_VIEWPORT.width || viewport.height !== LIGHTS_VIEWPORT.height)
    fail(`${code}_VIEWPORT`, `${String(viewport.width)}x${String(viewport.height)}`);
  if (!Array.isArray(raw.meshes) || raw.meshes.length !== 1)
    fail(`${code}_MESHES`, String((raw.meshes as unknown[] | undefined)?.length));
  const meshes: ILightsMesh[] = raw.meshes.map((entry) => {
    const mesh = object(entry, code);
    const aabb = object(mesh.aabb, code);
    const buffers = object(mesh.buffers, `${code}_BUFFERS`) as unknown as Record<string, unknown>;
    const read: ILightsMesh = {
      aabb: { min: triple(aabb.min, code), size: triple(aabb.size, code) },
      bufferSha256: digest(mesh.bufferSha256, `${code}_BUFFERS`),
      buffers: {
        indices: String(buffers.indices),
        normals: String(buffers.normals),
        positions: String(buffers.positions),
        uvs: String(buffers.uvs),
      },
      indices: integer(mesh.indices, code),
      kind: String(mesh.kind),
      triangles: integer(mesh.triangles, code),
      vertices: integer(mesh.vertices, code),
    };
    // Decoding here is the fixture's own self-check: an undecodable, wrongly sized or out-of-range
    // buffer never reaches the scene builder, which is the only other reader of these bytes.
    lightsMeshChannels(read);
    return read;
  });
  const camera = object(raw.camera, `${code}_CAMERA`);
  const meshGrid = object(raw.meshGrid, `${code}_GRID`);
  const lightGrid = object(raw.lightGrid, `${code}_GRID`);
  const meshModel = object(raw.meshModel, `${code}_GRID`);
  const lights = object(raw.lights, `${code}_LIGHTS`);
  const environment = object(raw.environment, `${code}_ENVIRONMENT`);
  const schedule = object(raw.schedule, `${code}_SCHEDULE`);
  const lightCells = cells(lightGrid.cells, `${code}_GRID`);
  if (!Array.isArray(lightGrid.accumSeeds) || lightGrid.accumSeeds.length !== lightCells.length)
    fail(`${code}_ACCUM_SEEDS`, String((lightGrid.accumSeeds as unknown[] | undefined)?.length));
  const fixture: ILightsFixture = {
    camera: {
      basisX: triple(camera.basisX, `${code}_CAMERA`),
      basisY: triple(camera.basisY, `${code}_CAMERA`),
      basisZ: triple(camera.basisZ, `${code}_CAMERA`),
      far: number(camera.far, `${code}_CAMERA`),
      fovDegrees: number(camera.fovDegrees, `${code}_CAMERA`),
      near: number(camera.near, `${code}_CAMERA`),
      position: triple(camera.position, `${code}_CAMERA`),
    },
    cell: String(raw.cell),
    environment: {
      ambientColor: triple(environment.ambientColor, `${code}_ENVIRONMENT`),
      ambientEnergy: number(environment.ambientEnergy, `${code}_ENVIRONMENT`),
      ambientSource: String(environment.ambientSource),
      backgroundColor: triple(environment.backgroundColor, `${code}_ENVIRONMENT`),
      backgroundMode: String(environment.backgroundMode),
    },
    lightGrid: {
      accumSeeds: (lightGrid.accumSeeds as unknown[]).map((entry) => number(entry, `${code}_GRID`)),
      cells: lightCells,
      rotaterSpeed: number(lightGrid.rotaterSpeed, `${code}_GRID`),
    },
    lights: {
      actual: integer(lights.actual, `${code}_LIGHTS`),
      attenuation: number(lights.attenuation, `${code}_LIGHTS`),
      color: triple(lights.color, `${code}_LIGHTS`),
      kind: String(lights.kind),
      localPosition: triple(lights.localPosition, `${code}_LIGHTS`),
      openingEnergy: number(lights.openingEnergy, `${code}_LIGHTS`),
      range: number(lights.range, `${code}_LIGHTS`),
      requested: integer(lights.requested, `${code}_LIGHTS`),
      shadowEnabled: lights.shadowEnabled === true,
    },
    meshGrid: {
      cells: cells(meshGrid.cells, `${code}_GRID`),
      rotaterSpeed: number(meshGrid.rotaterSpeed, `${code}_GRID`),
    },
    meshModel: {
      position: triple(meshModel.position, `${code}_GRID`),
      scale: triple(meshModel.scale, `${code}_GRID`),
    },
    meshes,
    rngSeed: raw.rngSeed as number,
    schedule: {
      advanceOrder: String(schedule.advanceOrder),
      energyScale: number(schedule.energyScale, `${code}_SCHEDULE`),
      frameDelta: number(schedule.frameDelta, `${code}_SCHEDULE`),
      lightSpeed: number(schedule.lightSpeed, `${code}_SCHEDULE`),
    },
    sourceCommit: String(raw.sourceCommit),
    viewport: { height: viewport.height as number, width: viewport.width as number },
  };
  // §5.1: record requested and actual counts, and require this cell's actual ones. A reader that
  // accepted a fixture with a different census would build a different scene under the same name.
  if (fixture.meshGrid.cells.length !== LIGHTS_ACTUAL_OBJECTS)
    fail(`${code}_OBJECTS`, String(fixture.meshGrid.cells.length));
  if (fixture.lights.actual !== LIGHTS_ACTUAL_LIGHTS)
    fail(`${code}_LIGHTS`, String(fixture.lights.actual));
  if (fixture.lights.requested !== LIGHTS_REQUESTED_LIGHTS)
    fail(`${code}_LIGHTS_REQUESTED`, String(fixture.lights.requested));
  if (fixture.lights.kind !== "omni") fail(`${code}_LIGHT_KIND`, fixture.lights.kind);
  if (fixture.environment.backgroundMode !== "color")
    fail(`${code}_BACKGROUND_MODE`, fixture.environment.backgroundMode);
  if (fixture.schedule.advanceOrder !== "advance-then-render")
    fail(`${code}_ADVANCE_ORDER`, fixture.schedule.advanceOrder);
  // The two grids must turn opposite ways, or the cell is not the one the name says.
  if (fixture.meshGrid.rotaterSpeed * fixture.lightGrid.rotaterSpeed >= 0)
    fail(
      `${code}_ROTATION_SENSE`,
      `${fixture.meshGrid.rotaterSpeed}/${fixture.lightGrid.rotaterSpeed}`,
    );
  return fixture;
}

export async function lightsFixtureHash(text: string): Promise<string> {
  return sha256(new TextEncoder().encode(text));
}

/** The pinned primitive's four channels, decoded once and checked against its own counts. */
export function lightsMeshChannels(mesh: ILightsMesh): ReturnType<typeof cullMeshChannels> {
  return cullMeshChannels({
    buffers: mesh.buffers,
    indices: mesh.indices,
    kind: mesh.kind,
    vertices: mesh.vertices,
  });
}

/** The digest the counterpart re-derives from the arrays it actually uploaded. */
export function lightsMeshBufferBytes(
  mesh: Pick<ILightsMesh, "indices" | "kind" | "vertices">,
  channels: Parameters<typeof cullMeshBufferBytes>[1],
): Uint8Array {
  return cullMeshBufferBytes(mesh, channels);
}

/**
 * The clock this arm renders frame `frame` at. The pinned `_process(delta)` methods take their
 * advance as an argument and hold no clock, and the arm advances before it renders, so the first
 * frame of an interval is one advance in rather than zero — the same ordering the culling family
 * already pins, and the counterpart has to match it or its frame `k` is a different workload state.
 */
export function lightsElapsedFrames(frame: number): number {
  if (!Number.isInteger(frame) || frame < 0) throw new Error("TN_BENCH_BAD_FRAME_ID");
  return frame + 1;
}

/** The two grid rotations at this frame: the pinned `Rotater` adds `delta * speed` per advance. */
export function lightsRotations(
  fixture: ILightsFixture,
  frame: number,
): { lightRotationY: number; meshRotationY: number } {
  const advances = lightsElapsedFrames(frame);
  return {
    lightRotationY: fixture.lightGrid.rotaterSpeed * advances * fixture.schedule.frameDelta,
    meshRotationY: fixture.meshGrid.rotaterSpeed * advances * fixture.schedule.frameDelta,
  };
}

/** The pinned `Lighter.accum` for one light at this frame, from its exported opening draw. */
export function lightsAccum(fixture: ILightsFixture, index: number, frame: number): number {
  const seed = fixture.lightGrid.accumSeeds[index];
  if (seed === undefined) throw new Error(`TN_BENCH_LIGHTS_PROBE_MISSING:${index}`);
  return (
    seed +
    lightsElapsedFrames(frame) * fixture.schedule.frameDelta * fixture.schedule.lightSpeed * 2
  );
}

/** The energy and visibility the pinned `Lighter` sets from that `accum`. */
export function lightsEnergy(
  fixture: ILightsFixture,
  index: number,
  frame: number,
): {
  energy: number;
  visible: boolean;
} {
  const energy = Math.sin(lightsAccum(fixture, index, frame)) * fixture.schedule.energyScale;
  return { energy, visible: energy > 0 };
}

/**
 * The world origin of one rendered node at this frame, derived once from the pinned hierarchy rather
 * than patched together:
 *
 * ```text
 * rotater (rotate_y)  ->  grid (identity)  ->  cell (position, 2/s x/z scale)  ->  node (offset)
 * ```
 *
 * so `world = R(theta) * (cellPosition + cellScale * nodeOffset)`. Two things are easy to get wrong
 * and both were wrong in a first draft that the arm's own oracle check caught: the cell's *position*
 * is not scaled (it is a translation, and the `2/s` scale applies to the offset under it), and the
 * rotater sits *above* the grid, so it turns the cell position as well as the offset. The node's own
 * scale does not appear: it scales its vertices, not its origin.
 */
export function lightsCellWorld(
  fixture: ILightsFixture,
  grid: "light" | "mesh",
  index: number,
  frame: number,
): readonly [number, number, number] {
  const cells = grid === "mesh" ? fixture.meshGrid.cells : fixture.lightGrid.cells;
  const cell = cells[index];
  if (cell === undefined) throw new Error(`TN_BENCH_LIGHTS_PROBE_MISSING:${grid}-${index}`);
  const rotation =
    (grid === "mesh" ? fixture.meshGrid : fixture.lightGrid).rotaterSpeed *
    lightsElapsedFrames(frame) *
    fixture.schedule.frameDelta;
  const offset =
    grid === "mesh"
      ? [
          fixture.meshModel.position[0] as number,
          fixture.meshModel.position[1] as number,
          fixture.meshModel.position[2] as number,
        ]
      : fixture.lights.localPosition;
  const local = [
    (cell.position[0] as number) + (offset[0] as number) * (cell.scale[0] as number),
    (cell.position[1] as number) + (offset[1] as number) * (cell.scale[1] as number),
    (cell.position[2] as number) + (offset[2] as number) * (cell.scale[2] as number),
  ];
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);
  return [
    (local[0] as number) * cos + (local[2] as number) * sin,
    local[1] as number,
    (local[2] as number) * cos - (local[0] as number) * sin,
  ];
}

/**
 * The world `X` axis of one rendered node at this frame: the rotater's own `X` column times the
 * cell's x scale times the node's own x scale. Both arms sample this column because it is a single
 * term, so a scale or a rotation sense cannot hide in a cancellation.
 */
export function lightsCellAxisX(
  fixture: ILightsFixture,
  grid: "light" | "mesh",
  index: number,
  frame: number,
): readonly [number, number, number] {
  const cells = grid === "mesh" ? fixture.meshGrid.cells : fixture.lightGrid.cells;
  if (cells[index] === undefined) throw new Error(`TN_BENCH_LIGHTS_PROBE_MISSING:${grid}-${index}`);
  const rotation =
    (grid === "mesh" ? fixture.meshGrid : fixture.lightGrid).rotaterSpeed *
    lightsElapsedFrames(frame) *
    fixture.schedule.frameDelta;
  const cellScale = (cells[index] as ILightsCellTransform).scale[0] as number;
  const nodeScale = (grid === "mesh" ? fixture.meshModel.scale[0] : 1) as number;
  const scale = cellScale * nodeScale;
  return [Math.cos(rotation) * scale, 0, -Math.sin(rotation) * scale];
}

/** The base64 alphabet, exported so the native entry can re-encode captures the same way. */
export const LIGHTS_BASE64_ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/** The native host has no `btoa`; one encoder beats a browser path the host never takes. */
export function lightsBase64(bytes: Uint8Array): string {
  const alphabet = LIGHTS_BASE64_ALPHABET;
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

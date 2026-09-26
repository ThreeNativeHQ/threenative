import {
  Box3,
  Frustum,
  Matrix4,
  Sphere,
  Quaternion as ThreeQuaternion,
  Vector3,
} from "three/webgpu";
import { sha256 } from "./identity.js";

/**
 * PRD-449 `bevy-many-cubes`: the counterpart arm's half of the canonical fixture, and the oracle
 * both arms are checked against.
 *
 * The fixture is exported by the pinned Bevy arm
 * ([`cubes_arm.rs`](../../../../benchmark/bevy-prd449/cubes_arm.rs)) from the scene it actually
 * built — its Fibonacci sphere placement, its seeded `ChaCha8Rng(42)` mesh and material choice, its
 * enclosing box, its camera and its light. This module is the only reader, so the two arms hash the
 * same bytes instead of two implementations agreeing about Bevy's RNG.
 *
 * Nothing here computes what a frame should look like from a name: the geometry is the exported
 * vertex and index buffers, the transforms are the exported doubles, and the state a frame must
 * reach is derived from the exported schedule by `cubesObjectRotation`/`cubesCameraRotation`, which
 * is the oracle both arms are compared against and not a description of either of them.
 */

/** The pinned upstream commit the exporting arm was built from; a fixture naming another is refused. */
export const CUBES_UPSTREAM_COMMIT = "c6f634ca9f406d68ba5109d921247b654cb42c10";
/** The canonical mesh-buffer byte layout both arms hash; see `cubesMeshBufferBytes`. */
export const CUBES_MESH_BUFFER_VERSION = "threenative-cubes-mesh-buffer/1";
export const CUBES_FIXTURE_SCHEMA = 1;
export const CUBES_FAMILY = "bevy-many-cubes";
export const CUBES_FRAME_DELTA = 1 / 60;

/**
 * Conformance tolerances, preregistered here rather than tuned after a speedup appeared. Both arms
 * carry f32 transforms; the oracle is computed in f64, so the residual is f32 rounding accumulated
 * over the fixture clock's steps. 1e-4 on a unit quaternion is roughly f32 epsilon (1.2e-7) grown by
 * the 600-step composition, with two orders of magnitude of headroom over that estimate.
 */
export const CUBES_TOLERANCE = {
  /** Absolute per-component agreement for a reported quaternion, against the f64 oracle. */
  quaternionAbs: 1e-4,
  /** Absolute agreement for a translation, in world units, where the sphere is 500 across. */
  translationAbs: 1e-3,
};

export interface ICubesMesh {
  readonly indexCount: number;
  readonly indices: string;
  readonly normals: string;
  readonly positions: string;
  readonly triangles: number;
  readonly uvs: string;
  readonly vertices: number;
}

export interface ICubesMaterial {
  readonly baseColor: readonly number[];
  readonly metallic: number;
  readonly perceptualRoughness: number;
}

export interface ICubesObject {
  readonly geometryAsset: string;
  readonly geometryId: number;
  readonly materialAsset: string;
  readonly materialId: number;
  readonly rotation: readonly number[];
  readonly scale: readonly number[];
  readonly translation: readonly number[];
}

export interface ICubesFrameSchedule {
  readonly cameraStepPerFrame: number;
  readonly frameDelta: number;
  /**
   * How many fixture-clock steps had run before measured frame 0, declared by the exporting arm, and
   * the two derived counts the two upstream systems actually apply. `move_camera` under `--benchmark`
   * multiplies a constant `1/60`, so it steps once per clock step; `rotate_cubes` reads `Res<Time>`,
   * and Bevy's first `Time` update records `first_update` without advancing the clock, so that frame's
   * delta is zero and its `rotate_y(10 * 0)` changes nothing — one step fewer. Reading one number for
   * both is what makes a rotating arm fail conformance for a reason that is not a scene difference.
   */
  readonly firstScoredFrameClockSteps: number;
  readonly firstScoredFrameConstantSteps: number;
  readonly firstScoredFrameTimeDeltas: number;
  readonly measuredFrames: number;
  readonly rotationPerFrame: number;
  readonly rotateCubes: boolean;
  readonly warmupFrames: number;
}

export interface ICubesFixture {
  readonly camera: {
    readonly far: number;
    readonly fovDegrees: number;
    readonly near: number;
    readonly position: readonly number[];
    readonly rotation: readonly number[];
  };
  readonly counts: {
    readonly cubes: number;
    readonly directionalLights: number;
    readonly enclosing: number;
    readonly requestedInstances: number;
  };
  readonly enclosing: readonly ICubesObject[];
  readonly environment: { readonly background: string; readonly shadowMapsEnabled: boolean };
  readonly family: string;
  readonly frameSchedule: ICubesFrameSchedule;
  readonly light: { readonly rotation: readonly number[]; readonly shadowMapsEnabled: boolean };
  readonly materials: readonly ICubesMaterial[];
  readonly meshes: readonly ICubesMesh[];
  readonly objects: readonly ICubesObject[];
  readonly probeIndices: readonly number[];
  readonly schedule: string;
  readonly schemaVersion: number;
  readonly source: {
    readonly adapterSha256: string;
    readonly commit: string;
    readonly patch: readonly string[];
    readonly path: string;
    readonly upstreamSha256: string;
  };
  readonly variant: "rotating" | "static";
  readonly viewport: {
    readonly deviation: string | null;
    readonly height: number;
    readonly requestedHeight: number;
    readonly requestedWidth: number;
    readonly scaleFactor: number;
    readonly width: number;
  };
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

function count(value: unknown, code: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0)
    fail(code, "expected a non-negative integer");
  return value;
}

function triple(value: unknown, code: string): readonly number[] {
  if (!Array.isArray(value) || value.length !== 3) fail(code, "expected three numbers");
  return value.map((entry) => number(entry, code));
}

function quat(value: unknown, code: string): readonly number[] {
  if (!Array.isArray(value) || value.length !== 4) fail(code, "expected four numbers");
  return value.map((entry) => number(entry, code));
}

function digest(value: unknown, code: string): string {
  if (typeof value !== "string" || !/^[0-9a-f]{64}$/.test(value)) fail(code, "expected a SHA-256");
  return value;
}

function base64ToBytes(text: string, code: string): Uint8Array {
  if (typeof text !== "string") fail(code, "expected base64 text");
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  const padded = text.replace(/=+$/, "");
  if (padded.length % 4 === 1) fail(code, "not base64");
  const out = new Uint8Array(Math.floor((padded.length * 3) / 4));
  let written = 0;
  let accumulator = 0;
  let bits = 0;
  for (const character of padded) {
    const value = alphabet.indexOf(character);
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

function parseObject(
  value: unknown,
  code: string,
  meshes: number,
  materials: number,
): ICubesObject {
  const raw = object(value, code);
  const geometryId = count(raw.geometryId, `${code}.geometryId`);
  const materialId = count(raw.materialId, `${code}.materialId`);
  if (geometryId >= meshes) fail(code, "geometryId outside the exported meshes");
  if (materialId >= materials) fail(code, "materialId outside the exported materials");
  if (typeof raw.geometryAsset !== "string" || typeof raw.materialAsset !== "string")
    fail(code, "expected the exported asset ids as provenance");
  return {
    geometryAsset: raw.geometryAsset,
    geometryId,
    materialAsset: raw.materialAsset,
    materialId,
    rotation: quat(raw.rotation, `${code}.rotation`),
    scale: triple(raw.scale, `${code}.scale`),
    translation: triple(raw.translation, `${code}.translation`),
  };
}

export function parseCubesFixture(text: string): ICubesFixture {
  const root = object(JSON.parse(text), "TN_BENCH_CUBES_FIXTURE");
  if (root.schemaVersion !== CUBES_FIXTURE_SCHEMA) fail("TN_BENCH_CUBES_FIXTURE", "schemaVersion");
  if (root.family !== CUBES_FAMILY) fail("TN_BENCH_CUBES_FIXTURE", "family");
  const source = object(root.source, "TN_BENCH_CUBES_FIXTURE.source");
  if (source.commit !== CUBES_UPSTREAM_COMMIT) fail("TN_BENCH_CUBES_FIXTURE", "upstream commit");
  digest(source.adapterSha256, "TN_BENCH_CUBES_FIXTURE.source.adapterSha256");
  digest(source.upstreamSha256, "TN_BENCH_CUBES_FIXTURE.source.upstreamSha256");
  if (!Array.isArray(source.patch) || source.patch.length === 0)
    fail("TN_BENCH_CUBES_FIXTURE", "the adapter patch must be disclosed");

  const rawMeshes = root.meshes;
  if (!Array.isArray(rawMeshes) || rawMeshes.length === 0) fail("TN_BENCH_CUBES_FIXTURE", "meshes");
  const meshes: ICubesMesh[] = rawMeshes.map((entry, index) => {
    const mesh = object(entry, `TN_BENCH_CUBES_FIXTURE.meshes[${index}]`);
    const parsed: ICubesMesh = {
      indexCount: count(mesh.indexCount, "indexCount"),
      indices: String(mesh.indices),
      normals: String(mesh.normals),
      positions: String(mesh.positions),
      triangles: count(mesh.triangles, "triangles"),
      uvs: String(mesh.uvs),
      vertices: count(mesh.vertices, "vertices"),
    };
    if (parsed.indexCount !== parsed.triangles * 3)
      fail("TN_BENCH_CUBES_FIXTURE", "indexCount is not three per triangle");
    if (parsed.vertices === 0 || parsed.triangles === 0)
      fail("TN_BENCH_CUBES_FIXTURE", "an exported mesh has no geometry");
    return parsed;
  });
  const rawMaterials = root.materials;
  if (!Array.isArray(rawMaterials) || rawMaterials.length === 0)
    fail("TN_BENCH_CUBES_FIXTURE", "materials");
  const materials: ICubesMaterial[] = rawMaterials.map((entry, index) => {
    const material = object(entry, `TN_BENCH_CUBES_FIXTURE.materials[${index}]`);
    return {
      baseColor: quat(material.baseColor, `TN_BENCH_CUBES_FIXTURE.materials[${index}].baseColor`),
      metallic: number(material.metallic, "metallic"),
      perceptualRoughness: number(material.perceptualRoughness, "perceptualRoughness"),
    };
  });

  const rawObjects = root.objects;
  if (!Array.isArray(rawObjects) || rawObjects.length === 0)
    fail("TN_BENCH_CUBES_FIXTURE", "objects");
  const objects = rawObjects.map((entry, index) =>
    parseObject(entry, `TN_BENCH_CUBES_FIXTURE.objects[${index}]`, meshes.length, materials.length),
  );
  const rawEnclosing = root.enclosing;
  if (!Array.isArray(rawEnclosing) || rawEnclosing.length === 0)
    fail("TN_BENCH_CUBES_FIXTURE", "the enclosing geometry is required and counted separately");
  const enclosing = rawEnclosing.map((entry, index) =>
    parseObject(
      entry,
      `TN_BENCH_CUBES_FIXTURE.enclosing[${index}]`,
      meshes.length,
      materials.length,
    ),
  );

  const counts = object(root.counts, "TN_BENCH_CUBES_FIXTURE.counts");
  const requestedInstances = count(counts.requestedInstances, "requestedInstances");
  if (counts.cubes !== objects.length) fail("TN_BENCH_CUBES_FIXTURE", "cubes count");
  if (counts.enclosing !== enclosing.length) fail("TN_BENCH_CUBES_FIXTURE", "enclosing count");
  if (requestedInstances !== objects.length)
    fail("TN_BENCH_CUBES_FIXTURE", "the sphere layout must author exactly the requested cubes");
  if (counts.directionalLights !== 1) fail("TN_BENCH_CUBES_FIXTURE", "directionalLights count");

  const rawSchedule = object(root.frameSchedule, "TN_BENCH_CUBES_FIXTURE.frameSchedule");
  const frameDelta = number(rawSchedule.frameDelta, "frameDelta");
  if (Math.abs(frameDelta - CUBES_FRAME_DELTA) > 1e-12)
    fail("TN_BENCH_CUBES_FIXTURE", "frameDelta is not 1/60 s");
  const frameSchedule: ICubesFrameSchedule = {
    cameraStepPerFrame: number(rawSchedule.cameraStepPerFrame, "cameraStepPerFrame"),
    firstScoredFrameClockSteps: count(
      rawSchedule.firstScoredFrameClockSteps,
      "firstScoredFrameClockSteps",
    ),
    firstScoredFrameConstantSteps: count(
      rawSchedule.firstScoredFrameConstantSteps,
      "firstScoredFrameConstantSteps",
    ),
    firstScoredFrameTimeDeltas: count(
      rawSchedule.firstScoredFrameTimeDeltas,
      "firstScoredFrameTimeDeltas",
    ),
    frameDelta,
    measuredFrames: count(rawSchedule.measuredFrames, "measuredFrames"),
    rotationPerFrame: number(rawSchedule.rotationPerFrame, "rotationPerFrame"),
    rotateCubes: rawSchedule.rotateCubes === true,
    warmupFrames: count(rawSchedule.warmupFrames, "warmupFrames"),
  };
  if (frameSchedule.measuredFrames < 2) fail("TN_BENCH_CUBES_FIXTURE", "measuredFrames");
  if (frameSchedule.rotateCubes !== (root.variant === "rotating"))
    fail("TN_BENCH_CUBES_FIXTURE", "variant and the rotation schedule disagree");

  const rawCamera = object(root.camera, "TN_BENCH_CUBES_FIXTURE.camera");
  const rawLight = object(root.light, "TN_BENCH_CUBES_FIXTURE.light");
  const rawViewport = object(root.viewport, "TN_BENCH_CUBES_FIXTURE.viewport");
  const probes = root.probeIndices;
  if (!Array.isArray(probes) || probes.length === 0) fail("TN_BENCH_CUBES_FIXTURE", "probeIndices");
  const probeIndices = probes.map((entry) => count(entry, "probeIndices"));
  for (const index of probeIndices)
    if (index >= objects.length) fail("TN_BENCH_CUBES_FIXTURE", "probe outside the census");

  return {
    camera: {
      far: number(rawCamera.far, "camera.far"),
      fovDegrees: number(rawCamera.fovDegrees, "camera.fovDegrees"),
      near: number(rawCamera.near, "camera.near"),
      position: triple(rawCamera.position, "camera.position"),
      rotation: quat(rawCamera.rotation, "camera.rotation"),
    },
    counts: {
      cubes: objects.length,
      directionalLights: 1,
      enclosing: enclosing.length,
      requestedInstances,
    },
    enclosing,
    environment: {
      background: String(object(root.environment, "environment").background),
      shadowMapsEnabled: object(root.environment, "environment").shadowMapsEnabled === true,
    },
    family: CUBES_FAMILY,
    frameSchedule,
    light: {
      rotation: quat(rawLight.rotation, "light.rotation"),
      shadowMapsEnabled: rawLight.shadowMapsEnabled === true,
    },
    materials,
    meshes,
    objects,
    probeIndices,
    schedule: String(root.schedule),
    schemaVersion: CUBES_FIXTURE_SCHEMA,
    source: {
      adapterSha256: source.adapterSha256 as string,
      commit: source.commit as string,
      patch: (source.patch as string[]).map(String),
      path: String(source.path),
      upstreamSha256: source.upstreamSha256 as string,
    },
    variant: root.variant === "rotating" ? "rotating" : "static",
    viewport: {
      deviation: rawViewport.deviation === null ? null : String(rawViewport.deviation),
      height: count(rawViewport.height, "viewport.height"),
      requestedHeight: count(rawViewport.requestedHeight, "viewport.requestedHeight"),
      requestedWidth: count(rawViewport.requestedWidth, "viewport.requestedWidth"),
      scaleFactor: number(rawViewport.scaleFactor, "viewport.scaleFactor"),
      width: count(rawViewport.width, "viewport.width"),
    },
  };
}

/** The fixture's identity is the digest of the bytes the exporting arm wrote. */
export async function cubesFixtureHash(text: string): Promise<string> {
  return sha256(new TextEncoder().encode(text));
}

export interface ICubesMeshChannels {
  readonly indices: Uint32Array;
  readonly normals: Float32Array;
  readonly positions: Float32Array;
  readonly uvs: Float32Array;
}

/**
 * The canonical byte stream a mesh's identity is a SHA-256 over: the version line, the mesh's index,
 * vertex and triangle counts as three little-endian `u32`, then positions, normals, UVs and indices
 * in that order. The exporting arm wrote those bytes as base64 of its own little-endian buffers, and
 * the counterpart arm re-derives the digest from the arrays it actually uploaded, so the digest
 * covers what was rendered rather than what a name implies.
 */
export function cubesMeshBufferBytes(
  mesh: Pick<ICubesMesh, "indexCount" | "triangles" | "vertices">,
  index: number,
  channels: ICubesMeshChannels,
): Uint8Array {
  const header = new TextEncoder().encode(
    `${CUBES_MESH_BUFFER_VERSION}\n${index}\n${mesh.vertices}\n${mesh.indexCount}\n${mesh.triangles}\n`,
  );
  const total =
    header.length +
    channels.positions.byteLength +
    channels.normals.byteLength +
    channels.uvs.byteLength +
    channels.indices.byteLength;
  const out = new Uint8Array(total);
  out.set(header, 0);
  let offset = header.length;
  for (const source of [channels.positions, channels.normals, channels.uvs, channels.indices]) {
    out.set(new Uint8Array(source.buffer, source.byteOffset, source.byteLength), offset);
    offset += source.byteLength;
  }
  return out;
}

export function cubesMeshChannels(mesh: ICubesMesh): ICubesMeshChannels {
  const code = "TN_BENCH_CUBES_MESH";
  const positions = base64ToBytes(mesh.positions, `${code}.positions`);
  const normals = base64ToBytes(mesh.normals, `${code}.normals`);
  const uvs = base64ToBytes(mesh.uvs, `${code}.uvs`);
  const indices = base64ToBytes(mesh.indices, `${code}.indices`);
  if (positions.length !== mesh.vertices * 12)
    fail(code, `positions are ${positions.length} bytes for ${mesh.vertices} vertices`);
  if (normals.length !== mesh.vertices * 12) fail(code, "normals length");
  if (uvs.length !== mesh.vertices * 8) fail(code, "uvs length");
  if (indices.length !== mesh.indexCount * 4) fail(code, "indices length");
  return {
    indices: new Uint32Array(indices.buffer, indices.byteOffset, mesh.indexCount),
    normals: new Float32Array(normals.buffer, normals.byteOffset, mesh.vertices * 3),
    positions: new Float32Array(positions.buffer, positions.byteOffset, mesh.vertices * 3),
    uvs: new Float32Array(uvs.buffer, uvs.byteOffset, mesh.vertices * 2),
  };
}

// ---------------------------------------------------------------------------------------------
// The state oracle. Both arms are compared against this, not against each other's arithmetic.
// ---------------------------------------------------------------------------------------------

type Quaternion = readonly [number, number, number, number];

const IDENTITY: Quaternion = [0, 0, 0, 1];

function multiply(a: Quaternion, b: Quaternion): Quaternion {
  const [ax, ay, az, aw] = a;
  const [bx, by, bz, bw] = b;
  return [
    aw * bx + ax * bw + ay * bz - az * by,
    aw * by - ax * bz + ay * bw + az * bx,
    aw * bz + ax * by - ay * bx + az * bw,
    aw * bw - ax * bx - ay * by - az * bz,
  ];
}

function aboutY(angle: number): Quaternion {
  return [0, Math.sin(angle / 2), 0, Math.cos(angle / 2)];
}

function aboutX(angle: number): Quaternion {
  return [Math.sin(angle / 2), 0, 0, Math.cos(angle / 2)];
}

function aboutZ(angle: number): Quaternion {
  return [0, 0, Math.sin(angle / 2), Math.cos(angle / 2)];
}

function power(rotation: Quaternion, steps: number): Quaternion {
  let out = IDENTITY;
  for (let index = 0; index < steps; index += 1) out = multiply(out, rotation);
  return out;
}

/** How many fixture-clock steps had run when measured frame `frame` was sampled. */
export function cubesClockSteps(fixture: ICubesFixture, frame: number): number {
  return fixture.frameSchedule.firstScoredFrameClockSteps + frame;
}

/** How many non-zero `Res<Time>` deltas a time consumer had seen by measured frame `frame`. */
export function cubesTimeDeltas(fixture: ICubesFixture, frame: number): number {
  return fixture.frameSchedule.firstScoredFrameTimeDeltas + frame;
}

/** How many fixed steps a constant-step system had applied by measured frame `frame`. */
export function cubesConstantSteps(fixture: ICubesFixture, frame: number): number {
  return fixture.frameSchedule.firstScoredFrameConstantSteps + frame;
}

/**
 * The rotation a cube must carry at measured frame `frame`.
 *
 * `rotate_cubes` calls `transform.rotate_y(10 * dt)`, and Bevy's `Transform::rotate_y` reaches
 * `Transform::rotate`, which is `self.rotation = rotation * self.rotation` — a *global*
 * pre-multiplication, not a local one (`rotate_local` is the other method, and the pinned source does
 * not use it). So the fixture clock's steps compose on the left: `Ry^k * q0`, spinning every cube
 * about the world Y axis. A static arm never steps, so its oracle is the exported rotation unchanged.
 */
export function cubesObjectRotation(
  fixture: ICubesFixture,
  index: number,
  frame: number,
): Quaternion {
  const base = fixture.objects[index]?.rotation;
  if (base === undefined) fail("TN_BENCH_CUBES_PROBE", `no object ${index}`);
  return multiply(cubesObjectStepRotation(fixture, frame), base as Quaternion);
}

/**
 * The per-frame world-space spin itself, so an arm composes it once and applies it to every object
 * instead of re-deriving the same power per object per frame. Identity on a static arm, which is what
 * makes a static arm's per-object work a quaternion multiply that changes nothing.
 */
export function cubesObjectStepRotation(fixture: ICubesFixture, frame: number): Quaternion {
  if (!fixture.frameSchedule.rotateCubes) return IDENTITY;
  return power(aboutY(fixture.frameSchedule.rotationPerFrame), cubesTimeDeltas(fixture, frame));
}

/**
 * The camera rotation at measured frame `frame`. `move_camera` calls `rotate_z(delta)` and then
 * `rotate_x(delta)`, both global pre-multiplications, so one clock step is `Rx * Rz` and the composed
 * state is `(Rx * Rz)^k * q0`.
 */
export function cubesCameraRotation(fixture: ICubesFixture, frame: number): Quaternion {
  const step = fixture.frameSchedule.cameraStepPerFrame;
  return multiply(
    power(multiply(aboutX(step), aboutZ(step)), cubesConstantSteps(fixture, frame)),
    fixture.camera.rotation as Quaternion,
  );
}

/** The component-wise agreement between a reported rotation and the oracle. */
export function cubesRotationDelta(reported: readonly number[], expected: Quaternion): number {
  if (reported.length !== 4) fail("TN_BENCH_CUBES_ROTATION", "expected four components");
  let delta = 0;
  for (let index = 0; index < 4; index += 1)
    delta = Math.max(delta, Math.abs((reported[index] as number) - (expected[index] as number)));
  return delta;
}

/**
 * The canonical frustum census both arms' own counters are checked against: the exported camera
 * projection and the frame's own camera rotation, over each cube's world-space bounding sphere built
 * from the exported vertices. Engine visibility counters are not automatically the same question, so
 * this is the common reference §6.1 asks for rather than one arm's answer.
 */
export function canonicalAdmittedCubes(
  fixture: ICubesFixture,
  frame: number,
): { admitted: number; cubes: number; radius: number } {
  const rotation = cubesCameraRotation(fixture, frame);
  const camera = new Matrix4().compose(
    new Vector3(
      fixture.camera.position[0] as number,
      fixture.camera.position[1] as number,
      fixture.camera.position[2] as number,
    ),
    new ThreeQuaternion(rotation[0], rotation[1], rotation[2], rotation[3]),
    new Vector3(1, 1, 1),
  );
  const inverse = camera.clone().invert();
  const near = fixture.camera.near;
  const top = near * Math.tan((Math.PI * fixture.camera.fovDegrees) / 360);
  const right = top * (fixture.viewport.width / fixture.viewport.height);
  const projection = new Matrix4().makePerspective(
    -right,
    right,
    top,
    -top,
    near,
    fixture.camera.far,
  );
  const frustum = new Frustum().setFromProjectionMatrix(
    projection.multiply(new Matrix4().copy(inverse)),
  );
  const geometryId = fixture.objects[0]?.geometryId;
  const mesh = geometryId === undefined ? undefined : fixture.meshes[geometryId];
  if (mesh === undefined) fail("TN_BENCH_CUBES_FIXTURE", "the first cube has no exported geometry");
  // The sphere is built from the exported vertices, so a geometry change moves the reference with it.
  const radius = new Box3()
    .setFromArray(cubesMeshChannels(mesh).positions)
    .getBoundingSphere(new Sphere()).radius;
  const scaleMatrix = new Matrix4();
  const sphere = new Sphere();
  let admitted = 0;
  for (const entry of fixture.objects) {
    const world = sphere
      .set(
        new Vector3(
          entry.translation[0] as number,
          entry.translation[1] as number,
          entry.translation[2] as number,
        ),
        radius,
      )
      .clone();
    scaleMatrix.compose(
      new Vector3(0, 0, 0),
      new ThreeQuaternion(),
      new Vector3(entry.scale[0] as number, entry.scale[1] as number, entry.scale[2] as number),
    );
    world.applyMatrix4(scaleMatrix);
    if (frustum.intersectsSphere(world)) admitted += 1;
  }
  return { admitted, cubes: fixture.objects.length, radius };
}

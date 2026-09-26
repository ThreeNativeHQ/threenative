import { Matrix4, Quaternion, Vector3 } from "three/webgpu";
import { sha256 } from "./identity.js";

/**
 * PRD-449 `bevy-city`: the counterpart arm's half of the canonical fixture, and the oracle both arms
 * are checked against.
 *
 * The fixture is exported by the pinned Bevy arm
 * ([`city/`](../../../../benchmark/bevy-prd449/city/)) from the scene it actually built — its nested
 * `spawn_city` block loop, its seeded `SmallRng(42)` car and building choices, its
 * `WorldAssetRoot` scene expansion, its `merge_car_meshes` result, its camera, its light and its
 * car simulation. This module is the only reader, so the two arms hash the same bytes instead of two
 * implementations agreeing about Bevy's RNG, its OpenSimplex noise or its glTF import.
 *
 * §5.1 is the reason this exists in this shape: "Exporting a canonical fixture is preferred to
 * independently recreating random generators in several languages", and "Export must preserve node
 * boundaries and material diversity rather than merging the whole city." Nothing here regenerates
 * the city, and nothing merges it.
 */

/** The pinned upstream commit the exporting arm was built from; a fixture naming another is refused. */
export const CITY_UPSTREAM_COMMIT = "c6f634ca9f406d68ba5109d921247b654cb42c10";
export const CITY_FIXTURE_SCHEMA = 1;
export const CITY_FAMILY = "bevy-city";
export const CITY_FRAME_DELTA = 1 / 60;
/** The canonical number form the exporting arm writes: the shortest decimal that round-trips an f32. */
const F32_TEXT = /^-?(0|[1-9][0-9]*)(\.[0-9]+)?([eE][-+]?[0-9]+)?$/;

/**
 * Conformance tolerances, preregistered here rather than tuned after a speedup appeared. Both arms
 * carry f32 transforms and the oracle is computed in f64, so the residual is f32 rounding over a
 * city that is a few tens of units across.
 *
 * `translationAbs` is 1e-3 world units on a city spanning about 45 units, which is ~2e-5 relative —
 * two orders of magnitude above f32 epsilon (1.2e-7) and generous for a 700-step composition.
 * `quaternionAbs` is the same 1e-4 the many-cubes family preregistered, for the camera's rotation.
 */
export const CITY_TOLERANCE = {
  quaternionAbs: 1e-4,
  translationAbs: 1e-3,
};

export interface ICityMesh {
  readonly indexCount: number;
  readonly indices: string;
  readonly normals: string;
  readonly positions: string;
  readonly tangents: string;
  readonly triangles: number;
  readonly uvs: string;
  readonly vertices: number;
}

export interface ICityImage {
  /** The vendored file's own bytes, base64. A PNG, so the reader decodes what Bevy sampled. */
  readonly bytes: string;
  readonly height: number;
  readonly path: string;
  readonly width: number;
}

export interface ICityMaterial {
  readonly alphaMode: string;
  readonly baseColor: readonly number[];
  readonly baseColorChannel: number;
  readonly baseColorTexture: number | null;
  readonly cullMode: string;
  readonly emissive: readonly number[];
  readonly emissiveChannel: number;
  readonly emissiveExposureWeight: number;
  readonly emissiveTexture: number | null;
  readonly metallic: number;
  readonly metallicRoughnessChannel: number;
  readonly metallicRoughnessTexture: number | null;
  readonly normalChannel: number;
  readonly normalTexture: number | null;
  readonly occlusionChannel: number;
  readonly occlusionTexture: number | null;
  readonly perceptualRoughness: number;
  readonly reflectance: number;
  readonly specularTint: readonly number[];
  readonly unlit: boolean;
}

/** One node of the city, in the exporting arm's breadth-first walk from `CityRoot`. */
export interface ICityNode {
  /** Index into `nodes`, or -1 for the root. The whole hierarchy is this column. */
  readonly parent: number;
  readonly geometryId: number | null;
  readonly materialId: number | null;
  readonly geometryAsset: string | null;
  readonly materialAsset: string | null;
  readonly translation: readonly [number, number, number];
  readonly rotation: readonly [number, number, number, number];
  readonly scale: readonly [number, number, number];
}

export interface ICityRoad {
  readonly end: readonly [number, number, number];
  readonly start: readonly [number, number, number];
}

export interface ICityCar {
  readonly dir: number;
  readonly distanceTraveled: number;
  readonly nodeIndex: number;
  readonly offset: readonly [number, number, number];
  readonly roadIndex: number;
  readonly rotation: readonly [number, number, number, number];
  readonly scale: readonly [number, number, number];
  /** The local translation this car carried when the fixture was exported. */
  readonly translation: readonly [number, number, number];
}

export interface ICityFrameSchedule {
  readonly carSpeedPerSecond: number;
  readonly frameDelta: number;
  readonly measuredFrames: number;
  readonly settleFrames: number;
  /** `simulate_cars` applications when the fixture was written. */
  readonly simulateCarsAtExport: number;
  readonly stableTicksBeforeExport: number;
  readonly warmupFrames: number;
}

export interface ICityFixture {
  readonly camera: {
    readonly far: number;
    readonly fovDegrees: number;
    readonly near: number;
    readonly position: readonly [number, number, number];
    readonly rotation: readonly [number, number, number, number];
  };
  readonly carFields: readonly string[];
  readonly cars: readonly ICityCar[];
  readonly census: {
    readonly cars: number;
    readonly groupNodes: number;
    readonly images: number;
    readonly materials: number;
    readonly meshNodes: number;
    readonly meshes: number;
    readonly nodes: number;
    readonly roads: number;
    readonly trianglesInCensus: number;
  };
  readonly environment: Record<string, unknown>;
  readonly family: string;
  readonly frameSchedule: ICityFrameSchedule;
  readonly images: readonly ICityImage[];
  readonly light: { readonly illuminanceLux: number; readonly rotation: readonly number[] };
  readonly licenses: readonly { readonly license: string; readonly note: string }[];
  readonly materials: readonly ICityMaterial[];
  readonly meshes: readonly ICityMesh[];
  readonly nodeFields: readonly string[];
  readonly nodes: readonly ICityNode[];
  readonly probeCars: readonly number[];
  readonly probeNodes: readonly number[];
  readonly profile: string;
  readonly roadFields: readonly string[];
  readonly roads: readonly ICityRoad[];
  readonly schedule: string;
  readonly schemaVersion: number;
  readonly seed: number;
  readonly settings: Record<string, unknown>;
  readonly size: number;
  readonly source: {
    readonly adapterSha256: string;
    readonly commit: string;
    readonly patch: readonly string[];
    readonly path: string;
    readonly upstreamSha256: string;
  };
  readonly variant: "moving" | "static";
  readonly viewport: {
    readonly deviation: string | null;
    readonly height: number;
    readonly requestedHeight: number;
    readonly requestedWidth: number;
    readonly scaleFactor: number;
    readonly width: number;
  };
}

const CODE = "TN_BENCH_CITY_FIXTURE";

function fail(detail: string): never {
  throw new Error(`${CODE}:${detail}`);
}

function object(value: unknown, detail: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    fail(`expected an object for ${detail}`);
  return value as Record<string, unknown>;
}

function array(value: unknown, detail: string): unknown[] {
  if (!Array.isArray(value)) fail(`expected an array for ${detail}`);
  return value;
}

/**
 * The exporting arm writes every f32 as the shortest decimal that round-trips it, so the reader
 * re-reads the *f32* the value came from before it becomes an f64. Anything else in a numeric field
 * means the two arms would be comparing different numbers, so this is checked rather than trusted.
 */
function f32(value: unknown, detail: string): number {
  if (typeof value === "number") {
    if (!Number.isFinite(value)) fail(`${detail} is not finite`);
    return Math.fround(value);
  }
  if (typeof value !== "string" || !F32_TEXT.test(value)) fail(`${detail} is not a number`);
  return Math.fround(Number(value));
}

function count(value: unknown, detail: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0)
    fail(`${detail} is not a non-negative integer`);
  return value;
}

function index(value: unknown, detail: string): number {
  if (value === null || value === -1) return -1;
  return count(value, detail);
}

function nullableIndex(value: unknown, detail: string, bound: number): number | null {
  if (value === null) return null;
  const read = count(value, detail);
  if (read >= bound) fail(`${detail} is outside the exported arrays`);
  return read;
}

function digest(value: unknown, detail: string): string {
  if (typeof value !== "string" || !/^[0-9a-f]{64}$/.test(value))
    fail(`${detail} is not a SHA-256`);
  return value;
}

function vec3(value: unknown, detail: string): [number, number, number] {
  const raw = array(value, detail);
  if (raw.length !== 3) fail(`${detail} is not three components`);
  return [f32(raw[0], detail), f32(raw[1], detail), f32(raw[2], detail)];
}

function quat(value: unknown, detail: string): [number, number, number, number] {
  const raw = array(value, detail);
  if (raw.length !== 4) fail(`${detail} is not four components`);
  return [f32(raw[0], detail), f32(raw[1], detail), f32(raw[2], detail), f32(raw[3], detail)];
}

/** A UV channel three can address. Bevy has two; a third would be a real difference, not a remap. */
function uvChannel(value: unknown, detail: string): number {
  const read = f32(value, detail);
  if (read !== 0 && read !== 1) fail(`${detail} is ${read}, and three has no uv2`);
  return read;
}

function base64ToBytes(text: string, detail: string): Uint8Array {
  if (typeof text !== "string") fail(`${detail} is not base64 text`);
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  const padded = text.replace(/=+$/, "");
  if (padded.length % 4 === 1) fail(`${detail} is not base64`);
  const out = new Uint8Array(Math.floor((padded.length * 3) / 4));
  let written = 0;
  let accumulator = 0;
  let bits = 0;
  for (const character of padded) {
    const read = alphabet.indexOf(character);
    if (read < 0) fail(`${detail} is not base64`);
    accumulator = (accumulator << 6) | read;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[written] = (accumulator >> bits) & 0xff;
      written += 1;
    }
  }
  return out.subarray(0, written);
}

function parseMesh(value: unknown, detail: string): ICityMesh {
  const raw = object(value, detail);
  const mesh: ICityMesh = {
    indexCount: count(raw.indexCount, `${detail}.indexCount`),
    indices: String(raw.indices),
    normals: String(raw.normals),
    positions: String(raw.positions),
    tangents: String(raw.tangents),
    triangles: count(raw.triangles, `${detail}.triangles`),
    uvs: String(raw.uvs),
    vertices: count(raw.vertices, `${detail}.vertices`),
  };
  if (mesh.indexCount !== mesh.triangles * 3)
    fail(`${detail} indexCount is not three per triangle`);
  if (mesh.vertices === 0 || mesh.triangles === 0) fail(`${detail} has no geometry`);
  return mesh;
}

function parseImage(value: unknown, detail: string): ICityImage {
  const raw = object(value, detail);
  return {
    bytes: String(raw.bytes),
    height: count(raw.height, `${detail}.height`),
    path: String(raw.path),
    width: count(raw.width, `${detail}.width`),
  };
}

function parseMaterial(value: unknown, detail: string, images: number): ICityMaterial {
  const raw = object(value, detail);
  const texture = (key: string): number | null =>
    nullableIndex(raw[key], `${detail}.${key}`, images);
  const baseColor = array(raw.baseColor, `${detail}.baseColor`);
  const emissive = array(raw.emissive, `${detail}.emissive`);
  const specularTint = array(raw.specularTint, `${detail}.specularTint`);
  return {
    alphaMode: String(raw.alphaMode),
    baseColor: [
      f32(baseColor[0], `${detail}.baseColor`),
      f32(baseColor[1], `${detail}.baseColor`),
      f32(baseColor[2], `${detail}.baseColor`),
      f32(baseColor[3], `${detail}.baseColor`),
    ],
    baseColorChannel: uvChannel(raw.baseColorChannel, `${detail}.baseColorChannel`),
    baseColorTexture: texture("baseColorTexture"),
    cullMode: String(raw.cullMode),
    emissive: [
      f32(emissive[0], `${detail}.emissive`),
      f32(emissive[1], `${detail}.emissive`),
      f32(emissive[2], `${detail}.emissive`),
    ],
    emissiveChannel: uvChannel(raw.emissiveChannel, `${detail}.emissiveChannel`),
    emissiveExposureWeight: f32(raw.emissiveExposureWeight, `${detail}.emissiveExposureWeight`),
    emissiveTexture: texture("emissiveTexture"),
    metallic: f32(raw.metallic, `${detail}.metallic`),
    metallicRoughnessChannel: uvChannel(
      raw.metallicRoughnessChannel,
      `${detail}.metallicRoughnessChannel`,
    ),
    metallicRoughnessTexture: texture("metallicRoughnessTexture"),
    normalChannel: uvChannel(raw.normalChannel, `${detail}.normalChannel`),
    normalTexture: texture("normalTexture"),
    occlusionChannel: uvChannel(raw.occlusionChannel, `${detail}.occlusionChannel`),
    occlusionTexture: texture("occlusionTexture"),
    perceptualRoughness: f32(raw.perceptualRoughness, `${detail}.perceptualRoughness`),
    reflectance: f32(raw.reflectance, `${detail}.reflectance`),
    specularTint: [
      f32(specularTint[0], `${detail}.specularTint`),
      f32(specularTint[1], `${detail}.specularTint`),
      f32(specularTint[2], `${detail}.specularTint`),
      f32(specularTint[3], `${detail}.specularTint`),
    ],
    unlit: raw.unlit === true,
  };
}

function parseNode(value: unknown, detail: string, meshes: number, materials: number): ICityNode {
  const raw = array(value, detail);
  if (raw.length !== 8) fail(`${detail} is not the exported node shape`);
  return {
    geometryAsset: raw[6] === null ? null : String(raw[6]),
    geometryId: nullableIndex(raw[1], `${detail}.geometryId`, meshes),
    materialAsset: raw[7] === null ? null : String(raw[7]),
    materialId: nullableIndex(raw[2], `${detail}.materialId`, materials),
    parent: index(raw[0], `${detail}.parent`),
    rotation: quat(raw[4], `${detail}.rotation`),
    scale: vec3(raw[5], `${detail}.scale`),
    translation: vec3(raw[3], `${detail}.translation`),
  };
}

function parseCar(value: unknown, detail: string, roads: number, nodes: number): ICityCar {
  const raw = array(value, detail);
  if (raw.length !== 8) fail(`${detail} is not the exported car shape`);
  const nodeIndex = count(raw[0], `${detail}.nodeIndex`);
  if (nodeIndex >= nodes) fail(`${detail}.nodeIndex is outside the census`);
  const roadIndex = count(raw[1], `${detail}.roadIndex`);
  if (roadIndex >= roads) fail(`${detail}.roadIndex is outside the roads`);
  return {
    dir: f32(raw[2], `${detail}.dir`),
    distanceTraveled: f32(raw[3], `${detail}.distanceTraveled`),
    nodeIndex,
    offset: vec3(raw[4], `${detail}.offset`),
    roadIndex,
    rotation: quat(raw[6], `${detail}.rotation`),
    scale: vec3(raw[7], `${detail}.scale`),
    translation: vec3(raw[5], `${detail}.translation`),
  };
}

export function parseCityFixture(text: string): ICityFixture {
  const root = object(JSON.parse(text), "document");
  if (root.schemaVersion !== CITY_FIXTURE_SCHEMA) fail("schemaVersion");
  if (root.family !== CITY_FAMILY) fail("family");
  const source = object(root.source, "source");
  if (source.commit !== CITY_UPSTREAM_COMMIT) fail("the fixture names another upstream commit");
  digest(source.adapterSha256, "source.adapterSha256");
  digest(source.upstreamSha256, "source.upstreamSha256");
  const patch = array(source.patch, "source.patch");
  if (patch.length === 0) fail("the adapter patch must be disclosed");

  const meshes = array(root.meshes, "meshes").map((entry, at) => parseMesh(entry, `meshes[${at}]`));
  if (meshes.length === 0) fail("meshes is empty");
  const images = array(root.images, "images").map((entry, at) =>
    parseImage(entry, `images[${at}]`),
  );
  for (const [at, image] of images.entries()) {
    if (base64ToBytes(image.bytes, `images[${at}].bytes`).length === 0)
      fail(`images[${at}] carries no bytes`);
    if (image.width === 0 || image.height === 0) fail(`images[${at}] has no extent`);
  }
  const materials = array(root.materials, "materials").map((entry, at) =>
    parseMaterial(entry, `materials[${at}]`, images.length),
  );
  if (materials.length === 0) fail("materials is empty");

  const nodes = array(root.nodes, "nodes").map((entry, at) =>
    parseNode(entry, `nodes[${at}]`, meshes.length, materials.length),
  );
  if (nodes.length === 0) fail("nodes is empty");
  for (const [at, node] of nodes.entries()) {
    if (node.parent >= nodes.length) fail(`nodes[${at}].parent is outside the census`);
    if (node.parent === at) fail(`nodes[${at}] is its own parent`);
  }
  const roads = array(root.roads, "roads").map((entry, at) => {
    const raw = array(entry, `roads[${at}]`);
    if (raw.length !== 2) fail(`roads[${at}] is not the exported road shape`);
    return { end: vec3(raw[1], `roads[${at}].end`), start: vec3(raw[0], `roads[${at}].start`) };
  });
  if (roads.length === 0) fail("roads is empty");
  const cars = array(root.cars, "cars").map((entry, at) =>
    parseCar(entry, `cars[${at}]`, roads.length, nodes.length),
  );
  if (cars.length === 0) fail("cars is empty");

  const census = object(root.census, "census");
  const read = {
    cars: count(census.cars, "census.cars"),
    groupNodes: count(census.groupNodes, "census.groupNodes"),
    images: count(census.images, "census.images"),
    materials: count(census.materials, "census.materials"),
    meshNodes: count(census.meshNodes, "census.meshNodes"),
    meshes: count(census.meshes, "census.meshes"),
    nodes: count(census.nodes, "census.nodes"),
    roads: count(census.roads, "census.roads"),
    trianglesInCensus: count(census.trianglesInCensus, "census.trianglesInCensus"),
  };
  // The census is the claim both arms are checked against, so every part of it is checked against
  // the arrays it counts rather than trusted.
  if (read.nodes !== nodes.length) fail("census.nodes disagrees with the exported nodes");
  if (read.cars !== cars.length) fail("census.cars disagrees with the exported cars");
  if (read.roads !== roads.length) fail("census.roads disagrees with the exported roads");
  if (read.meshes !== meshes.length) fail("census.meshes disagrees with the exported meshes");
  if (read.materials !== materials.length)
    fail("census.materials disagrees with the exported materials");
  if (read.images !== images.length) fail("census.images disagrees with the exported images");
  const meshNodes = nodes.filter((node) => node.geometryId !== null).length;
  if (read.meshNodes !== meshNodes) fail("census.meshNodes disagrees with the exported nodes");
  if (read.groupNodes + read.meshNodes !== read.nodes) fail("census group and mesh nodes disagree");
  let triangles = 0;
  for (const node of nodes) {
    if (node.geometryId === null) continue;
    const mesh = meshes[node.geometryId];
    if (mesh === undefined) fail("a node names a geometry outside the exported meshes");
    triangles += mesh.triangles;
  }
  if (read.trianglesInCensus !== triangles)
    fail("census.trianglesInCensus is not the sum of the node geometry");

  const rawSchedule = object(root.frameSchedule, "frameSchedule");
  const frameDelta = f32(rawSchedule.frameDelta, "frameSchedule.frameDelta");
  if (Math.abs(frameDelta - CITY_FRAME_DELTA) > 1e-9)
    fail("frameSchedule.frameDelta is not 1/60 s");
  const frameSchedule: ICityFrameSchedule = {
    carSpeedPerSecond: f32(rawSchedule.carSpeedPerSecond, "frameSchedule.carSpeedPerSecond"),
    frameDelta,
    measuredFrames: count(rawSchedule.measuredFrames, "frameSchedule.measuredFrames"),
    settleFrames: count(rawSchedule.settleFrames, "frameSchedule.settleFrames"),
    simulateCarsAtExport: count(
      rawSchedule.simulateCarsAtExport,
      "frameSchedule.simulateCarsAtExport",
    ),
    stableTicksBeforeExport: count(
      rawSchedule.stableTicksBeforeExport,
      "frameSchedule.stableTicksBeforeExport",
    ),
    warmupFrames: count(rawSchedule.warmupFrames, "frameSchedule.warmupFrames"),
  };
  if (frameSchedule.measuredFrames < 2) fail("frameSchedule.measuredFrames");
  if (frameSchedule.carSpeedPerSecond <= 0)
    fail("frameSchedule.carSpeedPerSecond must be positive");

  const settings = object(root.settings, "settings");
  const variant =
    root.variant === "static" ? "static" : root.variant === "moving" ? "moving" : fail("variant");
  if (settings.simulateCars !== (variant === "moving"))
    fail("the variant and the scene's own Simulate Cars setting disagree");

  const rawCamera = object(root.camera, "camera");
  const rawLight = object(root.light, "light");
  const rawViewport = object(root.viewport, "viewport");
  const probes = {
    cars: array(root.probeCars, "probeCars").map((entry) => count(entry, "probeCars")),
    nodes: array(root.probeNodes, "probeNodes").map((entry) => count(entry, "probeNodes")),
  };
  if (probes.nodes.length === 0 || probes.cars.length === 0) fail("the fixture names no probes");
  for (const probe of probes.nodes)
    if (probe >= nodes.length) fail("probeNodes is outside the census");
  for (const probe of probes.cars)
    if (probe >= cars.length) fail("probeCars is outside the census");

  return {
    camera: {
      far: f32(rawCamera.far, "camera.far"),
      fovDegrees: f32(rawCamera.fovDegrees, "camera.fovDegrees"),
      near: f32(rawCamera.near, "camera.near"),
      position: vec3(rawCamera.position, "camera.position"),
      rotation: quat(rawCamera.rotation, "camera.rotation"),
    },
    carFields: array(root.carFields, "carFields").map(String),
    cars,
    census: read,
    environment: object(root.environment, "environment"),
    family: CITY_FAMILY,
    frameSchedule,
    images,
    light: {
      illuminanceLux: f32(rawLight.illuminanceLux, "light.illuminanceLux"),
      rotation: quat(rawLight.rotation, "light.rotation"),
    },
    licenses: array(root.licenses, "licenses").map((entry) => {
      const record = object(entry, "licenses[]");
      return { license: String(record.license), note: String(record.note) };
    }),
    materials,
    meshes,
    nodeFields: array(root.nodeFields, "nodeFields").map(String),
    nodes,
    probeCars: probes.cars,
    probeNodes: probes.nodes,
    profile: String(root.profile),
    roadFields: array(root.roadFields, "roadFields").map(String),
    roads,
    schedule: String(root.schedule),
    schemaVersion: CITY_FIXTURE_SCHEMA,
    seed: count(root.seed, "seed"),
    settings,
    size: count(root.size, "size"),
    source: {
      adapterSha256: source.adapterSha256 as string,
      commit: source.commit as string,
      patch: patch.map(String),
      path: String(source.path),
      upstreamSha256: source.upstreamSha256 as string,
    },
    variant,
    viewport: {
      deviation: rawViewport.deviation === null ? null : String(rawViewport.deviation),
      height: count(rawViewport.height, "viewport.height"),
      requestedHeight: count(rawViewport.requestedHeight, "viewport.requestedHeight"),
      requestedWidth: count(rawViewport.requestedWidth, "viewport.requestedWidth"),
      scaleFactor: f32(rawViewport.scaleFactor, "viewport.scaleFactor"),
      width: count(rawViewport.width, "viewport.width"),
    },
  };
}

/** The fixture's identity is the digest of the bytes the exporting arm wrote. */
export async function cityFixtureHash(text: string): Promise<string> {
  return sha256(new TextEncoder().encode(text));
}

export interface ICityMeshChannels {
  readonly indices: Uint32Array;
  readonly normals: Float32Array;
  readonly positions: Float32Array;
  readonly tangents: Float32Array;
  readonly uvs: Float32Array;
}

export function cityMeshChannels(mesh: ICityMesh): ICityMeshChannels {
  const code = `${CODE}_MESH`;
  const positions = base64ToBytes(mesh.positions, `${code}.positions`);
  const normals = base64ToBytes(mesh.normals, `${code}.normals`);
  const uvs = base64ToBytes(mesh.uvs, `${code}.uvs`);
  const tangents = base64ToBytes(mesh.tangents, `${code}.tangents`);
  const indices = base64ToBytes(mesh.indices, `${code}.indices`);
  if (positions.length !== mesh.vertices * 12) fail("positions are not three f32 per vertex");
  if (normals.length !== mesh.vertices * 12) fail("normals are not three f32 per vertex");
  if (tangents.length !== mesh.vertices * 16) fail("tangents are not four f32 per vertex");
  if (uvs.length !== mesh.vertices * 8) fail("uvs are not two f32 per vertex");
  if (indices.length !== mesh.indexCount * 4) fail("indices are not one u32 per index");
  return {
    indices: new Uint32Array(indices.buffer, indices.byteOffset, mesh.indexCount),
    normals: new Float32Array(normals.buffer, normals.byteOffset, mesh.vertices * 3),
    positions: new Float32Array(positions.buffer, positions.byteOffset, mesh.vertices * 3),
    tangents: new Float32Array(tangents.buffer, tangents.byteOffset, mesh.vertices * 4),
    uvs: new Float32Array(uvs.buffer, uvs.byteOffset, mesh.vertices * 2),
  };
}

/** The canonical mesh-buffer byte layout both arms hash; see `cityMeshBufferBytes`. */
export const CITY_MESH_BUFFER_VERSION = "threenative-city-mesh-buffer/1";

/**
 * The canonical byte stream a mesh's identity is a SHA-256 over: the version line, the mesh's index,
 * vertex and triangle counts as ASCII, then positions, normals, UVs, tangents and indices in that
 * order. The counterpart arm re-derives the digest from the arrays it actually uploaded, so the
 * digest covers what was rendered rather than what the file's name implies.
 */
export function cityMeshBufferBytes(
  mesh: Pick<ICityMesh, "indexCount" | "triangles" | "vertices">,
  index: number,
  channels: ICityMeshChannels,
): Uint8Array {
  const header = new TextEncoder().encode(
    `${CITY_MESH_BUFFER_VERSION}\n${index}\n${mesh.vertices}\n${mesh.indexCount}\n${mesh.triangles}\n`,
  );
  const sources = [
    channels.positions,
    channels.normals,
    channels.uvs,
    channels.tangents,
    channels.indices,
  ];
  const total = header.length + sources.reduce((sum, source) => sum + source.byteLength, 0);
  const out = new Uint8Array(total);
  out.set(header, 0);
  let offset = header.length;
  for (const source of sources) {
    out.set(new Uint8Array(source.buffer, source.byteOffset, source.byteLength), offset);
    offset += source.byteLength;
  }
  return out;
}

/** The image bytes, as a PNG the reader can hand to the runtime's own decoder. */
export function cityImageBytes(image: ICityImage): Uint8Array {
  return base64ToBytes(image.bytes, `${CODE}_IMAGE`);
}

// ---------------------------------------------------------------------------------------------
// The state oracle. Both arms are compared against this, not against each other's arithmetic.
// ---------------------------------------------------------------------------------------------

/** A node's own matrix, from its exported local transform. */
function localMatrix(node: ICityNode): Matrix4 {
  return new Matrix4().compose(
    new Vector3(node.translation[0], node.translation[1], node.translation[2]),
    new Quaternion(node.rotation[0], node.rotation[1], node.rotation[2], node.rotation[3]),
    new Vector3(node.scale[0], node.scale[1], node.scale[2]),
  );
}

/**
 * The world translation of any node, composed from the exported parent chain in f64. This is the
 * hierarchy's own arithmetic rather than a restatement of it: a counterpart arm that authored the
 * nodes flat, or dropped a `WorldAssetRoot` level, lands somewhere else, which is the whole point of
 * §5.1's "Export must preserve node boundaries".
 */
export function cityNodeWorldPosition(
  fixture: ICityFixture,
  at: number,
  localTranslation?: readonly [number, number, number],
): Vector3 {
  if (at < 0 || at >= fixture.nodes.length) fail(`no node ${at}`);
  const chain: Matrix4[] = [];
  let cursor = at;
  let guard = 0;
  while (cursor >= 0) {
    guard += 1;
    if (guard > fixture.nodes.length) fail("the parent chain is not a tree");
    const node = fixture.nodes[cursor];
    if (node === undefined) fail("a parent index is outside the census");
    chain.push(
      localMatrix(
        cursor === at && localTranslation !== undefined
          ? { ...node, translation: localTranslation }
          : node,
      ),
    );
    cursor = node.parent;
  }
  const world = new Matrix4();
  for (let index = chain.length - 1; index >= 0; index -= 1) {
    world.multiply(chain[index] as Matrix4);
  }
  return new Vector3(
    world.elements[12] as number,
    world.elements[13] as number,
    world.elements[14] as number,
  );
}

/** The road length `simulate_cars` divides by, from the exported road endpoints. */
export function cityRoadLength(fixture: ICityFixture, roadIndex: number): number {
  const road = fixture.roads[roadIndex];
  if (road === undefined) fail(`no road ${roadIndex}`);
  const dx = road.end[0] - road.start[0];
  const dy = road.end[1] - road.start[1];
  const dz = road.end[2] - road.start[2];
  const length = Math.hypot(dx, dy, dz);
  if (!(length > 0)) fail(`road ${roadIndex} has no length`);
  return length;
}

/**
 * `simulate_cars`' recurrence, in the upstream system's f32 arithmetic, for one car.
 *
 * The upstream system is `distance += speed * delta`, then `if distance > road_len { distance = 0 }`
 * — a reset to zero, not a modulo — so the sequence is iterated rather than closed-formed. Both arms
 * read their own count from their own run, so the number of steps each takes is its own fact rather
 * than a number this module guessed.
 */
export function cityCarDistance(
  fixture: ICityFixture,
  carIndex: number,
  applications: number,
): number {
  const car = fixture.cars[carIndex];
  if (car === undefined) fail(`no car ${carIndex}`);
  if (fixture.variant === "static") return car.distanceTraveled;
  const length = Math.fround(cityRoadLength(fixture, car.roadIndex));
  const step = Math.fround(
    Math.fround(fixture.frameSchedule.carSpeedPerSecond) *
      Math.fround(fixture.frameSchedule.frameDelta),
  );
  let distance = car.distanceTraveled;
  for (let index = fixture.frameSchedule.simulateCarsAtExport; index < applications; index += 1) {
    distance = Math.fround(distance + step);
    if (distance > length) distance = 0;
  }
  return distance;
}

/**
 * The local translation `simulate_cars` writes, from the exported road and the recurrence. A static
 * arm never runs the system, so its oracle is the translation the car was spawned with, which the
 * exporting arm captured.
 */
export function cityCarLocalPosition(
  fixture: ICityFixture,
  carIndex: number,
  applications: number,
): Vector3 {
  const car = fixture.cars[carIndex];
  if (car === undefined) fail(`no car ${carIndex}`);
  if (fixture.variant === "static") {
    return new Vector3(car.translation[0], car.translation[1], car.translation[2]);
  }
  const road = fixture.roads[car.roadIndex] as ICityRoad;
  const length = cityRoadLength(fixture, car.roadIndex);
  const distance = cityCarDistance(fixture, carIndex, applications);
  const sign = Math.sign(car.dir);
  return new Vector3(
    road.start[0] + car.offset[0] + (sign * (road.end[0] - road.start[0]) * distance) / length,
    road.start[1] + car.offset[1] + (sign * (road.end[1] - road.start[1]) * distance) / length,
    road.start[2] + car.offset[2] + (sign * (road.end[2] - road.start[2]) * distance) / length,
  );
}

/** The component-wise agreement between a reported translation and the oracle, in world units. */
export function cityTranslationDelta(reported: readonly number[], expected: Vector3): number {
  if (reported.length !== 3) fail("a reported translation is not three components");
  return Math.max(
    Math.abs((reported[0] as number) - expected.x),
    Math.abs((reported[1] as number) - expected.y),
    Math.abs((reported[2] as number) - expected.z),
  );
}

/** The component-wise agreement between a reported rotation and the oracle. */
export function cityRotationDelta(reported: readonly number[], expected: Quaternion): number {
  if (reported.length !== 4) fail("a reported rotation is not four components");
  return Math.max(
    Math.abs((reported[0] as number) - expected.x),
    Math.abs((reported[1] as number) - expected.y),
    Math.abs((reported[2] as number) - expected.z),
    Math.abs((reported[3] as number) - expected.w),
  );
}

/** The camera's own rotation, as the exporting arm captured it. `FreeCamera` never moves it here. */
export function cityCameraRotation(fixture: ICityFixture): Quaternion {
  const [x, y, z, w] = fixture.camera.rotation;
  return new Quaternion(x as number, y as number, z as number, w as number);
}

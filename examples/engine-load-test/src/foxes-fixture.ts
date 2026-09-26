import { sha256 } from "./identity.js";

/**
 * PRD-449 `bevy-many-foxes`: the canonical fixture the pinned Bevy arm exported, the f64 oracles
 * both arms are checked against, and the correspondence digests that prove two independent glTF
 * loaders read the same clip, the same mesh and the same skeleton.
 *
 * The asset is the pinned `Fox.glb` itself, and both arms hash it. The clip's keyframes, its
 * interpolation and the joint order come from the glTF JSON inside that file, because Bevy 0.19
 * keeps a loaded `AnimationClip`'s curves in a private map of `VariableCurve`s: there is no runtime
 * accessor for them. The bone poses both arms report at six frames are what prove the clip was
 * evaluated the same way on both sides.
 */

export const FOXES_UPSTREAM_COMMIT = "c6f634ca9f406d68ba5109d921247b654cb42c10";
export const FOXES_FAMILY = "bevy-many-foxes";
export const FOXES_FIXTURE_SCHEMA = 1;
/** The pinned asset: `assets/models/animated/Fox.glb`, Git blob `1ef5c0d0…`, 162,852 bytes. */
export const FOXES_ASSET_SHA256 =
  "d97044e701822bac5a62696459b27d7b375aada5de8574ed4362edbba94771f7";
export const FOXES_ASSET_BYTES = 162_852;
/** Upstream's `add_clips` order is `[2, 1, 0]` and it plays `node_indices[0]`. */
export const FOXES_ACTIVE_CLIP = 2;

/**
 * Preregistered tolerances, derived from the pinned engine's own f32 arithmetic rather than from any
 * result. The 600-frame cell applies 720 clock steps, and the disagreement this family measures is
 * almost entirely *bevy's*: it accumulates its elapsed time and each ring's rotation in f32, while the
 * counterpart arm accumulates its clip time in doubles and composes each ring's rotation in f64 once
 * (its worst oracle disagreement is 4.9e-13, eleven orders of magnitude inside `oracleAbs`).
 *
 * With `n = 720` steps, `u = 2^-24 = 5.96e-8` and the ring's accumulated angle at 1 rad/s over 12 s:
 *
 * - `quaternionAbs = 1e-3`, from the first-order f32 bound of a quaternion *product* accumulated `n`
 *   times, `n · u · theta = 2.6e-4` on a component, at 4x.
 * - `matrixAbs = 4e-3`, from the same angle error times the largest ring radius: `8 · 2.6e-4` is
 *   2.1e-3, at 2x. A skin matrix entry is a world position under the pinned 0.01 instance scale, so
 *   this is the one quantity whose magnitude the ring radius sets.
 * - `boneAbs = oracleAbs = 1e-3`, from the f32 *sum* bound on the accumulated playhead,
 *   `u · (n/60) · sqrt(n) = 1.9e-5 s`, against the clip's fastest channel — the fixture's oracle
 *   channel is chosen as the largest max-min in the clip, 12.23 units over 1.158 s, so 10.6 units/s —
 *   which is 2.0e-4, at 5x. The rig is authored in centimetres, so an absolute bound is meaningful.
 * - `poseScalarAbs = 1e-4`: the same quantity averaged over 24 bones and 7 components, which can only
 *   shrink it.
 *
 * These are horizon bounds. At the 2-frame gate they are far looser than the arithmetic needs, which is
 * deliberate: one declared constant, checked at whatever horizon the cell runs, rather than a
 * tolerance that moves with the frame count.
 */
export const FOXES_TOLERANCE = {
  boneAbs: 1e-3,
  matrixAbs: 4e-3,
  oracleAbs: 1e-3,
  poseScalarAbs: 1e-4,
  quaternionAbs: 1e-3,
} as const;

export interface IFoxesClip {
  readonly channels: number;
  readonly digest: string;
  readonly duration: number;
  readonly index: number;
  readonly interpolation: string;
  readonly keys: number;
  readonly name: string;
  readonly nodes: readonly string[];
  readonly targets: number;
}

export interface IFoxesFox {
  readonly entityIndex: number;
  readonly index: number;
  readonly joints: number;
  readonly phase: number;
  readonly ring: number;
  readonly rotation: readonly number[];
  readonly scale: readonly number[];
  readonly translation: readonly number[];
}

export interface IFoxesRing {
  readonly direction: string;
  readonly foxes: number;
  readonly index: number;
  readonly radius: number;
  readonly sign: number;
}

export interface IFoxesOracleChannel {
  readonly channel: number;
  readonly component: number;
  readonly components: number;
  readonly node: string;
  readonly property: string;
  readonly times: readonly number[];
  readonly values: readonly number[];
}

export interface IFoxesFrameSchedule {
  readonly firstScoredFrameTimeDeltas: number;
  readonly foxSpeed: number;
  readonly frameDelta: number;
  readonly measuredFrames: number;
  readonly warmupFrames: number;
}

export interface IFoxesFixture {
  readonly asset: { readonly bytes: number; readonly name: string; readonly sha256: string };
  readonly camera: {
    readonly far: number;
    readonly fovDegrees: number;
    readonly msaa: string;
    readonly near: number;
    readonly position: readonly number[];
    readonly rotation: readonly number[];
  };
  readonly clips: readonly IFoxesClip[];
  readonly counts: {
    readonly directionalLights: number;
    readonly foxes: number;
    readonly joints: number;
    readonly requestedFoxes: number;
    readonly rings: number;
  };
  readonly environment: {
    readonly antialias: string;
    readonly background: string;
    readonly motionBlur: boolean;
    readonly shadowMapsEnabled: boolean;
  };
  readonly family: string;
  readonly foxes: readonly IFoxesFox[];
  readonly frameSchedule: IFoxesFrameSchedule;
  readonly light: {
    readonly cascades: readonly number[];
    readonly rotation: readonly number[];
    readonly shadowMapsEnabled: boolean;
  };
  readonly material: {
    readonly baseColor: readonly number[];
    readonly metallic: number;
    readonly perceptualRoughness: number;
    readonly texture: {
      readonly format: string;
      readonly height: number;
      readonly width: number;
    } | null;
    readonly textureBinding: string;
  };
  readonly mesh: {
    readonly digest: string;
    readonly hasNormals: boolean;
    readonly indexCount: number;
    readonly joints: number;
    readonly sourceIndexed: boolean;
    readonly triangles: number;
    readonly vertices: number;
  };
  readonly oracleChannel: IFoxesOracleChannel;
  readonly plane: {
    readonly color: readonly number[];
    readonly mesh: {
      readonly indexCount: number;
      readonly indices: string;
      readonly normals: string;
      readonly positions: string;
      readonly triangles: number;
      readonly uvs: string;
      readonly vertices: number;
    };
  };
  readonly probeFoxIndices: readonly number[];
  readonly rings: readonly IFoxesRing[];
  readonly runtime: {
    readonly clips: readonly {
      readonly curves: number;
      readonly duration: number;
      readonly index: number;
      readonly targets: number;
    }[];
  };
  readonly schedule: string;
  readonly schemaVersion: number;
  readonly skin: {
    readonly bindposeDigest: string;
    readonly inverseBindMatrices: readonly (readonly number[])[];
    readonly joints: readonly string[];
  };
  readonly source: {
    readonly adapterSha256: string;
    readonly commit: string;
    readonly patch: readonly string[];
  };
  readonly variant: "sync" | "staggered";
  readonly viewport: { readonly height: number; readonly width: number };
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
  const parsed = number(value, code);
  if (!Number.isInteger(parsed) || parsed < 0) fail(code, "expected a non-negative integer");
  return parsed;
}

function text(value: unknown, code: string): string {
  if (typeof value !== "string" || value.length === 0) fail(code, "expected a non-empty string");
  return value;
}

function numbers(value: unknown, code: string, length?: number): number[] {
  if (!Array.isArray(value)) fail(code, "expected an array");
  const parsed = value.map((entry) => number(entry, code));
  if (length !== undefined && parsed.length !== length) fail(code, `expected ${length} components`);
  return parsed;
}

function hex(value: unknown, code: string, length: number): string {
  const parsed = text(value, code);
  if (parsed.length !== length || !/^[0-9a-f]+$/.test(parsed))
    fail(code, `expected ${length} lowercase hex characters`);
  return parsed;
}

const BASE64_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/**
 * Base64 without `atob`, which the native host does not shim. The other families encode base64 by
 * hand for the same reason; decoding is the mirror of that and the alphabet check is what makes a
 * truncated channel a named failure instead of silent bytes.
 */
export function base64ToBytes(value: string, code: string): Uint8Array {
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(value) || value.length % 4 !== 0)
    fail(code, "not canonical base64");
  const out = new Uint8Array(
    (value.length / 4) * 3 - (value.endsWith("==") ? 2 : value.endsWith("=") ? 1 : 0),
  );
  let at = 0;
  for (let index = 0; index < value.length; index += 4) {
    const chunk = [0, 1, 2, 3].map((offset) => {
      const character = value[index + offset];
      return character === undefined || character === "=" ? 0 : BASE64_ALPHABET.indexOf(character);
    });
    if (chunk.some((digit) => digit < 0)) fail(code, "not canonical base64");
    const packed =
      ((((chunk[0] as number) << 2) | ((chunk[1] as number) >> 4)) << 16) |
      (((((chunk[1] as number) & 15) << 4) | ((chunk[2] as number) >> 2)) << 8) |
      (((chunk[2] as number) & 3) << 6) |
      (chunk[3] as number);
    const count = value[index + 2] === "=" ? 1 : value[index + 3] === "=" ? 2 : 3;
    for (let byte = 0; byte < count; byte += 1) out[at++] = (packed >> (16 - byte * 8)) & 0xff;
  }
  return out;
}

export function parseFoxesFixture(text_: string): IFoxesFixture {
  const root = object(JSON.parse(text_), "TN_BENCH_FOXES_FIXTURE");
  const code = "TN_BENCH_FOXES_FIXTURE";
  if (root.schemaVersion !== FOXES_FIXTURE_SCHEMA) fail(code, "schemaVersion");
  if (root.family !== FOXES_FAMILY) fail(code, "family");
  if (root.schedule !== "bevy-fractional-frame-boundary/1") fail(code, "schedule");
  const source = object(root.source, `${code}.source`);
  if (source.commit !== FOXES_UPSTREAM_COMMIT) fail(code, "upstream commit");
  if (!Array.isArray(source.patch) || source.patch.length === 0)
    fail(code, "the adapter patch must be disclosed");
  hex(source.adapterSha256, `${code}.source.adapterSha256`, 64);
  hex(source.upstreamSha256, `${code}.source.upstreamSha256`, 64);

  const asset = object(root.asset, `${code}.asset`);
  if (asset.name !== "Fox.glb") fail(code, "the pinned asset is Fox.glb");
  if (count(asset.bytes, "asset.bytes") !== FOXES_ASSET_BYTES) fail(code, "asset byte length");
  if (hex(asset.sha256, "asset.sha256", 64) !== FOXES_ASSET_SHA256)
    fail(code, "the fixture does not name the pinned asset digest");
  text(asset.attribution, "asset.attribution");

  const camera = object(root.camera, `${code}.camera`);
  const environment = object(root.environment, `${code}.environment`);
  const light = object(root.light, `${code}.light`);
  const counts = object(root.counts, `${code}.counts`);
  const material = object(root.material, `${code}.material`);
  const mesh = object(root.mesh, `${code}.mesh`);
  const plane = object(root.plane, `${code}.plane`);
  const planeMesh = object(plane.mesh, `${code}.plane.mesh`);
  const oracleChannel = object(root.oracleChannel, `${code}.oracleChannel`);
  const rawTexture = material.texture;

  const rawClips = root.clips;
  if (!Array.isArray(rawClips) || rawClips.length === 0) fail(code, "clips");
  const clips: IFoxesClip[] = rawClips.map((entry, index) => {
    const clip = object(entry, `${code}.clips[${index}]`);
    if (count(clip.index, "clip.index") !== index) fail(code, "clips must be in glTF order");
    return {
      channels: count(clip.channels, "clip.channels"),
      digest: hex(clip.digest, "clip.digest", 16),
      duration: number(clip.duration, "clip.duration"),
      index,
      interpolation: text(clip.interpolation, "clip.interpolation"),
      keys: count(clip.keys, "clip.keys"),
      name: text(clip.name, "clip.name"),
      nodes: Array.isArray(clip.nodes)
        ? clip.nodes.map((node) => text(node, "clip.nodes"))
        : fail(code, "clip.nodes"),
      targets: count(clip.targets, "clip.targets"),
    };
  });
  const active = clips[FOXES_ACTIVE_CLIP];
  if (active === undefined) fail(code, "the played clip is missing");

  const rawRings = root.rings;
  if (!Array.isArray(rawRings) || rawRings.length === 0) fail(code, "rings");
  const rings: IFoxesRing[] = rawRings.map((entry, index) => {
    const ring = object(entry, `${code}.rings[${index}]`);
    if (count(ring.index, "ring.index") !== index) fail(code, "rings must be in spawn order");
    const sign = number(ring.sign, "ring.sign");
    if (sign !== 1 && sign !== -1) fail(code, "a ring direction is a sign");
    return {
      direction: text(ring.direction, "ring.direction"),
      foxes: count(ring.foxes, "ring.foxes"),
      index,
      radius: number(ring.radius, "ring.radius"),
      sign,
    };
  });

  const rawFoxes = root.foxes;
  if (!Array.isArray(rawFoxes) || rawFoxes.length === 0) fail(code, "foxes");
  const foxes: IFoxesFox[] = rawFoxes.map((entry, index) => {
    const fox = object(entry, `${code}.foxes[${index}]`);
    if (count(fox.index, "fox.index") !== index) fail(code, "foxes must be in spawn order");
    const rotation = numbers(fox.rotation, "fox.rotation", 4);
    if (count(fox.entityIndex, "fox.entityIndex") === 0 && index === 0)
      fail(code, "fox 0's entity index");
    return {
      entityIndex: count(fox.entityIndex, "fox.entityIndex"),
      index,
      joints: count(fox.joints, "fox.joints"),
      phase: number(fox.phase, "fox.phase"),
      ring: count(fox.ring, "fox.ring"),
      rotation,
      scale: numbers(fox.scale, "fox.scale", 3),
      translation: numbers(fox.translation, "fox.translation", 3),
    };
  });

  const skin = object(root.skin, `${code}.skin`);
  const jointNames = Array.isArray(skin.joints)
    ? skin.joints.map((joint) => text(joint, "skin.joints"))
    : fail(code, "skin.joints");
  const rawBinds = skin.inverseBindMatrices;
  if (!Array.isArray(rawBinds) || rawBinds.length !== jointNames.length)
    fail(code, "one inverse bind matrix per joint");
  const binds = rawBinds.map((entry) => numbers(entry, "skin.inverseBindMatrices", 16));

  const schedule = object(root.frameSchedule, `${code}.frameSchedule`);
  const frameSchedule: IFoxesFrameSchedule = {
    firstScoredFrameTimeDeltas: count(
      schedule.firstScoredFrameTimeDeltas,
      "firstScoredFrameTimeDeltas",
    ),
    foxSpeed: number(schedule.foxSpeed, "foxSpeed"),
    frameDelta: number(schedule.frameDelta, "frameDelta"),
    measuredFrames: count(schedule.measuredFrames, "measuredFrames"),
    warmupFrames: count(schedule.warmupFrames, "warmupFrames"),
  };
  if (frameSchedule.measuredFrames === 0) fail(code, "a run with no measured frame");
  if (frameSchedule.foxSpeed <= 0) fail(code, "the ring speed is positive");
  for (const ring of rings)
    if (ring.foxes === 0 || ring.radius <= 0) fail(code, "a ring holds foxes at a positive radius");
  const census = rings.reduce((total, ring) => total + ring.foxes, 0);
  if (census !== foxes.length) fail(code, "the ring census does not sum to the fox count");
  if (count(counts.foxes, "counts.foxes") !== foxes.length) fail(code, "counts.foxes");
  if (counts.requestedFoxes !== foxes.length) fail(code, "requested and actual foxes must agree");
  if (count(counts.joints, "counts.joints") !== jointNames.length) fail(code, "counts.joints");
  for (const fox of foxes)
    if (fox.joints !== jointNames.length) fail(code, "every fox must carry every joint");

  const times = numbers(oracleChannel.times, "oracleChannel.times");
  const values = numbers(oracleChannel.values, "oracleChannel.values");
  if (times.length !== values.length || times.length < 2)
    fail(code, "the oracle channel needs at least two keys");
  for (let index = 1; index < times.length; index += 1)
    if ((times[index] as number) <= (times[index - 1] as number))
      fail(code, "the oracle channel's key times must increase");
  const oracle: IFoxesOracleChannel = {
    channel: count(oracleChannel.channel, "oracleChannel.channel"),
    component: count(oracleChannel.component, "oracleChannel.component"),
    components: count(oracleChannel.components, "oracleChannel.components"),
    node: text(oracleChannel.node, "oracleChannel.node"),
    property: text(oracleChannel.property, "oracleChannel.property"),
    times,
    values,
  };
  if (!jointNames.includes(oracle.node)) fail(code, "the oracle node is not a joint");
  if (oracle.component >= oracle.components) fail(code, "the oracle component is out of range");
  if (count(oracleChannel.animation, "oracleChannel.animation") !== FOXES_ACTIVE_CLIP)
    fail(code, "the oracle must read the played clip");

  const rawProbes = root.probeFoxIndices;
  if (!Array.isArray(rawProbes) || rawProbes.length === 0) fail(code, "probeFoxIndices");
  const probeFoxIndices = rawProbes.map((entry) => count(entry, "probeFoxIndices"));
  for (const index of probeFoxIndices)
    if (index >= foxes.length) fail(code, "a probe is outside the fox set");

  const runtime = object(root.runtime, `${code}.runtime`);
  const rawRuntimeClips = runtime.clips;
  if (!Array.isArray(rawRuntimeClips) || rawRuntimeClips.length !== clips.length)
    fail(code, "the runtime clip census must cover every clip");
  const runtimeClips = rawRuntimeClips.map((entry, index) => {
    const clip = object(entry, `${code}.runtime.clips[${index}]`);
    if (count(clip.index, "runtime clip index") !== index) fail(code, "runtime clip order");
    return {
      curves: count(clip.curves, "runtime clip curves"),
      duration: number(clip.duration, "runtime clip duration"),
      index,
      targets: count(clip.targets, "runtime clip targets"),
    };
  });
  for (const clip of runtimeClips) {
    const declared = clips[clip.index];
    if (declared === undefined) fail(code, "a runtime clip is outside the declared set");
    // The Bevy arm's own observation of each clip it loaded, against the file's declaration.
    if (clip.curves !== declared.channels || clip.targets !== declared.targets)
      fail(code, "a runtime clip's curve or target count disagrees with the file");
    if (Math.abs(clip.duration - declared.duration) > 1e-6)
      fail(code, "a runtime clip's duration disagrees with the file");
  }

  const viewport = object(root.viewport, `${code}.viewport`);
  const variant = root.variant;
  if (variant !== "sync" && variant !== "staggered") fail(code, "variant");

  return {
    asset: {
      bytes: FOXES_ASSET_BYTES,
      name: "Fox.glb",
      sha256: FOXES_ASSET_SHA256,
    },
    camera: {
      far: number(camera.far, "camera.far"),
      fovDegrees: number(camera.fovDegrees, "camera.fovDegrees"),
      msaa: text(camera.msaa, "camera.msaa"),
      near: number(camera.near, "camera.near"),
      position: numbers(camera.position, "camera.position", 3),
      rotation: numbers(camera.rotation, "camera.rotation", 4),
    },
    clips,
    counts: {
      directionalLights: count(counts.directionalLights, "counts.directionalLights"),
      foxes: foxes.length,
      joints: jointNames.length,
      requestedFoxes: count(counts.requestedFoxes, "counts.requestedFoxes"),
      rings: rings.length,
    },
    environment: {
      antialias: text(environment.antialias, "environment.antialias"),
      background: text(environment.background, "environment.background"),
      motionBlur: environment.motionBlur === true,
      shadowMapsEnabled: environment.shadowMapsEnabled === true,
    },
    family: FOXES_FAMILY,
    foxes,
    frameSchedule,
    light: {
      cascades: Array.isArray(light.cascades) ? numbers(light.cascades, "light.cascades") : [],
      rotation: numbers(light.rotation, "light.rotation", 4),
      shadowMapsEnabled: light.shadowMapsEnabled === true,
    },
    material: {
      baseColor: numbers(material.baseColor, "material.baseColor", 4),
      metallic: number(material.metallic, "material.metallic"),
      perceptualRoughness: number(material.perceptualRoughness, "material.perceptualRoughness"),
      texture:
        rawTexture === null || rawTexture === undefined
          ? null
          : (() => {
              const texture = object(rawTexture, "material.texture");
              return {
                format: text(texture.format, "material.texture.format"),
                height: count(texture.height, "material.texture.height"),
                width: count(texture.width, "material.texture.width"),
              };
            })(),
      textureBinding: text(material.textureBinding, "material.textureBinding"),
    },
    mesh: {
      digest: hex(mesh.digest, "mesh.digest", 16),
      hasNormals: mesh.hasNormals === true,
      indexCount: count(mesh.indexCount, "mesh.indexCount"),
      joints: count(mesh.joints, "mesh.joints"),
      sourceIndexed: mesh.sourceIndexed === true,
      triangles: count(mesh.triangles, "mesh.triangles"),
      vertices: count(mesh.vertices, "mesh.vertices"),
    },
    oracleChannel: oracle,
    plane: {
      color: numbers(plane.color, "plane.color", 4),
      mesh: {
        indexCount: count(planeMesh.indexCount, "plane.mesh.indexCount"),
        indices: text(planeMesh.indices, "plane.mesh.indices"),
        normals: text(planeMesh.normals, "plane.mesh.normals"),
        positions: text(planeMesh.positions, "plane.mesh.positions"),
        triangles: count(planeMesh.triangles, "plane.mesh.triangles"),
        uvs: text(planeMesh.uvs, "plane.mesh.uvs"),
        vertices: count(planeMesh.vertices, "plane.mesh.vertices"),
      },
    },
    probeFoxIndices,
    rings,
    runtime: { clips: runtimeClips },
    schedule: "bevy-fractional-frame-boundary/1",
    schemaVersion: FOXES_FIXTURE_SCHEMA,
    skin: {
      bindposeDigest: hex(skin.bindposeDigest, "skin.bindposeDigest", 16),
      inverseBindMatrices: binds,
      joints: jointNames,
    },
    source: {
      adapterSha256: String(source.adapterSha256),
      commit: FOXES_UPSTREAM_COMMIT,
      patch: (source.patch as string[]).map((entry) => String(entry)),
    },
    variant,
    viewport: {
      height: count(viewport.height, "viewport.height"),
      width: count(viewport.width, "viewport.width"),
    },
  };
}

/** The fixture's identity is the digest of the bytes the exporting arm wrote. */
export async function foxesFixtureHash(text_: string): Promise<string> {
  return sha256(new TextEncoder().encode(text_));
}

export function foxesPlaneMeshChannels(fixture: IFoxesFixture): {
  indices: Uint32Array;
  normals: Float32Array;
  positions: Float32Array;
  uvs: Float32Array;
} {
  const mesh = fixture.plane.mesh;
  if (mesh.indexCount !== mesh.triangles * 3) fail("TN_BENCH_FOXES_PLANE", "index count");
  if (mesh.vertices === 0 || mesh.triangles === 0) fail("TN_BENCH_FOXES_PLANE", "empty geometry");
  const read = (value: string, stride: number): Float32Array => {
    const bytes = base64ToBytes(value, "TN_BENCH_FOXES_PLANE");
    if (bytes.length % (stride * 4) !== 0) fail("TN_BENCH_FOXES_PLANE", "channel length");
    return new Float32Array(bytes.buffer, bytes.byteOffset, bytes.length / 4);
  };
  const positions = read(mesh.positions, 3);
  const normals = read(mesh.normals, 3);
  const uvs = read(mesh.uvs, 2);
  const indexBytes = base64ToBytes(mesh.indices, "TN_BENCH_FOXES_PLANE");
  if (indexBytes.length % 4 !== 0) fail("TN_BENCH_FOXES_PLANE", "index length");
  const indices = new Uint32Array(
    indexBytes.buffer,
    indexBytes.byteOffset,
    indexBytes.byteLength / 4,
  );
  if (positions.length !== mesh.vertices * 3) fail("TN_BENCH_FOXES_PLANE", "position count");
  for (const index of indices)
    if (index >= mesh.vertices) fail("TN_BENCH_FOXES_PLANE", "an index is outside the vertex set");
  return { indices, normals, positions, uvs };
}

// ---------------------------------------------------------------------------------------------
// The oracles. Both are composed in f64 from the fixture's own schedule, never accumulated in f32,
// so a 600-step composition cannot drift into a conformance failure that is the reader's arithmetic
// rather than the scene's.
// ---------------------------------------------------------------------------------------------

/** How many non-zero `Time` deltas have been applied by the end of a measured frame. */
export function foxesTimeDeltas(fixture: IFoxesFixture, frame: number): number {
  return fixture.frameSchedule.firstScoredFrameTimeDeltas + frame;
}

/**
 * The rotation a ring must carry at a measured frame: upstream spawns every ring at
 * `Transform::default()` and turns it by `sign * speed / radius * dt` per applied delta, so the whole
 * rotation is composed here from identity.
 */
export function foxesRingRotation(
  fixture: IFoxesFixture,
  ring: number,
  frame: number,
): [number, number, number, number] {
  const row = fixture.rings[ring];
  if (row === undefined) fail("TN_BENCH_FOXES_RING", `no ring ${ring}`);
  const angle =
    ((row.sign * fixture.frameSchedule.foxSpeed * fixture.frameSchedule.frameDelta) / row.radius) *
    foxesTimeDeltas(fixture, frame);
  return [0, Math.sin(angle / 2), 0, Math.cos(angle / 2)];
}

/** The quaternion distance used for every rotation comparison, sign-insensitive. */
export function foxesRotationDelta(
  reported: readonly number[],
  expected: readonly number[],
): number {
  if (reported.length !== 4 || expected.length !== 4)
    fail("TN_BENCH_FOXES_ROTATION", "four components");
  let dot = 0;
  for (let index = 0; index < 4; index += 1) {
    const value = reported[index] as number;
    if (!Number.isFinite(value)) fail("TN_BENCH_FOXES_ROTATION", "not finite");
    dot += value * (expected[index] as number);
  }
  return Math.max(0, 1 - Math.abs(dot));
}

/** The largest absolute difference over two same-length numeric arrays. */
export function foxesMaxDelta(reported: readonly number[], expected: readonly number[]): number {
  if (reported.length !== expected.length)
    fail("TN_BENCH_FOXES_DELTA", `length ${reported.length} against ${expected.length}`);
  let worst = 0;
  for (let index = 0; index < reported.length; index += 1) {
    const value = reported[index] as number;
    if (!Number.isFinite(value)) fail("TN_BENCH_FOXES_DELTA", "not finite");
    worst = Math.max(worst, Math.abs(value - (expected[index] as number)));
  }
  return worst;
}

/**
 * The clip time a fox must have reached at a measured frame, and the oracle channel's value there.
 * The staggered phase is an entity index over ten, so this is a wrapped f64 composition of a phase
 * that can exceed forty seconds; `duration` is the fixture's own f32 value widened, so both arms
 * wrap on the same number.
 */
export function foxesOracleTime(fixture: IFoxesFixture, fox: number, frame: number): number {
  const row = fixture.foxes[fox];
  if (row === undefined) fail("TN_BENCH_FOXES_ORACLE", `no fox ${fox}`);
  const duration = fixture.clips[FOXES_ACTIVE_CLIP]?.duration ?? 0;
  if (duration <= 0) fail("TN_BENCH_FOXES_ORACLE", "the played clip has no duration");
  const elapsed = foxesTimeDeltas(fixture, frame) * fixture.frameSchedule.frameDelta;
  return (row.phase + elapsed) % duration;
}

export function foxesOracleValue(fixture: IFoxesFixture, fox: number, frame: number): number {
  const { times, values } = fixture.oracleChannel;
  const time = foxesOracleTime(fixture, fox, frame);
  const last = times.length - 1;
  if (time <= (times[0] as number)) return values[0] as number;
  if (time >= (times[last] as number)) return values[last] as number;
  for (let index = 1; index <= last; index += 1) {
    const right = times[index] as number;
    if (time > right) continue;
    const left = times[index - 1] as number;
    const span = right - left;
    const weight = span > 0 ? (time - left) / span : 0;
    const from = values[index - 1] as number;
    return from + weight * ((values[index] as number) - from);
  }
  return values[last] as number;
}

// ---------------------------------------------------------------------------------------------
// The correspondence digests. FNV-1a 64 over the canonical streams the adapter's header declares:
// it answers "did the two arms' bytes agree", not "is this file authentic". The SHA-256 locks are the
// asset file and the fixture file.
// ---------------------------------------------------------------------------------------------

const FNV_OFFSET = 14695981039346656037n;
const FNV_PRIME = 1099511628211n;
const MASK = 0xffffffffffffffffn;

class Digest {
  #state = FNV_OFFSET;
  bytes(values: Uint8Array): this {
    for (const value of values) {
      this.#state = ((this.#state ^ BigInt(value)) * FNV_PRIME) & MASK;
    }
    return this;
  }
  text(value: string): this {
    const encoded = new TextEncoder().encode(value);
    return this.bytes(encoded).bytes(new Uint8Array([0]));
  }
  u32(value: number): this {
    const out = new Uint8Array(4);
    new DataView(out.buffer).setUint32(0, value, true);
    return this.bytes(out);
  }
  f32(value: number): this {
    const out = new Uint8Array(4);
    new DataView(out.buffer).setFloat32(0, value, true);
    return this.bytes(out);
  }
  f32Array(values: ArrayLike<number>): this {
    for (let index = 0; index < values.length; index += 1) this.f32(values[index] as number);
    return this;
  }
  hex(): string {
    return this.#state.toString(16).padStart(16, "0");
  }
}

/** One channel of a clip, as the digest's input, in the glTF property vocabulary. */
export interface IFoxesClipChannelDigest {
  readonly interpolation: string;
  readonly node: string;
  readonly property: string;
  readonly times: ArrayLike<number>;
  readonly values: ArrayLike<number>;
}

/** `threenative-foxes-clip/1`, over the arrays the arm actually holds. */
export function foxesClipDigest(
  name: string,
  channels: readonly IFoxesClipChannelDigest[],
): string {
  const digest = new Digest().text("threenative-foxes-clip/1").text(name).u32(channels.length);
  for (const channel of channels) {
    digest
      .text(channel.node)
      .text(channel.property)
      .text(channel.interpolation)
      .u32(channel.times.length)
      .f32Array(channel.times)
      .f32Array(channel.values);
  }
  return digest.hex();
}

/** `threenative-foxes-bindposes/1`, over the matrices the arm uploaded to its `Skeleton`. */
export function foxesBindposeDigest(binds: readonly (readonly number[])[]): string {
  const digest = new Digest().text("threenative-foxes-bindposes/1").u32(binds.length);
  for (const matrix of binds) {
    if (matrix.length !== 16) fail("TN_BENCH_FOXES_DIGEST", "a bind matrix is not 4x4");
    for (const value of matrix) digest.f32(value);
  }
  return digest.hex();
}

export interface IFoxesMeshDigestInput {
  readonly hasNormals: boolean;
  readonly indices: ArrayLike<number>;
  readonly joints: ArrayLike<number>;
  readonly positions: ArrayLike<number>;
  readonly uvs: ArrayLike<number>;
}

/**
 * `threenative-foxes-mesh/1`, over the buffers the arm uploaded. Indices arrive already widened to
 * `u32`, because the pinned primitive declares no index accessor: bevy keeps the mesh non-indexed
 * and three's loader generates a sequential index, and unwinding both to the same triangle list is
 * what lets one digest cover the two. The skin weights are outside the stream on purpose — three's
 * loader renormalises them and bevy does not — and the fixture's mesh census says so.
 */
export function foxesMeshDigest(mesh: IFoxesMeshDigestInput): string {
  const digest = new Digest()
    .text("threenative-foxes-mesh/1")
    .u32(mesh.positions.length / 3)
    .u32(mesh.indices.length)
    .bytes(new Uint8Array([mesh.hasNormals ? 1 : 0]));
  digest.f32Array(mesh.positions).f32Array(mesh.uvs);
  for (let vertex = 0; vertex < mesh.joints.length; vertex += 4) {
    for (let component = 0; component < 4; component += 1) {
      const value = mesh.joints[vertex + component] as number;
      const out = new Uint8Array(2);
      new DataView(out.buffer).setUint16(0, value, true);
      digest.bytes(out);
    }
  }
  for (let index = 0; index < mesh.indices.length; index += 1)
    digest.u32(mesh.indices[index] as number);
  return digest.hex();
}

import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { clone as cloneSkeleton } from "three/addons/utils/SkeletonUtils.js";
import {
  type AnimationAction,
  type AnimationClip,
  AnimationMixer,
  BufferAttribute,
  BufferGeometry,
  Color,
  DirectionalLight,
  LoopRepeat,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  PerspectiveCamera,
  Quaternion,
  REVISION,
  Scene,
  type Texture,
  Vector3,
  WebGPURenderer,
} from "three/webgpu";
import {
  FOXES_ACTIVE_CLIP,
  FOXES_ASSET_SHA256,
  FOXES_TOLERANCE,
  type IFoxesFixture,
  type IFoxesMeshDigestInput,
  base64ToBytes,
  foxesBindposeDigest,
  foxesClipDigest,
  foxesFixtureHash,
  foxesMaxDelta,
  foxesMeshDigest,
  foxesPlaneMeshChannels,
  foxesRingRotation,
  parseFoxesFixture,
} from "./foxes-fixture.js";
import { sha256 } from "./identity.js";

/**
 * PRD-449 `bevy-many-foxes`: the ThreeNative counterpart arm. It loads the pinned `Fox.glb` bytes this
 * bundle was built with, lays out the ring hierarchy and the fifty foxes exactly as the fixture
 * states, and drives every fox's own skeleton from the fixture clock — one `AnimationMixer` per fox,
 * never a shared pose and never a rigid clone.
 *
 * **`SkeletalMesh3D` is deliberately not used here, and the reason is the point.** The manifest entry
 * is right about a skeleton-safe clone and wrong about this workload's semantics twice over:
 *
 * 1. Its `AnimationPlayer` applies the stride convention to a looping clip by default, holding the
 *    playback rate inside 0.15x–3x of the ground the body covers. Upstream's foxes are parented under
 *    a rotating ring and never translate relative to it, so every fox's measured ground speed is zero
 *    and the rate would clamp to the 0.15 floor — while the pinned source plays every clip at rate
 *    1.0. `strideSync: false` restores the authored rate, and at that point the wrapper contributes
 *    nothing this workload needs: `AnimationPlayer` is a thin `AnimationMixer` over the same three.js
 *    a game would use, and its measured rate would itself be a per-clip foot-plant sample the timed
 *    path should not pay for.
 * 2. Its `size` normalisation is opt-in and is omitted here, which preserves the pinned 0.01 scale
 *    exactly — the one thing this cell must not change.
 *
 * What the entry got right is the one thing a naive `Object3D.clone()` gets wrong: a cloned
 * `SkinnedMesh` shares its `Skeleton`, so the clone would drive the source's bones. `SkeletonUtils` is
 * therefore used directly, once per fox.
 */

declare global {
  var canvas: HTMLCanvasElement | undefined;
}

declare const __TN_FOXES_ASSET_B64__: string;
declare const __TN_FOXES_CONFIG__: Readonly<{
  authoring: string;
  fixtureJson: string;
}>;

const STATE_FRAMES = [0, 1, 60, 120, 300, 599];
/** The joints whose 4x4 skin matrix both arms report: the rig root and a mid-leg joint. */
const SKIN_PROBE_JOINTS = [0, 12];

function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

function percentile(samples: readonly number[], fraction: number): number {
  const sorted = [...samples].sort((a, b) => a - b);
  return sorted[Math.ceil(fraction * sorted.length) - 1] as number;
}

/** The glTF property path the fixture's oracle names, as the three track suffix it maps to. */
const TRACK_SUFFIX: Record<string, string> = {
  rotation: "quaternion",
  scale: "scale",
  translation: "position",
};

interface IParsedGltf {
  readonly animations: readonly AnimationClip[];
  readonly map: Texture | null;
  readonly scene: Object3D;
}

function parseGltf(bytes: Uint8Array): Promise<IParsedGltf> {
  return new Promise((resolve, reject) => {
    new GLTFLoader().parse(
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
      "",
      (gltf) => {
        let map: Texture | null = null;
        gltf.scene.traverse((object) => {
          const material = (object as Mesh).material as MeshStandardMaterial | undefined;
          if (map === null && material !== undefined && material.map !== null) map = material.map;
        });
        resolve({ animations: gltf.animations ?? [], map, scene: gltf.scene });
      },
      (error: unknown) => reject(new Error(`TN_BENCH_FOXES_GLTF_PARSE:${String(error)}`)),
    );
  });
}

/**
 * The clip's correspondence digest, rebuilt from the tracks this arm actually holds rather than from
 * the fixture's numbers: each `nodeName.quaternion` track is the glTF `rotation` channel of that
 * node, and `GLTFLoader` pushes them in the file's channel order.
 */
function observedClipDigest(animations: readonly AnimationClip[], index: number): string | null {
  const clip = animations[index];
  if (clip === undefined) return null;
  return foxesClipDigest(
    clip.name,
    clip.tracks.map((track) => {
      const dot = track.name.lastIndexOf(".");
      const node = dot < 0 ? track.name : track.name.slice(0, dot);
      const suffix = dot < 0 ? "" : track.name.slice(dot + 1);
      const property = Object.entries(TRACK_SUFFIX).find(([, value]) => value === suffix)?.[0];
      if (property === undefined) throw new Error(`TN_BENCH_FOXES_TRACK_SUFFIX:${suffix}`);
      return {
        interpolation: "linear",
        node,
        property,
        times: (track as unknown as { times: ArrayLike<number> }).times,
        values: track.values,
      };
    }),
  );
}

function foxOf(source: Object3D): Mesh {
  let found: Mesh | null = null;
  source.traverse((object) => {
    if ((object as { isSkinnedMesh?: boolean }).isSkinnedMesh === true) found = object as Mesh;
  });
  if (found === null) throw new Error("TN_BENCH_FOXES_NO_SKINNED_MESH");
  return found;
}

function quaternionArray(quaternion: Quaternion): number[] {
  return [quaternion.x, quaternion.y, quaternion.z, quaternion.w];
}

function bonePose(bone: Object3D): number[] {
  return [
    bone.position.x,
    bone.position.y,
    bone.position.z,
    bone.quaternion.x,
    bone.quaternion.y,
    bone.quaternion.z,
    bone.quaternion.w,
  ];
}

function poseScalar(bones: readonly Object3D[]): number {
  let total = 0;
  for (const bone of bones) for (const value of bonePose(bone)) total += value;
  return total / (bones.length * 7);
}

function matrixArray(matrix: Matrix4): number[] {
  return [...matrix.toArray()];
}

async function main(): Promise<void> {
  const config = __TN_FOXES_CONFIG__;
  const surface = globalThis.canvas;
  if (surface === undefined) throw new Error("TN_BENCH_NO_CANVAS");
  if (config.authoring !== "default")
    throw new Error(`TN_BENCH_FOXES_BAD_AUTHORING:${config.authoring}`);
  const fixture = parseFoxesFixture(config.fixtureJson);
  const fixtureHash = await foxesFixtureHash(config.fixtureJson);
  const { width, height } = fixture.viewport;
  surface.width = width;
  surface.height = height;

  // The asset: the pinned bytes, hashed before anything reads them, refused unless they are the
  // pinned file. §5.1's "the same asset bytes" is this check rather than an argument.
  const asset = base64ToBytes(__TN_FOXES_ASSET_B64__, "TN_BENCH_FOXES_ASSET_B64");
  const assetSha256 = await sha256(asset);
  if (assetSha256 !== FOXES_ASSET_SHA256 || asset.length !== fixture.asset.bytes)
    throw new Error(`TN_BENCH_FOXES_ASSET_MISMATCH:${assetSha256}`);

  const renderer = new WebGPURenderer({ antialias: false, canvas: surface });
  renderer.setPixelRatio(1);
  renderer.setSize(width, height, false);
  await renderer.init();
  renderer.info.autoReset = false;
  renderer.shadowMap.enabled = fixture.environment.shadowMapsEnabled;

  const scene = new Scene();
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
  camera.quaternion.set(
    fixture.camera.rotation[0] as number,
    fixture.camera.rotation[1] as number,
    fixture.camera.rotation[2] as number,
    fixture.camera.rotation[3] as number,
  );

  const gltf = await parseGltf(asset);
  const clip = gltf.animations[FOXES_ACTIVE_CLIP];
  const declaredClip = fixture.clips[FOXES_ACTIVE_CLIP];
  if (clip === undefined || declaredClip === undefined)
    throw new Error("TN_BENCH_FOXES_ACTIVE_CLIP_ABSENT");
  if (declaredClip.name !== clip.name) throw new Error(`TN_BENCH_FOXES_CLIP_NAME:${clip.name}`);

  // One source rig, then one skeleton-safe clone and one mixer per fox.
  const source = gltf.scene;
  const sourceSkin = foxOf(source) as unknown as Mesh & {
    skeleton: { bones: Object3D[]; boneInverses: Matrix4[] };
  };
  const observedJoints = sourceSkin.skeleton.bones.map((bone) => bone.name);
  if (observedJoints.length !== fixture.skin.joints.length)
    throw new Error("TN_BENCH_FOXES_JOINT_COUNT");
  for (let index = 0; index < observedJoints.length; index += 1)
    if (observedJoints[index] !== fixture.skin.joints[index])
      throw new Error(`TN_BENCH_FOXES_JOINT_NAME:${index}`);

  // The bind matrices: the fixture's own bytes, cross-checked against what this loader read, so the
  // two rigs are known to agree before a single bone is posed.
  const observedBinds = sourceSkin.skeleton.boneInverses.map(matrixArray);
  for (let index = 0; index < observedBinds.length; index += 1) {
    const delta = foxesMaxDelta(
      observedBinds[index] as number[],
      fixture.skin.inverseBindMatrices[index] as number[],
    );
    if (delta > FOXES_TOLERANCE.matrixAbs)
      throw new Error(`TN_BENCH_FOXES_BINDPOSE:${index}:${delta}`);
  }
  const bindposeDigest = foxesBindposeDigest(observedBinds);
  if (bindposeDigest !== fixture.skin.bindposeDigest)
    throw new Error(`TN_BENCH_FOXES_BINDPOSE_DIGEST:${bindposeDigest}`);
  const clipDigest = observedClipDigest(gltf.animations, FOXES_ACTIVE_CLIP);
  if (clipDigest === null || clipDigest !== declaredClip.digest)
    throw new Error(`TN_BENCH_FOXES_CLIP_DIGEST:${String(clipDigest)}`);

  // The mesh digest, re-derived from the geometry this arm actually holds.
  const geometry = sourceSkin.geometry;
  const positions = geometry.getAttribute("position").array as Float32Array;
  const uvs = geometry.getAttribute("uv").array as Float32Array;
  const skinIndex = geometry.getAttribute("skinIndex");
  const skinWeight = geometry.getAttribute("skinWeight");
  if (skinIndex === undefined || skinWeight === undefined)
    throw new Error("TN_BENCH_FOXES_SKIN_ATTRIBUTES_ABSENT");
  const jointValues = skinIndex.array as ArrayLike<number>;
  const joints = new Uint16Array(jointValues.length);
  for (let index = 0; index < joints.length; index += 1)
    joints[index] = jointValues[index] as number;
  const vertexCount = positions.length / 3;
  const indexAttribute = geometry.getIndex();
  const indices = new Uint32Array(vertexCount);
  if (indexAttribute === null) {
    for (let index = 0; index < vertexCount; index += 1) indices[index] = index;
  } else {
    const raw = indexAttribute.array as ArrayLike<number>;
    if (raw.length !== vertexCount) throw new Error("TN_BENCH_FOXES_INDEX_COUNT");
    for (let index = 0; index < vertexCount; index += 1) indices[index] = raw[index] as number;
  }
  for (const index of indices)
    if (index >= vertexCount) throw new Error("TN_BENCH_FOXES_INDEX_RANGE");
  // Two channels are outside the digest because two loaders legitimately differ on them, and both
  // are recorded in the fixture. Normals: bevy's loader computes flat normals for this primitive
  // because the pinned file declares none, so this arm computes them too and the fox is lit rather
  // than black. Weights: three's loader renormalises every vertex's four of them, bevy takes them as
  // authored. The digest still carries the normals flag, so a side that had values would differ.
  if (geometry.getAttribute("normal") === undefined) geometry.computeVertexNormals();
  const meshInput: IFoxesMeshDigestInput = {
    hasNormals: fixture.mesh.hasNormals,
    indices,
    joints,
    positions,
    uvs,
  };
  const meshDigest = foxesMeshDigest(meshInput);
  if (meshDigest !== fixture.mesh.digest)
    throw new Error(`TN_BENCH_FOXES_MESH_DIGEST:${meshDigest}`);
  if (vertexCount !== fixture.mesh.vertices || indices.length !== fixture.mesh.indexCount)
    throw new Error("TN_BENCH_FOXES_MESH_CENSUS");

  if (fixture.material.texture !== null) {
    if (gltf.map === null) throw new Error("TN_BENCH_FOXES_TEXTURE_ABSENT");
    const size = gltf.map.image as { height?: number; width?: number };
    if (
      size.width !== fixture.material.texture.width ||
      size.height !== fixture.material.texture.height
    )
      throw new Error("TN_BENCH_FOXES_TEXTURE_SIZE");
  }

  const material = new MeshStandardMaterial({
    color: new Color().setRGB(
      fixture.material.baseColor[0] as number,
      fixture.material.baseColor[1] as number,
      fixture.material.baseColor[2] as number,
      "srgb-linear",
    ),
    map: gltf.map,
    metalness: fixture.material.metallic,
    roughness: fixture.material.perceptualRoughness,
  });

  // Rings first, then the foxes under them: the hierarchy is the upstream one, so a ring's rotation
  // carries every fox it holds and this arm reproduces it from the fixture's own schedule.
  const ringNodes: Object3D[] = fixture.rings.map((ring) => {
    const node = new Object3D();
    node.name = `ring-${ring.index}`;
    scene.add(node);
    return node;
  });
  const foxes: {
    action: AnimationAction;
    binds: readonly Matrix4[];
    bones: Object3D[];
    index: number;
    mixer: AnimationMixer;
    node: Object3D;
  }[] = [];
  for (const entry of fixture.foxes) {
    const node = cloneSkeleton(source);
    const parent = ringNodes[entry.ring];
    if (parent === undefined) throw new Error(`TN_BENCH_FOXES_RING:${entry.ring}`);
    parent.add(node);
    node.position.set(
      entry.translation[0] as number,
      entry.translation[1] as number,
      entry.translation[2] as number,
    );
    node.quaternion.set(
      entry.rotation[0] as number,
      entry.rotation[1] as number,
      entry.rotation[2] as number,
      entry.rotation[3] as number,
    );
    node.scale.set(entry.scale[0] as number, entry.scale[1] as number, entry.scale[2] as number);
    const skin = foxOf(node) as unknown as {
      skeleton: { bones: Object3D[]; boneInverses: Matrix4[] };
    };
    if (skin.skeleton.bones.length !== fixture.skin.joints.length)
      throw new Error("TN_BENCH_FOXES_CLONE_JOINTS");
    // Every fox plays the same clip on its own mixer, at the phase the exporting arm observed rather
    // than at a re-derived one: upstream seeks to its own entity index over ten.
    const mixer = new AnimationMixer(node);
    const action = mixer.clipAction(clip);
    action.setLoop(LoopRepeat, Number.POSITIVE_INFINITY);
    action.play();
    action.time = entry.phase;
    foxes.push({
      action,
      binds: skin.skeleton.boneInverses,
      bones: skin.skeleton.bones,
      index: entry.index,
      mixer,
      node,
    });
  }

  // The plane, from the fixture's own bytes: upstream's `Plane3d` is four vertices, so §6.1's "exact
  // mesh and index buffers" is a byte comparison rather than a matching name.
  const plane = foxesPlaneMeshChannels(fixture);
  const planeGeometry = new BufferGeometry();
  planeGeometry.setAttribute("position", new BufferAttribute(plane.positions, 3));
  planeGeometry.setAttribute("normal", new BufferAttribute(plane.normals, 3));
  planeGeometry.setAttribute("uv", new BufferAttribute(plane.uvs, 2));
  planeGeometry.setIndex(new BufferAttribute(plane.indices, 1));
  const planeMaterial = new MeshStandardMaterial({
    color: new Color().setRGB(
      fixture.plane.color[0] as number,
      fixture.plane.color[1] as number,
      fixture.plane.color[2] as number,
      "srgb-linear",
    ),
  });
  scene.add(new Mesh(planeGeometry, planeMaterial));

  // Bevy's `DirectionalLight` shines along its own -Z after `looking_at`; three's shines from
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

  const schedule = fixture.frameSchedule;
  // Measured frame 0 must find every fox's playhead `firstScoredFrameTimeDeltas` steps past its phase,
  // and the exporting arm's ring rotation is the f64 composition of the same count, so the warmup
  // runs exactly the steps that precede the first scored frame and nothing else.
  const presteps = schedule.firstScoredFrameTimeDeltas - 1;
  if (presteps < 0) throw new Error("TN_BENCH_FOXES_NO_PRESTEPS");
  const step = (frame: number): void => {
    steps += 1;
    for (let index = 0; index < ringNodes.length; index += 1) {
      const rotation = foxesRingRotation(fixture, index, frame);
      (ringNodes[index] as Object3D).quaternion.set(
        rotation[0],
        rotation[1],
        rotation[2],
        rotation[3],
      );
    }
    for (const fox of foxes) fox.mixer.update(schedule.frameDelta);
  };

  const backend = renderer.backend as unknown as {
    device?: { queue?: { onSubmittedWorkDone?: () => Promise<void> } };
  };
  const drain = async (): Promise<void> => {
    if (backend.device?.queue?.onSubmittedWorkDone === undefined)
      throw new Error("TN_BENCH_GPU_COMPLETION_UNAVAILABLE");
    await backend.device.queue.onSubmittedWorkDone();
  };

  const oracleJoint = fixture.skin.joints.indexOf(fixture.oracleChannel.node);
  const probeSet = new Set(fixture.probeFoxIndices);
  let steps = 0;
  const state = (): Record<string, unknown> => {
    const probes: Record<string, unknown>[] = [];
    const scalars: number[] = [];
    for (const fox of foxes) {
      const scalar = poseScalar(fox.bones);
      scalars.push(scalar);
      if (!probeSet.has(fox.index)) continue;
      const oracle = fox.bones[oracleJoint];
      if (oracle === undefined) throw new Error("TN_BENCH_FOXES_ORACLE_JOINT");
      const skinMatrices: number[][] = [];
      for (const joint of SKIN_PROBE_JOINTS) {
        const bone = fox.bones[joint];
        const bind = fox.binds[joint];
        if (bone === undefined || bind === undefined)
          throw new Error(`TN_BENCH_FOXES_SKIN_PROBE:${joint}`);
        bone.updateWorldMatrix(false, false);
        skinMatrices.push(matrixArray(new Matrix4().multiplyMatrices(bone.matrixWorld, bind)));
      }
      probes.push({
        bonePoses: fox.bones.map((bone) => bonePose(bone)),
        index: fox.index,
        joints: fox.bones.length,
        oracleRotation: quaternionArray(oracle.quaternion),
        oracleTranslation: [oracle.position.x, oracle.position.y, oracle.position.z],
        poseScalar: scalar,
        ring: fixture.foxes[fox.index]?.ring ?? 0,
        skinMatrices,
      });
    }
    return {
      foxes: probes,
      // The counterpart of the exporting arm's own system counter: how many ring updates this arm has
      // applied, so §5.1's "validate the actual effect rather than the option name" has evidence on
      // both sides rather than only where a system happens to be countable.
      ringSystemRuns: steps,
      poseScalars: scalars,
      rings: ringNodes.map((node, index) => ({
        index,
        rotation: quaternionArray(node.quaternion),
      })),
    };
  };

  const states: Record<string, unknown>[] = [];
  let work: Record<string, unknown> | null = null;
  try {
    for (let index = 0; index < presteps; index += 1) {
      step(-1 - index);
      // `info.autoReset` is off, so the counters are this arm's own and every frame resets them: read
      // at the midpoint they must describe that one frame, not the 421 frames before it.
      renderer.info.reset();
      await renderer.render(scene, camera);
      await nextFrame();
    }
    await drain();
    const start = performance.now();
    const boundaries = [{ frameId: 0, monotonicMs: start }];
    for (let frame = 0; frame < schedule.measuredFrames; frame += 1) {
      step(frame);
      renderer.info.reset();
      await renderer.render(scene, camera);
      await nextFrame();
      boundaries.push({ frameId: frame + 1, monotonicMs: performance.now() });
      if (STATE_FRAMES.includes(frame)) states.push({ frameId: frame, state: state() });
      if (frame === Math.floor(schedule.measuredFrames / 2)) {
        const triangles = renderer.info.render.triangles;
        work = {
          admittedFoxes:
            fixture.mesh.triangles === 0 ? null : Math.round(triangles / fixture.mesh.triangles),
          authoredFoxes: fixture.counts.foxes,
          mixers: foxes.length,
          note: "three does not expose its per-object visibility set, so the admitted count is derived from the submitted triangles and the fixture's per-mesh triangle count; one mixer per fox is this arm's own count of independently evaluated skeletons",
          sampledAtMeasuredFrame: frame,
          shadowMapsEnabled: renderer.shadowMap.enabled && light.castShadow,
          submittedDrawCalls: renderer.info.render.drawCalls,
          submittedTriangles: triangles,
        };
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
      adapter: await describeAdapter(),
      arm: "tn-desktop",
      asset: { bytes: asset.length, sha256: assetSha256 },
      authoring: config.authoring,
      bindposeDigest,
      boundarySemantics:
        "render-producing frame boundary at the next frame pump after this frame's render, so each interval carries the previous frame's ring update, its animation evaluation, its render submission and any GPU wait",
      clipDigest,
      clipName: clip.name,
      drain: {
        boundaryFrame: schedule.measuredFrames,
        includesUntimedFrames: 1,
        method: "onSubmittedWorkDone",
      },
      family: "bevy-many-foxes",
      fixture: {
        foxes: fixture.counts.foxes,
        hash: fixtureHash,
        sourceCommit: fixture.source.commit,
      },
      frameSchedule: schedule,
      frameP50Ms: percentile(intervals, 0.5),
      frameP95Ms: percentile(intervals, 0.95),
      frameP99Ms: percentile(intervals, 0.99),
      jointNames: observedJoints,
      meanMs: (finalCompletionMs - start) / schedule.measuredFrames,
      meshDigest,
      normals:
        "computed flat by this arm because the pinned primitive declares none; bevy's loader computes them the same way and they are deliberately outside the mesh digest",
      profile: "smoke",
      rawSeries: { boundaries, finalCompletionMs, schemaVersion: 1, unit: "ms" },
      states,
      texture: {
        binding: fixture.material.textureBinding,
        colorSpace: gltf.map?.colorSpace ?? null,
        height: fixture.material.texture?.height ?? null,
        width: fixture.material.texture?.width ?? null,
      },
      threeRevision: REVISION,
      tolerance: FOXES_TOLERANCE,
      variant: fixture.variant,
      viewport: { height, width },
      warmupFrames: schedule.warmupFrames,
      work,
    };
    const payload = JSON.stringify(record);
    console.log("ENGINE_LOAD_TEST_JSON_BEGIN");
    for (let offset = 0; offset < payload.length; offset += 800)
      console.log(`TNJSON:${payload.slice(offset, offset + 800)}`);
    console.log("ENGINE_LOAD_TEST_JSON_END");
  } finally {
    for (const fox of foxes) fox.mixer.stopAllAction();
    material.dispose();
    planeMaterial.dispose();
    planeGeometry.dispose();
    geometry.dispose();
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

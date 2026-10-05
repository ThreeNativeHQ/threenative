import { SkeletalMesh3D } from "@threenative/core";
import { type AnimationClip, Bone, Group, type Object3D, Quaternion, Vector3 } from "three";
import {
  FIRST_PERSON_BODY_LOCOMOTION,
  type ILocomotionSettings,
  THIRD_PERSON_LOCOMOTION,
  createLocomotionDriver,
} from "./locomotion-driver.js";

/**
 * The one scripted speed trace, in metres per second, and how many fixed ticks each speed holds:
 * idle, walk, jog, sprint, back down, then reversals a player actually makes. No direction is ever
 * supplied, because this game authored no directional clips; the driver throws if one is asked for.
 */
const SCRIPT: readonly (readonly [speed: number, ticks: number])[] = [
  [0, 30],
  [1.6, 24],
  [3.4, 24],
  [5.6, 24],
  [2.4, 18],
  [1.2, 18],
  [0, 24],
  [5.6, 2],
  [0, 2],
  [5.6, 2],
  [0, 2],
  [3.4, 1],
  [0, 1],
  [1.6, 1],
  [0, 1],
];
/** The same trace twice: a returning rig has to reach the same settled pose, not a fresh one. */
const PASSES = 2;
/** Idle ticks after the last speed before the actions are released, so the settle is measured. */
const SETTLE_TICKS = 24;
const STEP = 1 / 60;
/** Bones whose local pose must not jump between two adjacent ticks. */
const SAMPLED_BONES = [
  "spine_03",
  "clavicle_l",
  "upperarm_l",
  "lowerarm_l",
  "hand_l",
  "clavicle_r",
  "upperarm_r",
  "lowerarm_r",
  "hand_r",
  "thigh_l",
  "calf_l",
  "foot_l",
  "thigh_r",
  "calf_r",
  "foot_r",
] as const;

/** Everything one consumer publishes every tick, in the shape the playtest reads. */
interface ILocomotionReport {
  activeActions: number;
  clips: string;
  disposed: boolean;
  maxActiveActions: number;
  maxPhaseGap: number;
  maxPoseMetres: number;
  maxPoseRadians: number;
  maxWeightError: number;
  phase: number[];
  releasedActions: number;
  settledActions: number;
  settledClips: string;
  weights: number[];
}

/** One real game consumer: its authored settings, its own rig, its own driver, one mixer. */
function createRig(
  settings: ILocomotionSettings,
  model: { readonly scene: Object3D; readonly animations: readonly AnimationClip[] },
) {
  const group = new Group();
  const player = new SkeletalMesh3D({
    source: model.scene,
    clips: model.animations,
    requiredClips: settings.speedSamples.map(({ clip }) => clip),
    strideSync: false,
  });
  group.add(player.root);
  const bones = new Map<string, Bone>();
  player.root.traverse((node) => {
    if (node instanceof Bone) bones.set(node.name, node);
  });
  const sampled = SAMPLED_BONES.map((name) => {
    const bone = bones.get(name);
    if (bone === undefined)
      throw new Error(`Mannequin locomotion requires the bone '${name}' to sample.`);
    return bone;
  });
  const head = bones.get("Head");
  if (head === undefined)
    throw new Error("Mannequin locomotion requires a Head bone to measure eye height from.");
  const clips = settings.speedSamples.map(({ clip }) => clip);
  const actions = clips.map((name) => player.mixer.clipAction(player.clip(name)));
  const durations = actions.map((action) => action.getClip().duration);
  const driver = createLocomotionDriver(settings, player);
  // Every buffer below is allocated once. The per-tick path only writes into them.
  const weights = clips.map(() => 0);
  const phase = clips.map(() => 0);
  const live = clips.map(() => false);
  const wasLive = clips.map(() => false);
  const previous = sampled.map(() => ({ position: new Vector3(), rotation: new Quaternion() }));
  const normalized = new Quaternion();
  const world = new Vector3();
  const report: ILocomotionReport = {
    activeActions: 0,
    clips: "",
    disposed: false,
    maxActiveActions: 0,
    maxPhaseGap: 0,
    maxPoseMetres: 0,
    maxPoseRadians: 0,
    maxWeightError: 0,
    phase,
    releasedActions: -1,
    settledActions: -1,
    settledClips: "",
    weights,
  };
  let sampledOnce = false;
  return {
    dispose(): void {
      report.settledActions = player.mixer.stats.actions.inUse;
      report.settledClips = report.clips;
      player.dispose();
      report.disposed = true;
      report.releasedActions = player.mixer.stats.actions.total;
    },
    group,
    head,
    report,
    /** One fixed tick: the driver owns the weights, the player owns the actions. */
    tick(speed: number): void {
      driver.update(speed);
      // Request-time sampling, exactly like the reversal trace: the phase join is measured before a
      // tick of playback moves two clips of different lengths apart, which is gait, not a jump.
      let total = 0;
      let dominant = 0;
      let dominantWeight = 0;
      let selected = "";
      for (const [index, action] of actions.entries()) {
        const scheduled = action.isScheduled();
        const weight = scheduled ? action.getEffectiveWeight() : 0;
        if (!Number.isFinite(weight) || weight < 0)
          throw new Error("Locomotion produced a weight that is not finite and non-negative.");
        const duration = durations[index] ?? 0;
        live[index] = scheduled;
        weights[index] = weight;
        phase[index] = duration > 0 ? action.time / duration : 0;
        total += weight;
        if (weight > 0 && clips[index] !== undefined)
          selected = selected.length === 0 ? clips[index] : `${selected}+${clips[index]}`;
        if (weight > dominantWeight) {
          dominant = index;
          dominantWeight = weight;
        }
      }
      report.clips = selected;
      report.activeActions = player.mixer.stats.actions.inUse;
      report.maxActiveActions = Math.max(report.maxActiveActions, report.activeActions);
      report.maxWeightError = Math.max(report.maxWeightError, Math.abs(total - 1));
      // An entering clip joins the dominant contributor's phase when sync is on and starts at its
      // own when it is off; a returning one keeps the phase it already had, so it is not measured.
      for (const [index, scheduled] of live.entries()) {
        if (!scheduled || wasLive[index]) continue;
        const own = phase[index];
        const joined = phase[dominant];
        if (own === undefined || joined === undefined)
          throw new Error("Locomotion lost a phase sample.");
        report.maxPhaseGap = Math.max(report.maxPhaseGap, Math.abs(own - joined));
      }
      player.update(STEP);
      for (const [index, bone] of sampled.entries()) {
        const before = previous[index];
        if (before === undefined) throw new Error("Locomotion lost a sampled bone.");
        // glTF float32 quaternions are only near unit length, so compare normalized copies and
        // never touch the played bone.
        normalized.copy(bone.quaternion).normalize();
        bone.getWorldPosition(world);
        if (sampledOnce) {
          report.maxPoseRadians = Math.max(
            report.maxPoseRadians,
            normalized.angleTo(before.rotation),
          );
          report.maxPoseMetres = Math.max(report.maxPoseMetres, world.distanceTo(before.position));
        }
        before.rotation.copy(normalized);
        before.position.copy(world);
      }
      sampledOnce = true;
      for (const [index, scheduled] of live.entries()) wasLive[index] = scheduled;
    },
  };
}

/** Two real rigs on the actual CC0 mannequin, driven by one scripted speed trace. */
export function createLocomotionTrace(model: {
  readonly scene: Object3D;
  readonly animations: readonly AnimationClip[];
}) {
  const third = createRig(THIRD_PERSON_LOCOMOTION, model);
  const first = createRig(FIRST_PERSON_BODY_LOCOMOTION, model);
  const script: number[] = [];
  for (let pass = 0; pass < PASSES; pass++)
    for (const [speed, ticks] of SCRIPT)
      for (let tick = 0; tick < ticks; tick++) script.push(speed);
  const perPass = script.length / PASSES;
  const observation = {
    complete: false,
    first: first.report,
    passes: 0,
    released: false,
    settled: false,
    third: third.report,
    tick: 0,
  };
  let settled = 0;
  return {
    first,
    observation,
    third,
    /** Advance the shared trace by one fixed tick for both consumers. */
    step(): void {
      const speed = script[observation.tick];
      observation.tick += 1;
      if (speed === undefined) {
        if (settled < SETTLE_TICKS) {
          settled += 1;
          observation.settled = true;
          third.tick(0);
          first.tick(0);
          return;
        }
        if (!observation.released) {
          observation.released = true;
          third.dispose();
          first.dispose();
          observation.complete = true;
        }
        return;
      }
      third.tick(speed);
      first.tick(speed);
      observation.passes = Math.min(PASSES, Math.floor(observation.tick / perPass));
    },
  };
}

import { type ICtx, Scene } from "@threenative/core";
import {
  AnimationClip,
  AnimationMixer,
  Bone,
  BoxGeometry,
  Euler,
  Group,
  Mesh,
  type MeshStandardMaterial,
  type PerspectiveCamera,
  Quaternion,
  QuaternionKeyframeTrack,
  Vector3,
} from "three";
import {
  ConstrainedIK,
  type IIKReport,
  type IJointSpec,
} from "../../../integrations/ik/src/constrained-ik.js";
import { gripLook } from "../render/look.js";

/** One idle sway cycle, in seconds. */
const SWAY_SECONDS = 2.4;
/** How far along the rifle the support hand sits, in metres. */
const FOREGRIP_METRES = 0.38;
/** The rifle's grip in body space, in metres: on the shoulder line, the barrel reaching out. */
const GRIP = new Vector3(0, 1.42, 0.1);
/** The rig faces +Z, so the rifle points down its own +Z. */
const FORWARD = new Vector3(0, 0, 1);
/** The rifle box, with its origin at the grip rather than at its middle. */
const rifleGeometry = new BoxGeometry(0.07, 0.1, 0.7).translate(0, 0, 0.2);
/** Frames below this one are not counted into the running worst case. */
const WARMUP_FRAMES = 10;
/**
 * The authored two-handed hold the idle clip plays, the same pose
 * `examples/integrations/ik/tests/admission.test.mjs` validates. The mixer re-applies it every
 * frame, so each solve is a small correction from the animation, never from last frame's solve.
 */
const HOLD: Record<string, readonly [number, number, number, number]> = {
  spine: [0.411505113, -0.157050673, -0.050945871, 0.896327589],
  chest: [0.199890628, -0.146086411, 0.186203637, 0.950805292],
  rShoulder: [0.539380498, 0.021168731, 0.148062556, 0.828672458],
  rElbow: [-0.802057547, 0.328967737, -0.387378558, 0.313722442],
  lShoulder: [0.782780428, -0.051889252, -0.425276231, 0.45133406],
  lElbow: [-0.992100629, -0.0927252, 0.019103443, -0.082300895],
};

const box = new BoxGeometry(1, 1, 1);
const worldA = new Vector3();
const worldB = new Vector3();

function bone(parent: Bone | Group, name: string, x: number, y: number, z: number): Bone {
  const joint = new Bone();
  joint.name = name;
  joint.position.set(x, y, z);
  parent.add(joint);
  return joint;
}

/** A rigid box hanging down the bone's own -Y, so a bend of the chain bends the segment. */
function segment(
  parent: Bone,
  name: string,
  length: number,
  width: number,
  material: MeshStandardMaterial,
): Mesh {
  const mesh = new Mesh(box, material);
  mesh.name = name;
  mesh.scale.set(width, length, width);
  mesh.position.y = -length / 2;
  parent.add(mesh);
  return mesh;
}

/** A small box on the joint itself, so the pose is legible when the arm folds. */
function knuckle(parent: Bone, name: string, size: number, material: MeshStandardMaterial): Mesh {
  const mesh = new Mesh(box, material);
  mesh.name = name;
  mesh.scale.setScalar(size);
  parent.add(mesh);
  return mesh;
}

/** The idle clip: the authored hold with a small chest sway, built in code so nothing ships. */
function idleClip(): AnimationClip {
  const times = [0, SWAY_SECONDS / 2, SWAY_SECONDS];
  const sway = (angle: number) =>
    new Quaternion(...(HOLD.chest ?? [0, 0, 0, 1])).multiply(
      new Quaternion().setFromEuler(new Euler(0, 0, angle)),
    );
  return new AnimationClip(
    "idle",
    SWAY_SECONDS,
    Object.entries(HOLD).map(([name, q]) =>
      name === "chest"
        ? new QuaternionKeyframeTrack(`${name}.quaternion`, times, [
            ...sway(-0.02).toArray(),
            ...sway(0.02).toArray(),
            ...sway(-0.02).toArray(),
          ])
        : new QuaternionKeyframeTrack(`${name}.quaternion`, times, [...q, ...q, ...q]),
    ),
  );
}

/** One joint's rotational allowance, as an offset from whatever pose the mixer supplied this frame. */
function jointSpec(joint: Bone, limit: number): IJointSpec {
  return {
    axes: ["x", "y", "z"],
    bone: joint,
    max: [limit, limit, limit],
    min: [-limit, -limit, -limit],
  };
}

/** A bone's world distance to its parent. A solver that moved a bone instead of turning it shows here. */
function lengthOf(joint: Bone): number {
  const parent = joint.parent;
  if (parent === null) return 0;
  return joint.getWorldPosition(worldA).distanceTo(parent.getWorldPosition(worldB));
}

/**
 * A rifle grip held by two hands, and the measurement of how well the opt-in adapter puts them
 * there: the post-solve residual on the last frame, the running worst over the run, and the largest
 * bone-length change the solve caused.
 */
export class Grip extends Scene {
  override enter(ctx: ICtx) {
    const camera = ctx.camera as PerspectiveCamera;
    camera.position.set(1.6, 1.7, 1.9);
    camera.lookAt(0, 1.35, 0.35);
    ctx.add(camera);
    const look = gripLook(ctx.scene);

    const body = new Group();
    body.name = "body";
    ctx.add(body);

    const pelvis = bone(body, "pelvis", 0, 1, 0);
    const spine = bone(pelvis, "spine", 0, 0.25, 0);
    const chest = bone(spine, "chest", 0, 0.25, 0);
    const rShoulder = bone(chest, "rShoulder", -0.2, 0.15, 0);
    const rElbow = bone(rShoulder, "rElbow", 0, -0.3, 0);
    const rHand = bone(rElbow, "rHand", 0, -0.28, 0);
    const lShoulder = bone(chest, "lShoulder", 0.2, 0.15, 0);
    const lElbow = bone(lShoulder, "lElbow", 0, -0.3, 0);
    const lHand = bone(lElbow, "lHand", 0, -0.28, 0);

    for (const [parent, length, name] of [
      [spine, 0.25, "torso-lower"],
      [chest, 0.25, "torso-upper"],
      [rShoulder, 0.3, "r-upper-arm"],
      [rElbow, 0.28, "r-forearm"],
      [lShoulder, 0.3, "l-upper-arm"],
      [lElbow, 0.28, "l-forearm"],
    ] as const) {
      segment(parent, name, length, 0.1, look.body);
    }
    knuckle(rShoulder, "r-shoulder", 0.16, look.body);
    knuckle(lShoulder, "l-shoulder", 0.16, look.body);
    knuckle(rHand, "r-palm", 0.13, look.body);
    knuckle(lHand, "l-palm", 0.13, look.body);

    const rifle = new Mesh(rifleGeometry, look.rifle);
    rifle.name = "rifle";
    ctx.add(rifle);

    const ik = new ConstrainedIK({
      root: pelvis,
      joints: [
        jointSpec(spine, 0.5),
        jointSpec(chest, 0.5),
        jointSpec(rShoulder, 1.6),
        jointSpec(lShoulder, 1.6),
        jointSpec(rElbow, 1.6),
        jointSpec(lElbow, 1.6),
      ],
      effectors: [
        { bone: rHand, orientation: true },
        { bone: lHand, orientation: true },
      ],
      iterations: 32,
      positionTolerance: 0.005,
      rotationTolerance: 0.01,
    });

    const mixer = new AnimationMixer(body);
    mixer.clipAction(idleClip()).play();

    // Every bone but the root, so a solve that translates a bone instead of turning it is visible.
    const measured = [spine, chest, rShoulder, rElbow, rHand, lShoulder, lElbow, lHand].map(
      (joint) => ({ before: 0, joint, length: 0 }),
    );

    let frames = 0;
    let converged = true;
    let allConverged = true;
    let maxMetres = 0;
    let maxRadians = 0;
    let maxLengthDrift = 0;
    let solveMs = 0;
    let worstMetres = 0;
    let worstRadians = 0;
    let worstLengthDrift = 0;

    const grip = new Vector3();
    const foregrip = new Vector3();
    const rotation = new Quaternion();
    const euler = new Euler(0, 0, 0, "YXZ");
    const aim: [number, number, number, number] = [0, 0, 0, 1];

    /** The rifle's pose, in world metres: yaw ±0.5 rad and pitch -0.2..0.3 rad, as the admission trace. */
    const aimAt = (frame: number): void => {
      rotation.setFromEuler(
        euler.set(-(0.05 + 0.25 * Math.sin(frame / 45)), Math.sin(frame / 60) * 0.5, 0),
      );
      grip.copy(GRIP);
      foregrip.copy(FORWARD).applyQuaternion(rotation).multiplyScalar(FOREGRIP_METRES).add(grip);
      aim[0] = rotation.x;
      aim[1] = rotation.y;
      aim[2] = rotation.z;
      aim[3] = rotation.w;
    };
    /** Both hands on the one rifle frame: the grip hand on the grip, the support hand 0.38 m up it. */
    const targets = (): Parameters<ConstrainedIK["update"]>[0] => [
      { position: grip.toArray(), quaternion: aim },
      { position: foregrip.toArray(), quaternion: aim },
    ];

    // Posed by rendered frame rather than wall time, so every platform's capture of frame N shows
    // the same pose and the measurement is the same number everywhere.
    ctx.beforeRender(() => {
      frames += 1;
      mixer.setTime(frames / 60);
      for (const m of measured) m.before = lengthOf(m.joint);
      aimAt(frames);

      const started = performance.now();
      const report: IIKReport = ik.update(targets());
      solveMs = performance.now() - started;

      maxLengthDrift = 0;
      for (const m of measured) {
        m.length = lengthOf(m.joint);
        maxLengthDrift = Math.max(maxLengthDrift, Math.abs(m.length - m.before));
      }
      maxMetres = 0;
      maxRadians = 0;
      for (const residual of report.residuals) {
        maxMetres = Math.max(maxMetres, residual.metres);
        maxRadians = Math.max(maxRadians, residual.radians ?? 0);
      }
      converged = report.converged;
      allConverged = allConverged && report.converged;
      if (frames > WARMUP_FRAMES) {
        worstMetres = Math.max(worstMetres, maxMetres);
        worstRadians = Math.max(worstRadians, maxRadians);
        worstLengthDrift = Math.max(worstLengthDrift, maxLengthDrift);
      }

      rifle.position.copy(grip);
      rifle.quaternion.copy(rotation);
    });

    ctx.entities.add("ik", {
      debug: () => ({
        allConverged,
        converged,
        frames,
        maxLengthDrift,
        maxMetres,
        maxRadians,
        solveMs,
        worstLengthDrift,
        worstMetres,
        worstRadians,
      }),
      dispose: () => ik.dispose(),
      object: body,
    });
  }
}

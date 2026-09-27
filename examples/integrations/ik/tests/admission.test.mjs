import assert from "node:assert/strict";
import { test } from "node:test";
import { Link } from "closed-chain-ik/core";
import {
  Bone,
  BufferGeometry,
  Euler,
  Group,
  MeshBasicMaterial,
  Object3D,
  Quaternion,
  Skeleton,
  SkinnedMesh,
  Vector3,
} from "three";
import { CCDIKSolver } from "three/addons/animation/CCDIKSolver.js";
import { ConstrainedIK } from "../dist/constrained-ik.js";

// Metres, radians, seconds. One tolerance pair for every arm.
const METRES = 0.005;
const RADIANS = 0.01;
const ITERATIONS = 32;
const REPEATS = 10;
const FRAMES = 20;
const DRIFT = 1e-6;
const BARREL = 0.38; // grip -> foregrip along the barrel
const FORWARD = new Vector3(0, 0, 1); // the rig faces +Z, so the barrel does too
const SWEEP = { yaw: [-0.5, 0.5], pitch: [-0.2, 0.3] };

// Grip placement in body space. The brief sketches it at (0, 1.35, 0.45), which puts
// the foregrip 0.92 m from either shoulder against a 0.58 m arm, so no frame of the
// sweep would be reachable and the admission rule would be vacuous. The grip is
// therefore on the shoulder line with the barrel reaching out from it, and the
// authored hold below is baked for exactly this placement.
const GRIP = new Vector3(0, 1.42, 0.1);

// The authored animation pose: a two-handed hold baked offline at the sweep's centre
// (yaw 0, pitch 0.05) by walking the real solver's targets in 24 steps from a neutral
// bent-elbow stance, so the pose is reachable by construction and every frame of the
// sweep is a small correction from it. rig() asserts it still meets the centre frame.
// A hanging A-pose cannot be used here: it is a fully extended, singular chain, and the
// donor locks any degree of freedom that starts on its limit, so an elbow limited to
// [-2.6, 0] around a zero rest angle never moves at all.
const HOLD = {
  spine: [0.411505113, -0.157050673, -0.050945871, 0.896327589],
  chest: [0.199890628, -0.146086411, 0.186203637, 0.950805292],
  rShoulder: [0.539380498, 0.021168731, 0.148062556, 0.828672458],
  rElbow: [-0.802057547, 0.328967737, -0.387378558, 0.313722442],
  lShoulder: [0.782780428, -0.051889252, -0.425276231, 0.45133406],
  lElbow: [-0.992100629, -0.0927252, 0.019103443, -0.082300895],
};

const clamp = (n) => Math.min(1, Math.max(-1, n));
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const angleOf = (a, b) =>
  2 * Math.acos(clamp(Math.abs(a.x * b.x + a.y * b.y + a.z * b.z + a.w * b.w)));
const aimError = (a, b) => Math.acos(clamp(a.dot(b)));
const median = (values) => [...values].sort((a, b) => a - b)[values.length >> 1];
const zip = ([right, left]) => ({
  rMetres: right.metres,
  rRadians: right.radians,
  lMetres: left.metres,
  lRadians: left.radians,
});

/** The world-space rigid hand goals for one aim frame: both hands on one rifle frame. */
function aim(body, yaw, pitch) {
  body.updateMatrixWorld(true);
  const rotation = new Quaternion().setFromEuler(new Euler(-pitch, yaw, 0, "YXZ"));
  const rifle = body.getWorldQuaternion(new Quaternion()).multiply(rotation);
  const grip = GRIP.clone().applyMatrix4(body.matrixWorld);
  // The rifle belongs to the body, so its barrel scales with it.
  const barrel = BARREL * body.getWorldScale(new Vector3()).x;
  const fore = grip.clone().addScaledVector(FORWARD.clone().applyQuaternion(rifle), barrel);
  return { yaw, pitch, grip: grip.toArray(), rifle: rifle.toArray(), fore: fore.toArray() };
}
const goals = (frame) => [
  { position: frame.grip, quaternion: frame.rifle },
  { position: frame.fore, quaternion: frame.rifle },
];

/** 20 aim frames tracing yaw -0.5..0.5 rad against pitch -0.2..0.3 rad. */
const trace = (body) =>
  Array.from({ length: FRAMES }, (_, i) => {
    const t = i / (FRAMES - 1);
    return aim(
      body,
      SWEEP.yaw[0] + t * (SWEEP.yaw[1] - SWEEP.yaw[0]),
      SWEEP.pitch[0] + t * (SWEEP.pitch[1] - SWEEP.pitch[0]),
    );
  });

/**
 * The closed loop under test: chest -> right arm -> rifle -> left arm -> chest, both
 * hands locked to one rigid frame, spine/chest shared by both chains. Pelvis is the root.
 */
function rig({ position = [1, 0, -2], yaw = 0.4, scale = 1 } = {}) {
  const body = new Group();
  body.name = "body";
  body.position.set(...position);
  body.rotation.y = yaw;
  body.scale.setScalar(scale);
  const at = (name, parent, x, y, z) => {
    const bone = new Bone();
    bone.name = name;
    bone.position.set(x, y, z);
    parent.add(bone);
    return bone;
  };
  const pelvis = at("pelvis", body, 0, 1, 0);
  const spine = at("spine", pelvis, 0, 0.25, 0);
  const chest = at("chest", spine, 0, 0.25, 0);
  const rShoulder = at("rShoulder", chest, -0.2, 0.15, 0);
  const rElbow = at("rElbow", rShoulder, 0, -0.3, 0);
  const rHand = at("rHand", rElbow, 0, -0.28, 0);
  const lShoulder = at("lShoulder", chest, 0.2, 0.15, 0);
  const lElbow = at("lElbow", lShoulder, 0, -0.3, 0);
  const lHand = at("lHand", lElbow, 0, -0.28, 0);
  const bones = [pelvis, spine, chest, rShoulder, rElbow, rHand, lShoulder, lElbow, lHand];
  const by = Object.fromEntries(bones.map((bone) => [bone.name, bone]));
  for (const [name, q] of Object.entries(HOLD)) by[name].quaternion.set(...q);
  const ball = (bone, limit) => ({
    bone,
    axes: ["x", "y", "z"],
    min: [-limit, -limit, -limit],
    max: [limit, limit, limit],
  });
  const ik = new ConstrainedIK({
    root: pelvis,
    joints: [
      ball(spine, 0.5),
      ball(chest, 0.5),
      ball(rShoulder, 1.6),
      ball(lShoulder, 1.6),
      // The rig has no wrist bones, so the elbow carries the wrist freedom that holding
      // one rigid frame with two hands needs. A single-axis elbow pins the hand's offset
      // from its own shoulder to the plane perpendicular to the rifle's x axis, which no
      // two-handed hold can satisfy. The sweep uses less than 0.5 rad of this range.
      ball(rElbow, 1.6),
      ball(lElbow, 1.6),
    ],
    effectors: [
      { bone: rHand, orientation: true },
      { bone: lHand, orientation: true },
    ],
    iterations: ITERATIONS,
    positionTolerance: METRES,
    rotationTolerance: RADIANS,
  });
  const rest = bones.map((bone) => bone.quaternion.clone());
  const reset = () => {
    bones.forEach((bone, i) => bone.quaternion.copy(rest[i]));
    body.updateMatrixWorld(true);
  };
  const spans = () =>
    bones.map((bone) =>
      bone.parent
        ? distance(
            bone.parent.getWorldPosition(new Vector3()),
            bone.getWorldPosition(new Vector3()),
          )
        : 0,
    );
  reset();
  // The fixture only means something if the authored pose itself is a valid hold, and
  // the hold was baked at exactly this frame: yaw 0, pitch 0.05.
  const authored = aim(body, 0, 0.05);
  const check = measure(rigResiduals({ by }, authored), authored);
  assert.ok(
    check.every((m) => m.metres <= METRES && m.radians <= RADIANS),
    `authored hold does not meet the centre frame: ${JSON.stringify(check)}`,
  );
  return { body, bones, by, rest, ik, reset, spans };
}

const worldOf = (bone) => ({
  position: bone.getWorldPosition(new Vector3()),
  quaternion: bone.getWorldQuaternion(new Quaternion()),
});
const rigResiduals = (r, frame) => [worldOf(r.by.rHand), worldOf(r.by.lHand)];
const measure = (hands, frame) => {
  const [right, left] = hands;
  const rifle = new Quaternion(...frame.rifle);
  return [
    {
      bone: "rHand",
      metres: distance(right.position, new Vector3(...frame.grip)),
      radians: angleOf(right.quaternion, rifle),
    },
    {
      bone: "lHand",
      metres: distance(left.position, new Vector3(...frame.fore)),
      radians: angleOf(left.quaternion, rifle),
    },
  ];
};
/** Aim error: the rifle the right hand implies against the rifle that was asked for. */
const aimResidual = (r, frame) =>
  aimError(
    FORWARD.clone().applyQuaternion(worldOf(r.by.rHand).quaternion),
    FORWARD.clone().applyQuaternion(new Quaternion(...frame.rifle)),
  );

/** A Three SkinnedMesh view of a rig, plus CCD target bones, for the two baselines. */
function ccdHost(r, names) {
  const targets = names.map((name) => {
    const bone = new Bone();
    bone.name = name;
    return bone;
  });
  const mesh = new SkinnedMesh(new BufferGeometry(), new MeshBasicMaterial());
  mesh.add(r.body, ...targets);
  const bones = [...r.bones, ...targets];
  mesh.bind(new Skeleton(bones));
  const index = new Map(bones.map((bone, i) => [bone.name, i]));
  return {
    mesh,
    targets,
    index,
    chain: (...names) => names.map((name) => ({ index: index.get(name) })),
    dispose: () => {
      mesh.geometry.dispose();
      mesh.material.dispose();
      mesh.skeleton.dispose();
    },
  };
}

function candidateArm() {
  const r = rig();
  let frame = null;
  let before = [];
  let converged = false;
  return {
    name: "candidate",
    prepare(next) {
      r.reset();
      before = r.spans();
      frame = next;
    },
    run() {
      converged = r.ik.update(goals(frame)).converged;
    },
    metrics: () => ({
      converged,
      ...zip(measure(rigResiduals(r, frame), frame)),
      aimRadians: aimResidual(r, frame),
      drift: Math.max(...r.spans().map((d, i) => Math.abs(d - before[i]))),
    }),
  };
}

function ccdArm() {
  const r = rig();
  const host = ccdHost(r, ["grip_goal", "foregrip_goal"]);
  const solver = new CCDIKSolver(host.mesh, [
    {
      target: host.index.get("grip_goal"),
      effector: host.index.get("rHand"),
      links: host.chain("rElbow", "rShoulder", "chest", "spine"),
      iteration: ITERATIONS,
    },
    {
      target: host.index.get("foregrip_goal"),
      effector: host.index.get("lHand"),
      links: host.chain("lElbow", "lShoulder", "chest", "spine"),
      iteration: ITERATIONS,
    },
  ]);
  let frame = null;
  let before = [];
  return {
    name: "ccd",
    prepare(next) {
      r.reset();
      before = r.spans();
      frame = next;
      host.targets[0].position.set(...next.grip);
      host.targets[1].position.set(...next.fore);
      host.mesh.updateMatrixWorld(true);
    },
    run: () => solver.update(),
    metrics: () => ({
      converged: true,
      ...zip(measure(rigResiduals(r, frame), frame)),
      aimRadians: aimResidual(r, frame),
      drift: Math.max(...r.spans().map((d, i) => Math.abs(d - before[i]))),
    }),
    dispose: host.dispose,
  };
}

function attachmentArm() {
  const r = rig();
  const rifle = new Object3D(); // the grip offset is identity: the hand's origin is the grip
  rifle.name = "rifle";
  r.by.rHand.add(rifle);
  const host = ccdHost(r, ["foregrip_goal"]);
  const solver = new CCDIKSolver(host.mesh, [
    {
      target: host.index.get("foregrip_goal"),
      effector: host.index.get("lHand"),
      links: host.chain("lElbow", "lShoulder"),
      iteration: ITERATIONS,
    },
  ]);
  let frame = null;
  let before = [];
  return {
    name: "attachment",
    prepare(next) {
      r.reset();
      r.body.updateMatrixWorld(true);
      before = r.spans();
      frame = next;
      // The rifle rides the right hand, so the left arm only ever sees the foregrip of
      // whatever that hand is actually holding, never the requested one.
      host.targets[0].position
        .copy(rifle.getWorldPosition(new Vector3()))
        .addScaledVector(
          FORWARD.clone().applyQuaternion(rifle.getWorldQuaternion(new Quaternion())),
          BARREL,
        );
      host.mesh.updateMatrixWorld(true);
    },
    run: () => solver.update(),
    metrics: () => ({
      converged: true,
      ...zip(measure(rigResiduals(r, frame), frame)),
      aimRadians: aimResidual(r, frame),
      drift: Math.max(...r.spans().map((d, i) => Math.abs(d - before[i]))),
    }),
    dispose: host.dispose,
  };
}

const TOLERANCES = {
  rMetres: METRES,
  lMetres: METRES,
  rRadians: RADIANS,
  lRadians: RADIANS,
  aimRadians: RADIANS,
  drift: DRIFT,
};

/** Median solve time of one prepared frame, in microseconds, over REPEATS runs. */
function timeFrame(arm, frame) {
  const samples = [];
  for (let i = 0; i < REPEATS; i++) {
    arm.prepare(frame);
    const t0 = performance.now();
    arm.run();
    samples.push((performance.now() - t0) * 1000);
  }
  return samples;
}

/** Every tolerance one measured frame breaks, plus a missed convergence for the candidate. */
function violationsOf(arm, frame, row) {
  const found = Object.entries(TOLERANCES)
    .filter(([metric, tolerance]) => row[metric] > tolerance)
    .map(([metric, tolerance]) => ({
      arm: arm.name,
      frame,
      metric,
      value: row[metric],
      tolerance,
    }));
  if (arm.name === "candidate" && !row.converged)
    found.push({ arm: arm.name, frame, metric: "converged", value: 0, tolerance: 1 });
  return found;
}

function measureArm(arm, frames, violations) {
  const rows = [];
  const micros = [];
  for (const frame of frames) {
    arm.prepare(frame);
    arm.run();
    const row = arm.metrics();
    violations.push(...violationsOf(arm, rows.length, row));
    rows.push(row);
    micros.push(...timeFrame(arm, frame));
  }
  const pick = (metric) => rows.map((row) => row[metric]);
  arm.dispose?.();
  return {
    arm: arm.name,
    maxMetres: Math.max(...pick("rMetres"), ...pick("lMetres")),
    medianMetres: median(pick("rMetres").concat(pick("lMetres"))),
    maxRadians: Math.max(...pick("rRadians"), ...pick("lRadians")),
    medianRadians: median(pick("rRadians").concat(pick("lRadians"))),
    maxAimRadians: Math.max(...pick("aimRadians")),
    maxLengthDrift: Math.max(...pick("drift")),
    medianMicros: Math.round(median(micros)),
  };
}

test("A-D: a rigid two-handed rifle hold converges where the position-only baselines cannot", () => {
  const frames = trace(rig().body);
  const violations = [];
  const summaries = [candidateArm(), ccdArm(), attachmentArm()].map((arm) =>
    measureArm(arm, frames, violations),
  );
  for (const summary of summaries) console.log(JSON.stringify(summary));
  const failing = violations.filter((v) => v.arm === "candidate");
  assert.deepEqual(
    failing,
    [],
    `candidate missed its own tolerances: ${JSON.stringify(failing.slice(0, 8))}`,
  );
  const baselines = violations.filter((v) => v.arm !== "candidate");
  assert.ok(
    baselines.length > 0,
    "no baseline missed a tolerance on any frame: the coupled constraint is not proven, so this admission rule is void",
  );
});

test("E1: one body-space aim solves the same way at identity and at uniform scale 2", () => {
  const plain = rig({ position: [0, 0, 0], yaw: 0, scale: 1 });
  const placed = rig({ position: [1, 0, -2], yaw: 0.4, scale: 2 });
  for (const frame of trace(plain.body)) {
    for (const [host, target] of [
      [plain, frame],
      [placed, aim(placed.body, frame.yaw, frame.pitch)],
    ]) {
      const report = host.ik.update(goals(target));
      assert.ok(
        report.converged,
        `not converged at scale ${host.body.scale.x} on frame ${frame.yaw}`,
      );
      for (const residual of report.residuals) {
        assert.ok(
          residual.metres <= METRES,
          `position residual ${residual.metres} at ${residual.bone}`,
        );
        assert.ok(
          residual.radians <= RADIANS,
          `rotation residual ${residual.radians} at ${residual.bone}`,
        );
      }
    }
  }
  plain.ik.dispose();
  placed.ik.dispose();
});

test("E2: malformed targets throw and leave every bone bit-identical", () => {
  const r = rig();
  const good = goals(trace(r.body)[0]);
  const malformed = [
    [{ position: [Number.NaN, 0, 0], quaternion: good[0].quaternion }, good[1]],
    [{ position: good[0].position, quaternion: [Number.NaN, 0, 0, 1] }, good[1]],
    [{ position: good[0].position, quaternion: [0, 0, 0, 0] }, good[1]],
    [good[0]],
    [good[0], good[1], good[1]],
    [],
    [{ position: good[0].position }, good[1]],
  ];
  for (const targets of malformed) {
    const before = r.bones.map((bone) => bone.quaternion.toArray());
    assert.throws(() => r.ik.update(targets), undefined, `accepted ${JSON.stringify(targets)}`);
    assert.deepEqual(
      r.bones.map((bone) => bone.quaternion.toArray()),
      before,
    );
  }
  r.ik.dispose();
});

test("E3: two solvers are independent and caller-owned target arrays are copied", () => {
  const a = rig();
  const b = rig();
  const untouched = b.bones.map((bone) => bone.quaternion.toArray());
  a.ik.update(goals(trace(a.body)[7]));
  assert.deepEqual(
    b.bones.map((bone) => bone.quaternion.toArray()),
    untouched,
  );
  const pose = () =>
    a.bones.map((bone) => [
      ...bone.quaternion.toArray(),
      ...bone.getWorldPosition(new Vector3()).toArray(),
    ]);
  const targets = goals(trace(a.body)[3]);
  a.ik.update(targets);
  const settled = pose();
  targets[0].position[0] += 5;
  targets[0].quaternion[1] = 0.9;
  targets.length = 0;
  assert.deepEqual(pose(), settled);
  a.ik.dispose();
  b.ik.dispose();
});

test("E4: blend 0 keeps the input pose and blend 0.5 lands between the extremes", () => {
  const r = rig();
  const targets = goals(trace(r.body)[0]);
  const input = r.bones.map((bone) => bone.quaternion.clone());
  const worst = (report) => Math.max(...report.residuals.map((residual) => residual.metres));
  const zero = worst(r.ik.update(targets, 0));
  for (const [i, bone] of r.bones.entries())
    assert.deepEqual(
      bone.quaternion.toArray(),
      input[i].toArray(),
      `${bone.name} moved at blend 0`,
    );
  const half = worst(r.ik.update(targets, 0.5));
  const full = worst(r.ik.update(targets, 1));
  assert.ok(
    half < zero && half > full,
    `blend 0.5 residual ${half} is not between ${zero} and ${full}`,
  );
  r.ik.dispose();
});

test("E5: dispose is idempotent and the adapter refuses later work", () => {
  const r = rig();
  r.ik.dispose();
  r.ik.dispose();
  assert.throws(() => r.ik.update(goals(trace(r.body)[0])), /disposed/);
});

test("E6: a non-finite solver pose found mid-write restores the whole input pose", () => {
  const r = rig();
  const before = r.bones.map((bone) => bone.quaternion.toArray());
  // The last row is written after every other bone, so the rollback has real work to undo.
  const original = Link.prototype.getWorldQuaternion;
  Link.prototype.getWorldQuaternion = function (target) {
    original.call(this, target);
    if (this.name === "lHand") target[0] = Number.NaN;
    return target;
  };
  try {
    assert.throws(() => r.ik.update(goals(trace(r.body)[7])), /finite/);
  } finally {
    Link.prototype.getWorldQuaternion = original;
  }
  assert.deepEqual(
    r.bones.map((bone) => bone.quaternion.toArray()),
    before,
  );
  r.ik.dispose();
});

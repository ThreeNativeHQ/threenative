import {
  AnimationClip,
  Bone,
  Group,
  InterpolateDiscrete,
  Quaternion,
  QuaternionKeyframeTrack,
  Vector3,
  VectorKeyframeTrack,
} from "three";
import { describe, expect, it } from "vitest";
import { CompositionCharacter } from "../../../examples/animation-composition/src/character.js";
import { AnimationComposer } from "../src/animation-composition.js";
import { FixedStepLoop } from "../src/loop.js";
import "../../physics/src/web.js";
import { CharacterBody3D } from "../../physics/src/CharacterBody3D.js";
import { CollisionShape3D } from "../../physics/src/CollisionShape3D.js";
import { RigidBody3D } from "../../physics/src/RigidBody3D.js";
import { rapier } from "../../physics/src/plugin.js";

function travellingRig(yaw = 0) {
  const body = new Group();
  const root = new Group();
  body.add(root);
  const hips = new Bone();
  hips.name = "Hips";
  root.add(hips);
  const end = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), yaw);
  const clip = new AnimationClip("walk", 1, [
    new VectorKeyframeTrack("Hips.position", [0, 1], [0, 0, 0, 0, 0, 1]),
    new QuaternionKeyframeTrack("Hips.quaternion", [0, 1], [0, 0, 0, 1, ...end.toArray()]),
  ]);
  const composer = new AnimationComposer({
    root,
    clips: [clip],
    samples: ["walk"],
    rootMotion: { bone: "Hips", body },
  });
  return { body, root, hips, clip, composer };
}

describe("root motion has one body authority", () => {
  it("keeps turning trajectories identical across fixed-tick subdivisions and loop seams", () => {
    const trace = (steps: readonly number[]) => {
      const r = travellingRig(Math.PI / 2);
      for (const dt of steps) {
        const proposal = r.composer.advance(dt);
        r.body.position.add(proposal.translation);
        r.body.rotation.y += proposal.yaw;
        r.composer.finish(proposal);
      }
      const result = r.body.position.clone();
      r.composer.dispose();
      return result;
    };
    const one = trace([0.5]);
    expect(trace([0.25, 0.25]).distanceTo(one)).toBeLessThan(1e-6);
    expect(trace([0.25, 0.25, 0.25, 0.25]).distanceTo(trace([1]))).toBeLessThan(1e-6);
    expect(trace([1.5]).distanceTo(new Vector3(0.5, 0, 1))).toBeLessThan(1e-6);
    expect(trace(Array.from({ length: 10 }, () => 0.25)).distanceTo(trace([2.5]))).toBeLessThan(
      1e-6,
    );
  });

  it("rejects body or rig-ancestor animation and unsupported root interpolation", () => {
    const r = travellingRig();
    r.composer.dispose();
    expect(
      () =>
        new AnimationComposer({
          root: r.body,
          clips: [r.clip],
          samples: ["walk"],
          rootMotion: { bone: "Hips", body: r.body },
        }),
    ).toThrow(/separate|body/);
    expect(
      () =>
        new AnimationComposer({
          root: r.root,
          clips: [r.clip],
          samples: ["walk"],
          rootMotion: { bone: "Hips", body: r.hips },
        }),
    ).toThrow(/below|descendant|body/);
    const parentTrack = new VectorKeyframeTrack(".position", [0, 1], [0, 0, 0, 0, 0, 10]);
    const animatedParent = new AnimationClip("bad", 1, [...r.clip.tracks, parentTrack]);
    expect(
      () =>
        new AnimationComposer({
          root: r.root,
          clips: [animatedParent],
          samples: ["bad"],
          rootMotion: { bone: "Hips", body: r.body },
        }),
    ).toThrow(/ancestor/);
    const discrete = r.clip.clone();
    discrete.tracks[1]?.setInterpolation(InterpolateDiscrete);
    expect(
      () =>
        new AnimationComposer({
          root: r.root,
          clips: [discrete],
          samples: ["walk"],
          rootMotion: { bone: "Hips", body: r.body },
        }),
    ).toThrow(/linear interpolation/);
  });
  it("integrates fixed intervals and multiple loop seams, strips the skin root once", () => {
    const r = travellingRig();
    const before = JSON.stringify(r.clip.toJSON());
    for (const dt of [0.75, 0.5, 2]) {
      const proposal = r.composer.advance(dt);
      expect(proposal.translation.z).toBeCloseTo(dt);
      r.body.position.add(proposal.translation);
      r.composer.finish({ translation: proposal.translation, yaw: 0 });
      expect(r.hips.position.z).toBe(0);
    }
    expect(r.body.position.z).toBeCloseTo(3.25);
    expect(r.composer.motion.accepted.z).toBeCloseTo(2);
    expect(JSON.stringify(r.clip.toJSON())).toBe(before);
    r.composer.dispose();
  });

  it("unwraps yaw at the quaternion branch and reports pause without reusing motion", () => {
    const r = travellingRig(0.6);
    let proposal = r.composer.advance(0.75);
    expect(proposal.yaw).toBeCloseTo(0.45);
    r.body.position.add(proposal.translation);
    r.body.rotation.y += proposal.yaw;
    r.composer.finish({ translation: proposal.translation, yaw: proposal.yaw });
    proposal = r.composer.advance(0.5);
    expect(proposal.yaw).toBeCloseTo(0.3);
    r.body.position.add(proposal.translation);
    r.body.rotation.y += proposal.yaw;
    r.composer.finish({ translation: proposal.translation, yaw: proposal.yaw });
    r.composer.paused = true;
    proposal = r.composer.advance(0.5);
    expect(proposal.translation.length()).toBe(0);
    expect(proposal.yaw).toBe(0);
    r.composer.finish({ translation: proposal.translation, yaw: proposal.yaw });
    r.composer.dispose();
  });

  it("rejects missing movement observations, duplicate ticks and unsupported transforms", () => {
    const r = travellingRig();
    r.root.scale.set(1, 2, 1);
    expect(() => r.composer.advance(0.1)).toThrow(/nonuniform|uniform/);
    r.root.scale.set(1, 1, 1);
    const proposal = r.composer.advance(0.1);
    expect(() => r.composer.advance(0.1)).toThrow(/finish/);
    expect(() => r.composer.finish()).toThrow(/accepted/);
    expect(() => r.composer.finish({ translation: proposal.translation, yaw: 0 })).toThrow(/body/);
    r.body.position.add(proposal.translation);
    r.composer.finish({ translation: proposal.translation, yaw: 0 });
    expect(() => r.composer.update(0.1)).toThrow(/advance/);
    r.composer.dispose();
  });

  it("stops at a real Rapier wall through the fixed-step phase, then evaluates pose before IK", async () => {
    const plugin = rapier({ gravity: { x: 0, y: 0, z: 0 } });
    const ctx = { physics: undefined } as never;
    await plugin.setup?.(ctx);
    const r = travellingRig();
    const body = new CharacterBody3D({
      object: r.body,
      physics: (ctx as { physics: never }).physics,
      gravity: 0,
      shape: CollisionShape3D.capsule(0.2, 0.3),
    });
    new RigidBody3D({
      type: "fixed",
      position: { x: 0, y: 0, z: 2 },
      physics: (ctx as { physics: never }).physics,
      shape: CollisionShape3D.box(2, 2, 0.5),
    });
    const character = new CompositionCharacter(
      r.composer,
      body,
      () => {},
      () => {
        expect(r.hips.position.z).toBe(0); // Post-pose consumer observes the composed skin pose.
        r.hips.rotation.x = 0.05;
      },
    );
    const loop = new FixedStepLoop({
      step: 1 / 60,
      requestFrame: () => 0,
      cancelFrame: () => {},
      onUpdate: (dt) => {
        character.update(dt);
        plugin.update?.(ctx, dt);
      },
      onAfterPhysics: () => character.afterPhysics(),
    });
    try {
      loop.start();
      loop.advance(240);
      expect(character.ticks).toBe(240);
      expect(r.body.position.z).toBeGreaterThan(1.3);
      expect(r.body.position.z).toBeLessThan(1.5);
      expect(character.blockedTicks).toBeGreaterThan(100);
      expect(r.composer.phase).toBeCloseTo(0);
      expect(r.hips.getWorldPosition(new Vector3()).z).toBeCloseTo(r.body.position.z);
      expect(r.hips.rotation.x).toBeCloseTo(0.05);
    } finally {
      loop.stop();
      character.dispose();
      plugin.dispose?.(ctx);
    }
  });

  it("observes actual Rapier translation and yaw through the game caller over turning seams", async () => {
    const plugin = rapier({ gravity: { x: 0, y: 0, z: 0 } });
    const ctx = { physics: undefined } as never;
    await plugin.setup?.(ctx);
    const r = travellingRig(0.4);
    const body = new CharacterBody3D({
      object: r.body,
      physics: (ctx as { physics: never }).physics,
      gravity: 0,
      shape: CollisionShape3D.capsule(0.2, 0.3),
    });
    const character = new CompositionCharacter(r.composer, body);
    try {
      for (let i = 0; i < 180; i += 1) {
        character.update(1 / 60);
        plugin.update?.(ctx, 1 / 60);
        character.afterPhysics();
        expect(r.hips.position.z).toBe(0);
      }
      expect(r.body.rotation.y).toBeCloseTo(1.2, 4);
      expect(character.ticks).toBe(180);
      expect(r.composer.phase).toBeCloseTo(0);
    } finally {
      character.dispose();
      plugin.dispose?.(ctx);
    }
  });
});

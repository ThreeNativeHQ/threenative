import { AnimationClip, NumberKeyframeTrack, Object3D, VectorKeyframeTrack } from "three";
import { describe, expect, it } from "vitest";
import { AnimationPlayer } from "../src/animation.js";

describe("AnimationPlayer", () => {
  it("should say how to fix a duplicate clip name rather than only that there is one", () => {
    const root = new Object3D();
    const first = new AnimationClip("A_TPose", 1, []);
    const second = new AnimationClip("A_TPose", 1, []);
    // Two stock animation libraries built on one rig both ship a bind pose under this name, which
    // is what a game hits the moment it loads a second `.glb` of clips.
    expect(() => new AnimationPlayer({ clips: [first, second], root })).toThrow(
      /Duplicate animation clip 'A_TPose'\. Two clip sources define it; keep one per name/,
    );
  });

  it("crossfades named clips while keeping action weights normalized", () => {
    const root = new Object3D();
    const idle = new AnimationClip("idle", 1, []);
    const run = new AnimationClip("run", 1, []);
    const player = new AnimationPlayer({ clips: [idle, run], root });

    player.play("idle");
    player.update(1 / 60);
    player.play("run", { fade: 0.5 });

    const weights = () =>
      player.mixer.clipAction(idle).getEffectiveWeight() +
      player.mixer.clipAction(run).getEffectiveWeight();
    expect(weights()).toBeCloseTo(1);
    player.update(0.25);
    expect(weights()).toBeCloseTo(1);
    expect(player.current).toBe("run");
  });

  it("should not pop the pose when a crossfade is interrupted by another clip", () => {
    const root = new Object3D();
    const idle = new AnimationClip("idle", 1, []);
    const run = new AnimationClip("run", 1, []);
    const hit = new AnimationClip("hit", 1, []);
    const player = new AnimationPlayer({ clips: [idle, run, hit], root });
    const weightOf = (clip: AnimationClip): number =>
      player.mixer.clipAction(clip).getEffectiveWeight();
    const total = (): number => weightOf(idle) + weightOf(run) + weightOf(hit);

    player.play("idle");
    player.update(1 / 60);
    player.play("run", { fade: 0.4 });
    player.update(0.2); // halfway: idle and run both contribute

    const runBefore = weightOf(run);
    const idleBefore = weightOf(idle);
    expect(runBefore).toBeGreaterThan(0.1);
    expect(idleBefore).toBeGreaterThan(0.1);

    // Interrupt mid-blend. Nothing may jump: previously `idle` was hard-stopped to 0 and
    // `run` was snapped to 1 in this single call, which is a visible pop on the character.
    player.play("hit", { fade: 0.4 });

    expect(weightOf(run)).toBeCloseTo(runBefore, 3);
    expect(weightOf(idle)).toBeCloseTo(idleBefore, 3);
    expect(weightOf(hit)).toBeCloseTo(0, 3);
    expect(total()).toBeCloseTo(1, 3);

    // ...and the blend still completes on the new clip.
    player.update(0.4);
    expect(weightOf(hit)).toBeCloseTo(1, 3);
    expect(total()).toBeCloseTo(1, 3);
    expect(player.current).toBe("hit");
  });

  it("should ease the blend rather than ramp it linearly", () => {
    const root = new Object3D();
    const idle = new AnimationClip("idle", 1, []);
    const run = new AnimationClip("run", 1, []);
    const player = new AnimationPlayer({ clips: [idle, run], root });

    player.play("idle");
    player.update(1 / 60);
    player.play("run", { fade: 1 });
    player.update(0.25);

    // A linear ramp would sit at 0.25 here; smoothstep(0.25) is ~0.156.
    const weight = player.mixer.clipAction(run).getEffectiveWeight();
    expect(weight).toBeLessThan(0.22);
    expect(weight).toBeGreaterThan(0.1);
  });

  it("throws on an unknown clip and reports mixer advancement", () => {
    const player = new AnimationPlayer({
      clips: [new AnimationClip("idle", 1, [])],
      root: new Object3D(),
    });

    expect(() => player.play("missing")).toThrow("Unknown animation clip 'missing'.");
    player.play("idle");
    player.update(1 / 60);
    expect(player.advancedFrames).toBe(1);
  });

  it("normalizes an interrupted crossfade", () => {
    const root = new Object3D();
    const clips = ["idle", "run", "jump"].map((name) => new AnimationClip(name, 1, []));
    const player = new AnimationPlayer({ clips, root });
    const weights = () =>
      clips.reduce((sum, clip) => sum + player.mixer.clipAction(clip).getEffectiveWeight(), 0);

    player.play("idle");
    player.play("run", { fade: 0.1 });
    player.update(0.01);
    player.play("jump", { fade: 0.1 });
    player.update(0.01);

    expect(weights()).toBeCloseTo(1);
  });

  it("holds the last frame and reports completion for one-shot clips", () => {
    const root = new Object3D();
    const once = new AnimationClip("once", 1, [
      new NumberKeyframeTrack(".position[x]", [0, 1], [0, 1]),
    ]);
    const player = new AnimationPlayer({ clips: [once], root });

    player.play("once", { mode: "once" });
    player.update(0.9);
    expect(player.finished).toBe(false);
    expect(root.position.x).toBeCloseTo(0.9);

    player.update(0.2);
    expect(player.finished).toBe(true);
    expect(root.position.x).toBeCloseTo(1);

    player.update(1);
    expect(player.finished).toBe(true);
    expect(root.position.x).toBeCloseTo(1);

    // A held last frame is not animation progress: three advances mixer.time every update
    // even when nothing animates, so advancedFrames must stop at the finished clip or
    // playtest evaluators read idle frames as proof the clip animated.
    const frozen = player.advancedFrames;
    player.update(1);
    player.update(1);
    expect(player.advancedFrames).toBe(frozen);
  });

  it("applies a mode change when the requested clip is already current", () => {
    const root = new Object3D();
    const clip = new AnimationClip("clip", 1, [
      new NumberKeyframeTrack(".position[x]", [0, 1], [0, 1]),
    ]);
    const player = new AnimationPlayer({ clips: [clip], root });

    player.play("clip");
    player.update(0.25);
    player.play("clip", { mode: "once" });
    player.update(1.1);

    expect(player.finished).toBe(true);
    expect(root.position.x).toBeCloseTo(1);
  });

  it("replays a finished one-shot when the requested clip is already current", () => {
    const root = new Object3D();
    const clip = new AnimationClip("clip", 1, [
      new NumberKeyframeTrack(".position[x]", [0, 1], [0, 1]),
    ]);
    const player = new AnimationPlayer({ clips: [clip], root });

    player.play("clip", { mode: "once" });
    player.update(1.1);
    expect(player.finished).toBe(true);

    player.play("clip", { mode: "once" });
    expect(player.finished).toBe(false);
    expect(player.advancedFrames).toBe(0);
    player.update(0.25);

    expect(root.position.x).toBeCloseTo(0.25);
  });

  it("defaults a finished one-shot replay to looping", () => {
    const root = new Object3D();
    const clip = new AnimationClip("clip", 1, [
      new NumberKeyframeTrack(".position[x]", [0, 1], [0, 1]),
    ]);
    const player = new AnimationPlayer({ clips: [clip], root });

    player.play("clip", { mode: "once" });
    player.update(1.1);
    expect(player.finished).toBe(true);

    player.play("clip");
    expect(player.finished).toBe(false);
    player.update(1.1);

    expect(player.finished).toBe(false);
    expect(root.position.x).toBeCloseTo(0.1);
  });

  it("keeps the default playback mode looping", () => {
    const root = new Object3D();
    const loop = new AnimationClip("loop", 1, [
      new NumberKeyframeTrack(".position[x]", [0, 1], [0, 1]),
    ]);
    const player = new AnimationPlayer({ clips: [loop], root });

    player.play("loop");
    player.update(1.1);

    expect(player.finished).toBe(false);
    expect(root.position.x).toBeCloseTo(0.1);
  });
});

/**
 * Stride sync — the convention that a walking model covers the ground its feet cover.
 *
 * Measured in `sandbox/fps-framework` on 2026-08-25: a soldier patrolling at 2.31 m/s against a
 * walk clip that carries the body 1.31 m/s was played at rate 1.77, and on every patrol pause the
 * clip was switched to idle while the body was still sliding to a stop. Both halves read as wrong
 * to a player — feet spinning faster than the ground, then feet frozen while the body drifts —
 * and both are the same missing mechanism, hand-rolled in that game and in every other one.
 */
describe("AnimationPlayer stride sync", () => {
  const walkClip = () =>
    new AnimationClip("walk", 2, [
      // Two seconds carrying the rig two metres along +z: one metre per clip second.
      new VectorKeyframeTrack(".position", [0, 2], [0, 0, 0, 0, 0, 2]),
    ]);

  /**
   * The shape a real character has: a body the game moves, with the animated rig parented under
   * it. Measuring the rig itself would read the clip's own root track back as if the body had
   * travelled, which is why `strideRoot` exists.
   */
  const character = (options: { strideSync?: boolean; clips: AnimationClip[] }) => {
    const body = new Object3D();
    const rig = new Object3D();
    body.add(rig);
    const player = new AnimationPlayer({
      clips: options.clips,
      root: rig,
      strideRoot: body,
      ...(options.strideSync === undefined ? {} : { strideSync: options.strideSync }),
    });
    return { body, player };
  };

  it("measures a clip's own ground speed from its root track", () => {
    const { player } = character({ clips: [walkClip()] });
    player.play("walk");
    expect(player.stride.clipGroundSpeed).toBeCloseTo(1, 3);
  });

  it("matches playback rate to the ground the body actually covers", () => {
    const { body, player } = character({ clips: [walkClip()] });
    player.play("walk");
    player.update(1 / 60);
    // Two metres per second over a clip that carries one: the feet have to cycle twice as fast.
    body.position.z += 2 * (1 / 60);
    player.update(1 / 60);
    expect(player.stride.groundSpeed).toBeCloseTo(2, 1);
    expect(player.stride.rate).toBeCloseTo(2, 1);
    expect(player.mixer.clipAction(player.clip("walk")).getEffectiveTimeScale()).toBeCloseTo(2, 1);
  });

  it("leaves a clip that carries no ground alone", () => {
    const idle = new AnimationClip("idle", 1, [
      new VectorKeyframeTrack(".position", [0, 1], [0, 0, 0, 0, 0, 0]),
    ]);
    const { body, player } = character({ clips: [idle] });
    player.play("idle");
    player.update(1 / 60);
    body.position.z += 2 * (1 / 60);
    player.update(1 / 60);
    // An idle is not locomotion, so nothing about it is warped by how the body is moving.
    expect(player.stride.synced).toBe(false);
    expect(player.mixer.clipAction(idle).getEffectiveTimeScale()).toBe(1);
  });

  /**
   * "Turning a convention off must not turn its measurement off, and honest reporting when
   * overridden" — the house rule this class has to satisfy to ship the convention on by default.
   */
  it("keeps measuring, and says so, when a game turns it off", () => {
    const { body, player } = character({ clips: [walkClip()], strideSync: false });
    player.play("walk");
    player.update(1 / 60);
    body.position.z += 2 * (1 / 60);
    player.update(1 / 60);
    expect(player.stride.groundSpeed).toBeCloseTo(2, 1);
    expect(player.stride.rate).toBeCloseTo(2, 1);
    expect(player.stride.synced).toBe(false);
    expect(player.stride.overridden).toBe(true);
    // The rate is measured and reported, and deliberately not applied.
    expect(player.mixer.clipAction(player.clip("walk")).getEffectiveTimeScale()).toBe(1);
  });

  it("holds the clip at its slowest honest rate rather than freezing a stopped body", () => {
    const { player } = character({ clips: [walkClip()] });
    player.play("walk");
    player.update(1 / 60);
    player.update(1 / 60); // the body did not move at all
    expect(player.stride.rate).toBeGreaterThan(0);
    expect(player.stride.rate).toBeLessThan(1);
  });

  /**
   * Measured in `sandbox/fps-framework` on 2026-08-27: the enemy death clips carry 0.23–0.36 m/s
   * of hips root motion (the fall itself), and a dying body stands still, so stride sync clamped
   * every death to `STRIDE_RATE_MIN` — a 2.8 s fall spread over 19 s, and the corpse stood
   * upright through its whole respawn window. A `"once"` clip is an event — a death, a flinch, a
   * reload — authored at the rate the event happens at; the convention re-times locomotion, and
   * this is not locomotion.
   */
  it("leaves a one-shot clip at its authored rate even when the clip travels", () => {
    const death = new AnimationClip("death", 2, [
      // Two seconds carrying the rig two metres along +z — root motion, like a fall.
      new VectorKeyframeTrack(".position", [0, 2], [0, 0, 0, 0, 0, 2]),
    ]);
    const { player } = character({ clips: [death] });
    player.play("death", { mode: "once" });
    player.update(1 / 60);
    player.update(1 / 60); // the body did not move at all — a corpse never does
    expect(player.mixer.clipAction(player.clip("death")).getEffectiveTimeScale()).toBe(1);
    // The convention scopes itself out; the game did not override anything.
    expect(player.stride.synced).toBe(false);
    expect(player.stride.overridden).toBe(false);
  });

  /** Backstop for the scoping above: a one-shot must not switch the convention off wholesale. */
  it("still re-times loop clips on the same player after a one-shot", () => {
    const death = new AnimationClip("death", 2, [
      new VectorKeyframeTrack(".position", [0, 2], [0, 0, 0, 0, 0, 2]),
    ]);
    const { body, player } = character({ clips: [death, walkClip()] });
    player.play("death", { mode: "once" });
    player.update(1 / 60);
    player.play("walk");
    player.update(1 / 60);
    body.position.z += 2 * (1 / 60);
    player.update(1 / 60);
    expect(player.stride.rate).toBeCloseTo(2, 1);
    expect(player.stride.synced).toBe(true);
  });
});

/**
 * Stride sync against the clips games actually ship: in-place locomotion.
 *
 * Every clip above carries the rig along a root track, which is the minority authoring
 * convention. The majority — every ActorX/Unreal export, every Mixamo "in place" clip, every
 * stock animal pack — animates the body on the spot and leaves travel entirely to game code.
 *
 * Measured in `sandbox/wildwood` on 2026-09-03 against the PROTOFACTOR animal pack: the true root
 * bone of `ANIM_DeerStag_Walk` carries 0.00000 units of translation, but the clip writes local
 * translation tracks on `STAG_-R-Thigh` and `STAG_-Tail`. `#groundSpeedOf` took the longest
 * horizontal displacement of ANY `.position` track, so a swinging thigh was read as the body's
 * root motion at 0.1287 u/clip-second. Against a 1.3 m/s walk that asks for rate 10.10, clamped
 * to the 3.0 ceiling — so the stag's legs cycled at 3.0x for the whole game while its own stride
 * justifies 1.03x. The owner reported it as "legs ultra fast, but he's moving slowly".
 */
describe("AnimationPlayer stride sync on in-place clips", () => {
  /** A body the game moves, with the animated rig parented under it. */
  const character = (options: { clips: AnimationClip[]; scale?: number }) => {
    const body = new Object3D();
    const rig = new Object3D();
    const foot = new Object3D();
    foot.name = "Foot";
    rig.add(foot);
    body.add(rig);
    if (options.scale !== undefined) body.scale.setScalar(options.scale);
    const player = new AnimationPlayer({ clips: options.clips, root: rig, strideRoot: body });
    return { body, player };
  };

  /**
   * The shape of a real in-place clip: the root never translates, and a limb carries a local
   * translation track that swings back and forth without ever going anywhere.
   */
  const swingingLimb = () =>
    new AnimationClip("walk", 2, [
      new VectorKeyframeTrack("Foot.position", [0, 1, 2], [0, 0, 0.3, 0, 0, -0.3, 0, 0, 0.3]),
    ]);

  it("does not read a swinging limb as the body's root motion", () => {
    const { body, player } = character({ clips: [swingingLimb()] });
    player.play("walk");
    player.update(1 / 60);
    body.position.z += 1 * (1 / 60);
    player.update(1 / 60);
    // The limb goes nowhere: 0.6 units of swing per 2 seconds is not 0.3 m/s of ground.
    expect(player.stride.clipGroundSpeed).toBe(0);
    expect(player.stride.rate).toBe(1);
    expect(player.stride.synced).toBe(false);
  });

  it("says out loud that a clip carries no stride to match, so an override can be seen", () => {
    const { player } = character({ clips: [swingingLimb()] });
    player.play("walk");
    player.update(1 / 60);
    // `synced: false, overridden: false` is what an idle reports too. A game whose walk cycle is
    // not being matched has to be able to tell the two apart.
    expect(player.stride.inPlace).toBe(true);
  });

  /**
   * A clip's translation values are in the rig's own units; the ground the body covers is in
   * world metres. `normaliseToMetres` — the framework's own convention for sizing an import —
   * guarantees the two differ, so the comparison has to cross that scale.
   */
  it("measures a clip's ground speed in the world's metres, not the rig's units", () => {
    const clip = new AnimationClip("walk", 2, [
      new VectorKeyframeTrack(".position", [0, 2], [0, 0, 0, 0, 0, 2]),
    ]);
    const { body, player } = character({ clips: [clip], scale: 0.5 });
    player.play("walk");
    player.update(1 / 60);
    // One unit per clip-second on a rig rendered at half scale is half a metre per clip-second.
    expect(player.stride.clipGroundSpeed).toBeCloseTo(0.5, 3);
    body.position.z += 0.5 * (1 / 60);
    player.update(1 / 60);
    expect(player.stride.rate).toBeCloseTo(1, 1);
  });

  /**
   * The convention doing its job on the clips games ship.
   *
   * A planted foot sweeps backward relative to the body at exactly the body's ground speed, so
   * the stance phase of an in-place cycle states the speed the clip was authored for even though
   * nothing in it translates. Stance is where the contact bone is at the bottom of its own arc.
   */
  const plantedWalk = () =>
    new AnimationClip("walk", 1, [
      new VectorKeyframeTrack(
        "Foot.position",
        [0, 0.6, 0.8, 1],
        [0, 0, 0.25, 0, 0, -0.35, 0, 0.25, 0, 0, 0, 0.25],
      ),
    ]);

  it("matches an in-place walk cycle from the ground its planted foot sweeps", () => {
    const { body, player } = character({ clips: [plantedWalk()] });
    player.play("walk");
    player.update(1 / 60);
    // 0.6 units of backward sweep over the 0.6 s the foot is down: a 1 m/s walk cycle.
    expect(player.stride.clipGroundSpeed).toBeCloseTo(1, 1);
    expect(player.stride.inPlace).toBe(true);
    // The body is walked at twice that, so the cycle has to run at twice the rate.
    for (let frame = 0; frame < 4; frame += 1) {
      body.position.z += 2 * (1 / 60);
      player.update(1 / 60);
    }
    expect(player.stride.rate).toBeCloseTo(2, 1);
    expect(player.stride.synced).toBe(true);
  });
});

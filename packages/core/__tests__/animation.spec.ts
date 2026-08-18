import { AnimationClip, NumberKeyframeTrack, Object3D } from "three";
import { describe, expect, it } from "vitest";
import { AnimationPlayer } from "../src/animation.js";

describe("AnimationPlayer", () => {
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

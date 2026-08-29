import { DataTexture, MeshBasicMaterial, RGBAFormat, Texture, UnsignedByteType } from "three";
import { describe, expect, it } from "vitest";
import { SpriteAnimator3D } from "../src/sprite-animator.js";

const frames = [
  { x: 0, y: 0, width: 8, height: 8, duration: 0.1 },
  { x: 8, y: 0, width: 12, height: 10, duration: 0.2 },
  { x: 20, y: 2, width: 12, height: 8, duration: 0.3 },
] as const;

function atlas(): DataTexture {
  return new DataTexture(new Uint8Array(32 * 16 * 4), 32, 16, RGBAFormat, UnsignedByteType);
}

describe("SpriteAnimator3D", () => {
  it("indexes non-uniform atlas frames on the supplied fixed step", () => {
    const texture = atlas();
    const material = new MeshBasicMaterial({ map: texture });
    const animator = new SpriteAnimator3D({ frames, texture });

    expect(animator.frameIndex).toBe(0);
    expect(texture.repeat.x).toBeCloseTo(8 / 32);
    expect(texture.repeat.y).toBeCloseTo(8 / 16);
    expect(material.map).toBe(texture);

    animator.update(0.099);
    expect(animator.frameIndex).toBe(0);
    animator.update(0.001);
    expect(animator.frameIndex).toBe(1);
    expect(texture.repeat.x).toBeCloseTo(12 / 32);
    expect(texture.repeat.y).toBeCloseTo(10 / 16);
    expect(texture.offset.x).toBeCloseTo(8 / 32);
    expect(texture.offset.y).toBeCloseTo((16 - 10) / 16);

    animator.update(0.2);
    expect(animator.frameIndex).toBe(2);
    expect(texture.offset.y).toBeCloseTo((16 - 2 - 8) / 16);
  });

  it.each(["loop", "pingPong", "once"] as const)("supports %s playback", (mode) => {
    const animator = new SpriteAnimator3D({
      frames: frames.map((frame) => ({ ...frame, duration: 0.1 })),
      mode,
      texture: atlas(),
    });

    animator.update(0.3);
    if (mode === "loop") {
      expect(animator.frameIndex).toBe(0);
      expect(animator.finished).toBe(false);
    } else if (mode === "pingPong") {
      expect(animator.frameIndex).toBe(1);
      expect(animator.finished).toBe(false);
    } else {
      expect(animator.frameIndex).toBe(2);
      expect(animator.finished).toBe(true);
      expect(animator.playing).toBe(false);
    }
  });

  it("can be paused and resumed without advancing from wall time", () => {
    const animator = new SpriteAnimator3D({ frames, texture: atlas() });
    animator.pause();
    animator.update(100);
    expect(animator.frameIndex).toBe(0);
    expect(animator.playing).toBe(false);

    animator.play();
    animator.update(0.1);
    expect(animator.frameIndex).toBe(1);
  });

  it("holds a single frame in looping modes without spinning forever", () => {
    const singleFrame = [{ x: 0, y: 0, width: 8, height: 8, duration: 0.1 }];
    for (const mode of ["loop", "pingPong"] as const) {
      const animator = new SpriteAnimator3D({ frames: singleFrame, mode, texture: atlas() });
      animator.update(1.25);
      expect(animator.frameIndex).toBe(0);
      expect(animator.finished).toBe(false);
      expect(animator.elapsed).toBeCloseTo(0.05);
    }
  });

  it("requires every frame to provide its own duration", () => {
    expect(
      () =>
        new SpriteAnimator3D({
          frames: [{ x: 0, y: 0, width: 8, height: 8 } as never],
          texture: atlas(),
        }),
    ).toThrow("SpriteAnimator3D frame duration");
  });

  it("does not accept a texture without an atlas size or invalid timing", () => {
    expect(
      () =>
        new SpriteAnimator3D({
          frames: [{ x: 0, y: 0, width: 8, height: 8, duration: 0 }],
          texture: new Texture(),
        }),
    ).toThrow("SpriteAnimator3D.texture");
    expect(
      () =>
        new SpriteAnimator3D({
          frames: [{ x: 0, y: 0, width: 8, height: 8, duration: -1 }],
          texture: atlas(),
        }),
    ).toThrow("SpriteAnimator3D frame duration");
  });
});

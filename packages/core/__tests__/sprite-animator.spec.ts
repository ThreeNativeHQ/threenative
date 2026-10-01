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

  it("rejects a non-finite frame duration", () => {
    for (const duration of [Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(
        () =>
          new SpriteAnimator3D({
            frames: [{ x: 0, y: 0, width: 8, height: 8, duration }],
            texture: atlas(),
          }),
      ).toThrow("SpriteAnimator3D frame duration 0 must be positive and finite");
    }
  });

  it("stops back to the first frame and re-applies its atlas rectangle", () => {
    const texture = atlas();
    const animator = new SpriteAnimator3D({ frames, texture });
    animator.update(0.1);
    expect(animator.frameIndex).toBe(1);

    animator.stop();
    expect(animator.frameIndex).toBe(0);
    expect(animator.elapsed).toBe(0);
    expect(animator.finished).toBe(false);
    expect(animator.playing).toBe(false);
    expect(texture.repeat.x).toBeCloseTo(8 / 32);
    expect(texture.repeat.y).toBeCloseTo(8 / 16);
    expect(texture.offset.x).toBeCloseTo(0);
    expect(texture.offset.y).toBeCloseTo((16 - 0 - 8) / 16);
  });

  it("selects a frame directly and reflects off the last frame in pingPong", () => {
    const animator = new SpriteAnimator3D({
      frames: frames.map((frame) => ({ ...frame, duration: 0.1 })),
      mode: "pingPong",
      texture: atlas(),
    });

    animator.setFrame(1);
    expect(animator.frameIndex).toBe(1);
    expect(animator.elapsed).toBe(0);
    animator.update(0.1);
    expect(animator.frameIndex).toBe(2);

    animator.setFrame(2);
    expect(animator.frameIndex).toBe(2);
    animator.update(0.1);
    expect(animator.frameIndex).toBe(1);
    expect(animator.finished).toBe(false);
  });

  it("rejects a non-integer or out-of-range frame selection", () => {
    const animator = new SpriteAnimator3D({ frames, texture: atlas() });
    for (const index of [1.5, -1, frames.length, Number.NaN]) {
      expect(() => animator.setFrame(index)).toThrow(
        "SpriteAnimator3D frame index must be an in-range integer",
      );
    }
    expect(animator.frameIndex).toBe(0);
  });

  it("restarts a finished one-shot from frame zero on play", () => {
    const animator = new SpriteAnimator3D({
      frames: frames.map((frame) => ({ ...frame, duration: 0.1 })),
      mode: "once",
      texture: atlas(),
    });
    animator.update(0.3);
    expect(animator.finished).toBe(true);
    expect(animator.frameIndex).toBe(2);

    animator.play();
    expect(animator.finished).toBe(false);
    expect(animator.playing).toBe(true);
    expect(animator.frameIndex).toBe(0);
    animator.update(0.1);
    expect(animator.frameIndex).toBe(1);
  });

  it("ignores a zero delta and accepts a delta exactly one frame long", () => {
    const animator = new SpriteAnimator3D({ frames, texture: atlas() });
    animator.update(0);
    expect(animator.frameIndex).toBe(0);
    expect(animator.elapsed).toBe(0);

    animator.update(0.1);
    expect(animator.frameIndex).toBe(1);
    expect(animator.elapsed).toBe(0);
  });

  it("advances across several frames in one update and keeps the remainder", () => {
    const animator = new SpriteAnimator3D({
      frames: frames.map((frame) => ({ ...frame, duration: 0.1 })),
      texture: atlas(),
    });
    animator.update(0.35);
    expect(animator.frameIndex).toBe(0);
    expect(animator.elapsed).toBeCloseTo(0.05);
  });

  it("maps top-left and bottom-left origins to opposite atlas offsets", () => {
    const topLeft = new SpriteAnimator3D({ frames, texture: atlas(), origin: "top-left" });
    topLeft.setFrame(2);
    const bottomLeft = new SpriteAnimator3D({ frames, texture: atlas(), origin: "bottom-left" });
    bottomLeft.setFrame(2);

    expect(topLeft.texture.offset.x).toBeCloseTo(20 / 32);
    expect(topLeft.texture.offset.y).toBeCloseTo((16 - 2 - 8) / 16);
    expect(bottomLeft.texture.offset.y).toBeCloseTo(2 / 16);
  });

  it("rejects missing textures, empty frames, and invalid mode or origin", () => {
    expect(() => new SpriteAnimator3D({ frames } as never)).toThrow(
      "SpriteAnimator3D.texture is required",
    );
    expect(() => new SpriteAnimator3D({ frames: [], texture: atlas() })).toThrow(
      "SpriteAnimator3D.frames must contain at least one frame",
    );
    expect(
      () => new SpriteAnimator3D({ frames, texture: atlas(), mode: "bounce" as never }),
    ).toThrow("SpriteAnimator3D.mode");
    expect(
      () => new SpriteAnimator3D({ frames, texture: atlas(), origin: "center" as never }),
    ).toThrow("SpriteAnimator3D.origin");
  });

  it("rejects an atlas without a positive pixel size and frames outside it", () => {
    const sized = new Texture();
    sized.image = { width: 0, height: 16 };
    expect(() => new SpriteAnimator3D({ frames, texture: sized })).toThrow(
      "SpriteAnimator3D.texture must have a positive atlas width and height",
    );

    const outside = [{ x: 30, y: 0, width: 8, height: 8, duration: 0.1 }];
    expect(() => new SpriteAnimator3D({ frames: outside, texture: atlas() })).toThrow(
      "SpriteAnimator3D frame 0 is outside the texture atlas",
    );
  });

  it("rejects non-finite or negative update deltas", () => {
    const animator = new SpriteAnimator3D({ frames, texture: atlas() });
    for (const delta of [-0.1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => animator.update(delta)).toThrow(
        "SpriteAnimator3D.update delta must be finite and non-negative",
      );
    }
  });
});

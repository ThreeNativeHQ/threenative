import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { Checkpoints } from "../templates/platformer/src/level/Checkpoints.js";

type Point = { x: number; y: number; z: number; clone(): Point; copy(value: Point): Point };
type Target = Parameters<Checkpoints["hurt"]>[0];

function point(x: number): Point {
  return { clone: () => point(x), copy: (value) => point(value.x), x, y: 0.75, z: 0 };
}

function checkpoints(points: readonly Point[]): ConstructorParameters<typeof Checkpoints>[0] {
  return points as unknown as ConstructorParameters<typeof Checkpoints>[0];
}

function target(): Target {
  return {
    body: { body: { setTranslation: vi.fn() }, velocity: { set: vi.fn() } },
    mesh: { position: point(1) },
    visual: { visible: true },
  } as unknown as Target;
}

const feel = {
  blinkRate: 18,
  hurtHorizontalSpeed: 4.5,
  hurtVerticalSpeed: 5.5,
  invulnerabilityTime: 1.2,
};

describe("platformer checkpoints", () => {
  it("rejects an empty checkpoint list", () => {
    expect(() => new Checkpoints(checkpoints([]), 3, feel)).toThrow("at least one checkpoint");
  });

  it("decrements hearts once during the invulnerability window", () => {
    const state = new Checkpoints(checkpoints([point(0)]), 3, feel);
    const player = target();

    expect(state.hurt(player, 0)).toBe(true);
    expect(state.hurt(player, 0)).toBe(false);
    expect(state.hearts).toBe(2);

    state.update(1.2, player);
    expect(state.hurt(player, 0)).toBe(true);
    expect(state.hearts).toBe(1);
  });

  it("advances through ordered checkpoints only", () => {
    const state = new Checkpoints(checkpoints([point(0), point(14), point(25)]), 3, feel);

    state.pass(point(15));
    expect(state.currentIndex).toBe(1);
    state.pass(point(26));
    expect(state.currentIndex).toBe(2);
  });

  it("keeps the navigation blocker out of the player's collision mask", async () => {
    const character = await readFile(
      path.resolve("packages/create-threenative/templates/platformer/src/entities/Character.ts"),
      "utf8",
    );
    const level = await readFile(
      path.resolve("packages/create-threenative/templates/platformer/src/scenes/Level.ts"),
      "utf8",
    );

    expect(level).toContain("collisionLayer: 4");
    expect(character).toContain("collisionMask: 0xfffb");
  });

  it("should register a mobile-safe steering chaser without Recast", async () => {
    const game = await readFile(
      path.resolve("packages/create-threenative/templates/platformer/src/game.ts"),
      "utf8",
    );
    const level = await readFile(
      path.resolve("packages/create-threenative/templates/platformer/src/scenes/Level.ts"),
      "utf8",
    );
    const chaser = await readFile(
      path.resolve("packages/create-threenative/templates/platformer/src/entities/Chaser.ts"),
      "utf8",
    );

    expect(`${game}\n${level}\n${chaser}`).not.toMatch(/recast|NavigationAgent3D/u);
    expect(chaser).toContain("steeringFinished");
    expect(chaser).toContain("routeComplete");
    expect(level).toContain('ctx.entities.add("chaser", chaser)');
  });
});

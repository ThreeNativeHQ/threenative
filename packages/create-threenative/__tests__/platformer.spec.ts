import { readFile } from "node:fs/promises";
import path from "node:path";
import { PerspectiveCamera, Vector2, Vector3 } from "three";
import { describe, expect, it, vi } from "vitest";
import { Checkpoints } from "../templates/platformer/src/level/Checkpoints.js";
import {
  TouchControls,
  touchControlPoint,
} from "../templates/platformer/src/render/touch-controls.js";

type Target = Parameters<Checkpoints["hurt"]>[0];

function point(x: number): Vector3 {
  return new Vector3(x, 0.75, 0);
}

function checkpoints(points: readonly Vector3[]): ConstructorParameters<typeof Checkpoints>[0] {
  return points;
}

function target(): Target {
  return {
    body: { teleport: vi.fn(), velocity: { set: vi.fn() } },
    mesh: { position: point(1) },
    visual: { visible: true },
  } as unknown as Target;
}

const feel = {
  blinkRate: 18,
  hurtHorizontalSpeed: 4.5,
  hurtVerticalSpeed: 5.5,
  invulnerabilityTime: 1.2,
} as unknown as ConstructorParameters<typeof Checkpoints>[2];

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

  it("leaves hearts exhausted without respawning", () => {
    const state = new Checkpoints(checkpoints([point(0)]), 1, feel);
    const player = target();

    expect(state.hurt(player, 0)).toBe(true);
    expect(state.hearts).toBe(0);
    expect(player.body.teleport).not.toHaveBeenCalled();
    expect(state.hurt(player, 0)).toBe(false);
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

  it("clears velocity before teleporting to the current checkpoint", () => {
    const state = new Checkpoints(checkpoints([point(0), point(14)]), 3, feel);
    const player = target();
    state.pass(point(15));

    state.respawn(player);

    expect(player.body.velocity.set).toHaveBeenCalledWith(0, 0, 0);
    expect(player.body.teleport).toHaveBeenCalledWith(state.points[1]);
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

  it("should ship touch controls as user-owned render source", async () => {
    const controls = await readFile(
      path.resolve("packages/create-threenative/templates/platformer/src/render/touch-controls.ts"),
      "utf8",
    );
    const character = await readFile(
      path.resolve("packages/create-threenative/templates/platformer/src/entities/Character.ts"),
      "utf8",
    );
    const level = await readFile(
      path.resolve("packages/create-threenative/templates/platformer/src/scenes/Level.ts"),
      "utf8",
    );

    expect(controls).toContain("ReadonlyMap<number, ITouchPointer>");
    expect(controls).toContain("TouchControls");
    expect(level).toContain('ctx.entities.add("touch-controls"');
    expect(level).toContain("frameCtx.input.raw.pointers");
    expect(character).toContain("ITouchInput");
    expect(character).toContain("touch?.jumpPressed === true");
    expect(character).toContain("touch?.dashPressed === true");
  });

  it("keeps portrait movement and dash pointers in separate hit regions", () => {
    for (const size of [
      { aspect: 390 / 844, height: 844, width: 390 },
      { aspect: 320 / 568, height: 568, width: 320 },
    ]) {
      const controls = new TouchControls(new PerspectiveCamera(54, size.aspect));
      const movementCenter = touchControlPoint(size, "move");
      const dashCenter = touchControlPoint(size, "dash");
      const movementPosition = movementCenter.clone().add(new Vector2(20, 0));

      const movement = controls.update(new Map([[1, { id: 1, position: movementPosition }]]), size);
      expect(movement.dashPressed).toBe(false);
      // The stick anchors where the thumb lands, so the landing frame is zero by design and the
      // drag is what deflects it. This test is about which region claimed the pointer.
      expect(movement.move.toArray()).toEqual([0, 0]);
      // Dragged up, not right: on the 320-wide screen a rightward drag of this size reaches the
      // dash button's exclusion radius and the pointer stops being a movement pointer at all.
      const dragged = controls.update(
        new Map([[1, { id: 1, position: movementPosition.clone().add(new Vector2(0, -30)) }]]),
        size,
      );
      expect(dragged.move.length()).toBeGreaterThan(0);

      controls.update(new Map(), size);
      const dash = controls.update(new Map([[2, { id: 2, position: dashCenter }]]), size);
      expect(dash.dashPressed).toBe(true);
      expect(dash.move.toArray()).toEqual([0, 0]);

      if (size.width === 320) {
        const outsideDash = new Vector2(dashCenter.x - 65, dashCenter.y);
        const insideDash = new Vector2(dashCenter.x - 63, dashCenter.y);

        controls.update(new Map(), size);
        const movementAtBoundary = controls.update(
          new Map([[3, { id: 3, position: outsideDash }]]),
          size,
        );
        expect(movementAtBoundary.dashPressed).toBe(false);
        const draggedAtBoundary = controls.update(
          new Map([[3, { id: 3, position: outsideDash.clone().add(new Vector2(0, -30)) }]]),
          size,
        );
        expect(draggedAtBoundary.move.length()).toBeGreaterThan(0);

        controls.update(new Map(), size);
        const dashAtBoundary = controls.update(
          new Map([[4, { id: 4, position: insideDash }]]),
          size,
        );
        expect(dashAtBoundary.dashPressed).toBe(true);
        expect(dashAtBoundary.move.toArray()).toEqual([0, 0]);
      }
      controls.dispose();
    }
  });

  it("keeps simultaneous movement and jump pointers active", () => {
    const controls = new TouchControls(new PerspectiveCamera(54, 2400 / 1080));
    const pointers = new Map([
      [7, { buttons: 1, id: 7, position: new Vector2(180, 972) }],
      [3, { buttons: 1, id: 3, position: new Vector2(2300, 980) }],
    ]);
    const size = { aspect: 2400 / 1080, height: 1080, width: 2400 };

    const first = controls.update(pointers, size);
    // Landing frame anchors the stick; jump is edge-triggered and fires immediately.
    expect(first.move.x).toBe(0);
    expect(first.jumpPressed).toBe(true);

    // The moving thumb drags a full radius right while the jump thumb stays down. Both pointers
    // must still be honoured: this is the case a single-pointer reading cannot express.
    const dragged = new Map([
      [7, { buttons: 1, id: 7, position: new Vector2(180 + 72, 972) }],
      [3, { buttons: 1, id: 3, position: new Vector2(2300, 980) }],
    ]);
    const second = controls.update(dragged, size);

    expect(second.move.x).toBe(1);
    expect(second.jumpPressed).toBe(false);
    controls.dispose();
  });

  it("ships the production performance scenario without changing the platformer workload", async () => {
    const level = await readFile(
      path.resolve("packages/create-threenative/templates/platformer/src/scenes/Level.ts"),
      "utf8",
    );
    const performance = await readFile(
      path.resolve(
        "packages/create-threenative/templates/platformer/playtests/performance.playtest.json",
      ),
      "utf8",
    );
    const scenario = JSON.parse(performance) as {
      assert: {
        performance: {
          maxDrawCalls: number;
          maxFrameMsP95: number;
          maxTriangles: number;
        };
      };
      steps: Array<Record<string, unknown>>;
    };

    expect(scenario.assert.performance).toEqual({
      maxDrawCalls: 180,
      maxFrameMsP95: 33,
      maxTriangles: 100000,
    });
    expect(scenario.steps.map((step) => step.kind)).toEqual(["input", "wait"]);
    expect(scenario.steps).not.toContainEqual(expect.objectContaining({ kind: "performance" }));
    expect(scenario.steps).not.toContainEqual(expect.objectContaining({ sampleSeconds: 10 }));
    expect(level).toContain("const SPAWN = new Vector3(0, 0.75, 0);");
  });
});

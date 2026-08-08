import type { Ctx } from "@threenative/core";
import { BoxGeometry, Mesh, MeshBasicMaterial, Object3D, Vector3 } from "three";
import { afterEach, describe, expect, it } from "vitest";
import { NavigationAgent3D } from "../src/navigation/NavigationAgent3D.js";
import { NavigationObstacle3D } from "../src/navigation/NavigationObstacle3D.js";
import { NavigationRegion3D } from "../src/navigation/NavigationRegion3D.js";
import { recast } from "../src/navigation/index.js";
import { type PhysicsContext, rapier } from "../src/plugin.js";

type TestCtx = Ctx<Record<string, unknown>, PhysicsContext>;
const plugins: Array<ReturnType<typeof rapier> | ReturnType<typeof recast>> = [];

function levelMeshes(): Mesh[] {
  // Dimensions are owned by templates/platformer/src/scenes/Level.ts.
  const platforms: readonly [number, number, number][] = [
    [18, 0, 7],
    [10, 14, 7],
    [8, 25, 7],
    [6, 0, 5],
  ];
  const meshes = platforms.map(([width, x, depth], index) => {
    const mesh = new Mesh(new BoxGeometry(width, 0.4, depth), new MeshBasicMaterial());
    mesh.position.set(x, index === 3 ? 2.4 : -0.2, 0);
    return mesh;
  });
  const blocker = new Mesh(new BoxGeometry(0.6, 1.6, 5.2), new MeshBasicMaterial());
  blocker.position.set(3.4, 0.8, 0);
  meshes.push(blocker);
  return meshes;
}

async function setup(): Promise<{ ctx: TestCtx; navigationPlugin: ReturnType<typeof recast> }> {
  const physicsPlugin = rapier({ gravity: { x: 0, y: -26, z: 0 } });
  const navigationPlugin = recast();
  const ctx = { physics: undefined } as unknown as TestCtx;
  await physicsPlugin.setup?.(ctx);
  await navigationPlugin.setup?.(ctx);
  plugins.push(physicsPlugin, navigationPlugin);
  return { ctx, navigationPlugin };
}

function navigation(ctx: TestCtx): NonNullable<PhysicsContext["navigation"]> {
  const value = ctx.physics.navigation;
  if (value === undefined) throw new Error("Test setup did not install navigation.");
  return value;
}

function moveToward(object: Object3D, target: Vector3, distance: number): void {
  const direction = new Vector3(target.x - object.position.x, 0, target.z - object.position.z);
  if (direction.lengthSq() <= 0.0001) return;
  object.position.add(direction.normalize().multiplyScalar(Math.min(distance, direction.length())));
}

async function minimumDistance(avoidanceEnabled: boolean): Promise<number> {
  const { ctx, navigationPlugin } = await setup();
  new NavigationRegion3D({ meshes: levelMeshes(), navigation: navigation(ctx) });
  const firstObject = new Object3D();
  firstObject.position.set(-6, 0.75, 0);
  const secondObject = new Object3D();
  secondObject.position.set(6, 0.75, 0);
  const first = new NavigationAgent3D({
    avoidanceEnabled,
    navigation: navigation(ctx),
    object: firstObject,
  });
  const second = new NavigationAgent3D({
    avoidanceEnabled,
    navigation: navigation(ctx),
    object: secondObject,
  });
  const target = new Vector3(0, 0.75, 0);
  first.setTargetPosition(target);
  second.setTargetPosition(target);
  let minimum = Number.POSITIVE_INFINITY;
  for (let tick = 0; tick < 180; tick += 1) {
    moveToward(firstObject, first.getNextPathPosition(), 0.08);
    moveToward(secondObject, second.getNextPathPosition(), 0.08);
    navigationPlugin.update?.(ctx, 1 / 60);
    minimum = Math.min(minimum, firstObject.position.distanceTo(secondObject.position));
  }
  return minimum;
}

afterEach(() => {
  for (const plugin of plugins.splice(0).reverse()) plugin.dispose?.({} as TestCtx);
});

describe("NavigationObstacle3D", () => {
  it("should keep two agents from occupying the same point", async () => {
    const minimum = await minimumDistance(true);
    expect(minimum).toBeGreaterThanOrEqual(0.35 * 2 * 0.8);
  });

  it("should disable local avoidance when avoidanceEnabled is false", async () => {
    const minimum = await minimumDistance(false);
    expect(minimum).toBeLessThan(0.35 * 2 * 0.8);
  });

  it("should register and dispose a crowd obstacle", async () => {
    const { ctx } = await setup();
    new NavigationRegion3D({ meshes: levelMeshes(), navigation: navigation(ctx) });
    const obstacle = new NavigationObstacle3D({
      navigation: navigation(ctx),
      object: new Object3D(),
    });

    expect(obstacle.crowdAgent).toBeDefined();
    obstacle.avoidanceEnabled = false;
    expect(obstacle.crowdAgent).toBeUndefined();
    obstacle.dispose();
    expect(navigation(ctx).obstacles.has(obstacle)).toBe(false);
  });
});

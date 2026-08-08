import type { Ctx } from "@threenative/core";
import { BoxGeometry, Mesh, MeshBasicMaterial, Object3D, Vector3 } from "three";
import { afterEach, describe, expect, it } from "vitest";
import { NavigationAgent3D } from "../src/navigation/NavigationAgent3D.js";
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

afterEach(() => {
  for (const plugin of plugins.splice(0).reverse()) plugin.dispose?.({} as TestCtx);
});

describe("NavigationAgent3D", () => {
  it("should route around a blocker instead of through it", async () => {
    const { ctx } = await setup();
    new NavigationRegion3D({ meshes: levelMeshes(), navigation: navigation(ctx) });
    const object = new Object3D();
    object.position.set(7.5, 0.75, 0);
    const agent = new NavigationAgent3D({
      avoidanceEnabled: false,
      navigation: navigation(ctx),
      object,
    });
    agent.setTargetPosition(new Vector3(0, 0.75, 0));
    const path = navigation(ctx).query.computePath(
      { x: 7.5, y: 0.75, z: 0 },
      { x: 0, y: 0.75, z: 0 },
    );
    const pathLength = path.path.slice(1).reduce((total, point, index) => {
      const previous = path.path[index];
      return previous === undefined
        ? total
        : total + Math.hypot(point.x - previous.x, point.y - previous.y, point.z - previous.z);
    }, 0);

    expect(path.success).toBe(true);
    expect(pathLength).toBeGreaterThanOrEqual(9);
    expect(path.path.some((point) => Math.abs(point.z) > 2.5)).toBe(true);
    expect(agent.getFinalPosition().x).toBeCloseTo(0, 1);
  });

  it("should report the far platform unreachable and the near one reachable", async () => {
    const { ctx } = await setup();
    new NavigationRegion3D({ meshes: levelMeshes(), navigation: navigation(ctx) });
    const object = new Object3D();
    object.position.set(0, 0.75, 0);
    const agent = new NavigationAgent3D({
      navigation: navigation(ctx),
      object,
    });

    expect(agent.isTargetReachable(new Vector3(25, 0.75, 0))).toBe(false);
    expect(agent.isTargetReachable(new Vector3(-6, 0.75, 0))).toBe(true);
  });

  it("should keep an agent on the one-way platform layer", async () => {
    const { ctx } = await setup();
    new NavigationRegion3D({ meshes: levelMeshes(), navigation: navigation(ctx) });
    const object = new Object3D();
    object.position.set(-2, 2.75, 0);
    const agent = new NavigationAgent3D({
      avoidanceEnabled: false,
      navigation: navigation(ctx),
      object,
    });

    agent.setTargetPosition(new Vector3(2, 2.75, 0));

    expect(agent.isTargetReachable()).toBe(true);
    expect(agent.getNextPathPosition().y).toBeGreaterThan(2);
    expect(agent.getFinalPosition().y).toBeGreaterThan(2);
  });

  it("should advance the path cursor during the recast update", async () => {
    const { ctx, navigationPlugin } = await setup();
    new NavigationRegion3D({ meshes: levelMeshes(), navigation: navigation(ctx) });
    const object = new Object3D();
    object.position.set(7.5, 0.75, 0);
    const agent = new NavigationAgent3D({
      avoidanceEnabled: false,
      navigation: navigation(ctx),
      object,
    });
    agent.setTargetPosition(new Vector3(0, 0.75, 0));
    expect(agent.getNextPathPosition().distanceTo(object.position)).toBeLessThan(0.01);

    navigationPlugin.update?.(ctx, 1 / 60);

    expect(Math.abs(agent.getNextPathPosition().z)).toBeGreaterThan(2.5);
  });

  it("should throw when getNextPathPosition is called before a target is set", async () => {
    const { ctx } = await setup();
    new NavigationRegion3D({ meshes: levelMeshes(), navigation: navigation(ctx) });
    const agent = new NavigationAgent3D({
      avoidanceEnabled: false,
      navigation: navigation(ctx),
      object: new Object3D(),
    });

    expect(() => agent.getNextPathPosition()).toThrow(/requires a target/);
  });
});

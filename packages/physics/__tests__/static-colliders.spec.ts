import * as RAPIER from "@dimforge/rapier3d-compat";
import type { ICtx } from "@threenative/core";
import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
} from "three";
import { beforeAll, describe, expect, it } from "vitest";
import "../src/index.js";
import { type IPhysicsContext, rapier } from "../src/plugin.js";
import { buildStaticColliders } from "../src/static-colliders.js";

type PhysicsCtx = ICtx<Record<string, unknown>, IPhysicsContext>;

beforeAll(async () => {
  await RAPIER.init();
});

async function setup(): Promise<{ ctx: PhysicsCtx; plugin: ReturnType<typeof rapier> }> {
  const plugin = rapier({ gravity: { x: 0, y: 0, z: 0 } });
  const ctx = { physics: undefined } as unknown as PhysicsCtx;
  await plugin.setup?.(ctx);
  return { ctx, plugin };
}

function frameGeometry(): BufferGeometry {
  const positions: number[] = [];
  const indices: number[] = [];
  const addPanel = (minX: number, maxX: number, minY: number, maxY: number): void => {
    const offset = positions.length / 3;
    positions.push(minX, minY, -0.1, maxX, minY, -0.1, maxX, maxY, -0.1, minX, maxY, -0.1);
    indices.push(offset, offset + 1, offset + 2, offset, offset + 2, offset + 3);
  };
  addPanel(-4, -1, 0, 4);
  addPanel(1, 4, 0, 4);
  addPanel(-1, 1, 2, 4);
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(new Float32Array(positions), 3));
  geometry.setIndex(indices);
  return geometry;
}

describe("buildStaticColliders", () => {
  it("should keep an arch opening passable when the wall mesh is pierced", async () => {
    const { ctx, plugin } = await setup();
    const root = new Group();
    const wall = new Mesh(frameGeometry());
    wall.name = "pierced-arcade-wall";
    root.add(wall);

    const bodies = buildStaticColliders(ctx, root, {
      predicate: (object) => object.name === "pierced-arcade-wall",
    });
    plugin.update?.(ctx, 1 / 60);

    expect(bodies).toHaveLength(1);
    expect(bodies[0]?.shape.descriptor.kind).toBe("trimesh");
    expect(
      ctx.physics.directSpaceState.intersectRay({
        from: { x: 0, y: 1, z: -2 },
        to: { x: 0, y: 1, z: 2 },
      }),
    ).toBeUndefined();
    expect(
      ctx.physics.directSpaceState.intersectRay({
        from: { x: -2, y: 1, z: -2 },
        to: { x: -2, y: 1, z: 2 },
      }),
    ).toBeDefined();
    plugin.dispose?.(ctx);
  });

  it("should place one collider per instance when the root holds an InstancedMesh", async () => {
    const { ctx, plugin } = await setup();
    const root = new Group();
    root.position.x = 10;
    const instances = new InstancedMesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial(), 2);
    instances.name = "instanced-piers";
    instances.setMatrixAt(0, new Matrix4().makeTranslation(-3, 0, 0));
    instances.setMatrixAt(1, new Matrix4().makeTranslation(3, 0, 0));
    root.add(instances);

    const bodies = buildStaticColliders(ctx, root, {
      predicate: (object) => object.name === "instanced-piers",
    });

    expect(bodies).toHaveLength(2);
    const centres = bodies
      .map((body) => body.object?.position.x ?? Number.NaN)
      .sort((left, right) => left - right);
    expect(centres[0]).toBeCloseTo(7);
    expect(centres[1]).toBeCloseTo(13);
    plugin.dispose?.(ctx);
  });

  it("should report zero colliders as a failure when the predicate excludes everything", async () => {
    const { ctx, plugin } = await setup();
    const root = new Group();
    root.add(new Mesh(new BufferGeometry()));

    expect(() => buildStaticColliders(ctx, root, () => false)).toThrow(/zero colliders/u);
    plugin.dispose?.(ctx);
  });
});

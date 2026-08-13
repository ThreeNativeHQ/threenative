import { CollisionShape3D } from "@threenative/physics";
import { type Object3D, Vector3 } from "three";
import { type DefensePhysics, GROUND_LAYER, ROUTE_LAYER, createEntityBody } from "../physics.js";
import { base, board, routeSegment } from "../render/shapes.js";

export const ROUTE_POINTS = [
  new Vector3(-11, 0, -6),
  new Vector3(-5, 0, -6),
  new Vector3(-5, 0, 0),
  new Vector3(2, 0, 0),
  new Vector3(2, 0, 6),
  new Vector3(11, 0, 6),
] as const;

export const SAFE_BUILD_SLOTS = [
  new Vector3(-8.3, 0, -3.8),
  new Vector3(-2.3, 0, -3.8),
  new Vector3(-2.3, 0, 3.8),
  new Vector3(6.2, 0, 3.8),
] as const;

export const ROUTE_TEST_SLOT = new Vector3(-8, 0, -6);

interface IRouteContext {
  readonly add: (object: Object3D) => Object3D;
  readonly physics: DefensePhysics;
}

export class RouteBoard {
  readonly points = ROUTE_POINTS.map((point) => point.clone());
  readonly surface: Object3D;
  readonly #bodies = [] as ReturnType<typeof createEntityBody>[];

  constructor(ctx: IRouteContext) {
    this.surface = board();
    ctx.add(this.surface);
    this.#bodies.push(
      createEntityBody({
        collisionLayer: GROUND_LAYER,
        collisionMask: 0xffff,
        entity: "ground",
        object: this.surface,
        physics: ctx.physics,
        shape: CollisionShape3D.box(28, 0.2, 20),
        type: "fixed",
      }),
    );
    for (let index = 0; index < this.points.length - 1; index += 1) {
      const from = this.points[index];
      const to = this.points[index + 1];
      if (from === undefined || to === undefined) continue;
      const midpoint = from.clone().add(to).multiplyScalar(0.5);
      const delta = to.clone().sub(from);
      const length = Math.max(delta.x, delta.z, -delta.x, -delta.z);
      const visual = routeSegment(length, 2.1);
      visual.position.copy(midpoint);
      visual.rotation.y = Math.abs(delta.z) > Math.abs(delta.x) ? Math.PI / 2 : 0;
      ctx.add(visual);
      this.#bodies.push(
        createEntityBody({
          collisionLayer: ROUTE_LAYER,
          collisionMask: 0xffff,
          entity: `route.${index}`,
          object: visual,
          physics: ctx.physics,
          shape: CollisionShape3D.box(length, 0.3, 2.1),
          type: "fixed",
        }),
      );
    }
    const goal = base();
    goal.position.copy(this.points.at(-1) ?? new Vector3());
    ctx.add(goal);
  }

  dispose(): void {
    for (const body of this.#bodies) body.dispose();
    this.surface.removeFromParent();
  }
}

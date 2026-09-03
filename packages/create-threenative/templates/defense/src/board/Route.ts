import { CollisionShape3D, type IPhysicsContext, RigidBody3D } from "@threenative/physics";
import { type Object3D, Vector3 } from "three";
import { GROUND_LAYER, ROUTE_LAYER } from "../physics.js";
import { base, board, routeSegment } from "../render/shapes.js";

export const ROUTE_POINTS = [
  new Vector3(-11, 0, -6),
  new Vector3(-5, 0, -6),
  new Vector3(-5, 0, 0),
  new Vector3(2, 0, 0),
  new Vector3(2, 0, 6),
  new Vector3(11, 0, 6),
] as const;

/**
 * The four buildable positions, in the order the safe-build key walks them.
 *
 * The order is the level design. A player who buys three towers gets the first three, and those
 * three have to cover the whole route: with `(-2.3, 3.8)` third, the last nine metres — the run
 * along `z = 6` out to the exit — sat outside every tower's radius, so an attacker that survived
 * the first twenty-seven metres walked the rest unopposed. Measured over ten waves: nineteen
 * shots, nineteen kills, twenty attackers, one leak, every run.
 *
 * `(6.2, 3.8)` is third instead. It reaches the exit run end to end and still covers the corner
 * before it, and `(-2.3, 3.8)` becomes the fourth tower a richer player adds for depth rather
 * than for coverage. Slot zero stays where it is — the overlap-rejection test builds on it.
 */
export const SAFE_BUILD_SLOTS = [
  new Vector3(-8.3, 0, -3.8),
  new Vector3(-2.3, 0, -3.8),
  new Vector3(6.2, 0, 3.8),
  new Vector3(-2.3, 0, 3.8),
] as const;

export const ROUTE_TEST_SLOT = new Vector3(-8, 0, -6);

interface IRouteContext {
  readonly add: (object: Object3D) => Object3D;
  readonly physics: IPhysicsContext;
}

export class RouteBoard {
  readonly points = ROUTE_POINTS.map((point) => point.clone());
  readonly surface: Object3D;
  readonly #bodies: RigidBody3D[] = [];

  constructor(ctx: IRouteContext) {
    this.surface = board();
    ctx.add(this.surface);
    this.#bodies.push(
      new RigidBody3D({
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
        new RigidBody3D({
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

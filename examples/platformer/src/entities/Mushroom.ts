import type { Ctx } from "@threenative/core";
import { Area3D, CollisionShape3D, type PhysicsContext } from "@threenative/physics";
import { CylinderGeometry, Group, Mesh, SphereGeometry, type Vector3 } from "three";
import { patrolDirection, patrolOffset } from "../behaviors.js";
import type { Materials } from "../render/materials.js";
import type { GameState } from "../state.js";

const SPEED = 1.6;

/** The angry cap from the reference: walks a fixed line, dies when stomped. */
export class Mushroom {
  readonly area: Area3D;
  readonly mesh: Group;
  readonly tags = ["enemy"];
  alive = true;
  #origin: Vector3;
  #axis: "x" | "z";
  #distance: number;
  #squashLeft = 0;

  constructor(
    ctx: Ctx<GameState, PhysicsContext>,
    id: string,
    position: Vector3,
    axis: "x" | "z",
    distance: number,
    materials: Materials,
  ) {
    this.#origin = position.clone();
    this.#axis = axis;
    this.#distance = distance;
    this.mesh = new Group();
    this.mesh.position.copy(position);

    const stem = new Mesh(new CylinderGeometry(0.2, 0.25, 0.32, 12), materials.cream);
    stem.position.y = 0.16;
    stem.castShadow = true;
    const cap = new Mesh(new SphereGeometry(0.37, 16, 12), materials.mushroomCap);
    cap.scale.set(1, 0.72, 1);
    cap.position.y = 0.44;
    cap.castShadow = true;
    this.mesh.add(stem, cap);
    const spots: readonly [number, number, number, number][] = [
      [0.15, 0.56, 0.18, 0.08],
      [-0.2, 0.52, 0.1, 0.06],
      [0.02, 0.6, -0.2, 0.07],
    ];
    for (const [x, y, z, radius] of spots) {
      const spot = new Mesh(new SphereGeometry(radius, 8, 6), materials.cream);
      spot.position.set(x, y, z);
      this.mesh.add(spot);
    }
    for (const side of [-1, 1]) {
      const eye = new Mesh(new SphereGeometry(0.045, 8, 6), materials.dark);
      eye.position.set(side * 0.08, 0.2, 0.2);
      this.mesh.add(eye);
    }
    ctx.add(this.mesh);

    this.area = new Area3D({
      entity: id,
      physics: ctx.physics,
      position,
      shape: CollisionShape3D.box(1, 0.9, 1),
    });
  }

  update(elapsed: number, dt: number): void {
    if (!this.alive) {
      this.#squashLeft = Math.max(0, this.#squashLeft - dt);
      this.mesh.scale.y = Math.max(0.12, this.mesh.scale.y - dt * 4);
      if (this.#squashLeft <= 0) this.mesh.visible = false;
      return;
    }
    const offset = patrolOffset(elapsed, this.#distance, SPEED);
    const forward = patrolDirection(elapsed, this.#distance, SPEED) > 0;
    if (this.#axis === "x") {
      this.mesh.position.x = this.#origin.x + offset;
      this.mesh.rotation.y = forward ? Math.PI / 2 : -Math.PI / 2;
    } else {
      this.mesh.position.z = this.#origin.z + offset;
      this.mesh.rotation.y = forward ? 0 : Math.PI;
    }
    this.area.body.setTranslation(
      { x: this.mesh.position.x, y: this.mesh.position.y, z: this.mesh.position.z },
      true,
    );
  }

  squash(): void {
    if (!this.alive) return;
    this.alive = false;
    this.#squashLeft = 0.45;
    this.area.dispose();
  }

  debug(): Record<string, unknown> {
    return { alive: this.alive, position: this.mesh.position.toArray() };
  }

  dispose(): void {
    this.area.dispose();
    this.mesh.removeFromParent();
  }
}

import type { Ctx } from "@threenative/core";
import { Area3D, CollisionShape3D, type PhysicsContext } from "@threenative/physics";
import {
  CapsuleGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  SphereGeometry,
  TorusGeometry,
  type Vector3,
} from "three";
import { patrolDirection, patrolOffset } from "../behaviors.js";
import type { Materials } from "../render/materials.js";
import type { GameState } from "../state.js";

const SPEED = 0.7;

/** Shelled, so it cannot be stomped: the fox has to go around or dash past. */
export class Snail {
  readonly area: Area3D;
  readonly mesh: Group;
  readonly tags = ["enemy"];
  #origin: Vector3;
  #axis: "x" | "z";
  #distance: number;

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

    const foot = new Mesh(new CapsuleGeometry(0.15, 0.42, 4, 10), materials.snail);
    foot.rotation.z = Math.PI / 2;
    foot.position.y = 0.15;
    foot.castShadow = true;
    const shell = new Mesh(new TorusGeometry(0.26, 0.13, 10, 16), materials.shell);
    shell.position.set(-0.05, 0.36, 0);
    shell.castShadow = true;
    this.mesh.add(foot, shell);
    for (const side of [-1, 1]) {
      const stalk = new Mesh(new CylinderGeometry(0.025, 0.025, 0.22, 6), materials.snail);
      stalk.position.set(0.28, 0.32, side * 0.08);
      stalk.rotation.z = -0.4;
      const eye = new Mesh(new SphereGeometry(0.05, 8, 6), materials.dark);
      eye.position.set(0.33, 0.43, side * 0.08);
      this.mesh.add(stalk, eye);
    }
    ctx.add(this.mesh);

    this.area = new Area3D({
      entity: id,
      physics: ctx.physics,
      position,
      shape: CollisionShape3D.box(1, 0.9, 1),
    });
  }

  update(elapsed: number): void {
    const offset = patrolOffset(elapsed, this.#distance, SPEED);
    const forward = patrolDirection(elapsed, this.#distance, SPEED) > 0;
    if (this.#axis === "x") this.mesh.position.x = this.#origin.x + offset;
    else this.mesh.position.z = this.#origin.z + offset;
    this.mesh.rotation.y = forward ? 0 : Math.PI;
    this.area.body.setTranslation(
      { x: this.mesh.position.x, y: this.mesh.position.y, z: this.mesh.position.z },
      true,
    );
  }

  debug(): Record<string, unknown> {
    return { position: this.mesh.position.toArray() };
  }

  dispose(): void {
    this.area.dispose();
    this.mesh.removeFromParent();
  }
}

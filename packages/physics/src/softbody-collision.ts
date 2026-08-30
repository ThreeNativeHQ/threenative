import type { ISoftBodyCollision } from "@threenative/core";
import { Matrix4, Vector3 } from "three";
import type { RigidBody3D } from "./RigidBody3D.js";

const ONE = new Vector3(1, 1, 1);

class PhysicsSoftBodyCollision implements ISoftBodyCollision {
  readonly capacity: number;
  readonly #bodies: readonly RigidBody3D[];
  readonly #bodyMatrix = new Matrix4();
  readonly #localMatrix = new Matrix4();
  readonly #corner = new Vector3();
  readonly #minimum = new Vector3();
  readonly #maximum = new Vector3();

  constructor(bodies: readonly RigidBody3D[]) {
    if (bodies.length === 0)
      throw new Error("softBodyCollision requires at least one RigidBody3D.");
    for (const body of bodies) {
      if (body.shape.descriptor.kind !== "box")
        throw new Error("softBodyCollision currently supports box shapes only.");
      if (body.object === undefined)
        throw new Error("softBodyCollision requires an object transform for every body.");
    }
    this.#bodies = bodies;
    this.capacity = bodies.length;
  }

  writeBoxes(target: Float32Array, worldToLocal: Matrix4): number {
    if (target.length !== this.capacity * 8)
      throw new Error(
        `softBodyCollision expected ${this.capacity * 8} packed values, received ${target.length}.`,
      );
    for (let index = 0; index < this.#bodies.length; index += 1) {
      const body = this.#bodies[index] as RigidBody3D;
      const object = body.object;
      if (object === undefined)
        throw new Error("softBodyCollision body lost its object transform.");
      this.#bodyMatrix.compose(object.position, object.quaternion, ONE);
      this.#localMatrix.multiplyMatrices(worldToLocal, this.#bodyMatrix);
      this.#minimum.set(
        Number.POSITIVE_INFINITY,
        Number.POSITIVE_INFINITY,
        Number.POSITIVE_INFINITY,
      );
      this.#maximum.set(
        Number.NEGATIVE_INFINITY,
        Number.NEGATIVE_INFINITY,
        Number.NEGATIVE_INFINITY,
      );
      const shape = body.shape.descriptor;
      for (let corner = 0; corner < 8; corner += 1) {
        this.#corner
          .set(
            (corner & 1) === 0 ? -shape.x : shape.x,
            (corner & 2) === 0 ? -shape.y : shape.y,
            (corner & 4) === 0 ? -shape.z : shape.z,
          )
          .applyMatrix4(this.#localMatrix);
        this.#minimum.min(this.#corner);
        this.#maximum.max(this.#corner);
      }
      const offset = index * 8;
      target[offset] = (this.#minimum.x + this.#maximum.x) / 2;
      target[offset + 1] = (this.#minimum.y + this.#maximum.y) / 2;
      target[offset + 2] = (this.#minimum.z + this.#maximum.z) / 2;
      target[offset + 3] = 0;
      target[offset + 4] = (this.#maximum.x - this.#minimum.x) / 2;
      target[offset + 5] = (this.#maximum.y - this.#minimum.y) / 2;
      target[offset + 6] = (this.#maximum.z - this.#minimum.z) / 2;
      target[offset + 7] = 0;
    }
    return this.#bodies.length;
  }
}

/** Adapt existing physics bodies into `SoftBody3D` collision input without a second shape API. */
export function softBodyCollision(...bodies: readonly RigidBody3D[]): ISoftBodyCollision {
  return new PhysicsSoftBodyCollision(bodies);
}

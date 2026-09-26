import { type Object3D, Quaternion, Vector3 } from "three";
import { Vision, Vector3 as YukaVector3 } from "yuka";
import {
  type ISearchDecision,
  type ISearchOptions,
  type Point3,
  SearchController,
  validatePoint,
} from "./search.js";
export interface IVisibilityRay {
  readonly origin: Point3;
  readonly direction: Point3;
  readonly distance: number;
}
export interface IPerceptionOptions extends ISearchOptions {
  readonly body: Object3D;
  readonly fieldOfView: number;
  readonly range: number;
  /** Model-local forward direction; choose +Z or -Z explicitly for the authored character. */
  readonly forward: Point3;
  /** Nearest blocking distance, or null. Exclude observer and target bodies in this query. */
  readonly raycast: (ray: IVisibilityRay) => number | null;
}
export interface IPerceptionTarget {
  readonly id: string;
  readonly object: Object3D;
}
/** Yuka answers the view cone; the game's existing world answers occlusion and owns movement. */
export class YukaPerception {
  readonly #body: Object3D;
  readonly #brain: SearchController;
  readonly #vision: Vision;
  readonly #raycast: IPerceptionOptions["raycast"];
  readonly #forward = new Vector3();
  readonly #position = new Vector3();
  readonly #target = new Vector3();
  readonly #direction = new Vector3();
  readonly #rotation = new Quaternion();
  readonly #point = new YukaVector3();
  #disposed = false;
  constructor(options: IPerceptionOptions) {
    validatePoint(options.forward);
    if (
      !Number.isFinite(options.fieldOfView) ||
      options.fieldOfView <= 0 ||
      options.fieldOfView > Math.PI * 2 ||
      !Number.isFinite(options.range) ||
      options.range <= 0 ||
      typeof options.raycast !== "function"
    )
      throw new Error(
        "Perception requires a finite view cone, positive range and world ray query.",
      );
    this.#forward.fromArray(options.forward);
    if (!this.#forward.lengthSq()) throw new Error("Perception forward direction cannot be zero.");
    this.#forward.normalize();
    this.#body = options.body;
    this.#raycast = options.raycast;
    this.#brain = new SearchController(options);
    this.#vision = new Vision({
      getWorldPosition: (out) => out.set(this.#position.x, this.#position.y, this.#position.z),
      getWorldDirection: (out) => {
        this.#direction.copy(this.#forward).applyQuaternion(this.#rotation);
        return out.set(this.#direction.x, this.#direction.y, this.#direction.z);
      },
    });
    this.#vision.fieldOfView = options.fieldOfView;
    this.#vision.range = options.range;
  }
  update(dt: number, target: IPerceptionTarget | null): ISearchDecision {
    if (this.#disposed) throw new Error("Perception adapter is disposed.");
    if (!Number.isFinite(dt) || dt < 0)
      throw new Error("Perception dt must be finite and nonnegative.");
    this.#body.getWorldPosition(this.#position);
    this.#body.getWorldQuaternion(this.#rotation);
    const origin = this.#position.toArray() as [number, number, number];
    validatePoint(origin);
    if (
      this.#rotation.toArray().some((value) => !Number.isFinite(value)) ||
      this.#rotation.lengthSq() < 1e-12
    )
      throw new Error("Perception body orientation must be finite and nonzero.");
    this.#rotation.normalize();
    let observation = null;
    if (target) {
      if (!target.id.trim()) throw new Error("Perception target id is required.");
      target.object.getWorldPosition(this.#target);
      const position = this.#target.toArray() as [number, number, number];
      validatePoint(position);
      this.#point.set(...position);
      if (this.#vision.visible(this.#point)) {
        const distance = this.#direction.subVectors(this.#target, this.#position).length();
        let blocked = false;
        if (distance > 0) {
          this.#direction.divideScalar(distance);
          const hit = this.#raycast({
            origin,
            direction: this.#direction.toArray() as [number, number, number],
            distance,
          });
          if (hit !== null && (!Number.isFinite(hit) || hit < 0))
            throw new Error("Perception ray query returned an invalid distance.");
          blocked = hit !== null && hit <= distance;
        }
        if (!blocked) observation = { id: target.id, position };
      }
    }
    return this.#brain.step(dt, origin, observation);
  }
  forget(): void {
    this.#brain.forget();
  }
  dispose(): void {
    if (!this.#disposed) {
      this.#disposed = true;
      this.#brain.dispose();
    }
  }
}

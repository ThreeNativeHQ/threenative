import type { IPhysicsBodyHandle, IPhysicsWorldHandle } from "./handles.js";
import type { IPhysicsContext } from "./plugin.js";
import {
  type IPhysicsJointCreateOptions,
  type IPhysicsJointLimit,
  type IPhysicsRotation,
  type IPhysicsSimulation,
  type IPhysicsVector3,
  requirePhysicsJointCreateOptions,
  requirePhysicsSimulation,
} from "./simulation.js";

const ZERO_ANCHOR: IPhysicsVector3 = { x: 0, y: 0, z: 0 };
const X_AXIS: IPhysicsVector3 = { x: 1, y: 0, z: 0 };
const IDENTITY_FRAME: IPhysicsRotation = { x: 0, y: 0, z: 0, w: 1 };

/** A body handle or a shared physics node exposing one. */
export type PhysicsJointBody = IPhysicsBodyHandle | { readonly body: IPhysicsBodyHandle };

export interface IJoint3DOptions {
  readonly physics?: IPhysicsContext;
  /** @deprecated Prefer `physics`; a raw backend world is backend-specific. */
  readonly world?: IPhysicsWorldHandle | unknown;
  readonly bodyA: PhysicsJointBody;
  readonly bodyB: PhysicsJointBody;
  /** Local-space anchor on body A. Defaults to the body origin. */
  readonly anchorA?: IPhysicsVector3;
  /** Local-space anchor on body B. Defaults to the body origin. */
  readonly anchorB?: IPhysicsVector3;
}

export interface IPinJoint3DOptions extends IJoint3DOptions {}

export interface IHingeJoint3DOptions extends IJoint3DOptions {
  /** Local-space axis on both bodies. Defaults to the local X axis. */
  readonly axis?: IPhysicsVector3;
  /** Optional lower and upper angular limits, in radians. */
  readonly limit?: IPhysicsJointLimit;
}

export interface IFixedJoint3DOptions extends IJoint3DOptions {
  /** Optional local reference frames. Identity frames preserve equal initial orientations. */
  readonly frameA?: IPhysicsRotation;
  readonly frameB?: IPhysicsRotation;
}

function bodyId(value: PhysicsJointBody, label: string): number {
  const candidate =
    typeof value === "object" && value !== null && "body" in value
      ? (value as { readonly body: unknown }).body
      : value;
  if (
    typeof candidate !== "object" ||
    candidate === null ||
    !("id" in candidate) ||
    typeof candidate.id !== "number"
  )
    throw new Error(`TN_PHYSICS_INVALID_BODY: ${label} must expose a body handle.`);
  return candidate.id;
}

export class Joint3D {
  readonly id: number;
  readonly #simulation: IPhysicsSimulation;
  #disposed = false;

  private constructor(simulation: IPhysicsSimulation, id: number) {
    this.#simulation = simulation;
    this.id = id;
  }

  static #create(
    options: IJoint3DOptions,
    type: IPhysicsJointCreateOptions["type"],
    extra: Pick<IPhysicsJointCreateOptions, "axis" | "limit" | "frameA" | "frameB"> = {},
  ): Joint3D {
    const simulation = requirePhysicsSimulation(options.physics, options.world);
    const jointOptions: IPhysicsJointCreateOptions = {
      anchorA: options.anchorA ?? ZERO_ANCHOR,
      anchorB: options.anchorB ?? ZERO_ANCHOR,
      bodyA: bodyId(options.bodyA, "bodyA"),
      bodyB: bodyId(options.bodyB, "bodyB"),
      ...extra,
      type,
    };
    requirePhysicsJointCreateOptions(jointOptions);
    const id = simulation.createJoint(jointOptions);
    if (!Number.isSafeInteger(id) || id < 0)
      throw new Error("TN_PHYSICS_INVALID_JOINT: backend returned an invalid joint id.");
    return new Joint3D(simulation, id);
  }

  static pin(options: IPinJoint3DOptions): Joint3D {
    return Joint3D.#create(options, "pin");
  }

  static hinge(options: IHingeJoint3DOptions): Joint3D {
    return Joint3D.#create(options, "hinge", {
      axis: options.axis ?? X_AXIS,
      limit: options.limit,
    });
  }

  static fixed(options: IFixedJoint3DOptions): Joint3D {
    return Joint3D.#create(options, "fixed", {
      frameA: options.frameA ?? IDENTITY_FRAME,
      frameB: options.frameB ?? IDENTITY_FRAME,
    });
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#simulation.removeJoint(this.id);
  }
}

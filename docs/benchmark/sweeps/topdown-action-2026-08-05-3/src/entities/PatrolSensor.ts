import type { Ctx } from "@threenative/core";
import { Area3D, CollisionShape3D, type PhysicsContext } from "@threenative/physics";
import { Group, type Material, Mesh, Vector3 } from "three";
import { ball, tube } from "../render/shapes.js";
import type { GameState } from "../state.js";

type GameCtx = Ctx<GameState, PhysicsContext>;

const START_X = -5.8;
const END_X = 5.8;
const Z = 1.45;
const HEIGHT = 0.52;
const SPEED = 1.8;

export class PatrolSensor {
  readonly mesh = new Group();
  readonly area: Area3D;
  #distanceTravelled = 0;
  #position = new Vector3(START_X, HEIGHT, Z);
  #setPositionCalls = 0;

  constructor(ctx: GameCtx, material: Material, coreMaterial: Material) {
    this.mesh.name = "patrol-sensor";
    this.mesh.position.copy(this.#position);

    const scanDisc = tube(0.72, 0.88, 0.06, material, { segments: 24 });
    scanDisc.position.y = -0.42;
    const lowerRing = tube(0.5, 0.64, 0.09, material, { segments: 18 });
    lowerRing.position.y = -0.28;
    const core = ball(0.23, coreMaterial, { segments: 16 });
    const antenna = tube(0.035, 0.055, 0.32, coreMaterial, { segments: 10 });
    antenna.position.y = 0.3;
    const antennaTip = ball(0.075, coreMaterial, { segments: 10 });
    antennaTip.position.y = 0.5;
    this.mesh.add(scanDisc, lowerRing, core, antenna, antennaTip);
    this.mesh.traverse((child) => {
      if (child instanceof Mesh) child.castShadow = true;
    });
    ctx.add(this.mesh);

    this.area = new Area3D({
      entity: "patrol-sensor",
      physics: ctx.physics,
      position: this.#position,
      shape: CollisionShape3D.sphere(0.88),
    });
  }

  update(dt: number): void {
    const trackLength = END_X - START_X;
    const cycleDistance = trackLength * 2;
    const distance = (this.#distanceTravelled + dt * SPEED) % cycleDistance;
    this.#distanceTravelled += dt * SPEED;
    this.#position.x = distance <= trackLength
      ? START_X + distance
      : END_X - (distance - trackLength);

    this.mesh.position.copy(this.#position);
    this.mesh.rotation.y += dt * 1.4;
    this.area.setPosition(this.#position);
    this.#setPositionCalls += 1;
  }

  debug(): Record<string, unknown> {
    return {
      distanceTravelled: this.#distanceTravelled,
      position: this.mesh.position.toArray(),
      setPositionCalls: this.#setPositionCalls,
      state: "patrolling",
    };
  }

  get distanceTravelled(): number {
    return this.#distanceTravelled;
  }

  dispose(): void {
    this.area.dispose();
    this.mesh.removeFromParent();
  }
}

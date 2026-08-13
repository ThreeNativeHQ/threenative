import type { PhysicsBody3D } from "@threenative/physics";
import type { Vector3 } from "three";
import type { Checkline } from "./Checkline.js";

export interface ILapTarget {
  readonly body: PhysicsBody3D;
  readonly forward: Vector3;
}

export class Lap {
  readonly totalLaps: number;
  completed = 0;
  expectedGate = 0;
  shortcutRejects = 0;
  reverseRejects = 0;
  #target: ILapTarget;
  #gates: readonly Checkline[];
  #onLap: (lap: number) => void;
  #unsubscribe: (() => void)[] = [];

  constructor(
    target: ILapTarget,
    gates: readonly Checkline[],
    totalLaps = 3,
    onLap: (lap: number) => void = () => undefined,
  ) {
    if (gates.length === 0) throw new Error("Lap requires at least one ordered gate.");
    if (!Number.isInteger(totalLaps) || totalLaps <= 0)
      throw new Error("Lap totalLaps must be positive.");
    this.#target = target;
    this.#gates = gates;
    this.totalLaps = totalLaps;
    this.#onLap = onLap;
    for (const [index, gate] of gates.entries()) {
      const expected = gate.forward.clone().setY(0).normalize();
      this.#unsubscribe.push(
        gate.area.on("bodyEntered", (body) => {
          if (body !== this.#target.body || this.completed >= this.totalLaps) return;
          this.cross(index, expected);
        }),
      );
    }
  }

  cross(index: number, gateForward?: Vector3): boolean {
    const gate = this.#gates[index];
    if (gate === undefined) {
      this.shortcutRejects += 1;
      return false;
    }
    const direction = gateForward ?? gate.forward;
    const travel = this.#target.forward
      .clone()
      .setY(0)
      .normalize()
      .dot(direction.clone().setY(0).normalize());
    if (travel <= 0.2) {
      this.reverseRejects += 1;
      return false;
    }
    if (index !== this.expectedGate) {
      this.shortcutRejects += 1;
      return false;
    }
    this.expectedGate += 1;
    if (this.expectedGate < this.#gates.length) return true;
    this.expectedGate = 0;
    this.completed += 1;
    this.#onLap(this.completed);
    return true;
  }

  /** Sweeps a car transform between frames so a fast body cannot skip a thin sensor. */
  observe(previous: Vector3, current: Vector3): void {
    for (const [index, gate] of this.#gates.entries()) {
      const normal = gate.forward.clone().setY(0).normalize();
      const before = previous.clone().sub(gate.at).dot(normal);
      const after = current.clone().sub(gate.at).dot(normal);
      const crossedForward = before < 0 && after >= 0;
      const crossedReverse = before >= 0 && after < 0;
      if (crossedForward || crossedReverse) this.cross(index);
    }
  }

  get won(): boolean {
    return this.completed >= this.totalLaps;
  }

  debug(): Record<string, unknown> {
    return {
      completed: this.completed,
      expectedGate: this.expectedGate,
      reverseRejects: this.reverseRejects,
      shortcutRejects: this.shortcutRejects,
      totalLaps: this.totalLaps,
      won: this.won,
    };
  }

  dispose(): void {
    for (const unsubscribe of this.#unsubscribe) unsubscribe();
    this.#unsubscribe = [];
  }
}

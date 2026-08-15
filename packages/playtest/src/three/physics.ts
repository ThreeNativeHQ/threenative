import type { IPlaytestObservationSnapshot, IPlaytestSampleRequest, JsonValue } from "../protocol.js";

/**
 * Physics evidence for a project that drives its own simulation.
 *
 * The `settled` and `aerodynamics` assertions read a `physicsDebugSeries` whose snapshots have
 * a specific interior shape -- `artifact.primitives[]` entries categorised `sleep` and
 * `center-of-mass`, plus an `artifact.overflow.omittedBodies` count. That shape is a harness
 * contract, not something a caller should have to rediscover by reading a failed assertion, so
 * the bridge builds it here from a flat body list. A caller supplies what it already knows.
 */
export interface IThreePlaytestPhysicsBody {
  /** Body id. An assertion matches it exactly or by prefix, so `crate.3` matches entity `crate`. */
  readonly id: string;
  readonly position: readonly [number, number, number];
  readonly sleeping: boolean;
}

export interface IThreePlaytestPhysics {
  bodies(): readonly IThreePlaytestPhysicsBody[];
}

/** Retained bodies per labelled sample. Bodies past the limit are reported, never dropped. */
export const PLAYTEST_PHYSICS_BODY_LIMIT = 100;
/** Labelled samples retained per run. */
export const PLAYTEST_PHYSICS_SAMPLE_LIMIT = 100;

type PhysicsDebugSeries = NonNullable<IPlaytestObservationSnapshot["physicsDebugSeries"]>;

/**
 * Retains one physics snapshot per scenario step label.
 *
 * Fails closed throughout: a duplicate label, an exhausted retention budget, and a malformed
 * body all throw rather than yielding a series an assertion would read as merely empty. An
 * assertion that cannot see its evidence must fail loudly; one that silently sees nothing is
 * the vacuous pass this package exists to prevent.
 */
export class ThreePlaytestPhysicsRecorder {
  readonly #physics: IThreePlaytestPhysics;
  readonly #series: PhysicsDebugSeries = [];

  constructor(physics: IThreePlaytestPhysics) {
    this.#physics = physics;
  }

  sample(request: IPlaytestSampleRequest, tick: number): PhysicsDebugSeries {
    if (request.label !== undefined) {
      if (this.#series.some(({ label }) => label === request.label))
        throw new Error(`TN_PLAYTEST_PHYSICS_LABEL_DUPLICATE: '${request.label}' was already sampled.`);
      if (this.#series.length >= PLAYTEST_PHYSICS_SAMPLE_LIMIT)
        throw new Error(`TN_PLAYTEST_PHYSICS_SAMPLE_LIMIT: at most ${PLAYTEST_PHYSICS_SAMPLE_LIMIT} labelled samples are retained.`);
      this.#series.push({ label: request.label, snapshot: physicsSnapshot(this.#physics.bodies()), tick });
    }
    return this.#series.map((sample) => ({ ...sample }));
  }
}

function physicsSnapshot(bodies: readonly IThreePlaytestPhysicsBody[]): JsonValue {
  if (!Array.isArray(bodies))
    throw new Error("TN_PLAYTEST_PHYSICS_BODIES: the physics provider must return an array of bodies.");
  const retained = bodies.slice(0, PLAYTEST_PHYSICS_BODY_LIMIT);
  const seen = new Set<string>();
  const primitives: JsonValue[] = retained.flatMap<JsonValue>((body) => {
    if (typeof body?.id !== "string" || body.id.length === 0)
      throw new Error("TN_PLAYTEST_PHYSICS_BODY_ID: every observed physics body needs a non-empty string id.");
    // Two bodies sharing an id would silently collapse into one pose comparison.
    if (seen.has(body.id))
      throw new Error(`TN_PLAYTEST_PHYSICS_BODY_DUPLICATE: body id '${body.id}' was reported twice in one sample.`);
    seen.add(body.id);
    if (typeof body.sleeping !== "boolean")
      throw new Error(`TN_PLAYTEST_PHYSICS_BODY_SLEEPING: body '${body.id}' must report sleeping as a boolean.`);
    if (!isFiniteVec3(body.position))
      throw new Error(`TN_PLAYTEST_PHYSICS_BODY_POSITION: body '${body.id}' must report a finite [x, y, z] position.`);
    const sleep: JsonValue = { category: "sleep", entity: body.id, value: body.sleeping ? 1 : 0 };
    const centerOfMass: JsonValue = { category: "center-of-mass", entity: body.id, position: [...body.position] };
    return [sleep, centerOfMass];
  });
  return { artifact: { overflow: { omittedBodies: bodies.length - retained.length }, primitives } };
}

function isFiniteVec3(value: unknown): value is readonly [number, number, number] {
  return Array.isArray(value)
    && value.length === 3
    && value.every((component) => typeof component === "number" && Number.isFinite(component));
}

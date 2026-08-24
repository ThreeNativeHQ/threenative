import {
  axisIndex,
  parseMovementAxisExpectation,
  type IPlaytestAssertionResult,
  type IPlaytestDiagnostic,
  vectorDistance,
} from "../assertion-report.js";
import type { IEvaluationContext } from "./context.js";
import {
  finalFacingAngleToEntity,
  finalFacingAngleToPosition,
  finalTiltDegrees,
  maxResolvedAxisDelta,
  minimumResolvedDistance,
  movementFacingEvidence,
  rotationDelta,
  tiltDegrees,
} from "./helpers.js";

type MovementDetails = NonNullable<IPlaytestAssertionResult["details"]>;

function movementFailure(code: string, message: string, suggestion: string): IPlaytestDiagnostic {
  return { code, message, severity: "error", suggestion };
}

export function emitMovementAssertions(ctx: IEvaluationContext): void {
  const { assertions, diagnostics, input, scenarioAssertions } = ctx;
  const movement = scenarioAssertions.movement;
  if (movement === undefined) return;
  const add = (id: string, details: MovementDetails, pass: boolean, diagnostic?: IPlaytestDiagnostic): void => {
    assertions.push({ details, id, pass });
    if (!pass && diagnostic !== undefined) diagnostics.push(diagnostic);
  };
  const entity = movement.entity ?? input.scenario.subject ?? input.report.entity;
  const movementEntity = movement.entity ?? input.report.entity;

  if (movement.minVelocity !== undefined) {
    const velocity = input.report.frames <= 0 ? 0 : input.report.distance / input.report.frames;
    const pass = velocity >= movement.minVelocity;
    add("movement.velocity", { minVelocity: movement.minVelocity, velocity }, pass, movementFailure(
      "TN_PLAYTEST_VELOCITY_ASSERTION_FAILED",
      `Entity '${input.report.entity}' velocity ${velocity.toFixed(6)} was below required ${movement.minVelocity}.`,
      "Check input force/speed tuning and whether the scenario holds input long enough.",
    ));
  }
  if (movement.minDistance !== undefined) {
    const pass = input.report.distance >= movement.minDistance;
    add("movement.distance", { distance: input.report.distance, entity: input.report.entity, minimum: movement.minDistance }, pass,
      !pass && !input.report.diagnostics.some(({ code }) => code === "TN_PLAYTEST_INPUT_NO_EFFECT")
        ? movementFailure(
            "TN_PLAYTEST_MOVEMENT_ASSERTION_FAILED",
            `Entity '${movement.entity ?? input.report.entity}' moved ${input.report.distance.toFixed(6)}, below required ${movement.minDistance}.`,
            "Check input bindings, collision response, and whether the scenario holds input long enough.",
          )
        : undefined,
    );
  }
  if (movement.maxDistance !== undefined) {
    // `distance` falls back to 0 when the entity is absent from the snapshot, so
    // an unobserved entity looked exactly like a stationary one. This is the
    // blocked-movement proof: the assertion whose whole job is to show something
    // did NOT move must not be satisfiable by measuring nothing.
    const observed = input.report.before !== undefined && input.report.after !== undefined;
    const pass = observed && input.report.distance <= movement.maxDistance;
    add("movement.maxDistance", { distance: input.report.distance, maximum: movement.maxDistance, observed }, pass, movementFailure(
      "TN_PLAYTEST_MOVEMENT_ASSERTION_FAILED",
      observed
        ? `Entity '${input.report.entity}' moved ${input.report.distance.toFixed(6)}, above allowed ${movement.maxDistance}.`
        : `Entity '${movement.entity ?? input.report.entity}' was never observed, so its movement could not be bounded.`,
      observed
        ? "Check bounds/blocked-cell handling and ensure the scenario drives the intended blocked direction."
        : "Register the entity with the playtest bridge under the id the assertion names.",
    ));
  }
  if (movement.pathLength !== undefined) {
    const pathLength = input.report.pathLength ?? input.report.distance;
    const pass = pathLength >= movement.pathLength;
    add("movement.pathLength", { minimum: movement.pathLength, pathLength }, pass, movementFailure(
      "TN_PLAYTEST_PATH_LENGTH_ASSERTION_FAILED",
      `Entity '${input.report.entity}' accumulated path length ${pathLength.toFixed(6)}, below required ${movement.pathLength}.`,
      "Use pathLength with minDistance to distinguish actual traversal from a route that returns to its starting point.",
    ));
  }
  if (movement.minAxisDelta !== undefined) {
    const expectation = parseMovementAxisExpectation(movement.minAxisDelta.axis);
    let rawDelta: number | undefined;
    if (expectation !== undefined && input.report.movementDelta !== undefined) {
      rawDelta = input.report.movementDelta[axisIndex(expectation.axis)];
    }
    const signedDelta = rawDelta === undefined || expectation === undefined ? undefined : rawDelta * (expectation.sign ?? 1);
    const pass = signedDelta !== undefined && signedDelta >= movement.minAxisDelta.min;
    add("movement.axisDelta", {
      axis: movement.minAxisDelta.axis,
      min: movement.minAxisDelta.min,
      rawDelta: rawDelta ?? null,
      signedDelta: signedDelta ?? null,
    }, pass, movementFailure(
      "TN_PLAYTEST_AXIS_DELTA_ASSERTION_FAILED",
      `Entity '${movement.entity ?? input.report.entity}' did not move ${movement.minAxisDelta.min} units on ${movement.minAxisDelta.axis}.`,
      "Check route setup, collision response, and whether the scenario ends on the expected vertical surface.",
    ));
  }
  if (movement.minResolvedAxisDelta !== undefined) {
    const expectation = parseMovementAxisExpectation(movement.minResolvedAxisDelta.axis);
    const resolved = expectation === undefined
      ? undefined
      : maxResolvedAxisDelta(input.report.effectLog, entity, expectation, input.report.before?.position);
    const pass = resolved !== undefined && resolved >= movement.minResolvedAxisDelta.min;
    add("movement.resolvedAxisDelta", {
      axis: movement.minResolvedAxisDelta.axis,
      entity,
      min: movement.minResolvedAxisDelta.min,
      signedDelta: resolved ?? null,
    }, pass, movementFailure(
      "TN_PLAYTEST_RESOLVED_AXIS_DELTA_ASSERTION_FAILED",
      `Entity '${entity}' did not resolve ${movement.minResolvedAxisDelta.min} units on ${movement.minResolvedAxisDelta.axis}.`,
      "Check character.move effect-log entries, route setup, collision response, and whether the scenario reaches the expected slope or step surface.",
    ));
  }
  if (movement.rotationChanged === true) {
    const rotation = rotationDelta(input.report.effectLog, movementEntity, input.report.before?.rotation, input.report.after?.rotation);
    const pass = rotation !== undefined && rotation > 0.0001;
    add("movement.rotation", { rotationDelta: rotation ?? null }, pass, movementFailure(
      "TN_PLAYTEST_ROTATION_ASSERTION_FAILED",
      `Entity '${movementEntity}' did not expose a changed rotation during the playtest.`,
      "Check turn/yaw script output and ensure Transform rotation changes are emitted.",
    ));
  }
  if (movement.maxTiltDegrees !== undefined) {
    const tilt = tiltDegrees(input.report.after?.rotation) ?? finalTiltDegrees(input.report.effectLog, movementEntity);
    const pass = tilt !== undefined && tilt <= movement.maxTiltDegrees;
    add("movement.tilt", { entity: movementEntity, maxTiltDegrees: movement.maxTiltDegrees, tiltDegrees: tilt ?? null }, pass, movementFailure(
      "TN_PLAYTEST_TILT_ASSERTION_FAILED",
      `Entity '${movementEntity}' final tilt ${tilt === undefined ? "was unavailable" : `${tilt.toFixed(3)} degrees`} and must not exceed ${movement.maxTiltDegrees} degrees.`,
      "Inspect the final Transform rotation and fix suspension, grounding, collision response, or recovery before accepting the playtest.",
    ));
  }
  if (movement.closesDistanceToPosition !== undefined) {
    const expectation = movement.closesDistanceToPosition;
    const before = input.report.before?.position;
    const after = input.report.after?.position;
    const decrease = before === undefined || after === undefined
      ? undefined
      : vectorDistance(before, expectation.position) - vectorDistance(after, expectation.position);
    const pass = decrease !== undefined && decrease >= expectation.min;
    add("movement.closesDistance", { decrease: decrease ?? null, position: expectation.position, required: expectation.min }, pass, movementFailure(
      "TN_PLAYTEST_DISTANCE_CLOSURE_ASSERTION_FAILED",
      `Entity did not close distance to the expected position by ${expectation.min}.`,
      "Inspect pursue target ownership and character.move resolved positions.",
    ));
  }
  if (movement.reachesPositionWithin !== undefined) {
    const expectation = movement.reachesPositionWithin;
    const resolvedDistance = minimumResolvedDistance(
      input.report.effectLog,
      input.report.observations?.effectLogSeries,
      entity,
      expectation.position,
      input.report.before?.position,
      expectation.atStep,
    );
    const finalDistance = (expectation.atStep === undefined || input.scenario.steps.at(-1)?.label === expectation.atStep)
      && input.report.after?.position !== undefined
      ? vectorDistance(input.report.after.position, expectation.position)
      : undefined;
    const candidates = [resolvedDistance, finalDistance].filter((value): value is number => value !== undefined);
    const closestDistance = candidates.length === 0 ? undefined : Math.min(...candidates);
    const pass = closestDistance !== undefined && closestDistance <= expectation.maxDistance;
    add("movement.reachesPosition", { closestDistance: closestDistance ?? null, entity, ...expectation }, pass, movementFailure(
      "TN_PLAYTEST_POSITION_REACH_ASSERTION_FAILED",
      `Entity '${entity}' did not come within ${expectation.maxDistance} units of the expected position.`,
      "Inspect character.move resolved positions and the owned last-known-position target.",
    ));
  }
  if (movement.facesMovementWithinDegrees !== undefined) {
    const evidence = movementFacingEvidence(input.report.effectLog, entity);
    const pass = evidence.sampleCount > 0 && evidence.maxErrorDegrees <= movement.facesMovementWithinDegrees;
    add("movement.facing", { entity, ...evidence, threshold: movement.facesMovementWithinDegrees }, pass, movementFailure(
      "TN_PLAYTEST_MOVEMENT_FACING_ASSERTION_FAILED",
      `Entity '${entity}' did not face resolved movement within ${movement.facesMovementWithinDegrees} degrees.`,
      "Inspect character.move direction and Transform yaw effects; slew facing before allowing translation.",
    ));
  }
  if (movement.notFacing !== undefined) {
    const angleDegrees = finalFacingAngleToEntity(input.report.effectLog, entity, movement.notFacing.entity);
    const pass = angleDegrees !== undefined && angleDegrees >= movement.notFacing.minDegrees;
    add("movement.notFacing", { angleDegrees: angleDegrees ?? null, entity, target: movement.notFacing.entity }, pass, movementFailure(
      "TN_PLAYTEST_NOT_FACING_ASSERTION_FAILED",
      `Entity '${entity}' remained pointed at '${movement.notFacing.entity}' during movement.`,
      "Drive patrol yaw from movement direction rather than the target entity.",
    ));
  }
  if (movement.notFacingPosition !== undefined) {
    const expectation = movement.notFacingPosition;
    const angleDegrees = finalFacingAngleToPosition(input.report.effectLog, entity, expectation.position);
    const pass = angleDegrees !== undefined && angleDegrees >= expectation.minDegrees;
    add("movement.notFacingPosition", { angleDegrees: angleDegrees ?? null, entity, position: expectation.position }, pass, movementFailure(
      "TN_PLAYTEST_NOT_FACING_POSITION_ASSERTION_FAILED",
      `Entity '${entity}' remained pointed at the excluded world position during movement.`,
      "Drive patrol yaw from movement direction rather than the observed target position.",
    ));
  }
}

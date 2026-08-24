import { readPath, jsonEqual, trivialAssertionDiagnostic, componentAssertionDiagnostic, axisIndex } from '../assertion-report.js';
import type { IEvaluationContext } from "./context.js";
import { hasFinalComponentExpectation, rejectsTrivialAssertion, componentValueChecks, aerodynamicForceSampleCount, aerodynamicControlValues, aerodynamicTorqueAtLabel, evaluatePathAssertion, evaluateTagCountAssertion, evaluateStateAssertion } from "./helpers.js";

export function emitWorldGameplay(ctx: IEvaluationContext): void {
  const { assertions, diagnostics } = ctx;
  const { input, scenarioAssertions } = ctx;
  for (const assertion of scenarioAssertions.components ?? []) {
    const observed = input.report.observations?.components?.[assertion.entity]?.[assertion.component];
    const before = readPath(observed?.before, assertion.path);
    const after = readPath(observed?.after, assertion.path);
    if (hasFinalComponentExpectation(assertion)) {
      const valueChecks = [
        ...(Object.hasOwn(assertion, "equals") ? [jsonEqual(after, assertion.equals)] : []),
        ...(assertion.gte === undefined ? [] : [typeof after === "number" && after >= assertion.gte]),
        ...(assertion.lte === undefined ? [] : [typeof after === "number" && after <= assertion.lte]),
      ];
      const checks = [
        ...valueChecks,
        // Same absent-value trap as evaluatePathAssertion: a component that was
        // never observed must not satisfy "this value did not change".
        ...(assertion.changed === undefined
          ? []
          : [(before !== undefined || after !== undefined)
            && (assertion.changed ? !jsonEqual(before, after) : jsonEqual(before, after))]),
      ];
      const trivial = rejectsTrivialAssertion("components")
        && valueChecks.length > 0
        && before !== undefined
        && componentValueChecks(assertion, before).every(Boolean);
      const pass = checks.length > 0 && checks.every(Boolean) && (!trivial || typeof assertion.allowTrivial === "string");
      assertions.push({
        details: {
          after,
          before,
          component: assertion.component,
          entity: assertion.entity,
          expected: assertion,
          trivial,
          ...(trivial && typeof assertion.allowTrivial === "string" ? { trivialityOptOut: true } : {}),
        },
        id: `component.${assertion.entity}.${assertion.component}.${assertion.path ?? "value"}`,
        pass,
      });
      if (!pass) diagnostics.push(trivial && typeof assertion.allowTrivial !== "string"
        ? trivialAssertionDiagnostic(`component.${assertion.entity}.${assertion.component}.${assertion.path ?? "value"}`, assertion.path, before, input.scenario.sourcePath)
        : componentAssertionDiagnostic(assertion, before, after));
    }
    if ((assertion.atSteps?.length ?? 0) > 0) {
      const samples = assertion.atSteps!.map((expected) => {
        const sample = (input.report.observations?.componentSeries ?? []).find((candidate) => candidate.label === expected.label);
        const value = readPath(sample?.snapshots[assertion.entity]?.[assertion.component], assertion.path);
        return { expected, pass: sample !== undefined && Object.hasOwn(expected, "equals") && jsonEqual(value, expected.equals), value };
      });
      const pass = samples.every((sample) => sample.pass);
      assertions.push({ details: { samples }, id: `component.${assertion.entity}.${assertion.component}.${assertion.path ?? "value"}.atSteps`, pass });
      if (!pass) diagnostics.push({
        code: "TN_PLAYTEST_COMPONENT_TRANSITION_ASSERTION_FAILED",
        message: `Component '${assertion.component}' on entity '${assertion.entity}'${assertion.path === undefined ? "" : ` path '${assertion.path}'`} did not match the expected labeled-step transition.`,
        observedRuntimePath: "observations.json/componentSeries",
        severity: "error",
        suggestion: "Inspect the labeled component samples and fix the runtime component transition.",
      });
    }
  }
  for (const [index, assertion] of (scenarioAssertions.aerodynamics ?? []).entries()) {
    const forceSamples = aerodynamicForceSampleCount(input.report.observations?.physicsDebugSeries, assertion.entity);
    const controlsSupported = input.scenario.target === "web";
    const controls = (assertion.controls ?? []).map((control) => ({
      ...control,
      observed: aerodynamicControlValues(
        input.report.effectLog ?? input.report.observations?.effectLog,
        input.report.observations?.effectLogSeries,
        assertion.entity,
        control.surface,
      ),
      ...(controlsSupported ? {} : { skipped: true, reason: "native-service-log-unavailable" }),
    }));
    const torques = (assertion.torques ?? []).map((torque) => {
      const value = aerodynamicTorqueAtLabel(input.report.observations?.physicsDebugSeries, assertion.entity, torque.label)?.[axisIndex(torque.axis)];
      const relative = torque.relativeToLabel === undefined
        ? undefined
        : aerodynamicTorqueAtLabel(input.report.observations?.physicsDebugSeries, assertion.entity, torque.relativeToLabel)?.[axisIndex(torque.axis)];
      return { ...torque, observed: value === undefined || (torque.relativeToLabel !== undefined && relative === undefined) ? undefined : value - (relative ?? 0) };
    });
    const forcePass = assertion.minForceSamples === undefined || forceSamples >= assertion.minForceSamples;
    const controlsPass = controlsSupported
      ? controls.every((control) => control.observed.some((value) => Math.abs(value) >= (control.minAbs ?? 0.01) && (control.sign === "positive" ? value > 0 : value < 0)))
      : torques.length > 0;
    const torquesPass = torques.every((torque) => torque.observed !== undefined
      && Math.abs(torque.observed) >= (torque.minAbs ?? 0.01)
      && (torque.sign === "positive" ? torque.observed > 0 : torque.observed < 0));
    const pass = forcePass && controlsPass && torquesPass && (assertion.minForceSamples !== undefined || controls.length > 0 || torques.length > 0);
    assertions.push({ details: { controls, forceSamples, minimumForceSamples: assertion.minForceSamples, torques }, id: `aerodynamics.${index}`, pass });
    if (!pass) {
      diagnostics.push({
        artifactPath: assertion.minForceSamples !== undefined ? "observations.json" : "effect-log.json",
        code: "TN_PLAYTEST_AERODYNAMICS_ASSERTION_FAILED",
        message: `Aerodynamic proof for '${assertion.entity}' did not observe the required finite force samples and signed control values.`,
        observedRuntimePath: "observations.json/physicsDebugSeries/artifact/primitives[category=aero] | effect-log.json/entries[service=physics.aerodynamics.setInputs]",
        severity: "error",
        suggestion: "Check AerodynamicBody metadata, physics debug capture, input-axis bindings, and surface sign mapping.",
      });
    }
  }
  for (const assertion of scenarioAssertions.hud ?? []) {
    const result = evaluatePathAssertion("hud", assertion, input.report.observations?.hud[assertion.id], {});
    assertions.push(result.assertion);
    if (result.diagnostic !== undefined) {
      diagnostics.push({ ...result.diagnostic, code: result.diagnostic.code || "TN_PLAYTEST_HUD_ASSERTION_FAILED" });
    }
  }
  for (const assertion of scenarioAssertions.tags ?? []) {
    const result = evaluateTagCountAssertion(assertion, input.report.observations?.runtimeObservations);
    assertions.push(result.assertion);
    if (result.diagnostic !== undefined) {
      diagnostics.push(result.diagnostic);
    }
  }
  for (const [stateIndex, assertion] of (scenarioAssertions.states ?? []).entries()) {
    const result = evaluateStateAssertion(assertion, input.report.observations, input.scenario, stateIndex);
    assertions.push(result.assertion);
    if (result.diagnostic !== undefined) {
      diagnostics.push(result.diagnostic);
    }
  }
}

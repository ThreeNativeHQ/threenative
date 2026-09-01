import { readPath, jsonEqual, textValue } from '../assertion-report.js';
// Extracted verbatim from assertion-evaluators.ts (PRD-182 Phase 2); do not edit semantics here.
import type { IEvaluationContext } from "./context.js";
import { evaluatePerformanceAssertion, evaluateResourceAnyOfAssertion, hasFinalPathExpectation, evaluatePathAssertion, pathValuePass, matchingSignals, evaluateWorldAssertion } from "./helpers.js";

export function emitPerfSignalsWorld(ctx: IEvaluationContext): void {
  const { assertions, diagnostics } = ctx;
  const { input, scenarioAssertions } = ctx;
  emitTerrainResidency(input.report.observations?.components?.terrain, assertions, diagnostics);
  if (scenarioAssertions.performance !== undefined) {
    const result = evaluatePerformanceAssertion(
      scenarioAssertions.performance,
      input.report.observations?.performanceSeries,
      input.scenario.sourcePath,
    );
    assertions.push(...result.assertions);
    diagnostics.push(...result.diagnostics);
  }
  for (const assertion of scenarioAssertions.resources ?? []) {
    if (assertion.anyOf !== undefined) {
      const result = evaluateResourceAnyOfAssertion(assertion, input.report.observations?.resources[assertion.id], {
        effectLog: input.report.effectLog ?? input.report.observations?.effectLog,
        movedDistance: input.report.distance,
        scenarioSourcePath: input.scenario.sourcePath,
      });
      assertions.push(result.assertion);
      if (result.diagnostic !== undefined) diagnostics.push(result.diagnostic);
      continue;
    }
    if (hasFinalPathExpectation(assertion)) {
      const result = evaluatePathAssertion("resource", assertion, input.report.observations?.resources[assertion.id], {
        effectLog: input.report.effectLog ?? input.report.observations?.effectLog,
        movedDistance: input.report.distance,
        scenarioSourcePath: input.scenario.sourcePath,
      });
      assertions.push(result.assertion);
      if (result.diagnostic !== undefined) {
        diagnostics.push({ ...result.diagnostic, code: result.diagnostic.code || "TN_PLAYTEST_RESOURCE_ASSERTION_FAILED" });
      }
    }
    if (assertion.throughoutSteps === true) {
      const samples = (input.report.observations?.resourceSeries ?? []).map((sample) => ({
        label: sample.label,
        value: readPath(sample.snapshots[assertion.id], assertion.path),
      }));
      const expectedSamples = input.scenario.steps.reduce((count, step) => count + (step.label === undefined ? 0 : 1), 0);
      const pass = expectedSamples > 0 && samples.length === expectedSamples && samples.every((sample) => pathValuePass(assertion, sample.value));
      assertions.push({ details: { samples }, id: `resource.${assertion.id}.${assertion.path ?? "value"}.throughoutSteps`, pass });
      if (!pass) diagnostics.push({
        code: "TN_PLAYTEST_RESOURCE_TRANSITION_ASSERTION_FAILED",
        message: `Resource '${assertion.id}'${assertion.path === undefined ? "" : ` path '${assertion.path}'`} did not satisfy the assertion after every scenario step.`,
        observedRuntimePath: "observations.json/resourceSeries",
        severity: "error",
        suggestion: "Inspect the labeled resource samples and fix the transient gameplay-state transition.",
      });
    }
    if ((assertion.atSteps?.length ?? 0) > 0) {
      const samples = assertion.atSteps!.map((expected) => {
        const sample = (input.report.observations?.resourceSeries ?? []).find((candidate) => candidate.label === expected.label);
        const value = readPath(sample?.snapshots[assertion.id], assertion.path);
        const pass = sample !== undefined
          && (!Object.hasOwn(expected, "equals") || jsonEqual(value, expected.equals))
          && (expected.textIncludes === undefined || String(textValue(value)).includes(expected.textIncludes));
        return { expected, pass, value };
      });
      const pass = samples.every((sample) => sample.pass);
      assertions.push({ details: { samples }, id: `resource.${assertion.id}.${assertion.path ?? "value"}.atSteps`, pass });
      if (!pass) diagnostics.push({
        code: "TN_PLAYTEST_RESOURCE_TRANSITION_ASSERTION_FAILED",
        message: `Resource '${assertion.id}'${assertion.path === undefined ? "" : ` path '${assertion.path}'`} did not match the expected labeled-step transition.`,
        observedRuntimePath: "observations.json/resourceSeries",
        severity: "error",
        suggestion: "Inspect the failed and restored labeled samples and fix the retry transition.",
      });
    }
  }
  for (const assertion of scenarioAssertions.signals ?? []) {
    const series = input.report.observations?.signalSeries;
    const selected = assertion.atStep === undefined
      ? undefined
      : series?.find((sample) => sample.label === assertion.atStep);
    const drained = assertion.atStep === undefined
      ? series !== undefined && series.length > 0
      : selected !== undefined;
    const events = assertion.atStep === undefined ? input.report.observations?.signals : selected?.signals;
    const count = matchingSignals(events, assertion);
    const minCount = assertion.minCount ?? (assertion.maxCount === undefined ? 1 : 0);
    const pass = drained && count >= minCount && (assertion.maxCount === undefined || count <= assertion.maxCount);
    assertions.push({
      details: { atStep: assertion.atStep, count, entity: assertion.entity, maxCount: assertion.maxCount, minCount, name: assertion.name },
      id: `signal.${assertion.name}`,
      pass,
    });
    if (!pass) diagnostics.push({
      code: "TN_PLAYTEST_SIGNAL_NOT_OBSERVED",
      message: !drained
        ? `Signal assertion '${assertion.name}' had no retained event drain${assertion.atStep === undefined ? "" : ` at step '${assertion.atStep}'`}.`
        : `Expected signal '${assertion.name}'${assertion.entity === undefined ? "" : ` from '${assertion.entity}'`} ${minCount} time(s), observed ${count}.`,
      observedRuntimePath: "observations.json/signalSeries",
      severity: "error",
      suggestion: "Expose a bounded events callback on the playtest bridge and inspect the emitted signal name and entity.",
    });
  }
  if (scenarioAssertions.world !== undefined) {
    const result = evaluateWorldAssertion(scenarioAssertions.world, input.report.observations?.runtimeObservations);
    assertions.push(result.assertion);
    if (result.diagnostic !== undefined) diagnostics.push(result.diagnostic);
  }
}

function emitTerrainResidency(
  component: Record<string, { after?: unknown }> | undefined,
  assertions: IEvaluationContext["assertions"],
  diagnostics: IEvaluationContext["diagnostics"],
): void {
  if (component === undefined) return;
  const valueAfter = (name: string): unknown => component[name]?.after;
  const residentTiles = valueAfter("residentTiles");
  const residentBytes = valueAfter("residentBytes");
  const peakResidentTiles = valueAfter("peakResidentTiles");
  const peakResidentBytes = valueAfter("peakResidentBytes");
  const residentTileBudget = valueAfter("residentTileBudget");
  const residentByteBudget = valueAfter("residentByteBudget");
  const finiteNumbers = [
    residentTiles,
    residentBytes,
    peakResidentTiles,
    peakResidentBytes,
    residentTileBudget,
    residentByteBudget,
  ].every((value) => typeof value === "number" && Number.isFinite(value));
  const pass = finiteNumbers
    && (residentTiles as number) <= (peakResidentTiles as number)
    && (residentBytes as number) <= (peakResidentBytes as number)
    && (residentTiles as number) <= (residentTileBudget as number)
    && (residentBytes as number) <= (residentByteBudget as number)
    && (peakResidentTiles as number) <= (residentTileBudget as number)
    && (peakResidentBytes as number) <= (residentByteBudget as number);
  assertions.push({
    details: {
      peakResidentBytes,
      peakResidentTiles,
      residentByteBudget,
      residentBytes,
      residentTileBudget,
      residentTiles,
    },
    id: "world.residency",
    pass,
  });
  if (!pass)
    diagnostics.push({
      code: "TN_PLAYTEST_WORLD_RESIDENCY_ASSERTION_FAILED",
      message: "Terrain residency did not report finite measurements within its declared tile and byte caps.",
      observedRuntimePath: "observations.json/components/terrain",
      severity: "error",
      suggestion: "Expose TerrainTiles.debug() through the terrain entity and inspect the residency counters.",
    });
}

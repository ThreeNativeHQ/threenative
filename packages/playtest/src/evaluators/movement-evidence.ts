import { PLAYTEST_ASSERTION_REGISTRY } from "../assertion-schema.js";
import { consoleErrors, resolveDiagnosticsPolicy, runtimeDiagnostics } from "../assertion-report.js";
import type { IEvaluationContext } from "./context.js";
import {
  allTrivialityEligibleAssertionsWaived,
  assertionEvaluatedByBaseProbe,
  assertionNotEvaluatedDiagnostic,
  evaluateDiagnosticsPolicy,
} from "./helpers.js";
import { emitMovementAssertions } from "./movement-kinematics.js";
import { emitAnimationAssertions, emitOccludedAssertions } from "./movement-events.js";
import { emitContactAssertions, emitSettledAssertions } from "./movement-physics.js";
import { emitMovementVisibility } from "./movement-visibility.js";

export const MOVEMENT_EVIDENCE_KINDS = [
  "movement",
  "visibility",
  "contacts",
  "settled",
  "occluded",
  "animation",
] as const;

export type MovementEvidenceKind = typeof MOVEMENT_EVIDENCE_KINDS[number];
type MovementEvaluator = (ctx: IEvaluationContext) => void;

export const MOVEMENT_EVALUATORS: Readonly<Record<MovementEvidenceKind, MovementEvaluator>> = {
  animation: emitAnimationAssertions,
  contacts: emitContactAssertions,
  movement: emitMovementAssertions,
  occluded: emitOccludedAssertions,
  settled: emitSettledAssertions,
  visibility: emitMovementVisibility,
};

function emitDiagnostics(ctx: IEvaluationContext): void {
  const { assertions, diagnostics, input, scenarioAssertions } = ctx;
  const diagnosticsPolicy = resolveDiagnosticsPolicy(scenarioAssertions.diagnostics);
  const policyDiagnostics = evaluateDiagnosticsPolicy(input.report, diagnosticsPolicy);
  diagnostics.push(...policyDiagnostics);
  assertions.push({
    details: {
      consoleErrors: consoleErrors(input.report.observations?.console ?? []).length,
      networkErrors: input.report.observations?.network.length ?? 0,
      policy: diagnosticsPolicy,
      runtimeDiagnostics: runtimeDiagnostics(input.report.observations?.runtimeDiagnostics).length,
    },
    id: "diagnostics",
    pass: policyDiagnostics.length === 0,
  });
}

export function emitMovementEvidence(ctx: IEvaluationContext): void {
  emitDiagnostics(ctx);
  for (const kind of MOVEMENT_EVIDENCE_KINDS) {
    if (ctx.scenarioAssertions[kind] !== undefined) MOVEMENT_EVALUATORS[kind](ctx);
  }
  for (const entry of PLAYTEST_ASSERTION_REGISTRY) {
    if (ctx.scenarioAssertions[entry.kind] === undefined
      || ctx.assertions.some((assertion) => assertion.id.startsWith(entry.resultIdPrefix))
      || assertionEvaluatedByBaseProbe(entry.kind, ctx.input.report)) {
      continue;
    }
    const id = `assert.${entry.kind}`;
    ctx.assertions.push({ details: { reason: "registered-without-evaluator" }, id, pass: false });
    ctx.diagnostics.push(assertionNotEvaluatedDiagnostic(id, "the registered assertion produced no evaluator result"));
  }
  if (allTrivialityEligibleAssertionsWaived(ctx.assertions)) {
    ctx.diagnostics.push({
      code: "TN_PLAYTEST_SCENARIO_ASSERTS_NOTHING",
      message: `Scenario '${ctx.input.scenario.name}' waived every triviality-eligible assertion, so it asserts nothing independently of its initial state.`,
      severity: "error",
      ...(ctx.input.scenario.sourcePath === undefined ? {} : { sourcePath: ctx.input.scenario.sourcePath }),
      suggestion: "Remove at least one triviality waiver and drive that assertion from a failing initial state or assert changed:true.",
    });
  }
}

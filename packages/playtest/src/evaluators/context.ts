// Shared evaluation context for the evaluator family modules extracted from
// assertion-evaluators.ts (PRD-182). The orchestrator builds one context; every family
// emitter receives it and pushes into the same assertions and diagnostics arrays in the
// original order.
import type { IPlaytestAssertionResult, IPlaytestDiagnostic } from "../assertion-report.js";
import type { IPlaytestReport } from "../report.js";
import type { IPlaytestScenario } from "../scenario.js";

export interface IEvaluatorInput {
  readonly report: IPlaytestReport;
  readonly scenario: IPlaytestScenario;
}

export interface IEvaluationContext {
  readonly assertions: IPlaytestAssertionResult[];
  readonly diagnostics: IPlaytestDiagnostic[];
  readonly input: IEvaluatorInput;
  readonly scenarioAssertions: NonNullable<IPlaytestScenario["assert"]>;
}

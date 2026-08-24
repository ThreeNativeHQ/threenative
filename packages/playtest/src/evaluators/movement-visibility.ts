import type { IEvaluationContext } from "./context.js";
import { evaluateVisibilityAssertion } from "./helpers.js";

export function emitMovementVisibility(ctx: IEvaluationContext): void {
  const { assertions, diagnostics, input, scenarioAssertions } = ctx;
  for (const assertion of scenarioAssertions.visibility ?? []) {
    const entity = assertion.entity ?? input.scenario.subject ?? input.report.entity;
    const result = evaluateVisibilityAssertion(
      assertion,
      entity,
      input.scenario.viewport,
      input.report.observations?.runtimeDiagnostics,
      input.report.observations?.runtimeDiagnosticsBefore,
    );
    assertions.push(result.assertion);
    if (result.diagnostic !== undefined) diagnostics.push(result.diagnostic);
  }
}

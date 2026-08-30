import type { IPlaytestRenderChainAssertion } from "../scenario/schema-base.js";
import type { IEvaluationContext } from "./context.js";

export function emitRenderChain(ctx: IEvaluationContext): void {
  const assertion = ctx.scenarioAssertions.renderChain;
  if (assertion === undefined) return;
  const observed = ctx.input.report.observations?.renderChain;

  if (assertion.tier !== undefined) {
    const pass = observed?.tier === assertion.tier;
    ctx.assertions.push({
      details: { expected: assertion.tier, observed: observed?.tier },
      id: "renderChain.tier",
      pass,
    });
    if (!pass) {
      ctx.diagnostics.push({
        code: observed === undefined
          ? "TN_PLAYTEST_RENDER_CHAIN_UNOBSERVABLE"
          : "TN_PLAYTEST_RENDER_CHAIN_TIER_FAILED",
        message: observed === undefined
          ? "Render-chain tier was not observed because the TN_RENDER_CHAIN marker was absent."
          : `Render-chain tier '${observed.tier}' did not match the asserted tier '${assertion.tier}'.`,
        observedRuntimePath: "observations.json/renderChain/tier",
        severity: "error",
        suggestion: "Install the RenderChain through the renderer seam and keep its marker callback connected to the playtest bridge.",
      });
    }
  }

  if (assertion.velocity !== undefined) {
    const rejectionFraction = observed?.velocity.rejectionFraction;
    const measurementFrame = observed?.velocity.measurementFrame;
    const hasMeasurement = rejectionFraction !== undefined
      && Number.isFinite(rejectionFraction)
      && typeof measurementFrame === "number"
      && Number.isInteger(measurementFrame)
      && measurementFrame >= 0;
    const pass = hasMeasurement
      && rejectionFraction !== undefined
      && rejectionFraction <= assertion.velocity.maxRejectionFraction;
    ctx.assertions.push({
      details: {
        expected: assertion.velocity.maxRejectionFraction,
        measurementFrame,
        observed: rejectionFraction,
      },
      id: "renderChain.velocity.rejectionFraction",
      pass,
    });
    if (!pass) {
      ctx.diagnostics.push({
        code: observed === undefined || !hasMeasurement
          ? "TN_PLAYTEST_RENDER_CHAIN_UNOBSERVABLE"
          : "TN_PLAYTEST_RENDER_CHAIN_REJECTION_FAILED",
        message: observed === undefined
          ? "Render-chain velocity rejection was not observed because the TN_RENDER_CHAIN marker was absent."
          : !hasMeasurement
            ? "Render-chain velocity was provisioned without a fresh completed-frame history-rejection measurement."
            : `Render-chain history rejection fraction ${rejectionFraction ?? "missing"} exceeded the asserted ceiling ${assertion.velocity.maxRejectionFraction}.`,
        observedRuntimePath: "observations.json/renderChain/velocity/rejectionFraction",
        severity: "error",
        suggestion: "Publish the temporal stage's measured rejection fraction on the same render-chain marker used for tier reporting.",
      });
    }
  }
}

export function renderChainAssertionIsMeaningful(assertion: IPlaytestRenderChainAssertion): boolean {
  return assertion.tier !== undefined || assertion.velocity !== undefined;
}

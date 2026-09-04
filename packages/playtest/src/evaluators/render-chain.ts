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

  const stageAssertion = assertion.stages;
  if (stageAssertion !== undefined) {
    const observedStages = observed?.stages;
    if (stageAssertion.includes !== undefined) {
      emitStageCheck(
        ctx,
        observedStages,
        "includes",
        stageAssertion.includes,
        observedStages !== undefined && stageAssertion.includes.every((stage) => observedStages.includes(stage)),
      );
    }
    if (stageAssertion.excludes !== undefined) {
      emitStageCheck(
        ctx,
        observedStages,
        "excludes",
        stageAssertion.excludes,
        observedStages !== undefined && stageAssertion.excludes.every((stage) => !observedStages.includes(stage)),
      );
    }
    if (stageAssertion.order !== undefined) {
      emitStageCheck(
        ctx,
        observedStages,
        "order",
        stageAssertion.order,
        observedStages !== undefined && isOrderedSubsequence(stageAssertion.order, observedStages),
      );
    }
  }

  const contributionAssertion = assertion.contributions;
  if (contributionAssertion !== undefined) {
    const observedContributions = observed?.contributions;
    const pass = Array.isArray(observedContributions)
      && contributionAssertion.graphOutputChanged.every((name) =>
        observedContributions.some((entry) => entry.name === name && entry.graphOutputChanged === true),
      );
    ctx.assertions.push({
      details: {
        expected: contributionAssertion.graphOutputChanged,
        observed: observedContributions,
      },
      id: "renderChain.contributions.graphOutputChanged",
      pass,
    });
    if (!pass) {
      ctx.diagnostics.push({
        code: observed === undefined || observedContributions === undefined
          ? "TN_PLAYTEST_RENDER_CHAIN_UNOBSERVABLE"
          : "TN_PLAYTEST_RENDER_CHAIN_CONTRIBUTIONS_FAILED",
        message: observed === undefined
          ? "Render-chain contributions were not observed because the TN_RENDER_CHAIN marker was absent."
          : observedContributions === undefined
            ? "Render-chain stage contributions were not observed on the TN_RENDER_CHAIN marker."
            : "One or more authored stages did not report a changed graph output.",
        observedRuntimePath: "observations.json/renderChain/contributions",
        severity: "error",
        suggestion: "Publish one graphOutputChanged marker per applied stage; this is graph evidence, not pixel attribution.",
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
  return assertion.tier !== undefined
    || assertion.stages !== undefined
    || assertion.contributions !== undefined
    || assertion.velocity !== undefined;
}

function emitStageCheck(
  ctx: IEvaluationContext,
  observed: string[] | undefined,
  kind: "includes" | "excludes" | "order",
  expected: string[],
  pass: boolean,
): void {
  ctx.assertions.push({
    details: { expected, observed },
    id: `renderChain.stages.${kind}`,
    pass,
  });
  if (pass) return;
  ctx.diagnostics.push({
    code: observed === undefined
      ? "TN_PLAYTEST_RENDER_CHAIN_UNOBSERVABLE"
      : "TN_PLAYTEST_RENDER_CHAIN_STAGES_FAILED",
    message: observed === undefined
      ? "Render-chain stages were not observed because the TN_RENDER_CHAIN marker was absent."
      : `Render-chain stage ${kind} assertion did not match the observed stage order.`,
    observedRuntimePath: "observations.json/renderChain/stages",
    severity: "error",
    suggestion: "Keep each authored stage in the renderer chain and publish its id on TN_RENDER_CHAIN.",
  });
}

function isOrderedSubsequence(expected: string[], observed: string[]): boolean {
  let cursor = 0;
  for (const stage of expected) {
    const found = observed.indexOf(stage, cursor);
    if (found < 0) return false;
    cursor = found + 1;
  }
  return true;
}

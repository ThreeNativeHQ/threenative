import type { IEvaluationContext } from "./context.js";
import { platformTop, horizontalRadius, movementEnvelopeHorizontalLimit } from "./helpers.js";

export function emitDisplayFamilies(ctx: IEvaluationContext): void {
  const { assertions, diagnostics } = ctx;
  const { input, scenarioAssertions } = ctx;
  if (scenarioAssertions.framebufferCoverage !== undefined) {
    const observation = input.report.observations?.framebufferCoverage;
    const started = observation?.windowStarted === true;
    const completed = observation?.windowCompleted === true;
    const framesObserved = (observation?.frameCount ?? 0) > 0;
    const readable = observation?.unreadableReason === undefined;
    const violation = observation?.firstViolation;
    const evidenceComplete = violation === undefined
      || (violation.grid.samples.length
        === violation.grid.columns * violation.grid.rows
        && violation.screenshotPath.length > 0);
    const pass = started
      && completed
      && framesObserved
      && readable
      && violation === undefined
      && evidenceComplete;
    assertions.push({
      details: {
        boundarySource: observation?.boundarySource ?? null,
        evidenceComplete,
        firstViolation: violation ?? null,
        frameCount: observation?.frameCount ?? 0,
        unreadableReason: observation?.unreadableReason ?? null,
        windowCompleted: completed,
        windowStarted: started,
      },
      id: "framebufferCoverage",
      pass,
    });
    if (!readable) {
      diagnostics.push({
        code: "TN_PLAYTEST_FRAMEBUFFER_PIXELS_UNREADABLE",
        message: `Framebuffer pixels could not be read: ${observation?.unreadableReason}.`,
        severity: "error",
        suggestion: "On headless Linux, prefix the command with sh scripts/xvfb.sh.",
      });
    } else if (!started || !completed) {
      diagnostics.push({
        code: "TN_PLAYTEST_FRAMEBUFFER_WINDOW_NOT_REACHED",
        message: !started
          ? "The run never reached the declared framebuffer coverage window."
          : "The run entered but never completed the declared framebuffer coverage window.",
        severity: "error",
        suggestion: "Check the assertion's startStep/endStep labels and keep the run alive through the complete loading interval.",
      });
    } else if (!framesObserved) {
      diagnostics.push({
        code: "TN_PLAYTEST_FRAMEBUFFER_FRAMES_MISSING",
        message: "The framebuffer coverage window completed without observing any render frames.",
        severity: "error",
        suggestion: "Keep at least one requestAnimationFrame-driven frame inside the labeled loading window.",
      });
    } else if (violation !== undefined) {
      diagnostics.push({
        artifactPath: violation.screenshotPath,
        code: evidenceComplete
          ? "TN_PLAYTEST_FRAMEBUFFER_COVERAGE_FAILED"
          : "TN_PLAYTEST_FRAMEBUFFER_EVIDENCE_MISSING",
        message: evidenceComplete
          ? `Framebuffer coverage first diverged from the declared backdrop at frame ${violation.frameIndex}.`
          : `Framebuffer coverage diverged at frame ${violation.frameIndex}, but its grid or screenshot evidence is incomplete.`,
        observedRuntimePath: "observations.json/framebufferCoverage/firstViolation/grid",
        severity: "error",
        suggestion: "Inspect the violating-frame screenshot and RGB sample grid; fix the render pass that drew during the loading-covered window.",
      });
    }
  }
  if (scenarioAssertions.reachability !== undefined) {
    const { entities, envelope } = scenarioAssertions.reachability;
    for (let index = 0; index < entities.length - 1; index += 1) {
      const fromId = entities[index]!;
      const toId = entities[index + 1]!;
      const from = input.report.observations?.entityTransforms?.[fromId];
      const to = input.report.observations?.entityTransforms?.[toId];
      const rise = from?.position === undefined || to?.position === undefined ? undefined : platformTop(to) - platformTop(from);
      const horizontalDelta = from?.position === undefined || to?.position === undefined
        ? undefined
        : [to.position[0] - from.position[0], to.position[2] - from.position[2]] as const;
      const centerGap = horizontalDelta === undefined ? undefined : Math.hypot(...horizontalDelta);
      const direction = horizontalDelta === undefined || centerGap === 0
        ? undefined
        : [horizontalDelta[0] / centerGap!, horizontalDelta[1] / centerGap!] as const;
      const edgeGap = centerGap === undefined || direction === undefined
        ? centerGap
        : Math.max(0, centerGap - horizontalRadius(from, direction) - horizontalRadius(to, direction));
      const horizontalLimit = envelope === undefined || rise === undefined ? undefined : movementEnvelopeHorizontalLimit(envelope, rise);
      const pass = horizontalLimit !== undefined && edgeGap !== undefined && edgeGap <= horizontalLimit;
      assertions.push({
        details: { constraint: "static-movement-envelope-fit", edgeGap: edgeGap ?? null, envelope: envelope ?? null, from: fromId, horizontalLimit: horizontalLimit ?? null, rise: rise ?? null, to: toId },
        id: `reachability.${index}.${fromId}.${toId}`,
        pass,
      });
      if (!pass) diagnostics.push({
        code: "TN_PLAYTEST_REACHABILITY_ASSERTION_FAILED",
        message: `Static platform fit '${fromId}' to '${toId}' is outside the measured character envelope.`,
        path: `/assert/reachability/entities/${index + 1}`,
        severity: "error",
        ...(input.scenario.sourcePath === undefined ? {} : { sourcePath: input.scenario.sourcePath }),
        suggestion: "Reduce the platform rise or edge-to-edge gap, regenerate the envelope after changing movement, then use a traversal playtest to prove walls, ceilings, run-up, and air control.",
      });
    }
  }
}

import type { IPlaytestDiagnosticsPolicy, IPlaytestReport } from "./report.js";
import type { IPlaytestRuntimeDiagnosticsSample } from "./protocol.js";
import type { IPlaytestAnimationAssertion, IPlaytestComponentAssertion, IPlaytestContactAssertion, IPlaytestPathAssertion, IPlaytestPerformanceAssertion, IPlaytestResourceAnyOfAssertion, IPlaytestScenario, IPlaytestSignalAssertion, IPlaytestStateAssertion, IPlaytestTagCountAssertion, IPlaytestVisibilityAssertion, IPlaytestWorldAssertion } from "./scenario.js";
import { PLAYTEST_ASSERTION_REGISTRY } from "./assertion-schema.js";
import {
  type IPlaytestAssertionResult,
  type IPlaytestDiagnostic,
  type IPlaytestFramebufferCoverageObservation,
  type IPlaytestObservations,
  type MovementAxis,
  type Vec3,
  axisIndex,
  componentAssertionDiagnostic,
  consoleErrors,
  expectedPathAssertion,
  finiteVector,
  isRecord,
  jsonEqual,
  parseMovementAxisExpectation,
  pathAssertionDiagnostic,
  readPath,
  readRotation,
  readVec3,
  record,
  resolveDiagnosticsPolicy,
  sourcePathForSystem,
  runtimeDiagnostics,
  runtimeDiagnosticsSnapshot,
  textValue,
  trivialAssertionDiagnostic,
  vectorDistance,
} from "./assertion-report.js";

export function evaluateRichPlaytestAssertions(input: {
  report: IPlaytestReport;
  scenario: IPlaytestScenario;
}): { assertions: IPlaytestAssertionResult[]; diagnostics: IPlaytestDiagnostic[] } {
  const assertions: IPlaytestAssertionResult[] = [];
  const diagnostics: IPlaytestDiagnostic[] = [];
  const scenarioAssertions = input.scenario.assert ?? {};
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
  for (const assertion of scenarioAssertions.overlayNodes ?? []) {
    const id = overlayNodeObservationKey(assertion.overlayId, assertion.selector);
    if (input.scenario.target !== "web") {
      assertions.push({ details: { reason: "target-unsupported", target: input.scenario.target }, id: `overlayNode.${id}`, pass: false });
      diagnostics.push(assertionNotEvaluatedDiagnostic(`overlayNode.${id}`, `target '${input.scenario.target}' cannot evaluate same-origin overlay DOM state`));
      continue;
    }
    const snapshot = input.report.observations?.overlayNodes?.[id]?.after;
    const observed = isRecord(snapshot) ? snapshot : {};
    const value = assertion.attribute === undefined ? observed.text : observed.attribute;
    const checks = [
      ...(Object.hasOwn(assertion, "equals") ? [jsonEqual(value, assertion.equals)] : []),
      ...(assertion.textIncludes === undefined ? [] : [String(value ?? "").includes(assertion.textIncludes)]),
      ...(assertion.visible === undefined ? [] : [observed.visible === assertion.visible]),
    ];
    const pass = checks.length > 0 && checks.every(Boolean);
    assertions.push({ details: { expected: assertion, observed }, id: `overlayNode.${id}`, pass });
    if (!pass) diagnostics.push({
      code: "TN_PLAYTEST_OVERLAY_NODE_ASSERTION_FAILED",
      message: `Overlay '${assertion.overlayId}' node '${assertion.selector}' did not satisfy the DOM assertion.`,
      severity: "error",
      suggestion: "Inspect observations.json/overlayNodes and verify the overlay subscription, selector, attribute, and computed style.",
    });
  }
  const captureFailure = input.report.observations?.visual?.captureFailure;
  const hasVisualSamples = input.report.observations?.visual !== undefined && captureFailure === undefined;
  if ((scenarioAssertions.visual?.length ?? 0) > 0 && captureFailure !== undefined) {
    for (const [index] of scenarioAssertions.visual!.entries()) {
      assertions.push({
        details: { captureFailure, reason: "not-evaluated" },
        id: `visual.${index}`,
        pass: true,
      });
    }
  } else if ((scenarioAssertions.visual?.length ?? 0) > 0 && !hasVisualSamples) {
    for (const [index] of scenarioAssertions.visual!.entries()) {
      assertions.push({ id: `visual.${index}`, pass: false, details: { reason: "target-unsupported", target: input.scenario.target } });
      diagnostics.push(assertionNotEvaluatedDiagnostic(`visual.${index}`, `target '${input.scenario.target}' does not expose visual assertion samples`));
    }
  }
  for (const [index, visual] of (hasVisualSamples ? scenarioAssertions.visual ?? [] : []).entries()) {
    if (visual.frameDiff !== undefined) {
      const ratio = input.report.observations?.visual?.changedPixelRatio;
      const pass = ratio !== undefined
        && (visual.frameDiff.minChangedPixelRatio === undefined || ratio >= visual.frameDiff.minChangedPixelRatio)
        && (visual.frameDiff.maxChangedPixelRatio === undefined || ratio <= visual.frameDiff.maxChangedPixelRatio);
      assertions.push({ id: `visual.${index}.frameDiff`, pass, details: { after: pass, changedPixelRatio: ratio, comparisonSource: input.report.observations?.visual?.comparisonSource, expected: { equals: true }, ...visual.frameDiff } });
      if (!pass) diagnostics.push({ code: "TN_PLAYTEST_FRAME_DIFF_FAILED", message: `Screenshot changed-pixel ratio ${ratio ?? "unavailable"} was outside the asserted range.`, severity: "error", suggestion: "Check whether the expected visual change rendered and whether the thresholds match the scenario." });
    }
    if (visual.region !== undefined) {
      const observed = input.report.observations?.visual?.nonblankRegions?.find((region) => region.x === visual.region?.x && region.y === visual.region.y && region.width === visual.region.width && region.height === visual.region.height);
      const minimum = visual.region.minNonblankPixelRatio ?? 0.002;
      const pass = observed !== undefined && observed.nonblankPixelRatio >= minimum;
      assertions.push({ id: `visual.${index}.region`, pass, details: { after: pass, expected: { equals: true }, minimum, observed: observed?.nonblankPixelRatio } });
      if (!pass) diagnostics.push({ code: "TN_PLAYTEST_REGION_BLANK", message: `Screenshot region at (${visual.region.x}, ${visual.region.y}) did not meet nonblank ratio ${minimum}.`, severity: "error", suggestion: "Check camera framing and whether expected geometry renders in the asserted region." });
      if (visual.region.minDarkPixelRatio !== undefined) {
        const darkPass = observed?.darkPixelRatio !== undefined && observed.darkPixelRatio >= visual.region.minDarkPixelRatio;
        assertions.push({
          id: `visual.${index}.region.darkPixels`,
          pass: darkPass,
          details: {
            maximumLuminance: visual.region.maxLuminance ?? 0.25,
            minimumDarkPixelRatio: visual.region.minDarkPixelRatio,
            observedDarkPixelRatio: observed?.darkPixelRatio,
          },
        });
        if (!darkPass) diagnostics.push({
          code: "TN_PLAYTEST_REGION_DARK_PIXEL_RATIO_FAILED",
          message: `Screenshot region at (${visual.region.x}, ${visual.region.y}) contained ${observed?.darkPixelRatio ?? "unavailable"} dark pixels, below required ratio ${visual.region.minDarkPixelRatio}.`,
          severity: "error",
          suggestion: "Check whether the expected foreground silhouette occupies the asserted raster region.",
        });
      }
    }
    if (visual.entityVisible !== undefined) {
      const frameSeries = input.report.observations?.visual?.runtimeDiagnosticsSeries;
      const samples = frameSeries ?? [input.report.observations?.runtimeDiagnostics];
      const selected = visual.entityVisible.throughoutFrames === true ? samples : samples.slice(-1);
      const projected = selected.map((sample) => projectedPixelsForEntity(runtimeDiagnosticsSnapshot(sample), visual.entityVisible!.entity, input.scenario.viewport));
      const hasRequiredSeries = visual.entityVisible.throughoutFrames !== true || (frameSeries !== undefined && frameSeries.length > 0);
      const pass = hasRequiredSeries && projected.length > 0 && projected.every((pixels) => pixels !== undefined && pixels >= visual.entityVisible!.minProjectedPixels);
      assertions.push({ id: `visual.${index}.entityVisible`, pass, details: { entity: visual.entityVisible.entity, hasRequiredSeries, projectedPixels: projected } });
      if (!pass) diagnostics.push({ code: "TN_PLAYTEST_ENTITY_VISIBILITY_DROPPED", message: `Entity '${visual.entityVisible.entity}' dropped below ${visual.entityVisible.minProjectedPixels} projected pixels.`, severity: "error", suggestion: "Check per-frame visibility, camera clipping, scale, and renderer state." });
    }
  }
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
  {
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
  if (scenarioAssertions.movement?.minVelocity !== undefined) {
    const velocity = input.report.frames <= 0 ? 0 : input.report.distance / input.report.frames;
    const pass = velocity >= scenarioAssertions.movement.minVelocity;
    assertions.push({ details: { minVelocity: scenarioAssertions.movement.minVelocity, velocity }, id: "movement.velocity", pass });
    if (!pass) {
      diagnostics.push({
        code: "TN_PLAYTEST_VELOCITY_ASSERTION_FAILED",
        message: `Entity '${input.report.entity}' velocity ${velocity.toFixed(6)} was below required ${scenarioAssertions.movement.minVelocity}.`,
        severity: "error",
        suggestion: "Check input force/speed tuning and whether the scenario holds input long enough.",
      });
    }
  }
  if (scenarioAssertions.movement?.minDistance !== undefined) {
    const pass = input.report.distance >= scenarioAssertions.movement.minDistance;
    assertions.push({
      details: { distance: input.report.distance, entity: input.report.entity, minimum: scenarioAssertions.movement.minDistance },
      id: "movement.distance",
      pass,
    });
    if (!pass && !input.report.diagnostics.some((diagnostic) => diagnostic.code === "TN_PLAYTEST_INPUT_NO_EFFECT")) {
      diagnostics.push({
        code: "TN_PLAYTEST_MOVEMENT_ASSERTION_FAILED",
        message: `Entity '${scenarioAssertions.movement.entity ?? input.report.entity}' moved ${input.report.distance.toFixed(6)}, below required ${scenarioAssertions.movement.minDistance}.`,
        severity: "error",
        suggestion: "Check input bindings, collision response, and whether the scenario holds input long enough.",
      });
    }
  }
  if (scenarioAssertions.movement?.maxDistance !== undefined) {
    // `distance` falls back to 0 when the entity is absent from the snapshot, so
    // an unobserved entity looked exactly like a stationary one. This is the
    // blocked-movement proof: the assertion whose whole job is to show something
    // did NOT move must not be satisfiable by measuring nothing.
    const observed = input.report.before !== undefined && input.report.after !== undefined;
    const pass = observed && input.report.distance <= scenarioAssertions.movement.maxDistance;
    assertions.push({ details: { distance: input.report.distance, maximum: scenarioAssertions.movement.maxDistance, observed }, id: "movement.maxDistance", pass });
    if (!pass) {
      diagnostics.push({
        code: "TN_PLAYTEST_MOVEMENT_ASSERTION_FAILED",
        message: observed
          ? `Entity '${input.report.entity}' moved ${input.report.distance.toFixed(6)}, above allowed ${scenarioAssertions.movement.maxDistance}.`
          : `Entity '${scenarioAssertions.movement.entity ?? input.report.entity}' was never observed, so its movement could not be bounded.`,
        severity: "error",
        suggestion: observed
          ? "Check bounds/blocked-cell handling and ensure the scenario drives the intended blocked direction."
          : "Register the entity with the playtest bridge under the id the assertion names.",
      });
    }
  }
  if (scenarioAssertions.movement?.pathLength !== undefined) {
    const pathLength = input.report.pathLength ?? input.report.distance;
    const pass = pathLength >= scenarioAssertions.movement.pathLength;
    assertions.push({ details: { minimum: scenarioAssertions.movement.pathLength, pathLength }, id: "movement.pathLength", pass });
    if (!pass) {
      diagnostics.push({
        code: "TN_PLAYTEST_PATH_LENGTH_ASSERTION_FAILED",
        message: `Entity '${input.report.entity}' accumulated path length ${pathLength.toFixed(6)}, below required ${scenarioAssertions.movement.pathLength}.`,
        severity: "error",
        suggestion: "Use pathLength with minDistance to distinguish actual traversal from a route that returns to its starting point.",
      });
    }
  }
  if (scenarioAssertions.movement?.minAxisDelta !== undefined) {
    const expectation = parseMovementAxisExpectation(scenarioAssertions.movement.minAxisDelta.axis);
    let rawDelta: number | undefined;
    if (expectation !== undefined && input.report.movementDelta !== undefined) {
      rawDelta = input.report.movementDelta[axisIndex(expectation.axis)];
    }
    const signedDelta = rawDelta === undefined || expectation === undefined ? undefined : rawDelta * (expectation.sign ?? 1);
    const pass = signedDelta !== undefined && signedDelta >= scenarioAssertions.movement.minAxisDelta.min;
    assertions.push({
      details: {
        axis: scenarioAssertions.movement.minAxisDelta.axis,
        min: scenarioAssertions.movement.minAxisDelta.min,
        rawDelta: rawDelta ?? null,
        signedDelta: signedDelta ?? null,
      },
      id: "movement.axisDelta",
      pass,
    });
    if (!pass) {
      diagnostics.push({
        code: "TN_PLAYTEST_AXIS_DELTA_ASSERTION_FAILED",
        message: `Entity '${scenarioAssertions.movement.entity ?? input.report.entity}' did not move ${scenarioAssertions.movement.minAxisDelta.min} units on ${scenarioAssertions.movement.minAxisDelta.axis}.`,
        severity: "error",
        suggestion: "Check route setup, collision response, and whether the scenario ends on the expected vertical surface.",
      });
    }
  }
  if (scenarioAssertions.movement?.minResolvedAxisDelta !== undefined) {
    const entity = scenarioAssertions.movement.entity ?? input.scenario.subject ?? input.report.entity;
    const expectation = parseMovementAxisExpectation(scenarioAssertions.movement.minResolvedAxisDelta.axis);
    const resolved = expectation === undefined ? undefined : maxResolvedAxisDelta(input.report.effectLog, entity, expectation, input.report.before?.position);
    const pass = resolved !== undefined && resolved >= scenarioAssertions.movement.minResolvedAxisDelta.min;
    assertions.push({
      details: {
        axis: scenarioAssertions.movement.minResolvedAxisDelta.axis,
        entity,
        min: scenarioAssertions.movement.minResolvedAxisDelta.min,
        signedDelta: resolved ?? null,
      },
      id: "movement.resolvedAxisDelta",
      pass,
    });
    if (!pass) {
      diagnostics.push({
        code: "TN_PLAYTEST_RESOLVED_AXIS_DELTA_ASSERTION_FAILED",
        message: `Entity '${entity}' did not resolve ${scenarioAssertions.movement.minResolvedAxisDelta.min} units on ${scenarioAssertions.movement.minResolvedAxisDelta.axis}.`,
        severity: "error",
        suggestion: "Check character.move effect-log entries, route setup, collision response, and whether the scenario reaches the expected slope or step surface.",
      });
    }
  }
  if (scenarioAssertions.movement?.rotationChanged === true) {
    const rotation = rotationDelta(
      input.report.effectLog,
      scenarioAssertions.movement.entity ?? input.report.entity,
      input.report.before?.rotation,
      input.report.after?.rotation,
    );
    const pass = rotation !== undefined && rotation > 0.0001;
    assertions.push({ details: { rotationDelta: rotation ?? null }, id: "movement.rotation", pass });
    if (!pass) {
      diagnostics.push({
        code: "TN_PLAYTEST_ROTATION_ASSERTION_FAILED",
        message: `Entity '${scenarioAssertions.movement.entity ?? input.report.entity}' did not expose a changed rotation during the playtest.`,
        severity: "error",
        suggestion: "Check turn/yaw script output and ensure Transform rotation changes are emitted.",
      });
    }
  }
  if (scenarioAssertions.movement?.maxTiltDegrees !== undefined) {
    const entity = scenarioAssertions.movement.entity ?? input.report.entity;
    const tilt = tiltDegrees(input.report.after?.rotation) ?? finalTiltDegrees(input.report.effectLog, entity);
    const pass = tilt !== undefined && tilt <= scenarioAssertions.movement.maxTiltDegrees;
    assertions.push({
      details: { entity, maxTiltDegrees: scenarioAssertions.movement.maxTiltDegrees, tiltDegrees: tilt ?? null },
      id: "movement.tilt",
      pass,
    });
    if (!pass) {
      diagnostics.push({
        code: "TN_PLAYTEST_TILT_ASSERTION_FAILED",
        message: `Entity '${entity}' final tilt ${tilt === undefined ? "was unavailable" : `${tilt.toFixed(3)} degrees`} and must not exceed ${scenarioAssertions.movement.maxTiltDegrees} degrees.`,
        severity: "error",
        suggestion: "Inspect the final Transform rotation and fix suspension, grounding, collision response, or recovery before accepting the playtest.",
      });
    }
  }
  if (scenarioAssertions.movement?.closesDistanceToPosition !== undefined) {
    const expectation = scenarioAssertions.movement.closesDistanceToPosition;
    const before = input.report.before?.position;
    const after = input.report.after?.position;
    const decrease = before === undefined || after === undefined
      ? undefined
      : vectorDistance(before, expectation.position) - vectorDistance(after, expectation.position);
    const pass = decrease !== undefined && decrease >= expectation.min;
    assertions.push({
      details: { decrease: decrease ?? null, position: expectation.position, required: expectation.min },
      id: "movement.closesDistance",
      pass,
    });
    if (!pass) diagnostics.push({
      code: "TN_PLAYTEST_DISTANCE_CLOSURE_ASSERTION_FAILED",
      message: `Entity did not close distance to the expected position by ${expectation.min}.`,
      severity: "error",
      suggestion: "Inspect pursue target ownership and character.move resolved positions.",
    });
  }
  if (scenarioAssertions.movement?.reachesPositionWithin !== undefined) {
    const expectation = scenarioAssertions.movement.reachesPositionWithin;
    const entity = scenarioAssertions.movement.entity ?? input.scenario.subject ?? input.report.entity;
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
    assertions.push({
      details: { closestDistance: closestDistance ?? null, entity, ...expectation },
      id: "movement.reachesPosition",
      pass,
    });
    if (!pass) diagnostics.push({
      code: "TN_PLAYTEST_POSITION_REACH_ASSERTION_FAILED",
      message: `Entity '${entity}' did not come within ${expectation.maxDistance} units of the expected position.`,
      severity: "error",
      suggestion: "Inspect character.move resolved positions and the owned last-known-position target.",
    });
  }
  if (scenarioAssertions.movement?.facesMovementWithinDegrees !== undefined) {
    const entity = scenarioAssertions.movement.entity ?? input.scenario.subject ?? input.report.entity;
    const evidence = movementFacingEvidence(input.report.effectLog, entity);
    const pass = evidence.sampleCount > 0
      && evidence.maxErrorDegrees <= scenarioAssertions.movement.facesMovementWithinDegrees;
    assertions.push({
      details: { entity, ...evidence, threshold: scenarioAssertions.movement.facesMovementWithinDegrees },
      id: "movement.facing",
      pass,
    });
    if (!pass) diagnostics.push({
      code: "TN_PLAYTEST_MOVEMENT_FACING_ASSERTION_FAILED",
      message: `Entity '${entity}' did not face resolved movement within ${scenarioAssertions.movement.facesMovementWithinDegrees} degrees.`,
      severity: "error",
      suggestion: "Inspect character.move direction and Transform yaw effects; slew facing before allowing translation.",
    });
  }
  if (scenarioAssertions.movement?.notFacing !== undefined) {
    const entity = scenarioAssertions.movement.entity ?? input.scenario.subject ?? input.report.entity;
    const angleDegrees = finalFacingAngleToEntity(input.report.effectLog, entity, scenarioAssertions.movement.notFacing.entity);
    const pass = angleDegrees !== undefined && angleDegrees >= scenarioAssertions.movement.notFacing.minDegrees;
    assertions.push({
      details: { angleDegrees: angleDegrees ?? null, entity, target: scenarioAssertions.movement.notFacing.entity },
      id: "movement.notFacing",
      pass,
    });
    if (!pass) diagnostics.push({
      code: "TN_PLAYTEST_NOT_FACING_ASSERTION_FAILED",
      message: `Entity '${entity}' remained pointed at '${scenarioAssertions.movement.notFacing.entity}' during movement.`,
      severity: "error",
      suggestion: "Drive patrol yaw from movement direction rather than the target entity.",
    });
  }
  if (scenarioAssertions.movement?.notFacingPosition !== undefined) {
    const entity = scenarioAssertions.movement.entity ?? input.scenario.subject ?? input.report.entity;
    const expectation = scenarioAssertions.movement.notFacingPosition;
    const angleDegrees = finalFacingAngleToPosition(input.report.effectLog, entity, expectation.position);
    const pass = angleDegrees !== undefined && angleDegrees >= expectation.minDegrees;
    assertions.push({
      details: { angleDegrees: angleDegrees ?? null, entity, position: expectation.position },
      id: "movement.notFacingPosition",
      pass,
    });
    if (!pass) diagnostics.push({
      code: "TN_PLAYTEST_NOT_FACING_POSITION_ASSERTION_FAILED",
      message: `Entity '${entity}' remained pointed at the excluded world position during movement.`,
      severity: "error",
      suggestion: "Drive patrol yaw from movement direction rather than the observed target position.",
    });
  }
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
    if (result.diagnostic !== undefined) {
      diagnostics.push(result.diagnostic);
    }
  }
  for (const [contactIndex, assertion] of (scenarioAssertions.contacts ?? []).entries()) {
    const entity = assertion.entity ?? input.scenario.subject;
    const anonymous = entity === undefined;
    if (assertion.requiredOn !== undefined && !assertion.requiredOn.includes(input.scenario.target)) {
      assertions.push({
        details: { entity: entity || "anonymous", requiredOn: assertion.requiredOn, skipped: true, target: input.scenario.target },
        id: assertion.entity === undefined ? `contact.${contactIndex}` : `contact.${entity}`,
        pass: true,
      });
      continue;
    }
    const tokens = [entity, assertion.with, assertion.kind].filter((item): item is string => item !== undefined);
    const selectedSample = assertion.atStep === undefined
      ? undefined
      : input.report.observations?.physicsDebugSeries?.find((sample) => sample.label === assertion.atStep);
    const runtimeStepAvailable = assertion.atStep === undefined
      || runtimeGameplayAtStep(input.report.observations?.runtimeObservations, assertion.atStep) !== undefined;
    const stepAvailable = assertion.atStep === undefined || selectedSample !== undefined || runtimeStepAvailable;
    const effectEvidence = assertion.atStep === undefined
      ? mergeEffectLogs(input.report.effectLog, input.report.observations?.effectLogSeries)
      : [];
    const effectCount = countMatchingEntries(effectEvidence, tokens);
    const runtimeCount = assertion.atStep === undefined
      ? countRuntimeContacts(input.report.observations?.runtimeObservations, entity, assertion.with, assertion.kind)
      : 0;
    const physicsEvidence = assertion.kind === undefined || assertion.kind === "contact"
      ? physicsDebugContactEvidence(input.report.observations, entity, assertion.with, selectedSample?.snapshot)
      : { candidates: [], count: 0 };
    const runtimeEvidence = runtimeContactEvidence(
      input.report.observations?.runtimeObservations,
      entity,
      assertion.with,
      assertion.kind,
      assertion.atStep,
    );
    const candidates = [...new Set([...physicsEvidence.candidates, ...runtimeEvidence.candidates])];
    const count = effectCount + physicsEvidence.count + (assertion.atStep === undefined ? runtimeCount : runtimeEvidence.count);
    const minCount = assertion.minCount ?? (assertion.maxCount === undefined ? 1 : 0);
    const candidatesAvailable = !anonymous || candidates.length > 0;
    const pass = stepAvailable && candidatesAvailable && count >= minCount && (assertion.maxCount === undefined || count <= assertion.maxCount);
    const resultEntity = entity || "anonymous";
    assertions.push({ details: { atStep: assertion.atStep, candidates, count, entity: resultEntity, kind: assertion.kind, maxCount: assertion.maxCount, minCount, with: assertion.with }, id: assertion.entity === undefined ? `contact.${contactIndex}` : `contact.${resultEntity}`, pass });
    if (!pass) {
      const partial = summarizeMatchingEntries(effectEvidence, [entity, assertion.with].filter((item): item is string => item !== undefined));
      const hasPhysicsDebugEvidence = input.report.observations?.physicsDebug !== undefined
        || (input.report.observations?.physicsDebugSeries?.length ?? 0) > 0;
      diagnostics.push({
        artifactPath: partial !== undefined || !hasPhysicsDebugEvidence ? "effect-log.json" : "observations.json",
        code: !stepAvailable
          ? "TN_PLAYTEST_CONTACT_STEP_NOT_OBSERVED"
          : !candidatesAvailable
          ? "TN_PLAYTEST_CONTACT_CANDIDATES_UNAVAILABLE"
          : assertion.maxCount !== undefined && count > assertion.maxCount
          ? "TN_PLAYTEST_CONTACT_COUNT_EXCEEDED"
          : "TN_PLAYTEST_CONTACT_NOT_OBSERVED",
        message: !stepAvailable
          ? `Contact assertion step '${assertion.atStep}' was not retained.`
          : !candidatesAvailable
          ? "No observed contact candidate was retained for the anonymous contact assertion."
          : assertion.maxCount !== undefined && count > assertion.maxCount
          ? `Contact/trigger for '${resultEntity}' was observed ${count} time(s), above allowed ${assertion.maxCount}.`
          : `Expected contact/trigger for '${resultEntity}' was not observed ${minCount} time(s).`,
        observedRuntimePath: `observations.json/physicsDebugSeries/artifact/primitives[category=contact,entity=${resultEntity}] | effect-log.json/entries[kind=service|event,entity=${resultEntity}]`,
        path: `${input.scenario.sourcePath ?? "playtest"}/assert/contacts/${resultEntity}`,
        severity: "error",
        ...(input.scenario.sourcePath === undefined ? {} : { sourcePath: input.scenario.sourcePath }),
        ...(partial?.systemId === undefined ? {} : { systemId: partial.systemId, sourcePath: partial.sourcePath }),
        suggestion: !stepAvailable
          ? "Add a scenario step with the requested label or correct assert.contacts[].atStep."
          : partial === undefined
          ? "Check collider/trigger metadata, contact filters, and whether the scenario reaches the target. Inspect observations.json physics-debug contacts and effect-log.json."
          : `effect-log.json contains ${partial.entryCount} related runtime entr${partial.entryCount === 1 ? "y" : "ies"} from ${partial.systems}, but none satisfied the contact assertion. Check collider/trigger metadata, contact filters, and route timing in the listed system(s).`,
      });
    }
  }
  for (const [settledIndex, assertion] of (scenarioAssertions.settled ?? []).entries()) {
    if (assertion.requiredOn !== undefined && !assertion.requiredOn.includes(input.scenario.target)) {
      assertions.push({
        details: { entity: assertion.entity ?? "anonymous", requiredOn: assertion.requiredOn, skipped: true, target: input.scenario.target },
        id: `settled.${assertion.entity ?? "anonymous"}`,
        pass: true,
      });
      continue;
    }
    const snapshot = assertion.atStep === undefined
      ? input.report.observations?.physicsDebugSeries?.at(-1)?.snapshot ?? input.report.observations?.physicsDebug
      : input.report.observations?.physicsDebugSeries?.find((sample) => sample.label === assertion.atStep)?.snapshot;
    const minimum = assertion.minBodies ?? 1;
    const candidate = settledCandidate(snapshot, assertion.entity);
    const bodies = candidate?.bodies ?? [];
    const omittedBodies = physicsDebugOmittedBodies(snapshot);
    const sleeping = bodies.filter((body) => body.sleeping).length;
    const comparisonSnapshot = assertion.compareToStep === undefined
      ? undefined
      : input.report.observations?.physicsDebugSeries?.find((sample) => sample.label === assertion.compareToStep)?.snapshot;
    const selectedEntity = candidate?.selector ?? assertion.entity ?? "";
    const poseDistance = assertion.compareToStep === undefined
      ? undefined
      : physicsDebugMeanPoseDistance(snapshot, comparisonSnapshot, selectedEntity);
    const posePass = assertion.minMeanPoseDistance === undefined
      || (poseDistance !== undefined && poseDistance.sharedBodies >= minimum && poseDistance.mean >= assertion.minMeanPoseDistance);
    const complete = omittedBodies === 0;
    const comparisonPass = complete && candidate !== undefined && bodies.length >= minimum && sleeping === bodies.length && posePass;
    const initialSnapshot = initialPhysicsDebugSnapshot(input.report.observations);
    const initialCandidate = settledCandidate(initialSnapshot, assertion.entity);
    const initialBodies = initialCandidate?.bodies ?? [];
    // A pose-distance threshold is inherently a comparison between two retained samples. The
    // initial snapshot has no labeled comparison step, so it cannot make this assertion trivial
    // merely because its bodies happened to start asleep.
    const initialPosePass = assertion.minMeanPoseDistance === undefined;
    const initialPass = initialSnapshot !== undefined
      && physicsDebugOmittedBodies(initialSnapshot) === 0
      && initialCandidate !== undefined
      && initialBodies.length >= minimum
      && initialBodies.every((body) => body.sleeping)
      && initialPosePass;
    const trivial = comparisonPass && initialPass;
    const pass = comparisonPass && (!trivial || typeof assertion.allowTrivial === "string");
    const resultEntity = candidate?.selector ?? assertion.entity ?? "anonymous";
    assertions.push({
      details: {
        atStep: assertion.atStep,
        bodies: bodies.length,
        candidates: candidate?.candidates ?? [],
        compareToStep: assertion.compareToStep,
        entity: resultEntity,
        expected: assertion,
        initialPass,
        initialPosePass,
        minimum,
        omittedBodies,
        poseDistance,
        sleeping,
        trivial,
        ...(trivial && typeof assertion.allowTrivial === "string" ? { trivialityOptOut: true } : {}),
      },
      id: assertion.entity === undefined ? `settled.${settledIndex}` : `settled.${assertion.entity}`,
      pass,
    });
    if (!pass) diagnostics.push({
      artifactPath: "observations.json",
      code: trivial && typeof assertion.allowTrivial !== "string"
        ? "TN_PLAYTEST_ASSERTION_TRIVIAL"
        : !complete
        ? "TN_PLAYTEST_PHYSICS_EVIDENCE_TRUNCATED"
        : !posePass ? "TN_PLAYTEST_RAGDOLL_POSE_NOT_DISTINCT" : "TN_PLAYTEST_PHYSICS_NOT_SETTLED",
      message: trivial && typeof assertion.allowTrivial !== "string"
        ? `Assertion 'settled.${resultEntity}' was already satisfied before the scenario ran.`
        : !complete
        ? `Physics evidence omitted ${omittedBodies} bod${omittedBodies === 1 ? "y" : "ies"}; settled cannot pass on a partial snapshot.`
        : !posePass
        ? `Expected mean settled-pose distance for '${resultEntity}' to reach ${assertion.minMeanPoseDistance}m from step '${assertion.compareToStep}'; observed ${poseDistance?.mean ?? "unavailable"}m across ${poseDistance?.sharedBodies ?? 0} bodies.`
        : `Expected at least ${minimum} physics bod${minimum === 1 ? "y" : "ies"} matching '${resultEntity}' to be asleep; observed ${sleeping} of ${bodies.length}.`,
      observedRuntimePath: "observations.json/physicsDebugSeries/artifact/primitives[category=sleep]",
      path: `${input.scenario.sourcePath ?? "playtest"}/assert/settled/${resultEntity}`,
      severity: "error",
      ...(input.scenario.sourcePath === undefined ? {} : { sourcePath: input.scenario.sourcePath }),
      suggestion: trivial && typeof assertion.allowTrivial !== "string"
        ? "Drive the asserted bodies from an awake initial state, or provide allowTrivial with the reason the rest state is intentionally held."
        : "Allow a longer settle window or fix damping, contacts, joints, and persistent forces that keep the bodies awake.",
    });
  }
  for (const assertion of scenarioAssertions.occluded ?? []) {
    const matches = matchingOccludedRaycasts(input.report.effectLog, assertion.entity, assertion.target);
    const id = `occluded.${assertion.entity ?? "ray"}`;
    const initialMatches = matchingOccludedRaycasts(
      initialEffectLog(input.report.observations),
      assertion.entity,
      assertion.target,
    );
    const comparisonPass = matches > 0;
    const trivial = comparisonPass && initialMatches > 0;
    const pass = comparisonPass && (!trivial || typeof assertion.allowTrivial === "string");
    assertions.push({
      details: {
        count: matches,
        entity: assertion.entity,
        expected: assertion,
        initialMatches,
        target: assertion.target,
        trivial,
        ...(trivial && typeof assertion.allowTrivial === "string" ? { trivialityOptOut: true } : {}),
      },
      id,
      pass,
    });
    if (!pass) diagnostics.push({
      artifactPath: "effect-log.json",
      code: trivial && typeof assertion.allowTrivial !== "string"
        ? "TN_PLAYTEST_ASSERTION_TRIVIAL"
        : "TN_PLAYTEST_OCCLUSION_NOT_OBSERVED",
      message: trivial && typeof assertion.allowTrivial !== "string"
        ? `Assertion '${id}' was already satisfied before the scenario ran.`
        : "Expected a render scene-ray query or physics raycast result with hit=true, but no matching occlusion evidence was observed.",
      observedRuntimePath: "effect-log.json/entries[service=render.sceneRayQuery|physics.raycast]/payload/result/hit",
      severity: "error",
      suggestion: trivial && typeof assertion.allowTrivial !== "string"
        ? "Drive the asserted occlusion from a non-occluded initial state, or provide allowTrivial with the reason the occlusion is intentionally held."
        : "Check the listener/emitter entity ids and rendered occluder geometry, then inspect effect-log.json for the scene-query request and hit result.",
    });
  }
  for (const assertion of scenarioAssertions.animation ?? []) {
    const entity = assertion.entity ?? input.scenario.subject ?? input.report.entity;
    const runtime = runtimeAnimationObservations(input.report.observations?.runtimeObservations);
    if (runtime !== undefined) {
      const observed = isRecord(runtime[entity]) ? runtime[entity] : undefined;
      const clip = typeof observed?.clip === "string" ? observed.clip : undefined;
      const advancedFrames = typeof observed?.advancedFrames === "number" ? observed.advancedFrames : undefined;
      const finished = typeof observed?.finished === "boolean" ? observed.finished : undefined;
      const pass = observed !== undefined
        && (assertion.clip === undefined || clip === assertion.clip)
        && (assertion.entered !== true || clip !== undefined)
        && (assertion.finished === undefined || (finished !== undefined && finished === assertion.finished))
        && (assertion.advancedFrames === undefined || (advancedFrames !== undefined && advancedFrames >= assertion.advancedFrames));
      const initialGameplay = runtimeGameplayBefore(input.report.observations?.runtimeObservations);
      const initialAnimations = isRecord(initialGameplay?.animation) ? initialGameplay.animation : undefined;
      const initialObserved = isRecord(initialAnimations?.[entity]) ? initialAnimations[entity] : undefined;
      const initialPass = animationObservationPass(assertion, initialObserved);
      const trivial = pass && initialPass;
      const guardedPass = pass && (!trivial || typeof assertion.allowTrivial === "string");
      assertions.push({
        details: {
          advancedFrames,
          clip,
          entity,
          expected: assertion,
          finished,
          initialPass,
          trivial,
          ...(trivial && typeof assertion.allowTrivial === "string" ? { trivialityOptOut: true } : {}),
        },
        id: `animation.${entity}`,
        pass: guardedPass,
      });
      if (!guardedPass) {
        diagnostics.push({
          code: trivial && typeof assertion.allowTrivial !== "string"
            ? "TN_PLAYTEST_ASSERTION_TRIVIAL"
            : "TN_PLAYTEST_ANIMATION_NOT_OBSERVED",
          message: trivial && typeof assertion.allowTrivial !== "string"
            ? `Assertion 'animation.${entity}' was already satisfied before the scenario ran.`
            : `Expected animation evidence for '${entity}'${assertion.clip === undefined ? "" : ` clip '${assertion.clip}'`} was not observed.`,
          severity: "error",
          suggestion: trivial && typeof assertion.allowTrivial !== "string"
            ? "Drive the asserted animation from a different initial clip, or provide allowTrivial with the reason the clip is intentionally held."
            : "Check model animation clip wiring and runtime animation playback state.",
        });
      }
      continue;
    }
    if (assertion.finished !== undefined) {
      assertions.push({ details: { entity, expected: assertion, finished: undefined }, id: `animation.${entity}`, pass: false });
      diagnostics.push({
        code: "TN_PLAYTEST_ANIMATION_NOT_OBSERVED",
        message: `Expected runtime completion evidence for animation '${entity}', but the runtime animation channel was unavailable.`,
        severity: "error",
        suggestion: "Install the runtime animation observer and inspect runtimeObservations.gameplay.animation.",
      });
      continue;
    }
    const tokens = [entity, assertion.clip].filter((item): item is string => item !== undefined);
    const count = countMatchingEntries(input.report.effectLog, tokens);
    const minCount = Math.max(1, assertion.advancedFrames ?? 1);
    const comparisonPass = count >= minCount;
    const initialCount = countMatchingEntries(initialEffectLog(input.report.observations), tokens);
    const trivial = comparisonPass && initialCount >= minCount;
    const pass = comparisonPass && (!trivial || typeof assertion.allowTrivial === "string");
    assertions.push({
      details: {
        count,
        entity,
        clip: assertion.clip,
        advancedFrames: assertion.advancedFrames,
        expected: assertion,
        finished: assertion.finished,
        initialCount,
        trivial,
        ...(trivial && typeof assertion.allowTrivial === "string" ? { trivialityOptOut: true } : {}),
      },
      id: `animation.${entity}`,
      pass,
    });
    if (!pass) {
      diagnostics.push({
        code: trivial && typeof assertion.allowTrivial !== "string"
          ? "TN_PLAYTEST_ASSERTION_TRIVIAL"
          : "TN_PLAYTEST_ANIMATION_NOT_OBSERVED",
        message: trivial && typeof assertion.allowTrivial !== "string"
          ? `Assertion 'animation.${entity}' was already satisfied before the scenario ran.`
          : `Expected animation evidence for '${entity}'${assertion.clip === undefined ? "" : ` clip '${assertion.clip}'`} was not observed.`,
        severity: "error",
        suggestion: trivial && typeof assertion.allowTrivial !== "string"
          ? "Drive the asserted animation from a different initial clip, or provide allowTrivial with the reason the clip is intentionally held."
          : "Check model animation clip wiring and runtime animation playback state.",
      });
    }
  }
  for (const entry of PLAYTEST_ASSERTION_REGISTRY) {
    if (scenarioAssertions[entry.kind] === undefined
      || assertions.some((assertion) => assertion.id.startsWith(entry.resultIdPrefix))
      || assertionEvaluatedByBaseProbe(entry.kind, input.report)) {
      continue;
    }
    const id = `assert.${entry.kind}`;
    assertions.push({ details: { reason: "registered-without-evaluator" }, id, pass: false });
    diagnostics.push(assertionNotEvaluatedDiagnostic(id, "the registered assertion produced no evaluator result"));
  }
  if (allTrivialityEligibleAssertionsWaived(assertions)) {
    diagnostics.push({
      code: "TN_PLAYTEST_SCENARIO_ASSERTS_NOTHING",
      message: `Scenario '${input.scenario.name}' waived every triviality-eligible assertion, so it asserts nothing independently of its initial state.`,
      severity: "error",
      ...(input.scenario.sourcePath === undefined ? {} : { sourcePath: input.scenario.sourcePath }),
      suggestion: "Remove at least one triviality waiver and drive that assertion from a failing initial state or assert changed:true.",
    });
  }
  if (assertions.length === 0 || (scenarioAssertions.diagnostics === undefined && !assertions.some(({ id }) => id !== "diagnostics"))) {
    const id = "scenario.assertions";
    assertions.push({ details: { reason: "no-evaluated-assertions" }, id, pass: false });
    diagnostics.push({
      code: "TN_PLAYTEST_SCENARIO_NO_ASSERTIONS",
      message: `Scenario '${input.scenario.name}' completed without evaluating any assertions.`,
      severity: "error",
      ...(input.scenario.sourcePath === undefined ? {} : { sourcePath: input.scenario.sourcePath }),
      suggestion: "Declare a supported assertion and ensure its evaluator observes a result before treating the scenario as proof.",
    });
  }
  return { assertions, diagnostics };
}

function horizontalRadius(
  transform: { halfExtents?: Vec3; scale?: Vec3 } | undefined,
  direction: readonly [number, number],
): number {
  const halfExtents = transform?.halfExtents
    ?? (transform?.scale === undefined ? undefined : transform.scale.map((value) => Math.abs(value) * 0.5) as Vec3);
  return halfExtents === undefined
    ? 0
    : Math.abs(direction[0]) * Math.abs(halfExtents[0]) + Math.abs(direction[1]) * Math.abs(halfExtents[2]);
}

function platformTop(transform: { halfExtents?: Vec3; position?: Vec3; scale?: Vec3 }): number {
  const halfHeight = transform.halfExtents?.[1] ?? (transform.scale === undefined ? 0 : Math.abs(transform.scale[1]) * 0.5);
  return (transform.position?.[1] ?? 0) + halfHeight;
}

function movementEnvelopeHorizontalLimit(
  envelope: { fallDistanceToGround: number; forwardReach: number; maxRise: number },
  rise: number,
): number | undefined {
  if (rise > envelope.maxRise) return undefined;
  const dropFromApex = envelope.maxRise - rise;
  if (dropFromApex > envelope.fallDistanceToGround) return undefined;
  if (envelope.maxRise === 0) return rise === 0 ? envelope.forwardReach : undefined;
  return envelope.forwardReach * (1 + Math.sqrt(dropFromApex / envelope.maxRise));
}

interface IContactEvidence {
  candidates: string[];
  count: number;
}

function physicsDebugContactEvidence(
  observations: IPlaytestObservations | undefined,
  entity: string | undefined,
  withEntity: string | undefined,
  selectedSnapshot?: unknown,
): IContactEvidence {
  const snapshots = selectedSnapshot === undefined
    ? [
        observations?.physicsDebug,
        ...(observations?.physicsDebugSeries ?? []).map((sample) => sample.snapshot),
      ]
    : [selectedSnapshot];
  const candidates: string[] = [];
  for (const snapshot of snapshots) {
    if (!isRecord(snapshot) || !isRecord(snapshot.artifact) || !Array.isArray(snapshot.artifact.primitives)) continue;
    for (const primitive of snapshot.artifact.primitives) {
      if (!isRecord(primitive) || primitive.category !== "contact" || typeof primitive.id !== "string") continue;
      if (primitive.id.includes(entity ?? "") && (withEntity === undefined || primitive.id.includes(withEntity))) {
        candidates.push(primitive.id);
      }
    }
  }
  return { candidates: [...new Set(candidates)], count: candidates.length };
}

function settledCandidate(
  snapshot: unknown,
  entity: string | undefined,
): { bodies: Array<{ entity: string; sleeping: boolean }>; candidates: string[]; selector: string } | undefined {
  const bodies = physicsDebugSleepStates(snapshot, entity);
  if (entity !== undefined) {
    return bodies.length === 0 ? undefined : { bodies, candidates: bodies.map(({ entity: body }) => body), selector: entity };
  }
  const groups = new Map<string, Array<{ entity: string; sleeping: boolean }>>();
  for (const body of bodies) {
    const selector = bodySelector(body.entity);
    const group = groups.get(selector) ?? [];
    group.push(body);
    groups.set(selector, group);
  }
  const selected = [...groups.entries()]
    .sort(([leftSelector, leftBodies], [rightSelector, rightBodies]) => rightBodies.length - leftBodies.length || leftSelector.localeCompare(rightSelector))[0];
  if (selected === undefined) return undefined;
  const [selector, selectedBodies] = selected;
  return { bodies: selectedBodies, candidates: selectedBodies.map(({ entity: body }) => body), selector };
}

function bodySelector(entity: string): string {
  return /\d$/.test(entity) ? entity.replace(/\d+$/, "") : entity;
}

function physicsDebugSleepStates(snapshot: unknown, entity?: string): Array<{ entity: string; sleeping: boolean }> {
  if (!isRecord(snapshot) || !isRecord(snapshot.artifact) || !Array.isArray(snapshot.artifact.primitives)) return [];
  return snapshot.artifact.primitives.flatMap((primitive) => {
    if (!isRecord(primitive)
      || primitive.category !== "sleep"
      || typeof primitive.entity !== "string"
      || (entity !== undefined && primitive.entity !== entity && !primitive.entity.startsWith(entity))
      || typeof primitive.value !== "number") return [];
    return [{ entity: primitive.entity, sleeping: primitive.value >= 1 }];
  });
}

function physicsDebugOmittedBodies(snapshot: unknown): number {
  if (!isRecord(snapshot) || !isRecord(snapshot.artifact) || !isRecord(snapshot.artifact.overflow)) {
    return 0;
  }
  const omitted = snapshot.artifact.overflow.omittedBodies;
  return typeof omitted === "number" && Number.isInteger(omitted) && omitted >= 0 ? omitted : 1;
}

function physicsDebugMeanPoseDistance(
  snapshot: unknown,
  comparisonSnapshot: unknown,
  entity: string,
): { mean: number; sharedBodies: number } | undefined {
  const positions = physicsDebugBodyPositions(snapshot, entity);
  const comparison = physicsDebugBodyPositions(comparisonSnapshot, entity);
  const distances = [...positions.entries()].flatMap(([id, position]) => {
    const other = comparison.get(id);
    return other === undefined
      ? []
      : [Math.hypot(position[0] - other[0], position[1] - other[1], position[2] - other[2])];
  });
  if (distances.length === 0) return undefined;
  return {
    mean: distances.reduce((sum, distance) => sum + distance, 0) / distances.length,
    sharedBodies: distances.length,
  };
}

function physicsDebugBodyPositions(snapshot: unknown, entity: string): Map<string, [number, number, number]> {
  const positions = new Map<string, [number, number, number]>();
  if (!isRecord(snapshot) || !isRecord(snapshot.artifact) || !Array.isArray(snapshot.artifact.primitives)) return positions;
  for (const primitive of snapshot.artifact.primitives) {
    if (!isRecord(primitive)
      || primitive.category !== "center-of-mass"
      || typeof primitive.entity !== "string"
      || (primitive.entity !== entity && !primitive.entity.startsWith(entity))
      || !finiteVector(primitive.position)) continue;
    positions.set(primitive.entity, primitive.position as [number, number, number]);
  }
  return positions;
}

function assertionEvaluatedByBaseProbe(
  kind: keyof NonNullable<IPlaytestScenario["assert"]>,
  report: IPlaytestReport,
): boolean {
  if (kind === "movement") return report.expectMoved || report.expectAxis !== undefined;
  if (kind === "camera") return report.follow !== undefined;
  return false;
}

function assertionNotEvaluatedDiagnostic(id: string, reason: string): IPlaytestDiagnostic {
  return {
    code: "TN_PLAYTEST_ASSERTION_NOT_EVALUATED",
    message: `Declared assertion '${id}' was not evaluated: ${reason}.`,
    severity: "error",
    suggestion: "Run this assertion on a supported target or add its evaluator before treating the scenario as proof.",
  };
}

export function overlayNodeObservationKey(overlayId: string, selector: string): string {
  return `${overlayId}:${selector}`;
}

function evaluateTagCountAssertion(
  assertion: IPlaytestTagCountAssertion,
  observations: unknown,
): { assertion: IPlaytestAssertionResult; diagnostic?: IPlaytestDiagnostic } {
  const gameplay = gameplayObservations(observations);
  const count = tagCount(gameplay, assertion.tag);
  const comparisonPass = count !== undefined
    && (assertion.count === undefined || count === assertion.count)
    && (assertion.gte === undefined || count >= assertion.gte)
    && (assertion.lte === undefined || count <= assertion.lte);
  const initialCount = tagCount(runtimeGameplayBefore(observations), assertion.tag);
  const initialPass = initialCount !== undefined
    && (assertion.count === undefined || initialCount === assertion.count)
    && (assertion.gte === undefined || initialCount >= assertion.gte)
    && (assertion.lte === undefined || initialCount <= assertion.lte);
  const trivial = comparisonPass && initialPass;
  const pass = comparisonPass && (!trivial || typeof assertion.allowTrivial === "string");
  const result = {
    details: {
      count: count ?? null,
      expected: assertion,
      initialCount: initialCount ?? null,
      initialPass,
      tag: assertion.tag,
      trivial,
      ...(trivial && typeof assertion.allowTrivial === "string" ? { trivialityOptOut: true } : {}),
    },
    id: `tags.${assertion.tag}`,
    pass,
  };
  return pass
    ? { assertion: result }
    : {
        assertion: result,
        diagnostic: {
          code: trivial && typeof assertion.allowTrivial !== "string"
            ? "TN_PLAYTEST_ASSERTION_TRIVIAL"
            : "TN_PLAYTEST_TAG_COUNT_ASSERTION_FAILED",
          message: trivial && typeof assertion.allowTrivial !== "string"
            ? `Assertion 'tags.${assertion.tag}' was already satisfied before the scenario ran.`
            : `Tag '${assertion.tag}' count ${count === undefined ? "was unavailable" : count} did not satisfy the expected count.`,
          severity: "error",
          suggestion: trivial && typeof assertion.allowTrivial !== "string"
            ? "Drive the asserted tag count from a different initial count, or provide allowTrivial with the reason the count is intentionally held."
            : "Ensure the runtime entity tags are authored and inspect runtimeObservations.gameplay.tags in the playtest artifact.",
        },
      };
}

/**
 * `index` identifies an assertion that names no entity.
 *
 * Naming the row after the entity the run happened to discover makes the identifier depend on the
 * build rather than on the proof, so two arms of a paired round emit different ids for the same
 * sealed assertion — `states.mission` against `states.anonymous` — and nothing can join them. The
 * discovered entity stays in `details`, where it is evidence rather than identity.
 */
function evaluateStateAssertion(
  assertion: IPlaytestStateAssertion,
  observations: unknown,
  scenario: IPlaytestScenario,
  index: number,
): { assertion: IPlaytestAssertionResult; diagnostic?: IPlaytestDiagnostic } {
  const gameplay = gameplayObservations(runtimeObservationValue(observations));
  const states = isRecord(gameplay?.states) ? gameplay.states : undefined;
  const candidates = Object.entries(states ?? {}).filter((entry): entry is [string, string] => typeof entry[1] === "string");
  const matching = assertion.entity === undefined
    ? candidates.filter(([, state]) => state === assertion.equals)
    : candidates.filter(([entity]) => entity === assertion.entity);
  const terminalStep = assertion.entity === undefined
    ? terminalContactStep(scenario, assertion.equals)
    : undefined;
  const terminal: { contactObserved: boolean; historyComplete: boolean; preExisting: boolean; preExistingEntities: string[]; step: string | null } = terminalStep === undefined
    ? { contactObserved: true, historyComplete: true, preExisting: false, preExistingEntities: [], step: null }
    : terminalStateEvidence(terminalStep, observations, scenario, matching.map(([entity]) => entity));
  const selected = matching.find(([entity]) => !terminal.preExistingEntities.includes(entity)) ?? matching[0];
  const selectedEntity = selected?.[0] ?? assertion.entity;
  const observed = selected?.[1];
  const selectedPreExisting = selected === undefined
    ? terminal.preExisting
    : terminal.preExistingEntities.includes(selected[0]);
  const comparisonPass = observed === assertion.equals && terminal.contactObserved && terminal.historyComplete && !selectedPreExisting;
  const initialStates = runtimeGameplayBefore(observations);
  const initialStateMap = isRecord(initialStates?.states) ? initialStates.states : undefined;
  const initialPass = assertion.entity === undefined
    ? Object.values(initialStateMap ?? {}).some((state) => state === assertion.equals)
    : initialStateMap?.[assertion.entity] === assertion.equals;
  const trivial = comparisonPass && initialPass;
  const pass = comparisonPass && (!trivial || typeof assertion.allowTrivial === "string");
  const result = {
    details: {
      candidates: candidates.map(([entity, state]) => ({ entity, state })),
      entity: selectedEntity ?? "anonymous",
      expected: assertion,
      expectedState: assertion.equals,
      initialPass,
      observed: observed ?? null,
      terminal: { contactObserved: terminal.contactObserved, historyComplete: terminal.historyComplete, preExisting: selectedPreExisting, step: terminal.step },
      trivial,
      ...(trivial && typeof assertion.allowTrivial === "string" ? { trivialityOptOut: true } : {}),
    },
    id: assertion.entity === undefined ? `states.${index}` : `states.${assertion.entity}`,
    pass,
  };
  return pass
    ? { assertion: result }
    : {
        assertion: result,
        diagnostic: {
          code: trivial && typeof assertion.allowTrivial !== "string"
            ? "TN_PLAYTEST_ASSERTION_TRIVIAL"
            : observed === assertion.equals && (!terminal.contactObserved || !terminal.historyComplete || selectedPreExisting)
            ? "TN_PLAYTEST_STATE_ORDERING_FAILED"
            : "TN_PLAYTEST_STATE_ASSERTION_FAILED",
          message: trivial && typeof assertion.allowTrivial !== "string"
            ? `Assertion '${result.id}' was already satisfied before the scenario ran.`
            : observed === assertion.equals && (!terminal.contactObserved || !terminal.historyComplete || selectedPreExisting)
            ? `Terminal state '${assertion.equals}' was not observed after retained contact evidence at '${terminal.step ?? "an unavailable step"}'.`
            : `Entity '${selectedEntity ?? "anonymous"}' state ${observed === undefined ? "was unavailable" : `'${observed}'`} did not equal '${assertion.equals}'.`,
          severity: "error",
          suggestion: trivial && typeof assertion.allowTrivial !== "string"
            ? "Drive the asserted state from a different initial state, or provide allowTrivial with the reason the state is intentionally held."
            : "Ensure the entity has a StateMachine component and inspect runtimeObservations.gameplay.states in the playtest artifact.",
        },
      };
}

function terminalContactStep(scenario: IPlaytestScenario, expectedState: string): string | undefined {
  if (expectedState !== "won") return undefined;
  return [...(scenario.assert?.contacts ?? [])]
    .reverse()
    .find((assertion) => {
      const minimum = assertion.minCount ?? (assertion.maxCount === undefined ? 1 : 0);
      return assertion.atStep !== undefined
        && minimum > 0
        && (assertion.requiredOn === undefined || assertion.requiredOn.includes(scenario.target));
    })?.atStep;
}

function terminalStateEvidence(
  contactStep: string,
  observations: unknown,
  scenario: IPlaytestScenario,
  candidateEntities: readonly string[],
): { contactObserved: boolean; historyComplete: boolean; preExisting: boolean; preExistingEntities: string[]; step: string } {
  const contactAssertion = [...(scenario.assert?.contacts ?? [])]
    .reverse()
    .find((assertion) => assertion.atStep === contactStep);
  const contactObserved = contactAssertion === undefined
    ? false
    : contactAssertionSatisfiedAtStep(contactAssertion, observations, scenario);
  const labeledSteps = scenario.steps.flatMap(({ label }) => label === undefined ? [] : [label]);
  const contactIndex = labeledSteps.indexOf(contactStep);
  const samples = runtimeGameplaySeries(observations);
  const samplesByLabel = new Map(samples.map((sample) => [sample.label, sample.states] as const));
  const historyComplete = contactIndex >= 0
    && labeledSteps.slice(0, contactIndex + 1).every((label) => samplesByLabel.has(label));
  const preExistingEntities = candidateEntities.filter((entity) => {
    if (contactIndex < 0) return false;
    return labeledSteps.slice(0, contactIndex).some((label) => samplesByLabel.get(label)?.[entity] === "won");
  });
  return {
    contactObserved,
    historyComplete,
    preExisting: preExistingEntities.length > 0,
    preExistingEntities,
    step: contactStep,
  };
}

function contactAssertionSatisfiedAtStep(
  assertion: IPlaytestContactAssertion,
  observations: unknown,
  scenario: IPlaytestScenario,
): boolean {
  const selectedSample = physicsDebugSeries(observations).find((sample) => sample.label === assertion.atStep);
  const runtimeSamples = runtimeGameplaySeries(observations);
  const runtimeStepAvailable = runtimeSamples.some(({ label }) => label === assertion.atStep);
  const stepAvailable = selectedSample !== undefined || runtimeStepAvailable;
  const entity = assertion.entity ?? scenario.subject;
  const anonymous = assertion.entity === undefined && scenario.subject === undefined;
  const physicsEvidence = assertion.kind === undefined || assertion.kind === "contact"
    ? physicsDebugContactEvidence(
        observationsForPhysics(observations),
        entity,
        assertion.with,
        selectedSample?.snapshot,
      )
    : { candidates: [], count: 0 };
  const runtimeEvidence = runtimeContactEvidence(observations, entity, assertion.with, assertion.kind, assertion.atStep);
  const candidates = [...new Set([...physicsEvidence.candidates, ...runtimeEvidence.candidates])];
  const count = physicsEvidence.count + runtimeEvidence.count;
  const minimum = assertion.minCount ?? (assertion.maxCount === undefined ? 1 : 0);
  return stepAvailable
    && (!anonymous || candidates.length > 0)
    && count >= minimum
    && (assertion.maxCount === undefined || count <= assertion.maxCount);
}

function evaluateWorldAssertion(
  assertion: IPlaytestWorldAssertion,
  observations: unknown,
): { assertion: IPlaytestAssertionResult; diagnostic?: IPlaytestDiagnostic } {
  const gameplay = gameplayObservations(observations);
  const world = isRecord(gameplay?.world) ? gameplay.world : undefined;
  const observed = world?.seed;
  const seedPass = (typeof observed === "number" || observed === null) && observed === assertion.seed;
  const observedRuntime = isRecord(world?.runtime) ? world.runtime : undefined;
  const expectedRuntime = assertion.runtime;
  const runtimePass = expectedRuntime === undefined || (
    observedRuntime !== undefined &&
    (expectedRuntime.portable === true || observedRuntime.agent === expectedRuntime.agent) &&
    observedRuntime.core === expectedRuntime.core &&
    observedRuntime.randomState === expectedRuntime.randomState &&
    observedRuntime.rapier === expectedRuntime.rapier &&
    observedRuntime.step === expectedRuntime.step
  );
  const pass = seedPass && runtimePass;
  const result = {
    details: {
      expected: assertion.seed,
      expectedRuntime: expectedRuntime ?? null,
      observed: observed ?? null,
      observedRuntime: observedRuntime ?? null,
    },
    id: "world.seed",
    pass,
  };
  return pass
    ? { assertion: result }
    : {
        assertion: result,
        diagnostic: {
          code: "TN_PLAYTEST_WORLD_ASSERTION_FAILED",
          message: !seedPass
            ? `Runtime world seed ${observed === undefined ? "was unavailable" : JSON.stringify(observed)} did not equal ${JSON.stringify(assertion.seed)}.`
            : `Runtime world fingerprint ${observedRuntime === undefined ? "was unavailable" : JSON.stringify(observedRuntime)} did not equal ${JSON.stringify(expectedRuntime)}.`,
          observedRuntimePath: !seedPass
            ? "observations.json/runtimeObservations/gameplay/world/seed"
            : "observations.json/runtimeObservations/gameplay/world/runtime",
          severity: "error",
          suggestion: "Expose the configured world seed and deterministic runtime fingerprint through the runtime bridge and rerun the scenario.",
        },
      };
}

function gameplayObservations(value: unknown): Record<string, unknown> | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const gameplay = value.gameplay;
  return isRecord(gameplay) ? gameplay : undefined;
}

function runtimeObservationValue(value: unknown): unknown {
  if (!isRecord(value) || !Object.hasOwn(value, "runtimeObservations")) return value;
  return value.runtimeObservations;
}

function runtimeGameplayBefore(value: unknown): Record<string, unknown> | undefined {
  const runtime = runtimeObservationValue(value);
  if (!isRecord(runtime)) return undefined;
  return isRecord(runtime.gameplayBefore) ? runtime.gameplayBefore : undefined;
}

function tagCount(gameplay: Record<string, unknown> | undefined, tag: string): number | undefined {
  const tags = isRecord(gameplay?.tags) ? gameplay.tags : undefined;
  const summary = isRecord(tags?.[tag]) ? tags[tag] : undefined;
  return typeof summary?.count === "number" ? summary.count : tags === undefined ? undefined : 0;
}

function initialPhysicsDebugSnapshot(observations: IPlaytestObservations | undefined): unknown {
  return observations?.physicsDebugBefore;
}

function initialEffectLog(observations: IPlaytestObservations | undefined): unknown {
  return observations?.effectLogBefore;
}

function animationObservationPass(assertion: IPlaytestAnimationAssertion, observed: unknown): boolean {
  if (!isRecord(observed)) return false;
  const clip = typeof observed.clip === "string" ? observed.clip : undefined;
  const advancedFrames = typeof observed.advancedFrames === "number" ? observed.advancedFrames : undefined;
  const finished = typeof observed.finished === "boolean" ? observed.finished : undefined;
  return (assertion.clip === undefined || clip === assertion.clip)
    && (assertion.entered !== true || clip !== undefined)
    && (assertion.finished === undefined || (finished !== undefined && finished === assertion.finished))
    && (assertion.advancedFrames === undefined || (advancedFrames !== undefined && advancedFrames >= assertion.advancedFrames));
}

function runtimeGameplaySamples(value: unknown): Array<{ gameplay: Record<string, unknown>; label: string }> {
  const runtime = runtimeObservationValue(value);
  if (!isRecord(runtime) || !Array.isArray(runtime.gameplaySeries)) return [];
  return runtime.gameplaySeries.flatMap((entry) => {
    if (!isRecord(entry) || typeof entry.label !== "string") return [];
    const direct = isRecord(entry.gameplay) ? entry.gameplay : undefined;
    const nested = isRecord(entry.snapshot) && isRecord(entry.snapshot.gameplay) ? entry.snapshot.gameplay : undefined;
    return direct === undefined && nested === undefined ? [] : [{ gameplay: direct ?? nested!, label: entry.label }];
  });
}

function runtimeGameplaySeries(value: unknown): Array<{ label: string; states: Record<string, string> }> {
  return runtimeGameplaySamples(value).map(({ gameplay, label }) => ({
    label,
    states: isRecord(gameplay.states)
      ? Object.fromEntries(Object.entries(gameplay.states).filter((entry): entry is [string, string] => typeof entry[1] === "string"))
      : {},
  }));
}

function runtimeGameplayAtStep(value: unknown, atStep: string | undefined): Record<string, unknown> | undefined {
  const runtime = runtimeObservationValue(value);
  if (atStep === undefined) return gameplayObservations(runtime);
  return runtimeGameplaySamples(runtime).find(({ label }) => label === atStep)?.gameplay;
}

function physicsDebugSeries(value: unknown): Array<{ label: string; snapshot: unknown }> {
  if (!isRecord(value) || !Array.isArray(value.physicsDebugSeries)) return [];
  return value.physicsDebugSeries.flatMap((sample) => {
    if (!isRecord(sample) || typeof sample.label !== "string") return [];
    return [{ label: sample.label, snapshot: sample.snapshot }];
  });
}

function observationsForPhysics(value: unknown): IPlaytestObservations | undefined {
  return isRecord(value) ? value as unknown as IPlaytestObservations : undefined;
}

function runtimeContactEvidence(
  observations: unknown,
  entity: string | undefined,
  withEntity: string | undefined,
  kind: string | undefined,
  atStep: string | undefined,
): IContactEvidence {
  const gameplay = runtimeGameplayAtStep(observations, atStep);
  if (!Array.isArray(gameplay?.contacts)) return { candidates: [], count: 0 };
  const candidates: string[] = [];
  for (const contact of gameplay.contacts) {
    if (!isRecord(contact)
      || typeof contact.entity !== "string"
      || typeof contact.with !== "string"
      || typeof contact.kind !== "string"
      || (entity !== undefined && contact.entity !== entity)
      || (withEntity !== undefined && contact.with !== withEntity)
      || (kind !== undefined && contact.kind !== kind)) continue;
    candidates.push(`${contact.entity}:${contact.with}:${contact.kind}`);
  }
  return { candidates: [...new Set(candidates)], count: candidates.length };
}

function countRuntimeContacts(observations: unknown, entity: string | undefined, withEntity: string | undefined, kind: string | undefined): number {
  const gameplay = gameplayObservations(observations);
  if (!Array.isArray(gameplay?.contacts)) return 0;
  return gameplay.contacts.filter((contact) => {
    if (!isRecord(contact)) return false;
    return (entity === undefined || contact.entity === entity)
      && (withEntity === undefined || contact.with === withEntity)
      && (kind === undefined || contact.kind === kind);
  }).length;
}

function runtimeAnimationObservations(value: unknown): Record<string, unknown> | undefined {
  const gameplay = gameplayObservations(value);
  return isRecord(gameplay?.animation) ? gameplay.animation : undefined;
}

function evaluatePathAssertion(
  kind: "hud" | "resource",
  assertion: IPlaytestPathAssertion,
  observed: { after?: unknown; before?: unknown } | undefined,
  context: { effectLog?: unknown; movedDistance?: number; scenarioSourcePath?: string },
): { assertion: IPlaytestAssertionResult; diagnostic?: IPlaytestDiagnostic } {
  const before = readPath(observed?.before, assertion.path);
  const after = readPath(observed?.after, assertion.path);
  const valueChecksBefore: boolean[] = [];
  const valueChecksAfter: boolean[] = [];
  if (Object.hasOwn(assertion, "equals")) {
    valueChecksBefore.push(jsonEqual(before, assertion.equals));
    valueChecksAfter.push(jsonEqual(after, assertion.equals));
  }
  if (assertion.gte !== undefined) {
    valueChecksBefore.push(typeof before === "number" && before >= assertion.gte);
    valueChecksAfter.push(typeof after === "number" && after >= assertion.gte);
  }
  if (assertion.lte !== undefined) {
    valueChecksBefore.push(typeof before === "number" && before <= assertion.lte);
    valueChecksAfter.push(typeof after === "number" && after <= assertion.lte);
  }
  if (assertion.textIncludes !== undefined) {
    valueChecksBefore.push(String(textValue(before)).includes(assertion.textIncludes));
    valueChecksAfter.push(String(textValue(after)).includes(assertion.textIncludes));
  }
  const trivial = rejectsTrivialAssertion(kind === "hud" ? "hud" : "resources")
    && valueChecksBefore.length > 0
    && before !== undefined
    && valueChecksBefore.every(Boolean);
  const checks = [...valueChecksAfter];
  if (assertion.changed !== undefined) {
    // jsonEqual(undefined, undefined) is true, because JSON.stringify(undefined)
    // is undefined on both sides. Without the observed guard, `changed: false`
    // was satisfied by a value that never existed — and since observations.hud is
    // always {}, that made every hud changed:false assertion green.
    const observed = before !== undefined || after !== undefined;
    checks.push(observed && (assertion.changed ? !jsonEqual(before, after) : jsonEqual(before, after)));
  }
  const pass = checks.length > 0 && checks.every(Boolean) && (!trivial || typeof assertion.allowTrivial === "string");
  const result = {
    details: {
      after,
      before,
      expected: expectedPathAssertion(assertion),
      id: assertion.id,
      path: assertion.path,
      trivial,
      ...(trivial && typeof assertion.allowTrivial === "string" ? { trivialityOptOut: true } : {}),
    },
    id: `${kind}.${assertion.id}${assertion.path === undefined ? "" : `.${assertion.path}`}`,
    pass,
  };
  return pass
    ? { assertion: result }
    : {
        assertion: result,
        diagnostic: trivial && typeof assertion.allowTrivial !== "string"
          ? trivialAssertionDiagnostic(`${kind}.${assertion.id}`, assertion.path, before, context.scenarioSourcePath)
          : pathAssertionDiagnostic(kind, assertion, before, after, context),
      };
}

function evaluateResourceAnyOfAssertion(
  assertion: IPlaytestResourceAnyOfAssertion,
  observed: { after?: unknown; before?: unknown } | undefined,
  context: { effectLog?: unknown; movedDistance?: number; scenarioSourcePath?: string },
): { assertion: IPlaytestAssertionResult; diagnostic?: IPlaytestDiagnostic } {
  const alternatives = assertion.anyOf ?? [];
  const evaluated = alternatives.map((alternative) => evaluatePathAssertion(
    "resource",
    { ...alternative, id: assertion.id } as IPlaytestPathAssertion,
    observed,
    context,
  ));
  const passing = evaluated.find(({ assertion: result }) => result.pass);
  const result = {
    details: {
      alternatives: evaluated.map(({ assertion: alternative }) => alternative.details ?? {}),
      id: assertion.id,
      observed: observed ?? null,
    },
    id: `resource.${assertion.id}.anyOf`,
    pass: passing !== undefined,
  };
  return passing === undefined
    ? {
        assertion: result,
        diagnostic: {
          code: "TN_PLAYTEST_RESOURCE_ANY_OF_ASSERTION_FAILED",
          message: `No alternative path assertion for resource '${assertion.id}' passed.`,
          observedRuntimePath: `observations.json/resources/${assertion.id}`,
          severity: "error",
          suggestion: "Check the shared action input and the resource paths exposed by the runtime bridge.",
        },
      }
    : { assertion: result };
}

function rejectsTrivialAssertion(kind: keyof NonNullable<IPlaytestScenario["assert"]>): boolean {
  return PLAYTEST_ASSERTION_REGISTRY.find((entry) => entry.kind === kind)?.triviality === "reject-initial-value";
}

function allTrivialityEligibleAssertionsWaived(assertions: readonly IPlaytestAssertionResult[]): boolean {
  // Diagnostics is an automatically-added health check, not an independent gameplay assertion.
  const substantive = assertions.filter(({ id }) => id !== "diagnostics");
  return substantive.length > 0 && substantive.every(({ details }) => details?.trivialityOptOut === true);
}

function componentValueChecks(assertion: IPlaytestComponentAssertion, value: unknown): boolean[] {
  const resolved = value;
  return [
    ...(Object.hasOwn(assertion, "equals") ? [jsonEqual(resolved, assertion.equals)] : []),
    ...(assertion.gte === undefined ? [] : [typeof resolved === "number" && resolved >= assertion.gte]),
    ...(assertion.lte === undefined ? [] : [typeof resolved === "number" && resolved <= assertion.lte]),
  ];
}

function matchingSignals(events: unknown[] | undefined, assertion: IPlaytestSignalAssertion): number {
  if (events === undefined) return 0;
  let count = 0;
  for (const event of events) {
    if (!isRecord(event) || event.name !== assertion.name) continue;
    if (assertion.entity !== undefined && event.entity !== assertion.entity) continue;
    count += 1;
  }
  return count;
}


function hasFinalPathExpectation(assertion: IPlaytestPathAssertion): boolean {
  return Object.hasOwn(assertion, "equals")
    || assertion.gte !== undefined
    || assertion.lte !== undefined
    || assertion.textIncludes !== undefined
    || assertion.changed !== undefined;
}

function hasFinalComponentExpectation(assertion: IPlaytestComponentAssertion): boolean {
  return Object.hasOwn(assertion, "equals")
    || assertion.gte !== undefined
    || assertion.lte !== undefined
    || assertion.changed !== undefined;
}



function pathValuePass(assertion: IPlaytestPathAssertion, value: unknown): boolean {
  const checks: boolean[] = [];
  if (Object.hasOwn(assertion, "equals")) checks.push(jsonEqual(value, assertion.equals));
  if (assertion.gte !== undefined) checks.push(typeof value === "number" && value >= assertion.gte);
  if (assertion.lte !== undefined) checks.push(typeof value === "number" && value <= assertion.lte);
  if (assertion.textIncludes !== undefined) checks.push(String(textValue(value)).includes(assertion.textIncludes));
  return checks.length > 0 && checks.every(Boolean);
}

function aerodynamicForceSampleCount(series: IPlaytestObservations["physicsDebugSeries"], entity: string): number {
  return (series ?? []).filter(({ snapshot }) => {
    if (!isRecord(snapshot) || !isRecord(snapshot.artifact) || !Array.isArray(snapshot.artifact.primitives)) return false;
    return snapshot.artifact.primitives.some((primitive) => isRecord(primitive)
      && primitive.category === "aero"
      && primitive.entity === entity
      && typeof primitive.value === "number"
      && Number.isFinite(primitive.value)
      && finiteVector(primitive.from)
      && finiteVector(primitive.to));
  }).length;
}

function aerodynamicControlValues(
  effectLog: unknown,
  series: IPlaytestObservations["effectLogSeries"],
  entity: string,
  surface: string,
): number[] {
  const logs = [effectLog, ...(series ?? []).map((sample) => sample.snapshot)];
  return logs.flatMap((log) => !isRecord(log) || !Array.isArray(log.entries) ? [] : log.entries.flatMap((entry) => {
    if (!isRecord(entry) || entry.service !== "physics.aerodynamics.setInputs" || !isRecord(entry.payload)) return [];
    const request = record(entry.payload.request);
    const inputs = record(request?.inputs);
    const surfaces = record(inputs?.surfaces);
    const value = surfaces?.[surface];
    return request?.entity === entity && typeof value === "number" && Number.isFinite(value) ? [value] : [];
  }));
}

function aerodynamicTorqueAtLabel(series: IPlaytestObservations["physicsDebugSeries"], entity: string, label: string): Vec3 | undefined {
  const snapshot = (series ?? []).find((sample) => sample.label === label)?.snapshot;
  if (!isRecord(snapshot) || !isRecord(snapshot.artifact) || !Array.isArray(snapshot.artifact.primitives)) return undefined;
  const primitives = snapshot.artifact.primitives.filter(isRecord);
  const bodyPosition = primitives.find((primitive) => primitive.id === `sleep:${entity}`)?.position;
  if (!finiteVector(bodyPosition)) return undefined;
  const origin = bodyPosition as Vec3;
  const torque: Vec3 = [0, 0, 0];
  let samples = 0;
  for (const primitive of primitives) {
    if (primitive.category !== "aero" || primitive.entity !== entity || !finiteVector(primitive.from) || !finiteVector(primitive.to)) continue;
    const from = primitive.from as Vec3;
    const to = primitive.to as Vec3;
    const momentArm: Vec3 = [from[0] - origin[0], from[1] - origin[1], from[2] - origin[2]];
    const force: Vec3 = [to[0] - from[0], to[1] - from[1], to[2] - from[2]];
    const cross: Vec3 = [
      momentArm[1] * force[2] - momentArm[2] * force[1],
      momentArm[2] * force[0] - momentArm[0] * force[2],
      momentArm[0] * force[1] - momentArm[1] * force[0],
    ];
    torque[0] += cross[0];
    torque[1] += cross[1];
    torque[2] += cross[2];
    samples += 1;
  }
  return samples === 0 || !torque.every(Number.isFinite) ? undefined : torque;
}



function evaluateDiagnosticsPolicy(
  report: IPlaytestReport,
  policy: IPlaytestDiagnosticsPolicy,
): IPlaytestDiagnostic[] {
  const diagnostics: IPlaytestDiagnostic[] = [];
  if (policy?.runtimeReady === true && report.diagnostics.some((diagnostic) => diagnostic.code === "TN_PLAYTEST_RUNTIME_NOT_READY")) {
    diagnostics.push({
      code: "TN_PLAYTEST_RUNTIME_DIAGNOSTIC",
      message: "Runtime did not reach ready state while diagnostics policy required it.",
      severity: "error",
      suggestion: "Inspect runtime diagnostics and bundle validation output before replaying the scenario.",
    });
  }
  const capturedConsoleErrors = consoleErrors(report.observations?.console ?? []);
  if (policy.noConsoleErrors && capturedConsoleErrors.length > 0) {
    diagnostics.push({
      code: "TN_PLAYTEST_CONSOLE_ERROR",
      message: `${capturedConsoleErrors.length} browser console error(s) were captured during playtest.`,
      severity: "error",
      suggestion: "Open console.json in the playtest artifact directory and fix the first runtime error.",
    });
  }
  if (policy.noNetworkErrors && (report.observations?.network.length ?? 0) > 0) {
    diagnostics.push({
      code: "TN_PLAYTEST_NETWORK_ERROR",
      message: `${report.observations?.network.length ?? 0} failed network request(s) were captured during playtest.`,
      severity: "error",
      suggestion: "Open network.json in the playtest artifact directory and fix missing asset or bundle paths.",
    });
  }
  const runtimeErrors = runtimeDiagnostics(report.observations?.runtimeDiagnostics);
  if (policy.noRuntimeDiagnostics && runtimeErrors.length > 0) {
    diagnostics.push({
      code: "TN_PLAYTEST_RUNTIME_DIAGNOSTIC",
      message: `${runtimeErrors.length} runtime diagnostic error(s) were captured during playtest.`,
      severity: "error",
      suggestion: "Inspect runtime-trace.json and repair the authored source that owns the diagnostic path.",
    });
  }
  return diagnostics;
}

function evaluateVisibilityAssertion(
  assertion: IPlaytestVisibilityAssertion,
  entity: string,
  viewport: { height: number; width: number },
  runtimeDiagnosticsValue: unknown,
  initialRuntimeDiagnosticsValue: unknown,
): { assertion: IPlaytestAssertionResult; diagnostic?: IPlaytestDiagnostic } {
  const minProjectedPixels = assertion.minProjectedPixels;
  const maxOffscreenRatio = assertion.maxOffscreenRatio;
  const present = assertion.present;
  const diagnosticsSnapshot = runtimeDiagnosticsSnapshot(runtimeDiagnosticsValue);
  const rendered = renderedEntity(diagnosticsSnapshot, entity);
  const supportsProjectedBounds = renderedEntitiesAreReported(diagnosticsSnapshot);
  const initialSnapshot = runtimeDiagnosticsSnapshot(initialRuntimeDiagnosticsValue);
  const initialRendered = renderedEntity(initialSnapshot, entity);
  const initialObserved = initialRendered !== undefined;
  const initialBounds = isRecord(initialRendered?.projectedBounds) ? initialRendered.projectedBounds : undefined;
  const initialMin = Array.isArray(initialBounds?.min) ? initialBounds.min : undefined;
  const initialMax = Array.isArray(initialBounds?.max) ? initialBounds.max : undefined;
  const initialProjectedPixels = initialMin === undefined || initialMax === undefined
    ? undefined
    : Math.max(0, ((Number(initialMax[0]) - Number(initialMin[0])) / 2) * viewport.width) * Math.max(0, ((Number(initialMax[1]) - Number(initialMin[1])) / 2) * viewport.height);
  const initialOffscreenRatio = initialMin === undefined || initialMax === undefined
    ? undefined
    : projectedOffscreenRatio([Number(initialMin[0]), Number(initialMin[1])], [Number(initialMax[0]), Number(initialMax[1])]);
  const initialPass = present !== undefined && minProjectedPixels === undefined && maxOffscreenRatio === undefined
    ? initialObserved === present
    : initialRendered !== undefined
      && (present === undefined || present)
      && (minProjectedPixels === undefined || (initialProjectedPixels ?? 0) >= minProjectedPixels)
      && (maxOffscreenRatio === undefined || (initialOffscreenRatio ?? 1) <= maxOffscreenRatio);
  const guarded = (comparisonPass: boolean, details: Record<string, unknown>, failure: IPlaytestDiagnostic) => {
    const trivial = comparisonPass && initialPass;
    const pass = comparisonPass && (!trivial || typeof assertion.allowTrivial === "string");
    const result = {
      details: {
        ...details,
        expected: assertion,
        initialPass,
        trivial,
        ...(trivial && typeof assertion.allowTrivial === "string" ? { trivialityOptOut: true } : {}),
      },
      id: `visibility.${entity}`,
      pass,
    };
    return pass
      ? { assertion: result }
      : {
        assertion: result,
        diagnostic: trivial && typeof assertion.allowTrivial !== "string"
          ? trivialAssertionDiagnostic(result.id, undefined, true, undefined)
          : failure,
      };
  };
  if (present !== undefined && minProjectedPixels === undefined && maxOffscreenRatio === undefined) {
    const observed = rendered !== undefined;
    return guarded(observed === present, { entity, observed, present }, {
      code: "TN_PLAYTEST_VISIBILITY_FAILED",
      message: `Entity '${entity}' presence did not match the expected value.`,
      severity: "error",
      suggestion: "Check entity registration and streaming unload decisions.",
    });
  }
  if (!supportsProjectedBounds && hasNativeReadinessSamples(diagnosticsSnapshot)) {
    return guarded(false, {
      entity,
      maxOffscreenRatio,
      minProjectedPixels,
      reason: "native-projected-bounds-unavailable",
      skipped: false,
    }, {
      code: "TN_PLAYTEST_VISIBILITY_FAILED",
      message: `Entity '${entity}' projected bounds are unavailable on the native target.`,
      severity: "error",
      suggestion: "Expose rendered entity projected bounds or remove the projected-pixel assertion.",
    });
  }
  const bounds = isRecord(rendered?.projectedBounds) ? rendered.projectedBounds : undefined;
  const min = Array.isArray(bounds?.min) ? bounds.min : undefined;
  const max = Array.isArray(bounds?.max) ? bounds.max : undefined;
  const projectedPixels = min === undefined || max === undefined
    ? undefined
    : Math.max(0, ((Number(max[0]) - Number(min[0])) / 2) * viewport.width) * Math.max(0, ((Number(max[1]) - Number(min[1])) / 2) * viewport.height);
  const offscreenRatio = min === undefined || max === undefined ? undefined : projectedOffscreenRatio([Number(min[0]), Number(min[1])], [Number(max[0]), Number(max[1])]);
  const pass = rendered !== undefined
    && bounds !== undefined
    && (present === undefined || present)
    && (minProjectedPixels === undefined || (projectedPixels ?? 0) >= minProjectedPixels)
    && (maxOffscreenRatio === undefined || (offscreenRatio ?? 1) <= maxOffscreenRatio);
  return guarded(pass, { entity, maxOffscreenRatio, minProjectedPixels, offscreenRatio, present, projectedPixels }, {
    code: "TN_PLAYTEST_VISIBILITY_FAILED",
    message: `Entity '${entity}' did not satisfy projected visibility assertions.`,
    severity: "error",
    suggestion: "Check camera framing, clipping range, entity scale, and viewport-specific layout.",
  });
}

function projectedPixelsForEntity(snapshot: unknown, entity: string, viewport: { height: number; width: number }): number | undefined {
  const rendered = renderedEntity(snapshot, entity);
  const bounds = isRecord(rendered?.projectedBounds) ? rendered.projectedBounds : undefined;
  const min = Array.isArray(bounds?.min) ? bounds.min : undefined;
  const max = Array.isArray(bounds?.max) ? bounds.max : undefined;
  return min === undefined || max === undefined
    ? undefined
    : Math.max(0, ((Number(max[0]) - Number(min[0])) / 2) * viewport.width) * Math.max(0, ((Number(max[1]) - Number(min[1])) / 2) * viewport.height);
}

function countMatchingEntries(effectLog: unknown, tokens: readonly string[]): number {
  if (tokens.length === 0 || !isRecord(effectLog) || !Array.isArray(effectLog.entries)) {
    return 0;
  }
  return effectLog.entries.filter((entry) => {
    const text = JSON.stringify(entry);
    return tokens.every((token) => text.includes(token));
  }).length;
}

function evaluatePerformanceAssertion(
  assertion: IPlaytestPerformanceAssertion,
  series: readonly unknown[] | undefined,
  sourcePath: string | undefined,
): { assertions: IPlaytestAssertionResult[]; diagnostics: IPlaytestDiagnostic[] } {
  const samples = series ?? [];
  const validSamples = samples.length > 0 && samples.every(isRuntimeDiagnosticsSample);
  const observed = validSamples ? samples as IPlaytestRuntimeDiagnosticsSample[] : [];
  const frameTimes = observed.map(({ frameMs }) => frameMs);
  const drawCalls = observed.flatMap(({ drawCalls: value }) => value === undefined ? [] : [value]);
  const triangles = observed.flatMap(({ triangles: value }) => value === undefined ? [] : [value]);
  const frameMsP95 = nearestRank(frameTimes, 0.95);
  const maxObservedDrawCalls = drawCalls.length === 0 ? undefined : Math.max(...drawCalls);
  const maxObservedTriangles = triangles.length === 0 ? undefined : Math.max(...triangles);
  const results: IPlaytestAssertionResult[] = [];
  const diagnostics: IPlaytestDiagnostic[] = [];
  const path = `${sourcePath ?? "playtest"}/observations.json/performanceSeries`;
  const samplesPass = validSamples;
  results.push({
    details: { sampleCount: samples.length, valid: validSamples },
    id: "performance.samples",
    pass: samplesPass,
  });
  if (!samplesPass) {
    diagnostics.push({
      code: "TN_PLAYTEST_PERFORMANCE_SAMPLES_MISSING",
      message: samples.length === 0
        ? "Performance assertion received no render samples."
        : "Performance assertion received an invalid render sample series.",
      observedRuntimePath: path,
      severity: "error",
      sourcePath,
      suggestion: "Run the scenario against the real render loop and keep the performance bridge provider installed.",
    });
  }

  const addBound = (
    id: string,
    expected: number,
    actual: number | undefined,
    unit: string,
    pass: boolean,
  ): void => {
    results.push({ details: { actual: actual ?? null, expected, sampleCount: samples.length, unit }, id, pass });
    if (!pass) diagnostics.push({
      code: "TN_PLAYTEST_PERFORMANCE_ASSERTION_FAILED",
      message: `${id} expected at most ${expected} ${unit}, observed ${actual ?? "unavailable"}.`,
      observedRuntimePath: path,
      severity: "error",
      sourcePath,
      suggestion: "Inspect the recorded frame-cost series and reduce the authored scene cost that owns the regression.",
    });
  };

  if (assertion.maxFrameMsP95 !== undefined) {
    addBound(
      "performance.maxFrameMsP95",
      assertion.maxFrameMsP95,
      frameMsP95,
      "ms",
      samplesPass && frameMsP95 !== undefined && frameMsP95 <= assertion.maxFrameMsP95,
    );
  }
  if (assertion.maxDrawCalls !== undefined) {
    addBound(
      "performance.maxDrawCalls",
      assertion.maxDrawCalls,
      maxObservedDrawCalls,
      "draw calls",
      samplesPass && drawCalls.length === samples.length && maxObservedDrawCalls !== undefined && maxObservedDrawCalls <= assertion.maxDrawCalls,
    );
  }
  if (assertion.maxTriangles !== undefined) {
    addBound(
      "performance.maxTriangles",
      assertion.maxTriangles,
      maxObservedTriangles,
      "triangles",
      samplesPass && triangles.length === samples.length && maxObservedTriangles !== undefined && maxObservedTriangles <= assertion.maxTriangles,
    );
  }
  return { assertions: results, diagnostics };
}

function isRuntimeDiagnosticsSample(value: unknown): value is IPlaytestRuntimeDiagnosticsSample {
  if (!isRecord(value)
    || typeof value.frameMs !== "number"
    || !Number.isFinite(value.frameMs)
    || value.frameMs <= 0) {
    return false;
  }
  return (value.drawCalls === undefined || (typeof value.drawCalls === "number" && Number.isFinite(value.drawCalls) && value.drawCalls >= 0))
    && (value.triangles === undefined || (typeof value.triangles === "number" && Number.isFinite(value.triangles) && value.triangles >= 0));
}

function nearestRank(values: readonly number[], percentile: number): number | undefined {
  if (values.length === 0) return undefined;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.max(0, Math.ceil(values.length * percentile) - 1)];
}

function mergeEffectLogs(effectLog: unknown, series: IPlaytestObservations["effectLogSeries"]): { entries: unknown[] } {
  return {
    entries: [effectLog, ...(series ?? []).map((sample) => sample.snapshot)]
      .flatMap((log) => isRecord(log) && Array.isArray(log.entries) ? log.entries : []),
  };
}

function matchingOccludedRaycasts(effectLog: unknown, entity: string | undefined, target: string | undefined): number {
  if (!isRecord(effectLog) || !Array.isArray(effectLog.entries)) return 0;
  return effectLog.entries.filter((entry) => {
    if (!isRecord(entry) || (entry.service !== "render.sceneRayQuery" && entry.service !== "physics.raycast") || !isRecord(entry.payload) || !isRecord(entry.payload.result) || entry.payload.result.hit !== true) return false;
    const request = JSON.stringify(entry.payload.request ?? null);
    return (entity === undefined || request.includes(entity)) && (target === undefined || request.includes(target));
  }).length;
}

function summarizeMatchingEntries(effectLog: unknown, tokens: readonly string[]): { entryCount: number; sourcePath?: string; systemId?: string; systems: string } | undefined {
  if (tokens.length === 0 || !isRecord(effectLog) || !Array.isArray(effectLog.entries)) {
    return undefined;
  }
  const entries = effectLog.entries
    .filter((entry): entry is Record<string, unknown> => isRecord(entry))
    .filter((entry) => {
      const text = JSON.stringify(entry);
      return tokens.every((token) => text.includes(token));
    });
  if (entries.length === 0) {
    return undefined;
  }
  const systems = new Set(entries.map((entry) => typeof entry.system === "string" ? entry.system : undefined).filter((item): item is string => item !== undefined));
  const firstSystem = [...systems][0];
  return {
    entryCount: entries.length,
    ...(firstSystem === undefined ? {} : { sourcePath: sourcePathForSystem(firstSystem), systemId: firstSystem }),
    systems: systems.size === 0 ? "unknown systems" : [...systems].slice(0, 5).join(", "),
  };
}

function rotationDelta(
  effectLog: unknown,
  entityId: string,
  beforeRotation?: readonly [number, number, number, number],
  afterRotation?: readonly [number, number, number, number],
): number | undefined {
  if (isRecord(effectLog) && Array.isArray(effectLog.entries)) {
    const rotations = effectLog.entries
    .filter((entry): entry is Record<string, unknown> => isRecord(entry))
    .filter((entry) => entry.kind === "patch" && entry.command === "setComponent" && entry.component === "Transform" && entry.entity === entityId)
    .map((entry) => readRotation(entry.value))
    .filter((item): item is Vec3 => item !== undefined);
    const first = rotations[0];
    const last = rotations[rotations.length - 1];
    if (first !== undefined && last !== undefined) return vectorDistance(first, last);
  }
  return quaternionDelta(beforeRotation, afterRotation);
}

function quaternionDelta(
  before: readonly [number, number, number, number] | undefined,
  after: readonly [number, number, number, number] | undefined,
): number | undefined {
  if (before === undefined || after === undefined) return undefined;
  const beforeLength = Math.hypot(...before);
  const afterLength = Math.hypot(...after);
  if (beforeLength <= Number.EPSILON || afterLength <= Number.EPSILON) return undefined;
  const dot = Math.abs((before[0] * after[0] + before[1] * after[1] + before[2] * after[2] + before[3] * after[3]) / (beforeLength * afterLength));
  return 2 * Math.acos(Math.max(-1, Math.min(1, dot)));
}

function finalTiltDegrees(effectLog: unknown, entityId: string): number | undefined {
  if (!isRecord(effectLog) || !Array.isArray(effectLog.entries)) return undefined;
  const rotation = effectLog.entries
    .filter((entry): entry is Record<string, unknown> => isRecord(entry))
    .filter((entry) => entry.kind === "patch" && entry.command === "setComponent" && entry.component === "Transform" && entry.entity === entityId)
    .map((entry) => isRecord(entry.value) ? entry.value.rotation : undefined)
    .filter((value): value is unknown[] => Array.isArray(value) && value.length >= 4)
    .at(-1);
  return tiltDegrees(rotation);
}

function tiltDegrees(rotation: readonly unknown[] | undefined): number | undefined {
  if (rotation === undefined) return undefined;
  const quaternion = rotation.slice(0, 4).map((value) => typeof value === "number" && Number.isFinite(value) ? value : Number.NaN);
  if (!quaternion.every(Number.isFinite)) return undefined;
  const [x, y, z, w] = quaternion as [number, number, number, number];
  const length = Math.hypot(x, y, z, w);
  if (length <= Number.EPSILON) return undefined;
  const upDot = 1 - 2 * ((x / length) ** 2 + (z / length) ** 2);
  return Math.acos(Math.max(-1, Math.min(1, upDot))) * 180 / Math.PI;
}

function movementFacingEvidence(effectLog: unknown, entityId: string): { maxErrorDegrees: number; sampleCount: number } {
  if (!isRecord(effectLog) || !Array.isArray(effectLog.entries)) {
    return { maxErrorDegrees: Number.POSITIVE_INFINITY, sampleCount: 0 };
  }
  let yaw: number | undefined;
  const errors: number[] = [];
  for (const entry of effectLog.entries) {
    if (!isRecord(entry)) continue;
    if (entry.kind === "patch" && entry.command === "setComponent" && entry.component === "Transform" && entry.entity === entityId) {
      yaw = yawFromTransform(entry.value) ?? yaw;
      continue;
    }
    if (entry.kind !== "service" || entry.service !== "character.move" || yaw === undefined || !isRecord(entry.payload)) continue;
    const request = isRecord(entry.payload.request) ? entry.payload.request : undefined;
    const options = isRecord(request?.options) ? request.options : undefined;
    const direction = Array.isArray(options?.direction) ? options.direction : undefined;
    if (request?.entity !== entityId || direction === undefined || typeof direction[0] !== "number" || typeof direction[1] !== "number") continue;
    const heading = Math.atan2(direction[0], direction[1]);
    errors.push(Math.abs(wrappedAngle(heading - yaw)) * 180 / Math.PI);
  }
  return {
    maxErrorDegrees: errors.length === 0 ? Number.POSITIVE_INFINITY : Math.max(...errors),
    sampleCount: errors.length,
  };
}

function finalFacingAngleToEntity(effectLog: unknown, entityId: string, targetId: string): number | undefined {
  if (!isRecord(effectLog) || !Array.isArray(effectLog.entries)) return undefined;
  let subject: { position: Vec3; yaw: number } | undefined;
  let target: Vec3 | undefined;
  for (const entry of effectLog.entries) {
    if (!isRecord(entry)) continue;
    if (entry.kind === "service" && entry.service === "character.move" && isRecord(entry.payload)) {
      const result = isRecord(entry.payload.result) ? entry.payload.result : undefined;
      if (result?.entity === targetId) target = readVec3(result.resolved) ?? target;
      continue;
    }
    if (entry.kind !== "patch" || entry.command !== "setComponent" || entry.component !== "Transform") continue;
    if (entry.entity === entityId) {
      const position = isRecord(entry.value) ? readVec3(entry.value.position) : undefined;
      const yaw = yawFromTransform(entry.value);
      if (position !== undefined && yaw !== undefined) subject = { position, yaw };
    } else if (entry.entity === targetId && isRecord(entry.value)) {
      target = readVec3(entry.value.position) ?? target;
    }
  }
  if (subject === undefined || target === undefined) return undefined;
  const heading = Math.atan2(target[0] - subject.position[0], target[2] - subject.position[2]);
  return Math.abs(wrappedAngle(heading - subject.yaw)) * 180 / Math.PI;
}

function finalFacingAngleToPosition(effectLog: unknown, entityId: string, target: readonly [number, number, number]): number | undefined {
  if (!isRecord(effectLog) || !Array.isArray(effectLog.entries)) return undefined;
  let subject: { position: Vec3; yaw: number } | undefined;
  for (const entry of effectLog.entries) {
    if (!isRecord(entry) || entry.kind !== "patch" || entry.command !== "setComponent" || entry.component !== "Transform" || entry.entity !== entityId) continue;
    const position = isRecord(entry.value) ? readVec3(entry.value.position) : undefined;
    const yaw = yawFromTransform(entry.value);
    if (position !== undefined && yaw !== undefined) subject = { position, yaw };
  }
  if (subject === undefined) return undefined;
  const heading = Math.atan2(target[0] - subject.position[0], target[2] - subject.position[2]);
  return Math.abs(wrappedAngle(heading - subject.yaw)) * 180 / Math.PI;
}

function yawFromTransform(value: unknown): number | undefined {
  if (!isRecord(value) || !Array.isArray(value.rotation) || value.rotation.length < 4) return undefined;
  const y = value.rotation[1];
  const w = value.rotation[3];
  return typeof y === "number" && Number.isFinite(y) && typeof w === "number" && Number.isFinite(w)
    ? 2 * Math.atan2(y, w)
    : undefined;
}

function wrappedAngle(value: number): number {
  return Math.atan2(Math.sin(value), Math.cos(value));
}

function maxResolvedAxisDelta(
  effectLog: unknown,
  entityId: string,
  expectation: { axis: MovementAxis; sign?: 1 | -1 },
  baseline: Vec3 | undefined,
): number | undefined {
  if (!isRecord(effectLog) || !Array.isArray(effectLog.entries)) {
    return undefined;
  }
  const index = axisIndex(expectation.axis);
  const resolvedValues = effectLog.entries
    .filter((entry): entry is Record<string, unknown> => isRecord(entry))
    .filter((entry) => entry.kind === "service" && entry.service === "character.move")
    .map((entry) => {
      const payload = isRecord(entry.payload) ? entry.payload : undefined;
      const result = isRecord(payload?.result) ? payload.result : undefined;
      return result?.entity === entityId ? readVec3(result.resolved) : undefined;
    })
    .filter((item): item is Vec3 => item !== undefined);
  const first = baseline ?? resolvedValues[0];
  if (first === undefined || resolvedValues.length === 0) {
    return undefined;
  }
  const sign = expectation.sign ?? 1;
  return Math.max(...resolvedValues.map((value) => (value[index] - first[index]) * sign));
}

function minimumResolvedDistance(
  effectLog: unknown,
  effectLogSeries: unknown,
  entityId: string,
  target: Vec3,
  baseline: Vec3 | undefined,
  atStep: string | undefined,
): number | undefined {
  const logs = [
    ...(atStep === undefined ? [effectLog] : []),
    ...(Array.isArray(effectLogSeries)
      ? effectLogSeries
        .filter((item) => atStep === undefined || (isRecord(item) && item.label === atStep))
        .map((item) => isRecord(item) ? item.snapshot : undefined)
      : []),
  ];
  const positions = logs
    .flatMap((log) => isRecord(log) && Array.isArray(log.entries) ? log.entries : [])
    .filter((entry): entry is Record<string, unknown> => isRecord(entry))
    .filter((entry) => entry.kind === "service" && entry.service === "character.move")
    .map((entry) => {
      const payload = isRecord(entry.payload) ? entry.payload : undefined;
      const result = isRecord(payload?.result) ? payload.result : undefined;
      return result?.entity === entityId ? readVec3(result.resolved) : undefined;
    })
    .filter((item): item is Vec3 => item !== undefined);
  if (baseline !== undefined && atStep === undefined) positions.unshift(baseline);
  return positions.length === 0
    ? undefined
    : Math.min(...positions.map((position) => vectorDistance(position, target)));
}

function renderedEntity(runtimeDiagnosticsValue: unknown, entity: string): Record<string, unknown> | undefined {
  if (!renderedEntitiesAreReported(runtimeDiagnosticsValue)) {
    return undefined;
  }
  return runtimeDiagnosticsValue.scene.renderedEntities.find((item): item is Record<string, unknown> => isRecord(item) && item.id === entity);
}

function renderedEntitiesAreReported(runtimeDiagnosticsValue: unknown): runtimeDiagnosticsValue is { scene: { renderedEntities: unknown[] } } {
  return isRecord(runtimeDiagnosticsValue) && isRecord(runtimeDiagnosticsValue.scene) && Array.isArray(runtimeDiagnosticsValue.scene.renderedEntities);
}

function hasNativeReadinessSamples(runtimeDiagnosticsValue: unknown): boolean {
  return isRecord(runtimeDiagnosticsValue) && Array.isArray(runtimeDiagnosticsValue.readiness);
}

function projectedOffscreenRatio(min: [number, number], max: [number, number]): number {
  const width = Math.max(0, max[0] - min[0]);
  const height = Math.max(0, max[1] - min[1]);
  const area = width * height;
  if (area === 0) {
    return 1;
  }
  const visibleWidth = Math.max(0, Math.min(max[0], 1) - Math.max(min[0], -1));
  const visibleHeight = Math.max(0, Math.min(max[1], 1) - Math.max(min[1], -1));
  return 1 - Math.max(0, visibleWidth * visibleHeight) / area;
}


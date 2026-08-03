import { readFile } from 'fs/promises';
import { resolve } from 'path';

// src/capabilities.ts
var PLAYTEST_CAPABILITY_REGISTRY = [
  capability("browser.canvas", "Samples canvas pixels and health."),
  capability("browser.console", "Captures browser console and page errors."),
  capability("browser.dom", "Reads bounded DOM observations."),
  capability("browser.input", "Delivers keyboard and pointer input."),
  capability("browser.network", "Captures failed browser requests."),
  capability("browser.screenshot", "Captures viewport screenshots."),
  capability("browser.trace", "Captures a bounded Playwright trace."),
  capability("camera.observe", "Samples the active camera transform and projection."),
  capability("entity.bounds", "Projects registered entity bounds into the viewport."),
  capability("entity.observe", "Samples registered entity transforms and visibility."),
  capability("entity.setup", "Applies bounded transforms to registered entities."),
  capability("runtime.animation", "Samples application-owned animation state."),
  capability("runtime.components", "Samples registered JSON-safe component state."),
  capability("runtime.contacts", "Samples bounded collision and trigger contacts."),
  capability("runtime.diagnostics", "Samples application-owned runtime diagnostics."),
  capability("runtime.events", "Drains bounded application event observations."),
  capability("runtime.fixedStep", "Advances an application-owned deterministic tick."),
  capability("runtime.physics", "Samples bounded application-owned physics observations."),
  capability("runtime.resources", "Reads and writes registered JSON-safe application state."),
  capability("runtime.state", "Samples application-owned state-machine state."),
  capability("runtime.tags", "Samples bounded application-owned entity tags."),
  capability("runtime.ui", "Samples registered JSON-safe UI and HUD state.")
];
var KNOWN_CAPABILITIES = new Set(PLAYTEST_CAPABILITY_REGISTRY.map(({ name }) => name));
function unknownPlaytestCapabilities(capabilities) {
  return capabilities.filter((name) => !KNOWN_CAPABILITIES.has(name));
}
function missingPlaytestCapabilities(required, available) {
  const availableSet = new Set(available);
  return [...new Set(required)].filter((name) => !availableSet.has(name)).sort();
}
function capability(name, description) {
  return { description, name, protocolVersion: 1 };
}

// src/assertions.ts
var PLAYTEST_ASSERTION_REGISTRY = [
  {
    description: "Checks every consecutive platform against a measured static movement-envelope fit; it does not simulate traversal, walls, ceilings, run-up, or air control.",
    example: { reachability: { artifact: "artifacts/character-envelope/player.json", entities: ["platform.a", "platform.b"] } },
    fields: [
      { description: "Project-relative character envelope artifact emitted by tn character envelope.", name: "artifact", required: true, type: "string" },
      { description: "Ordered platform entity ids forming the critical path.", name: "entities", required: true, type: "string[] (minimum 2)" }
    ],
    cardinality: "object",
    kind: "reachability",
    requiredCapabilities: ["entity.observe"],
    resultIdPrefix: "reachability.",
    triviality: "not-applicable"
  },
  {
    description: "Proves aerodynamic force telemetry and signed control-surface delivery for a flight entity.",
    example: { aerodynamics: [{ controls: [{ sign: "negative", surface: "elevator" }], entity: "aircraft", minForceSamples: 4 }] },
    fields: [
      { description: "Aerodynamic entity id.", name: "entity", required: true, type: "string" },
      { description: "Minimum physics-debug samples containing finite aerodynamic force vectors.", name: "minForceSamples", type: "positive integer" },
      { description: "Signed surface values required in physics.aerodynamics.setInputs calls.", name: "controls", type: "Array<{ surface: string, sign: 'negative' | 'positive', minAbs?: number }>" },
      { description: "Signed net aerodynamic torque, optionally relative to another labeled step.", name: "torques", type: "Array<{ label: string, relativeToLabel?: string, axis: 'x' | 'y' | 'z', sign: 'negative' | 'positive', minAbs?: number }>" }
    ],
    cardinality: "array",
    kind: "aerodynamics",
    requiredCapabilities: ["runtime.fixedStep", "runtime.physics"],
    resultIdPrefix: "aerodynamics.",
    triviality: "not-applicable"
  },
  {
    description: "Proves screenshot change, populated regions, and sustained projected entity visibility.",
    example: { visual: [{ frameDiff: { baselineImage: "artifacts/baseline.png", minChangedPixelRatio: 0.01 }, entityVisible: { entity: "board.e4", minProjectedPixels: 20, throughoutFrames: true } }] },
    fields: [
      { description: "Before/after or baseline-image changed-pixel ratio bounds.", name: "frameDiff", type: "{ baselineImage?: project-relative PNG, minChangedPixelRatio?: number, maxChangedPixelRatio?: number }" },
      { description: "Pixel region that must remain populated and may require dark-pixel occupancy.", name: "region", type: "{ x: number, y: number, width: number, height: number, minNonblankPixelRatio?: number, minDarkPixelRatio?: number, maxLuminance?: number }" },
      { description: "Entity projected-pixel floor, optionally across all captured samples.", name: "entityVisible", type: "{ entity: string, minProjectedPixels: number, throughoutFrames?: boolean }" }
    ],
    cardinality: "array",
    kind: "visual",
    requiredCapabilities: ["browser.screenshot"],
    resultIdPrefix: "visual.",
    triviality: "not-applicable"
  },
  {
    description: "Proves the subject moved, reached a minimum velocity, or changed rotation during held input.",
    example: { movement: { entity: "player", minDistance: 0.5, minVelocity: 0.01, rotationChanged: true } },
    fields: [
      { description: "Entity id to measure. Defaults to scenario subject.", name: "entity", type: "string" },
      { description: "Require distance to a fixed world position to decrease by at least min.", name: "closesDistanceToPosition", type: "{ position: [number, number, number], min: number }" },
      { description: "Maximum yaw error from resolved movement direction.", name: "facesMovementWithinDegrees", type: "number" },
      { description: "Expected movement axis: x, y, or z.", name: "axis", type: "string" },
      { description: "Minimum signed movement on a specific axis, for example { axis: '+y', min: 0.2 }.", name: "minAxisDelta", type: "{ axis: string, min: number }" },
      { description: "Minimum signed resolved character.move displacement on a specific axis, for example { axis: '+y', min: 0.2 }.", name: "minResolvedAxisDelta", type: "{ axis: string, min: number }" },
      { description: "Maximum final pitch/roll tilt from world up, in degrees; yaw is ignored.", name: "maxTiltDegrees", type: "number in [0, 180]" },
      { description: "Minimum distance moved over the scenario.", name: "minDistance", type: "number" },
      { description: "Maximum distance allowed; use for blocked-movement proof.", name: "maxDistance", type: "number" },
      { description: "Minimum distance per frame.", name: "minVelocity", type: "number" },
      { description: "Minimum accumulated path length; use with minDistance to catch movement that cancels out.", name: "pathLength", type: "number" },
      { description: "Require the final facing to differ from another entity by at least minDegrees.", name: "notFacing", type: "{ entity: string, minDegrees: number }" },
      { description: "Require the final facing to differ from a fixed world position by at least minDegrees.", name: "notFacingPosition", type: "{ position: [number, number, number], minDegrees: number }" },
      { description: "Require a resolved character position to come within maxDistance of a fixed world position, optionally within one labeled step.", name: "reachesPositionWithin", type: "{ position: [number, number, number], maxDistance: number, atStep?: string }" },
      { description: "Require any observed rotation delta.", name: "rotationChanged", type: "boolean" }
    ],
    cardinality: "object",
    kind: "movement",
    requiredCapabilities: ["entity.observe"],
    resultIdPrefix: "movement.",
    triviality: "not-applicable"
  },
  {
    description: "Proves a camera follows an entity or keeps a target in view.",
    example: { camera: { entity: "camera.main", follows: "player", within: 10, targetInViewport: true } },
    fields: [
      { description: "Camera entity id.", name: "entity", type: "string" },
      { description: "Entity the camera should follow.", name: "follows", type: "string" },
      { description: "Maximum allowed separation.", name: "within", type: "number" },
      { description: "Require the target to be visible in the viewport.", name: "targetInViewport", type: "boolean" }
    ],
    cardinality: "object",
    kind: "camera",
    requiredCapabilities: ["camera.observe", "entity.observe"],
    resultIdPrefix: "camera",
    triviality: "not-applicable"
  },
  {
    description: "Proves a live entity component value after the scenario or at named steps.",
    example: { components: [{ component: "Camera", entity: "camera.main", path: "fovY", equals: 22, changed: true }] },
    fields: [
      { description: "Entity id carrying the component.", name: "entity", required: true, type: "string" },
      { description: "Component name as emitted in the runtime world.", name: "component", required: true, type: "string" },
      { description: "Optional dot path inside the component snapshot.", name: "path", type: "string" },
      { description: "Exact expected value.", name: "equals", type: "json" },
      { description: "Minimum numeric value.", name: "gte", type: "number" },
      { description: "Require before and after values to differ or remain equal.", name: "changed", type: "boolean" },
      { description: "Expected values at named scenario-step samples.", name: "atSteps", type: "Array<{ label: string, equals: json }>" },
      { description: "Visible opt-out for a held invariant whose initial value intentionally satisfies the assertion.", name: "allowTrivial", type: "boolean" }
    ],
    cardinality: "array",
    kind: "components",
    requiredCapabilities: ["runtime.components"],
    resultIdPrefix: "component.",
    triviality: "reject-initial-value"
  },
  {
    description: "Proves resource state after the scenario through equals, gte, textIncludes, or changed checks.",
    example: { resources: [{ id: "GameState", path: "score", gte: 1, changed: true }] },
    fields: [
      { description: "Resource id.", name: "id", required: true, type: "string" },
      { description: "Optional dot path inside the resource snapshot.", name: "path", type: "string" },
      { description: "Exact expected value.", name: "equals", type: "json" },
      { description: "Minimum numeric value.", name: "gte", type: "number" },
      { description: "Substring expected in the observed value.", name: "textIncludes", type: "string" },
      { description: "Require before and after values to differ or remain equal.", name: "changed", type: "boolean" },
      { description: "Require the value assertion after every labeled scenario step.", name: "throughoutSteps", type: "boolean" },
      { description: "Expected values at named scenario-step samples.", name: "atSteps", type: "Array<{ label: string, equals?: json, textIncludes?: string }>" },
      { description: "Visible opt-out for a held invariant whose initial value intentionally satisfies the assertion.", name: "allowTrivial", type: "boolean" }
    ],
    cardinality: "array",
    kind: "resources",
    requiredCapabilities: ["runtime.resources"],
    resultIdPrefix: "resource.",
    triviality: "reject-initial-value"
  },
  {
    description: "Proves the final count of entities carrying a bounded runtime tag.",
    example: { tags: [{ tag: "coin", count: 10 }] },
    fields: [
      { description: "Entity tag to count.", name: "tag", required: true, type: "string" },
      { description: "Exact expected entity count.", name: "count", type: "non-negative integer" },
      { description: "Minimum expected entity count.", name: "gte", type: "non-negative integer" }
    ],
    cardinality: "array",
    kind: "tags",
    requiredCapabilities: ["runtime.tags"],
    resultIdPrefix: "tags.",
    triviality: "not-applicable"
  },
  {
    description: "Proves an entity's final runtime-owned state-machine state.",
    example: { states: [{ entity: "guard", equals: "chase" }] },
    fields: [
      { description: "Entity carrying the StateMachine component.", name: "entity", required: true, type: "string" },
      { description: "Expected current state name.", name: "equals", required: true, type: "string" }
    ],
    cardinality: "array",
    kind: "states",
    requiredCapabilities: ["runtime.state"],
    resultIdPrefix: "states.",
    triviality: "not-applicable"
  },
  {
    description: "Proves retained UI/HUD text or values after the scenario.",
    example: { hud: [{ id: "score-label", textIncludes: "Score" }] },
    fields: [
      { description: "UI node id.", name: "id", required: true, type: "string" },
      { description: "Optional dot path inside the UI snapshot.", name: "path", type: "string" },
      { description: "Exact expected value.", name: "equals", type: "json" },
      { description: "Minimum numeric value.", name: "gte", type: "number" },
      { description: "Substring expected in the observed value.", name: "textIncludes", type: "string" },
      { description: "Require before and after values to differ or remain equal.", name: "changed", type: "boolean" },
      { description: "Visible opt-out for a held invariant whose initial value intentionally satisfies the assertion.", name: "allowTrivial", type: "boolean" }
    ],
    cardinality: "array",
    kind: "hud",
    requiredCapabilities: ["runtime.ui"],
    resultIdPrefix: "hud.",
    triviality: "reject-initial-value"
  },
  {
    description: "Proves DOM state inside a same-origin webview overlay iframe.",
    example: { overlayNodes: [{ attribute: "data-aiming", equals: "true", overlayId: "game-ui", selector: "[data-testid=fps-crosshair]", visible: false }] },
    fields: [
      { description: "Declared overlay id.", name: "overlayId", required: true, type: "string" },
      { description: "CSS selector inside the overlay document.", name: "selector", required: true, type: "string" },
      { description: "Optional attribute to read instead of text content.", name: "attribute", type: "string" },
      { description: "Exact expected attribute or text value.", name: "equals", type: "json" },
      { description: "Substring expected in text content.", name: "textIncludes", type: "string" },
      { description: "Expected computed visibility.", name: "visible", type: "boolean" }
    ],
    cardinality: "array",
    kind: "overlayNodes",
    requiredCapabilities: ["browser.dom"],
    resultIdPrefix: "overlayNode.",
    triviality: "not-applicable"
  },
  {
    description: "Proves console, network, runtime, and readiness diagnostics stayed clean.",
    example: { diagnostics: { noConsoleErrors: true, noNetworkErrors: true, noRuntimeDiagnostics: true, runtimeReady: true } },
    fields: [
      { description: "Fail on captured console errors.", name: "noConsoleErrors", type: "boolean" },
      { description: "Fail on captured network errors.", name: "noNetworkErrors", type: "boolean" },
      { description: "Fail on runtime diagnostics.", name: "noRuntimeDiagnostics", type: "boolean" },
      { description: "Required bounded justification when noRuntimeDiagnostics is false.", name: "runtimeDiagnosticsOptOutReason", type: "non-empty string" },
      { description: "Require runtime readiness.", name: "runtimeReady", type: "boolean" }
    ],
    cardinality: "object",
    kind: "diagnostics",
    requiredCapabilities: ["browser.console", "browser.network", "runtime.diagnostics"],
    resultIdPrefix: "diagnostics",
    triviality: "not-applicable"
  },
  {
    description: "Proves projected entity visibility in the viewport.",
    example: { visibility: [{ entity: "player", minProjectedPixels: 1200, maxOffscreenRatio: 0.05 }] },
    fields: [
      { description: "Entity id. Defaults to scenario subject.", name: "entity", type: "string" },
      { description: "Minimum projected pixel area.", name: "minProjectedPixels", type: "number" },
      { description: "Maximum allowed offscreen ratio.", name: "maxOffscreenRatio", type: "number" }
    ],
    cardinality: "array",
    kind: "visibility",
    requiredCapabilities: ["entity.bounds"],
    resultIdPrefix: "visibility.",
    triviality: "not-applicable"
  },
  {
    description: "Proves contact or trigger evidence appeared in the effect log.",
    example: { contacts: [{ entity: "player", with: "pickup", kind: "trigger", minCount: 1 }] },
    fields: [
      { description: "Retained step label to inspect instead of the full observation history.", name: "atStep", type: "string" },
      { description: "Entity id. Defaults to scenario subject.", name: "entity", type: "string" },
      { description: "Other entity or tag token expected in the contact evidence.", name: "with", type: "string" },
      { description: "Contact kind token, such as contact or trigger.", name: "kind", type: "string" },
      { description: "Minimum number of matching observations.", name: "minCount", type: "number" },
      { description: "Maximum number of matching observations; use zero to prove separation.", name: "maxCount", type: "non-negative integer" },
      { description: "Targets on which the contact assertion is required.", name: "requiredOn", type: "Array<'web' | 'desktop' | 'bevy'>" }
    ],
    cardinality: "array",
    kind: "contacts",
    requiredCapabilities: ["runtime.contacts"],
    resultIdPrefix: "contact.",
    triviality: "not-applicable"
  },
  {
    description: "Proves matching physics bodies are asleep in a retained physics-debug sample.",
    example: { settled: [{ atStep: "fall-and-settle", entity: "enemy.default/0/", minBodies: 15 }] },
    fields: [
      { description: "Exact entity id or stable entity-id prefix.", name: "entity", required: true, type: "string" },
      { description: "Optional labeled step whose physics-debug sample must be used.", name: "atStep", type: "string" },
      { description: "Minimum number of matching bodies required.", name: "minBodies", type: "positive integer" },
      { description: "Optional earlier labeled step whose matching body positions are compared.", name: "compareToStep", type: "string" },
      { description: "Minimum mean body-position distance from compareToStep, in metres.", name: "minMeanPoseDistance", type: "positive number" },
      { description: "Targets on which the settled assertion is required.", name: "requiredOn", type: "Array<'web' | 'desktop' | 'bevy'>" }
    ],
    cardinality: "array",
    kind: "settled",
    triviality: "not-applicable",
    requiredCapabilities: ["runtime.physics"],
    resultIdPrefix: "settled."
  },
  {
    description: "Proves rendered scene geometry occludes the segment between an origin entity and target.",
    example: { occluded: [{ entity: "listener", target: "emitter" }] },
    fields: [
      { description: "Optional origin/listener entity token expected in the raycast request.", name: "entity", type: "string" },
      { description: "Optional target/emitter entity token expected in the raycast request.", name: "target", type: "string" }
    ],
    cardinality: "array",
    kind: "occluded",
    requiredCapabilities: ["runtime.physics"],
    resultIdPrefix: "occluded.",
    triviality: "not-applicable"
  },
  {
    description: "Proves animation evidence appeared in the effect log.",
    example: { animation: [{ entity: "player", clip: "run", entered: true, advancedFrames: 5 }] },
    fields: [
      { description: "Entity id. Defaults to scenario subject.", name: "entity", type: "string" },
      { description: "Animation clip id or name.", name: "clip", type: "string" },
      { description: "Require entering the animation state.", name: "entered", type: "boolean" },
      { description: "Require animation advancement evidence.", name: "advancedFrames", type: "number" }
    ],
    cardinality: "array",
    kind: "animation",
    requiredCapabilities: ["runtime.animation"],
    resultIdPrefix: "animation.",
    triviality: "not-applicable"
  }
];
var PLAYTEST_SETUP_REGISTRY = [
  {
    description: "Applies bounded transforms to registered entities before input.",
    kind: "entities",
    requiredCapabilities: ["entity.setup"]
  },
  {
    description: "Writes bounded JSON-safe application state before input.",
    kind: "resources",
    requiredCapabilities: ["runtime.resources"]
  }
];
function requiredPlaytestCapabilities(scenario) {
  const required = /* @__PURE__ */ new Set();
  if (scenario.steps.some((step) => step.kind !== "wait" && (step.press !== void 0 || step.pointerPosition !== void 0))) {
    required.add("browser.input");
  }
  if (scenario.artifacts?.screenshots !== false) {
    required.add("browser.screenshot");
  }
  for (const entry of PLAYTEST_ASSERTION_REGISTRY) {
    if (scenario.assert?.[entry.kind] !== void 0) {
      entry.requiredCapabilities.forEach((capability2) => required.add(capability2));
    }
  }
  for (const entry of PLAYTEST_SETUP_REGISTRY) {
    if (scenario.setup?.[entry.kind] !== void 0) {
      entry.requiredCapabilities.forEach((capability2) => required.add(capability2));
    }
  }
  return [...required].sort();
}
function evaluateRichPlaytestAssertions(input) {
  const assertions = [];
  const diagnostics = [];
  const scenarioAssertions = input.scenario.assert ?? {};
  if (scenarioAssertions.reachability !== void 0) {
    const { entities, envelope } = scenarioAssertions.reachability;
    for (let index = 0; index < entities.length - 1; index += 1) {
      const fromId = entities[index];
      const toId = entities[index + 1];
      const from = input.report.observations?.entityTransforms?.[fromId];
      const to = input.report.observations?.entityTransforms?.[toId];
      const rise = from?.position === void 0 || to?.position === void 0 ? void 0 : platformTop(to) - platformTop(from);
      const horizontalDelta = from?.position === void 0 || to?.position === void 0 ? void 0 : [to.position[0] - from.position[0], to.position[2] - from.position[2]];
      const centerGap = horizontalDelta === void 0 ? void 0 : Math.hypot(...horizontalDelta);
      const direction = horizontalDelta === void 0 || centerGap === 0 ? void 0 : [horizontalDelta[0] / centerGap, horizontalDelta[1] / centerGap];
      const edgeGap = centerGap === void 0 || direction === void 0 ? centerGap : Math.max(0, centerGap - horizontalRadius(from, direction) - horizontalRadius(to, direction));
      const horizontalLimit = envelope === void 0 || rise === void 0 ? void 0 : movementEnvelopeHorizontalLimit(envelope, rise);
      const pass = horizontalLimit !== void 0 && edgeGap !== void 0 && edgeGap <= horizontalLimit;
      assertions.push({
        details: { constraint: "static-movement-envelope-fit", edgeGap: edgeGap ?? null, envelope: envelope ?? null, from: fromId, horizontalLimit: horizontalLimit ?? null, rise: rise ?? null, to: toId },
        id: `reachability.${index}.${fromId}.${toId}`,
        pass
      });
      if (!pass) diagnostics.push({
        code: "TN_PLAYTEST_REACHABILITY_ASSERTION_FAILED",
        message: `Static platform fit '${fromId}' to '${toId}' is outside the measured character envelope.`,
        path: `/assert/reachability/entities/${index + 1}`,
        severity: "error",
        ...input.scenario.sourcePath === void 0 ? {} : { sourcePath: input.scenario.sourcePath },
        suggestion: "Reduce the platform rise or edge-to-edge gap, regenerate the envelope after changing movement, then use a traversal playtest to prove walls, ceilings, run-up, and air control."
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
    const value = assertion.attribute === void 0 ? observed.text : observed.attribute;
    const checks = [
      ...Object.hasOwn(assertion, "equals") ? [jsonEqual(value, assertion.equals)] : [],
      ...assertion.textIncludes === void 0 ? [] : [String(value ?? "").includes(assertion.textIncludes)],
      ...assertion.visible === void 0 ? [] : [observed.visible === assertion.visible]
    ];
    const pass = checks.length > 0 && checks.every(Boolean);
    assertions.push({ details: { expected: assertion, observed }, id: `overlayNode.${id}`, pass });
    if (!pass) diagnostics.push({
      code: "TN_PLAYTEST_OVERLAY_NODE_ASSERTION_FAILED",
      message: `Overlay '${assertion.overlayId}' node '${assertion.selector}' did not satisfy the DOM assertion.`,
      severity: "error",
      suggestion: "Inspect observations.json/overlayNodes and verify the overlay subscription, selector, attribute, and computed style."
    });
  }
  const hasVisualSamples = input.report.observations?.visual !== void 0;
  if ((scenarioAssertions.visual?.length ?? 0) > 0 && !hasVisualSamples) {
    for (const [index] of scenarioAssertions.visual.entries()) {
      assertions.push({ id: `visual.${index}`, pass: false, details: { reason: "target-unsupported", target: input.scenario.target } });
      diagnostics.push(assertionNotEvaluatedDiagnostic(`visual.${index}`, `target '${input.scenario.target}' does not expose visual assertion samples`));
    }
  }
  for (const [index, visual] of (hasVisualSamples ? scenarioAssertions.visual ?? [] : []).entries()) {
    if (visual.frameDiff !== void 0) {
      const ratio = input.report.observations?.visual?.changedPixelRatio;
      const pass = ratio !== void 0 && (visual.frameDiff.minChangedPixelRatio === void 0 || ratio >= visual.frameDiff.minChangedPixelRatio) && (visual.frameDiff.maxChangedPixelRatio === void 0 || ratio <= visual.frameDiff.maxChangedPixelRatio);
      assertions.push({ id: `visual.${index}.frameDiff`, pass, details: { after: pass, changedPixelRatio: ratio, comparisonSource: input.report.observations?.visual?.comparisonSource, expected: { equals: true }, ...visual.frameDiff } });
      if (!pass) diagnostics.push({ code: "TN_PLAYTEST_FRAME_DIFF_FAILED", message: `Screenshot changed-pixel ratio ${ratio ?? "unavailable"} was outside the asserted range.`, severity: "error", suggestion: "Check whether the expected visual change rendered and whether the thresholds match the scenario." });
    }
    if (visual.region !== void 0) {
      const observed = input.report.observations?.visual?.nonblankRegions?.find((region) => region.x === visual.region?.x && region.y === visual.region.y && region.width === visual.region.width && region.height === visual.region.height);
      const minimum = visual.region.minNonblankPixelRatio ?? 2e-3;
      const pass = observed !== void 0 && observed.nonblankPixelRatio >= minimum;
      assertions.push({ id: `visual.${index}.region`, pass, details: { after: pass, expected: { equals: true }, minimum, observed: observed?.nonblankPixelRatio } });
      if (!pass) diagnostics.push({ code: "TN_PLAYTEST_REGION_BLANK", message: `Screenshot region at (${visual.region.x}, ${visual.region.y}) did not meet nonblank ratio ${minimum}.`, severity: "error", suggestion: "Check camera framing and whether expected geometry renders in the asserted region." });
      if (visual.region.minDarkPixelRatio !== void 0) {
        const darkPass = observed?.darkPixelRatio !== void 0 && observed.darkPixelRatio >= visual.region.minDarkPixelRatio;
        assertions.push({
          id: `visual.${index}.region.darkPixels`,
          pass: darkPass,
          details: {
            maximumLuminance: visual.region.maxLuminance ?? 0.25,
            minimumDarkPixelRatio: visual.region.minDarkPixelRatio,
            observedDarkPixelRatio: observed?.darkPixelRatio
          }
        });
        if (!darkPass) diagnostics.push({
          code: "TN_PLAYTEST_REGION_DARK_PIXEL_RATIO_FAILED",
          message: `Screenshot region at (${visual.region.x}, ${visual.region.y}) contained ${observed?.darkPixelRatio ?? "unavailable"} dark pixels, below required ratio ${visual.region.minDarkPixelRatio}.`,
          severity: "error",
          suggestion: "Check whether the expected foreground silhouette occupies the asserted raster region."
        });
      }
    }
    if (visual.entityVisible !== void 0) {
      const samples = input.report.observations?.visual?.runtimeDiagnosticsSeries ?? [input.report.observations?.runtimeDiagnostics];
      const selected = visual.entityVisible.throughoutFrames === true ? samples : samples.slice(-1);
      const projected = selected.map((sample) => projectedPixelsForEntity(runtimeDiagnosticsSnapshot(sample), visual.entityVisible.entity, input.scenario.viewport));
      const pass = projected.length > 0 && projected.every((pixels) => pixels !== void 0 && pixels >= visual.entityVisible.minProjectedPixels);
      assertions.push({ id: `visual.${index}.entityVisible`, pass, details: { entity: visual.entityVisible.entity, projectedPixels: projected } });
      if (!pass) diagnostics.push({ code: "TN_PLAYTEST_ENTITY_VISIBILITY_DROPPED", message: `Entity '${visual.entityVisible.entity}' dropped below ${visual.entityVisible.minProjectedPixels} projected pixels.`, severity: "error", suggestion: "Check per-frame visibility, camera clipping, scale, and renderer state." });
    }
  }
  for (const assertion of scenarioAssertions.resources ?? []) {
    if (hasFinalPathExpectation(assertion)) {
      const result = evaluatePathAssertion("resource", assertion, input.report.observations?.resources[assertion.id], {
        effectLog: input.report.effectLog ?? input.report.observations?.effectLog,
        movedDistance: input.report.distance,
        scenarioSourcePath: input.scenario.sourcePath
      });
      assertions.push(result.assertion);
      if (result.diagnostic !== void 0) {
        diagnostics.push({ ...result.diagnostic, code: result.diagnostic.code || "TN_PLAYTEST_RESOURCE_ASSERTION_FAILED" });
      }
    }
    if (assertion.throughoutSteps === true) {
      const samples = (input.report.observations?.resourceSeries ?? []).map((sample) => ({
        label: sample.label,
        value: readPath(sample.snapshots[assertion.id], assertion.path)
      }));
      const pass = samples.length === input.scenario.steps.length && samples.every((sample) => pathValuePass(assertion, sample.value));
      assertions.push({ details: { samples }, id: `resource.${assertion.id}.${assertion.path ?? "value"}.throughoutSteps`, pass });
      if (!pass) diagnostics.push({
        code: "TN_PLAYTEST_RESOURCE_TRANSITION_ASSERTION_FAILED",
        message: `Resource '${assertion.id}'${assertion.path === void 0 ? "" : ` path '${assertion.path}'`} did not satisfy the assertion after every scenario step.`,
        observedRuntimePath: "observations.json/resourceSeries",
        severity: "error",
        suggestion: "Inspect the labeled resource samples and fix the transient gameplay-state transition."
      });
    }
    if ((assertion.atSteps?.length ?? 0) > 0) {
      const samples = assertion.atSteps.map((expected) => {
        const sample = (input.report.observations?.resourceSeries ?? []).find((candidate) => candidate.label === expected.label);
        const value = readPath(sample?.snapshots[assertion.id], assertion.path);
        const pass2 = sample !== void 0 && (!Object.hasOwn(expected, "equals") || jsonEqual(value, expected.equals)) && (expected.textIncludes === void 0 || String(textValue(value)).includes(expected.textIncludes));
        return { expected, pass: pass2, value };
      });
      const pass = samples.every((sample) => sample.pass);
      assertions.push({ details: { samples }, id: `resource.${assertion.id}.${assertion.path ?? "value"}.atSteps`, pass });
      if (!pass) diagnostics.push({
        code: "TN_PLAYTEST_RESOURCE_TRANSITION_ASSERTION_FAILED",
        message: `Resource '${assertion.id}'${assertion.path === void 0 ? "" : ` path '${assertion.path}'`} did not match the expected labeled-step transition.`,
        observedRuntimePath: "observations.json/resourceSeries",
        severity: "error",
        suggestion: "Inspect the failed and restored labeled samples and fix the retry transition."
      });
    }
  }
  for (const assertion of scenarioAssertions.components ?? []) {
    const observed = input.report.observations?.components?.[assertion.entity]?.[assertion.component];
    const before = readPath(observed?.before, assertion.path);
    const after = readPath(observed?.after, assertion.path);
    if (hasFinalComponentExpectation(assertion)) {
      const valueChecks = [
        ...Object.hasOwn(assertion, "equals") ? [jsonEqual(after, assertion.equals)] : [],
        ...assertion.gte === void 0 ? [] : [typeof after === "number" && after >= assertion.gte]
      ];
      const checks = [
        ...valueChecks,
        ...assertion.changed === void 0 ? [] : [assertion.changed ? !jsonEqual(before, after) : jsonEqual(before, after)]
      ];
      const trivial = rejectsTrivialAssertion("components") && valueChecks.length > 0 && before !== void 0 && componentValueChecks(assertion, before).every(Boolean);
      const pass = checks.length > 0 && checks.every(Boolean) && (!trivial || assertion.allowTrivial === true);
      assertions.push({
        details: {
          after,
          before,
          component: assertion.component,
          entity: assertion.entity,
          expected: assertion,
          trivial,
          ...trivial && assertion.allowTrivial === true ? { trivialityOptOut: true } : {}
        },
        id: `component.${assertion.entity}.${assertion.component}.${assertion.path ?? "value"}`,
        pass
      });
      if (!pass) diagnostics.push(trivial && assertion.allowTrivial !== true ? trivialAssertionDiagnostic(`component.${assertion.entity}.${assertion.component}.${assertion.path ?? "value"}`, assertion.path, before, input.scenario.sourcePath) : componentAssertionDiagnostic(assertion, before, after));
    }
    if ((assertion.atSteps?.length ?? 0) > 0) {
      const samples = assertion.atSteps.map((expected) => {
        const sample = (input.report.observations?.componentSeries ?? []).find((candidate) => candidate.label === expected.label);
        const value = readPath(sample?.snapshots[assertion.entity]?.[assertion.component], assertion.path);
        return { expected, pass: sample !== void 0 && Object.hasOwn(expected, "equals") && jsonEqual(value, expected.equals), value };
      });
      const pass = samples.every((sample) => sample.pass);
      assertions.push({ details: { samples }, id: `component.${assertion.entity}.${assertion.component}.${assertion.path ?? "value"}.atSteps`, pass });
      if (!pass) diagnostics.push({
        code: "TN_PLAYTEST_COMPONENT_TRANSITION_ASSERTION_FAILED",
        message: `Component '${assertion.component}' on entity '${assertion.entity}'${assertion.path === void 0 ? "" : ` path '${assertion.path}'`} did not match the expected labeled-step transition.`,
        observedRuntimePath: "observations.json/componentSeries",
        severity: "error",
        suggestion: "Inspect the labeled component samples and fix the runtime component transition."
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
        control.surface
      ),
      ...controlsSupported ? {} : { skipped: true, reason: "native-service-log-unavailable" }
    }));
    const torques = (assertion.torques ?? []).map((torque) => {
      const value = aerodynamicTorqueAtLabel(input.report.observations?.physicsDebugSeries, assertion.entity, torque.label)?.[axisIndex(torque.axis)];
      const relative = torque.relativeToLabel === void 0 ? void 0 : aerodynamicTorqueAtLabel(input.report.observations?.physicsDebugSeries, assertion.entity, torque.relativeToLabel)?.[axisIndex(torque.axis)];
      return { ...torque, observed: value === void 0 || torque.relativeToLabel !== void 0 && relative === void 0 ? void 0 : value - (relative ?? 0) };
    });
    const forcePass = assertion.minForceSamples === void 0 || forceSamples >= assertion.minForceSamples;
    const controlsPass = controlsSupported ? controls.every((control) => control.observed.some((value) => Math.abs(value) >= (control.minAbs ?? 0.01) && (control.sign === "positive" ? value > 0 : value < 0))) : torques.length > 0;
    const torquesPass = torques.every((torque) => torque.observed !== void 0 && Math.abs(torque.observed) >= (torque.minAbs ?? 0.01) && (torque.sign === "positive" ? torque.observed > 0 : torque.observed < 0));
    const pass = forcePass && controlsPass && torquesPass && (assertion.minForceSamples !== void 0 || controls.length > 0 || torques.length > 0);
    assertions.push({ details: { controls, forceSamples, minimumForceSamples: assertion.minForceSamples, torques }, id: `aerodynamics.${index}`, pass });
    if (!pass) {
      diagnostics.push({
        artifactPath: assertion.minForceSamples !== void 0 ? "observations.json" : "effect-log.json",
        code: "TN_PLAYTEST_AERODYNAMICS_ASSERTION_FAILED",
        message: `Aerodynamic proof for '${assertion.entity}' did not observe the required finite force samples and signed control values.`,
        observedRuntimePath: "observations.json/physicsDebugSeries/artifact/primitives[category=aero] | effect-log.json/entries[service=physics.aerodynamics.setInputs]",
        severity: "error",
        suggestion: "Check AerodynamicBody metadata, physics debug capture, input-axis bindings, and surface sign mapping."
      });
    }
  }
  for (const assertion of scenarioAssertions.hud ?? []) {
    const result = evaluatePathAssertion("hud", assertion, input.report.observations?.hud[assertion.id], {});
    assertions.push(result.assertion);
    if (result.diagnostic !== void 0) {
      diagnostics.push({ ...result.diagnostic, code: result.diagnostic.code || "TN_PLAYTEST_HUD_ASSERTION_FAILED" });
    }
  }
  for (const assertion of scenarioAssertions.tags ?? []) {
    const result = evaluateTagCountAssertion(assertion, input.report.observations?.runtimeObservations);
    assertions.push(result.assertion);
    if (result.diagnostic !== void 0) {
      diagnostics.push(result.diagnostic);
    }
  }
  for (const assertion of scenarioAssertions.states ?? []) {
    const result = evaluateStateAssertion(assertion, input.report.observations?.runtimeObservations);
    assertions.push(result.assertion);
    if (result.diagnostic !== void 0) {
      diagnostics.push(result.diagnostic);
    }
  }
  {
    const diagnosticsPolicy = {
      ...scenarioAssertions.diagnostics,
      noRuntimeDiagnostics: scenarioAssertions.diagnostics?.noRuntimeDiagnostics ?? true
    };
    const policyDiagnostics = evaluateDiagnosticsPolicy(input.report, diagnosticsPolicy);
    diagnostics.push(...policyDiagnostics);
    if (scenarioAssertions.diagnostics !== void 0 || policyDiagnostics.length > 0) {
      assertions.push({
        details: {
          consoleErrors: consoleErrors(input.report.observations?.console ?? []).length,
          networkErrors: input.report.observations?.network.length ?? 0,
          runtimeDiagnostics: runtimeDiagnostics(input.report.observations?.runtimeDiagnostics).length
        },
        id: "diagnostics",
        pass: policyDiagnostics.length === 0
      });
    }
  }
  if (scenarioAssertions.movement?.minVelocity !== void 0) {
    const velocity = input.report.frames <= 0 ? 0 : input.report.distance / input.report.frames;
    const pass = velocity >= scenarioAssertions.movement.minVelocity;
    assertions.push({ details: { minVelocity: scenarioAssertions.movement.minVelocity, velocity }, id: "movement.velocity", pass });
    if (!pass) {
      diagnostics.push({
        code: "TN_PLAYTEST_VELOCITY_ASSERTION_FAILED",
        message: `Entity '${input.report.entity}' velocity ${velocity.toFixed(6)} was below required ${scenarioAssertions.movement.minVelocity}.`,
        severity: "error",
        suggestion: "Check input force/speed tuning and whether the scenario holds input long enough."
      });
    }
  }
  if (scenarioAssertions.movement?.minDistance !== void 0) {
    const pass = input.report.distance >= scenarioAssertions.movement.minDistance;
    assertions.push({
      details: { distance: input.report.distance, minimum: scenarioAssertions.movement.minDistance },
      id: "movement.distance",
      pass
    });
    if (!pass && !input.report.diagnostics.some((diagnostic) => diagnostic.code === "TN_PLAYTEST_INPUT_NO_EFFECT")) {
      diagnostics.push({
        code: "TN_PLAYTEST_MOVEMENT_ASSERTION_FAILED",
        message: `Entity '${scenarioAssertions.movement.entity ?? input.report.entity}' moved ${input.report.distance.toFixed(6)}, below required ${scenarioAssertions.movement.minDistance}.`,
        severity: "error",
        suggestion: "Check input bindings, collision response, and whether the scenario holds input long enough."
      });
    }
  }
  if (scenarioAssertions.movement?.maxDistance !== void 0) {
    const pass = input.report.distance <= scenarioAssertions.movement.maxDistance;
    assertions.push({ details: { distance: input.report.distance, maximum: scenarioAssertions.movement.maxDistance }, id: "movement.maxDistance", pass });
    if (!pass) {
      diagnostics.push({
        code: "TN_PLAYTEST_MOVEMENT_ASSERTION_FAILED",
        message: `Entity '${input.report.entity}' moved ${input.report.distance.toFixed(6)}, above allowed ${scenarioAssertions.movement.maxDistance}.`,
        severity: "error",
        suggestion: "Check bounds/blocked-cell handling and ensure the scenario drives the intended blocked direction."
      });
    }
  }
  if (scenarioAssertions.movement?.pathLength !== void 0) {
    const pathLength = input.report.pathLength ?? input.report.distance;
    const pass = pathLength >= scenarioAssertions.movement.pathLength;
    assertions.push({ details: { minimum: scenarioAssertions.movement.pathLength, pathLength }, id: "movement.pathLength", pass });
    if (!pass) {
      diagnostics.push({
        code: "TN_PLAYTEST_PATH_LENGTH_ASSERTION_FAILED",
        message: `Entity '${input.report.entity}' accumulated path length ${pathLength.toFixed(6)}, below required ${scenarioAssertions.movement.pathLength}.`,
        severity: "error",
        suggestion: "Use pathLength with minDistance to distinguish actual traversal from a route that returns to its starting point."
      });
    }
  }
  if (scenarioAssertions.movement?.minAxisDelta !== void 0) {
    const expectation = parseMovementAxisExpectation(scenarioAssertions.movement.minAxisDelta.axis);
    let rawDelta;
    if (expectation !== void 0 && input.report.movementDelta !== void 0) {
      rawDelta = input.report.movementDelta[axisIndex(expectation.axis)];
    }
    const signedDelta = rawDelta === void 0 || expectation === void 0 ? void 0 : rawDelta * (expectation.sign ?? 1);
    const pass = signedDelta !== void 0 && signedDelta >= scenarioAssertions.movement.minAxisDelta.min;
    assertions.push({
      details: {
        axis: scenarioAssertions.movement.minAxisDelta.axis,
        min: scenarioAssertions.movement.minAxisDelta.min,
        rawDelta: rawDelta ?? null,
        signedDelta: signedDelta ?? null
      },
      id: "movement.axisDelta",
      pass
    });
    if (!pass) {
      diagnostics.push({
        code: "TN_PLAYTEST_AXIS_DELTA_ASSERTION_FAILED",
        message: `Entity '${scenarioAssertions.movement.entity ?? input.report.entity}' did not move ${scenarioAssertions.movement.minAxisDelta.min} units on ${scenarioAssertions.movement.minAxisDelta.axis}.`,
        severity: "error",
        suggestion: "Check route setup, collision response, and whether the scenario ends on the expected vertical surface."
      });
    }
  }
  if (scenarioAssertions.movement?.minResolvedAxisDelta !== void 0) {
    const entity = scenarioAssertions.movement.entity ?? input.scenario.subject ?? input.report.entity;
    const expectation = parseMovementAxisExpectation(scenarioAssertions.movement.minResolvedAxisDelta.axis);
    const resolved = expectation === void 0 ? void 0 : maxResolvedAxisDelta(input.report.effectLog, entity, expectation, input.report.before?.position);
    const pass = resolved !== void 0 && resolved >= scenarioAssertions.movement.minResolvedAxisDelta.min;
    assertions.push({
      details: {
        axis: scenarioAssertions.movement.minResolvedAxisDelta.axis,
        entity,
        min: scenarioAssertions.movement.minResolvedAxisDelta.min,
        signedDelta: resolved ?? null
      },
      id: "movement.resolvedAxisDelta",
      pass
    });
    if (!pass) {
      diagnostics.push({
        code: "TN_PLAYTEST_RESOLVED_AXIS_DELTA_ASSERTION_FAILED",
        message: `Entity '${entity}' did not resolve ${scenarioAssertions.movement.minResolvedAxisDelta.min} units on ${scenarioAssertions.movement.minResolvedAxisDelta.axis}.`,
        severity: "error",
        suggestion: "Check character.move effect-log entries, route setup, collision response, and whether the scenario reaches the expected slope or step surface."
      });
    }
  }
  if (scenarioAssertions.movement?.rotationChanged === true) {
    const rotation = rotationDelta(input.report.effectLog, scenarioAssertions.movement.entity ?? input.report.entity);
    const pass = rotation !== void 0 && rotation > 1e-4;
    assertions.push({ details: { rotationDelta: rotation ?? null }, id: "movement.rotation", pass });
    if (!pass) {
      diagnostics.push({
        code: "TN_PLAYTEST_ROTATION_ASSERTION_FAILED",
        message: `Entity '${scenarioAssertions.movement.entity ?? input.report.entity}' did not expose a changed rotation during the playtest.`,
        severity: "error",
        suggestion: "Check turn/yaw script output and ensure Transform rotation changes are emitted."
      });
    }
  }
  if (scenarioAssertions.movement?.maxTiltDegrees !== void 0) {
    const entity = scenarioAssertions.movement.entity ?? input.report.entity;
    const tilt = tiltDegrees(input.report.after?.rotation) ?? finalTiltDegrees(input.report.effectLog, entity);
    const pass = tilt !== void 0 && tilt <= scenarioAssertions.movement.maxTiltDegrees;
    assertions.push({
      details: { entity, maxTiltDegrees: scenarioAssertions.movement.maxTiltDegrees, tiltDegrees: tilt ?? null },
      id: "movement.tilt",
      pass
    });
    if (!pass) {
      diagnostics.push({
        code: "TN_PLAYTEST_TILT_ASSERTION_FAILED",
        message: `Entity '${entity}' final tilt ${tilt === void 0 ? "was unavailable" : `${tilt.toFixed(3)} degrees`} and must not exceed ${scenarioAssertions.movement.maxTiltDegrees} degrees.`,
        severity: "error",
        suggestion: "Inspect the final Transform rotation and fix suspension, grounding, collision response, or recovery before accepting the playtest."
      });
    }
  }
  if (scenarioAssertions.movement?.closesDistanceToPosition !== void 0) {
    const expectation = scenarioAssertions.movement.closesDistanceToPosition;
    const before = input.report.before?.position;
    const after = input.report.after?.position;
    const decrease = before === void 0 || after === void 0 ? void 0 : vectorDistance(before, expectation.position) - vectorDistance(after, expectation.position);
    const pass = decrease !== void 0 && decrease >= expectation.min;
    assertions.push({
      details: { decrease: decrease ?? null, position: expectation.position, required: expectation.min },
      id: "movement.closesDistance",
      pass
    });
    if (!pass) diagnostics.push({
      code: "TN_PLAYTEST_DISTANCE_CLOSURE_ASSERTION_FAILED",
      message: `Entity did not close distance to the expected position by ${expectation.min}.`,
      severity: "error",
      suggestion: "Inspect pursue target ownership and character.move resolved positions."
    });
  }
  if (scenarioAssertions.movement?.reachesPositionWithin !== void 0) {
    const expectation = scenarioAssertions.movement.reachesPositionWithin;
    const entity = scenarioAssertions.movement.entity ?? input.scenario.subject ?? input.report.entity;
    const closestDistance = minimumResolvedDistance(
      input.report.effectLog,
      input.report.observations?.effectLogSeries,
      entity,
      expectation.position,
      input.report.before?.position,
      expectation.atStep
    );
    const pass = closestDistance !== void 0 && closestDistance <= expectation.maxDistance;
    assertions.push({
      details: { closestDistance: closestDistance ?? null, entity, ...expectation },
      id: "movement.reachesPosition",
      pass
    });
    if (!pass) diagnostics.push({
      code: "TN_PLAYTEST_POSITION_REACH_ASSERTION_FAILED",
      message: `Entity '${entity}' did not come within ${expectation.maxDistance} units of the expected position.`,
      severity: "error",
      suggestion: "Inspect character.move resolved positions and the owned last-known-position target."
    });
  }
  if (scenarioAssertions.movement?.facesMovementWithinDegrees !== void 0) {
    const entity = scenarioAssertions.movement.entity ?? input.scenario.subject ?? input.report.entity;
    const evidence = movementFacingEvidence(input.report.effectLog, entity);
    const pass = evidence.sampleCount > 0 && evidence.maxErrorDegrees <= scenarioAssertions.movement.facesMovementWithinDegrees;
    assertions.push({
      details: { entity, ...evidence, threshold: scenarioAssertions.movement.facesMovementWithinDegrees },
      id: "movement.facing",
      pass
    });
    if (!pass) diagnostics.push({
      code: "TN_PLAYTEST_MOVEMENT_FACING_ASSERTION_FAILED",
      message: `Entity '${entity}' did not face resolved movement within ${scenarioAssertions.movement.facesMovementWithinDegrees} degrees.`,
      severity: "error",
      suggestion: "Inspect character.move direction and Transform yaw effects; slew facing before allowing translation."
    });
  }
  if (scenarioAssertions.movement?.notFacing !== void 0) {
    const entity = scenarioAssertions.movement.entity ?? input.scenario.subject ?? input.report.entity;
    const angleDegrees = finalFacingAngleToEntity(input.report.effectLog, entity, scenarioAssertions.movement.notFacing.entity);
    const pass = angleDegrees !== void 0 && angleDegrees >= scenarioAssertions.movement.notFacing.minDegrees;
    assertions.push({
      details: { angleDegrees: angleDegrees ?? null, entity, target: scenarioAssertions.movement.notFacing.entity },
      id: "movement.notFacing",
      pass
    });
    if (!pass) diagnostics.push({
      code: "TN_PLAYTEST_NOT_FACING_ASSERTION_FAILED",
      message: `Entity '${entity}' remained pointed at '${scenarioAssertions.movement.notFacing.entity}' during movement.`,
      severity: "error",
      suggestion: "Drive patrol yaw from movement direction rather than the target entity."
    });
  }
  if (scenarioAssertions.movement?.notFacingPosition !== void 0) {
    const entity = scenarioAssertions.movement.entity ?? input.scenario.subject ?? input.report.entity;
    const expectation = scenarioAssertions.movement.notFacingPosition;
    const angleDegrees = finalFacingAngleToPosition(input.report.effectLog, entity, expectation.position);
    const pass = angleDegrees !== void 0 && angleDegrees >= expectation.minDegrees;
    assertions.push({
      details: { angleDegrees: angleDegrees ?? null, entity, position: expectation.position },
      id: "movement.notFacingPosition",
      pass
    });
    if (!pass) diagnostics.push({
      code: "TN_PLAYTEST_NOT_FACING_POSITION_ASSERTION_FAILED",
      message: `Entity '${entity}' remained pointed at the excluded world position during movement.`,
      severity: "error",
      suggestion: "Drive patrol yaw from movement direction rather than the observed target position."
    });
  }
  for (const assertion of scenarioAssertions.visibility ?? []) {
    const entity = assertion.entity ?? input.scenario.subject ?? input.report.entity;
    const result = evaluateVisibilityAssertion(entity, assertion.minProjectedPixels, assertion.maxOffscreenRatio, input.scenario.viewport, input.report.observations?.runtimeDiagnostics);
    assertions.push(result.assertion);
    if (result.diagnostic !== void 0) {
      diagnostics.push(result.diagnostic);
    }
  }
  for (const assertion of scenarioAssertions.contacts ?? []) {
    const entity = assertion.entity ?? input.scenario.subject ?? input.report.entity;
    if (assertion.requiredOn !== void 0 && !assertion.requiredOn.includes(input.scenario.target)) {
      assertions.push({
        details: { entity, requiredOn: assertion.requiredOn, skipped: true, target: input.scenario.target },
        id: `contact.${entity}`,
        pass: true
      });
      continue;
    }
    const tokens = [entity, assertion.with, assertion.kind].filter((item) => item !== void 0);
    const selectedSample = assertion.atStep === void 0 ? void 0 : input.report.observations?.physicsDebugSeries?.find((sample) => sample.label === assertion.atStep);
    const stepAvailable = assertion.atStep === void 0 || selectedSample !== void 0;
    const effectEvidence = assertion.atStep === void 0 ? mergeEffectLogs(input.report.effectLog, input.report.observations?.effectLogSeries) : [];
    const effectCount = countMatchingEntries(effectEvidence, tokens);
    const physicsDebugCount = assertion.kind === void 0 || assertion.kind === "contact" ? countPhysicsDebugContacts(input.report.observations, entity, assertion.with, selectedSample?.snapshot) : 0;
    const count = effectCount + physicsDebugCount;
    const minCount = assertion.minCount ?? (assertion.maxCount === void 0 ? 1 : 0);
    const pass = stepAvailable && count >= minCount && (assertion.maxCount === void 0 || count <= assertion.maxCount);
    assertions.push({ details: { atStep: assertion.atStep, count, entity, kind: assertion.kind, maxCount: assertion.maxCount, minCount, with: assertion.with }, id: `contact.${entity}`, pass });
    if (!pass) {
      const partial = summarizeMatchingEntries(effectEvidence, [entity, assertion.with].filter((item) => item !== void 0));
      const hasPhysicsDebugEvidence = input.report.observations?.physicsDebug !== void 0 || (input.report.observations?.physicsDebugSeries?.length ?? 0) > 0;
      diagnostics.push({
        artifactPath: partial !== void 0 || !hasPhysicsDebugEvidence ? "effect-log.json" : "observations.json",
        code: !stepAvailable ? "TN_PLAYTEST_CONTACT_STEP_NOT_OBSERVED" : assertion.maxCount !== void 0 && count > assertion.maxCount ? "TN_PLAYTEST_CONTACT_COUNT_EXCEEDED" : "TN_PLAYTEST_CONTACT_NOT_OBSERVED",
        message: !stepAvailable ? `Contact assertion step '${assertion.atStep}' was not retained.` : assertion.maxCount !== void 0 && count > assertion.maxCount ? `Contact/trigger for '${entity}' was observed ${count} time(s), above allowed ${assertion.maxCount}.` : `Expected contact/trigger for '${entity}' was not observed ${minCount} time(s).`,
        observedRuntimePath: `observations.json/physicsDebugSeries/artifact/primitives[category=contact,entity=${entity}] | effect-log.json/entries[kind=service|event,entity=${entity}]`,
        path: `${input.scenario.sourcePath ?? "playtest"}/assert/contacts/${entity}`,
        severity: "error",
        ...input.scenario.sourcePath === void 0 ? {} : { sourcePath: input.scenario.sourcePath },
        ...partial?.systemId === void 0 ? {} : { systemId: partial.systemId, sourcePath: partial.sourcePath },
        suggestion: !stepAvailable ? "Add a scenario step with the requested label or correct assert.contacts[].atStep." : partial === void 0 ? "Check collider/trigger metadata, contact filters, and whether the scenario reaches the target. Inspect observations.json physics-debug contacts and effect-log.json." : `effect-log.json contains ${partial.entryCount} related runtime entr${partial.entryCount === 1 ? "y" : "ies"} from ${partial.systems}, but none satisfied the contact assertion. Check collider/trigger metadata, contact filters, and route timing in the listed system(s).`
      });
    }
  }
  for (const assertion of scenarioAssertions.settled ?? []) {
    if (assertion.requiredOn !== void 0 && !assertion.requiredOn.includes(input.scenario.target)) {
      assertions.push({
        details: { entity: assertion.entity, requiredOn: assertion.requiredOn, skipped: true, target: input.scenario.target },
        id: `settled.${assertion.entity}`,
        pass: true
      });
      continue;
    }
    const snapshot = assertion.atStep === void 0 ? input.report.observations?.physicsDebugSeries?.at(-1)?.snapshot ?? input.report.observations?.physicsDebug : input.report.observations?.physicsDebugSeries?.find((sample) => sample.label === assertion.atStep)?.snapshot;
    const bodies = physicsDebugSleepStates(snapshot, assertion.entity);
    const minimum = assertion.minBodies ?? 1;
    const sleeping = bodies.filter((body) => body.sleeping).length;
    const comparisonSnapshot = assertion.compareToStep === void 0 ? void 0 : input.report.observations?.physicsDebugSeries?.find((sample) => sample.label === assertion.compareToStep)?.snapshot;
    const poseDistance = assertion.compareToStep === void 0 ? void 0 : physicsDebugMeanPoseDistance(snapshot, comparisonSnapshot, assertion.entity);
    const posePass = assertion.minMeanPoseDistance === void 0 || poseDistance !== void 0 && poseDistance.sharedBodies >= minimum && poseDistance.mean >= assertion.minMeanPoseDistance;
    const pass = bodies.length >= minimum && sleeping === bodies.length && posePass;
    assertions.push({
      details: { atStep: assertion.atStep, bodies: bodies.length, compareToStep: assertion.compareToStep, entity: assertion.entity, minimum, poseDistance, sleeping },
      id: `settled.${assertion.entity}`,
      pass
    });
    if (!pass) diagnostics.push({
      artifactPath: "observations.json",
      code: !posePass ? "TN_PLAYTEST_RAGDOLL_POSE_NOT_DISTINCT" : "TN_PLAYTEST_PHYSICS_NOT_SETTLED",
      message: !posePass ? `Expected mean settled-pose distance for '${assertion.entity}' to reach ${assertion.minMeanPoseDistance}m from step '${assertion.compareToStep}'; observed ${poseDistance?.mean ?? "unavailable"}m across ${poseDistance?.sharedBodies ?? 0} bodies.` : `Expected at least ${minimum} physics bod${minimum === 1 ? "y" : "ies"} matching '${assertion.entity}' to be asleep; observed ${sleeping} of ${bodies.length}.`,
      observedRuntimePath: "observations.json/physicsDebugSeries/artifact/primitives[category=sleep]",
      path: `${input.scenario.sourcePath ?? "playtest"}/assert/settled/${assertion.entity}`,
      severity: "error",
      ...input.scenario.sourcePath === void 0 ? {} : { sourcePath: input.scenario.sourcePath },
      suggestion: "Allow a longer settle window or fix damping, contacts, joints, and persistent forces that keep the bodies awake."
    });
  }
  for (const assertion of scenarioAssertions.occluded ?? []) {
    const matches = matchingOccludedRaycasts(input.report.effectLog, assertion.entity, assertion.target);
    const pass = matches > 0;
    assertions.push({ details: { count: matches, entity: assertion.entity, target: assertion.target }, id: `occluded.${assertion.entity ?? "ray"}`, pass });
    if (!pass) diagnostics.push({
      artifactPath: "effect-log.json",
      code: "TN_PLAYTEST_OCCLUSION_NOT_OBSERVED",
      message: "Expected a render scene-ray query or physics raycast result with hit=true, but no matching occlusion evidence was observed.",
      observedRuntimePath: "effect-log.json/entries[service=render.sceneRayQuery|physics.raycast]/payload/result/hit",
      severity: "error",
      suggestion: "Check the listener/emitter entity ids and rendered occluder geometry, then inspect effect-log.json for the scene-query request and hit result."
    });
  }
  for (const assertion of scenarioAssertions.animation ?? []) {
    const entity = assertion.entity ?? input.scenario.subject ?? input.report.entity;
    const tokens = [entity, assertion.clip].filter((item) => item !== void 0);
    const count = countMatchingEntries(input.report.effectLog, tokens);
    const minCount = assertion.entered === true || assertion.advancedFrames !== void 0 ? 1 : 0;
    const pass = count >= minCount;
    assertions.push({ details: { count, entity, clip: assertion.clip, advancedFrames: assertion.advancedFrames }, id: `animation.${entity}`, pass });
    if (!pass) {
      diagnostics.push({
        code: "TN_PLAYTEST_ANIMATION_NOT_OBSERVED",
        message: `Expected animation evidence for '${entity}'${assertion.clip === void 0 ? "" : ` clip '${assertion.clip}'`} was not observed.`,
        severity: "error",
        suggestion: "Check model animation clip wiring and runtime animation playback state."
      });
    }
  }
  for (const entry of PLAYTEST_ASSERTION_REGISTRY) {
    if (scenarioAssertions[entry.kind] === void 0 || assertions.some((assertion) => assertion.id.startsWith(entry.resultIdPrefix)) || assertionEvaluatedByBaseProbe(entry.kind, input.report)) {
      continue;
    }
    const id = `assert.${entry.kind}`;
    assertions.push({ details: { reason: "registered-without-evaluator" }, id, pass: false });
    diagnostics.push(assertionNotEvaluatedDiagnostic(id, "the registered assertion produced no evaluator result"));
  }
  if (assertions.length === 0) {
    const id = "scenario.assertions";
    assertions.push({ details: { reason: "no-evaluated-assertions" }, id, pass: false });
    diagnostics.push({
      code: "TN_PLAYTEST_SCENARIO_NO_ASSERTIONS",
      message: `Scenario '${input.scenario.name}' completed without evaluating any assertions.`,
      severity: "error",
      ...input.scenario.sourcePath === void 0 ? {} : { sourcePath: input.scenario.sourcePath },
      suggestion: "Declare a supported assertion and ensure its evaluator observes a result before treating the scenario as proof."
    });
  }
  return { assertions, diagnostics };
}
function horizontalRadius(transform, direction) {
  const halfExtents = transform?.halfExtents ?? (transform?.scale === void 0 ? void 0 : transform.scale.map((value) => Math.abs(value) * 0.5));
  return halfExtents === void 0 ? 0 : Math.abs(direction[0]) * Math.abs(halfExtents[0]) + Math.abs(direction[1]) * Math.abs(halfExtents[2]);
}
function platformTop(transform) {
  const halfHeight = transform.halfExtents?.[1] ?? (transform.scale === void 0 ? 0 : Math.abs(transform.scale[1]) * 0.5);
  return (transform.position?.[1] ?? 0) + halfHeight;
}
function movementEnvelopeHorizontalLimit(envelope, rise) {
  if (rise > envelope.maxRise) return void 0;
  const dropFromApex = envelope.maxRise - rise;
  if (dropFromApex > envelope.fallDistanceToGround) return void 0;
  if (envelope.maxRise === 0) return rise === 0 ? envelope.forwardReach : void 0;
  return envelope.forwardReach * (1 + Math.sqrt(dropFromApex / envelope.maxRise));
}
function countPhysicsDebugContacts(observations, entity, withEntity, selectedSnapshot) {
  const snapshots = selectedSnapshot === void 0 ? [
    observations?.physicsDebug,
    ...(observations?.physicsDebugSeries ?? []).map((sample) => sample.snapshot)
  ] : [selectedSnapshot];
  let count = 0;
  for (const snapshot of snapshots) {
    if (!isRecord(snapshot) || !isRecord(snapshot.artifact) || !Array.isArray(snapshot.artifact.primitives)) continue;
    count += snapshot.artifact.primitives.filter((primitive) => {
      if (!isRecord(primitive) || primitive.category !== "contact" || typeof primitive.id !== "string") return false;
      return primitive.id.includes(entity) && (withEntity === void 0 || primitive.id.includes(withEntity));
    }).length;
  }
  return count;
}
function physicsDebugSleepStates(snapshot, entity) {
  if (!isRecord(snapshot) || !isRecord(snapshot.artifact) || !Array.isArray(snapshot.artifact.primitives)) return [];
  return snapshot.artifact.primitives.flatMap((primitive) => {
    if (!isRecord(primitive) || primitive.category !== "sleep" || typeof primitive.entity !== "string" || primitive.entity !== entity && !primitive.entity.startsWith(entity) || typeof primitive.value !== "number") return [];
    return [{ entity: primitive.entity, sleeping: primitive.value >= 1 }];
  });
}
function physicsDebugMeanPoseDistance(snapshot, comparisonSnapshot, entity) {
  const positions = physicsDebugBodyPositions(snapshot, entity);
  const comparison = physicsDebugBodyPositions(comparisonSnapshot, entity);
  const distances = [...positions.entries()].flatMap(([id, position]) => {
    const other = comparison.get(id);
    return other === void 0 ? [] : [Math.hypot(position[0] - other[0], position[1] - other[1], position[2] - other[2])];
  });
  if (distances.length === 0) return void 0;
  return {
    mean: distances.reduce((sum, distance) => sum + distance, 0) / distances.length,
    sharedBodies: distances.length
  };
}
function physicsDebugBodyPositions(snapshot, entity) {
  const positions = /* @__PURE__ */ new Map();
  if (!isRecord(snapshot) || !isRecord(snapshot.artifact) || !Array.isArray(snapshot.artifact.primitives)) return positions;
  for (const primitive of snapshot.artifact.primitives) {
    if (!isRecord(primitive) || primitive.category !== "center-of-mass" || typeof primitive.entity !== "string" || primitive.entity !== entity && !primitive.entity.startsWith(entity) || !finiteVector(primitive.position)) continue;
    positions.set(primitive.entity, primitive.position);
  }
  return positions;
}
function assertionEvaluatedByBaseProbe(kind, report) {
  if (kind === "movement") return report.expectMoved || report.expectAxis !== void 0;
  if (kind === "camera") return report.follow !== void 0;
  return false;
}
function assertionNotEvaluatedDiagnostic(id, reason) {
  return {
    code: "TN_PLAYTEST_ASSERTION_NOT_EVALUATED",
    message: `Declared assertion '${id}' was not evaluated: ${reason}.`,
    severity: "error",
    suggestion: "Run this assertion on a supported target or add its evaluator before treating the scenario as proof."
  };
}
function overlayNodeObservationKey(overlayId, selector) {
  return `${overlayId}:${selector}`;
}
function evaluateTagCountAssertion(assertion, observations) {
  const gameplay = gameplayObservations(observations);
  const tags = isRecord(gameplay?.tags) ? gameplay.tags : void 0;
  const candidate = tags?.[assertion.tag];
  const summary = isRecord(candidate) ? candidate : void 0;
  const count = typeof summary?.count === "number" ? summary.count : void 0;
  const pass = count !== void 0 && (assertion.count === void 0 || count === assertion.count) && (assertion.gte === void 0 || count >= assertion.gte);
  const result = { details: { count: count ?? null, expected: assertion, tag: assertion.tag }, id: `tags.${assertion.tag}`, pass };
  return pass ? { assertion: result } : {
    assertion: result,
    diagnostic: {
      code: "TN_PLAYTEST_TAG_COUNT_ASSERTION_FAILED",
      message: `Tag '${assertion.tag}' count ${count === void 0 ? "was unavailable" : count} did not satisfy the expected count.`,
      severity: "error",
      suggestion: "Ensure the runtime entity tags are authored and inspect runtimeObservations.gameplay.tags in the playtest artifact."
    }
  };
}
function evaluateStateAssertion(assertion, observations) {
  const gameplay = gameplayObservations(observations);
  const states = isRecord(gameplay?.states) ? gameplay.states : void 0;
  const observed = typeof states?.[assertion.entity] === "string" ? states[assertion.entity] : void 0;
  const pass = observed === assertion.equals;
  const result = { details: { entity: assertion.entity, expected: assertion.equals, observed: observed ?? null }, id: `states.${assertion.entity}`, pass };
  return pass ? { assertion: result } : {
    assertion: result,
    diagnostic: {
      code: "TN_PLAYTEST_STATE_ASSERTION_FAILED",
      message: `Entity '${assertion.entity}' state ${observed === void 0 ? "was unavailable" : `'${observed}'`} did not equal '${assertion.equals}'.`,
      severity: "error",
      suggestion: "Ensure the entity has a StateMachine component and inspect runtimeObservations.gameplay.states in the playtest artifact."
    }
  };
}
function gameplayObservations(value) {
  if (!isRecord(value)) {
    return void 0;
  }
  const gameplay = value.gameplay;
  return isRecord(gameplay) ? gameplay : void 0;
}
function evaluatePathAssertion(kind, assertion, observed, context) {
  const before = readPath(observed?.before, assertion.path);
  const after = readPath(observed?.after, assertion.path);
  const valueChecksBefore = [];
  const valueChecksAfter = [];
  if (Object.hasOwn(assertion, "equals")) {
    valueChecksBefore.push(jsonEqual(before, assertion.equals));
    valueChecksAfter.push(jsonEqual(after, assertion.equals));
  }
  if (assertion.gte !== void 0) {
    valueChecksBefore.push(typeof before === "number" && before >= assertion.gte);
    valueChecksAfter.push(typeof after === "number" && after >= assertion.gte);
  }
  if (assertion.textIncludes !== void 0) {
    valueChecksBefore.push(String(textValue(before)).includes(assertion.textIncludes));
    valueChecksAfter.push(String(textValue(after)).includes(assertion.textIncludes));
  }
  const trivial = rejectsTrivialAssertion(kind === "hud" ? "hud" : "resources") && valueChecksBefore.length > 0 && before !== void 0 && valueChecksBefore.every(Boolean);
  const checks = [...valueChecksAfter];
  if (assertion.changed !== void 0) {
    checks.push(assertion.changed ? !jsonEqual(before, after) : jsonEqual(before, after));
  }
  const pass = checks.length > 0 && checks.every(Boolean) && (!trivial || assertion.allowTrivial === true);
  const result = {
    details: {
      after,
      before,
      expected: expectedPathAssertion(assertion),
      id: assertion.id,
      path: assertion.path,
      trivial,
      ...trivial && assertion.allowTrivial === true ? { trivialityOptOut: true } : {}
    },
    id: `${kind}.${assertion.id}${assertion.path === void 0 ? "" : `.${assertion.path}`}`,
    pass
  };
  return pass ? { assertion: result } : {
    assertion: result,
    diagnostic: trivial && assertion.allowTrivial !== true ? trivialAssertionDiagnostic(`${kind}.${assertion.id}`, assertion.path, before, context.scenarioSourcePath) : pathAssertionDiagnostic(kind, assertion, before, after, context)
  };
}
function rejectsTrivialAssertion(kind) {
  return PLAYTEST_ASSERTION_REGISTRY.find((entry) => entry.kind === kind)?.triviality === "reject-initial-value";
}
function componentValueChecks(assertion, value) {
  const resolved = value;
  return [
    ...Object.hasOwn(assertion, "equals") ? [jsonEqual(resolved, assertion.equals)] : [],
    ...assertion.gte === void 0 ? [] : [typeof resolved === "number" && resolved >= assertion.gte]
  ];
}
function trivialAssertionDiagnostic(id, path, before, sourcePath) {
  return {
    code: "TN_PLAYTEST_ASSERTION_TRIVIAL",
    message: `Assertion '${id}'${path === void 0 ? "" : ` at path '${path}'`} was already satisfied before the scenario ran (value ${JSON.stringify(before)}).`,
    path,
    severity: "error",
    ...sourcePath === void 0 ? {} : { sourcePath },
    suggestion: "Drive the asserted value from a failing initial state, assert changed:true, or set allowTrivial:true with a documented held-invariant reason."
  };
}
function hasFinalPathExpectation(assertion) {
  return Object.hasOwn(assertion, "equals") || assertion.gte !== void 0 || assertion.textIncludes !== void 0 || assertion.changed !== void 0;
}
function hasFinalComponentExpectation(assertion) {
  return Object.hasOwn(assertion, "equals") || assertion.gte !== void 0 || assertion.changed !== void 0;
}
function componentAssertionDiagnostic(assertion, before, after) {
  return {
    code: "TN_PLAYTEST_COMPONENT_ASSERTION_FAILED",
    message: `Component '${assertion.component}' on entity '${assertion.entity}'${assertion.path === void 0 ? "" : ` path '${assertion.path}'`} did not satisfy the assertion.`,
    observedRuntimePath: `observations.json/components/${assertion.entity}/${assertion.component}`,
    severity: "error",
    suggestion: `Expected ${JSON.stringify(assertion)}, observed before=${JSON.stringify(before)} after=${JSON.stringify(after)}. Check the owning script and runtime component synchronization.`
  };
}
function pathValuePass(assertion, value) {
  const checks = [];
  if (Object.hasOwn(assertion, "equals")) checks.push(jsonEqual(value, assertion.equals));
  if (assertion.gte !== void 0) checks.push(typeof value === "number" && value >= assertion.gte);
  if (assertion.textIncludes !== void 0) checks.push(String(textValue(value)).includes(assertion.textIncludes));
  return checks.length > 0 && checks.every(Boolean);
}
function aerodynamicForceSampleCount(series, entity) {
  return (series ?? []).filter(({ snapshot }) => {
    if (!isRecord(snapshot) || !isRecord(snapshot.artifact) || !Array.isArray(snapshot.artifact.primitives)) return false;
    return snapshot.artifact.primitives.some((primitive) => isRecord(primitive) && primitive.category === "aero" && primitive.entity === entity && typeof primitive.value === "number" && Number.isFinite(primitive.value) && finiteVector(primitive.from) && finiteVector(primitive.to));
  }).length;
}
function aerodynamicControlValues(effectLog, series, entity, surface) {
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
function aerodynamicTorqueAtLabel(series, entity, label) {
  const snapshot = (series ?? []).find((sample) => sample.label === label)?.snapshot;
  if (!isRecord(snapshot) || !isRecord(snapshot.artifact) || !Array.isArray(snapshot.artifact.primitives)) return void 0;
  const primitives = snapshot.artifact.primitives.filter(isRecord);
  const bodyPosition = primitives.find((primitive) => primitive.id === `sleep:${entity}`)?.position;
  if (!finiteVector(bodyPosition)) return void 0;
  const origin = bodyPosition;
  const torque = [0, 0, 0];
  let samples = 0;
  for (const primitive of primitives) {
    if (primitive.category !== "aero" || primitive.entity !== entity || !finiteVector(primitive.from) || !finiteVector(primitive.to)) continue;
    const from = primitive.from;
    const to = primitive.to;
    const momentArm = [from[0] - origin[0], from[1] - origin[1], from[2] - origin[2]];
    const force = [to[0] - from[0], to[1] - from[1], to[2] - from[2]];
    const cross = [
      momentArm[1] * force[2] - momentArm[2] * force[1],
      momentArm[2] * force[0] - momentArm[0] * force[2],
      momentArm[0] * force[1] - momentArm[1] * force[0]
    ];
    torque[0] += cross[0];
    torque[1] += cross[1];
    torque[2] += cross[2];
    samples += 1;
  }
  return samples === 0 || !torque.every(Number.isFinite) ? void 0 : torque;
}
function finiteVector(value) {
  return Array.isArray(value) && value.length === 3 && value.every((item) => typeof item === "number" && Number.isFinite(item));
}
function record(value) {
  return isRecord(value) ? value : void 0;
}
function expectedPathAssertion(assertion) {
  return {
    ...assertion.atSteps === void 0 ? {} : { atSteps: assertion.atSteps },
    ...Object.hasOwn(assertion, "equals") ? { equals: assertion.equals } : {},
    ...assertion.gte === void 0 ? {} : { gte: assertion.gte },
    ...assertion.textIncludes === void 0 ? {} : { textIncludes: assertion.textIncludes },
    ...assertion.throughoutSteps === void 0 ? {} : { throughoutSteps: assertion.throughoutSteps },
    ...assertion.changed === void 0 ? {} : { changed: assertion.changed },
    ...assertion.allowTrivial === void 0 ? {} : { allowTrivial: assertion.allowTrivial }
  };
}
function unchangedPathValue(before, after) {
  return before !== void 0 && after !== void 0 && jsonEqual(before, after);
}
function pathAssertionDiagnostic(kind, assertion, before, after, context) {
  const unchanged = unchangedPathValue(before, after);
  if (kind === "resource" && unchanged && (context.movedDistance ?? 0) > 0.01) {
    const summary = summarizeResourceEffectLog(context.effectLog, assertion.id, assertion.path);
    return {
      code: "TN_PLAYTEST_RESOURCE_STATE_STAGNATED",
      message: `Resource '${assertion.id}'${assertion.path === void 0 ? "" : ` path '${assertion.path}'`} did not change after the scenario moved the subject ${formatNumber(context.movedDistance ?? 0)} units.`,
      artifactPath: "effect-log.json",
      observedRuntimePath: `effect-log.json/entries[kind=resource,resource=${assertion.id}]`,
      path: assertion.path === void 0 ? `${context.scenarioSourcePath ?? "playtest"}/assert/resources/${assertion.id}` : `${context.scenarioSourcePath ?? "playtest"}/assert/resources/${assertion.id}/${assertion.path}`,
      resourceId: assertion.id,
      severity: "error",
      ...context.scenarioSourcePath === void 0 ? {} : { sourcePath: context.scenarioSourcePath },
      ...summary?.systemId === void 0 ? {} : { systemId: summary.systemId, sourcePath: summary.sourcePath },
      suggestion: summary === void 0 ? "The scenario movement path executed but the asserted resource never changed. Capture effect-log.json, then check pickup/contact predicates, route coordinates, resource write declarations, and stale duplicate systems before rerunning." : `The scenario movement path executed and effect-log.json shows ${summary.entryCount} '${assertion.id}' resource snapshot(s) from ${summary.systems}; observed values stayed ${summary.distinctValues}. Check pickup/contact predicates, route coordinates, resource write declarations, and stale duplicate systems in the listed system(s).`
    };
  }
  return {
    code: "",
    message: `${kind === "hud" ? "HUD" : "Resource"} assertion failed for '${assertion.id}'${assertion.path === void 0 ? "" : ` path '${assertion.path}'`}.`,
    severity: "error",
    suggestion: unchanged ? `${kind === "hud" ? "Observed HUD value" : "Observed resource value"} did not change during the scenario. Inspect effect-log.json for the owning system's resource writes, run tn build --project . --json for undeclared writes, and check whether duplicate/stale systems or route/collision setup prevented the state transition.` : kind === "hud" ? "Check UI binding IDs and whether the backing resource changes during the scenario." : "Check resource IDs, script writes, and assertion path spelling."
  };
}
function summarizeResourceEffectLog(effectLog, resourceId, path) {
  if (!isRecord(effectLog) || !Array.isArray(effectLog.entries)) {
    return void 0;
  }
  const entries = effectLog.entries.filter((entry) => isRecord(entry)).filter((entry) => entry.kind === "resource" && entry.resource === resourceId);
  if (entries.length === 0) {
    return void 0;
  }
  const systems = /* @__PURE__ */ new Set();
  const values = /* @__PURE__ */ new Set();
  for (const entry of entries) {
    if (typeof entry.system === "string") {
      systems.add(entry.system);
    }
    values.add(shortJson(readPath(entry.value, path)));
  }
  return {
    distinctValues: Array.from(values).slice(0, 3).join(", "),
    entryCount: entries.length,
    ...[...systems].at(0) === void 0 ? {} : { sourcePath: sourcePathForSystem([...systems][0]), systemId: [...systems][0] },
    systems: systems.size === 0 ? "unknown systems" : Array.from(systems).slice(0, 5).join(", ")
  };
}
function sourcePathForSystem(systemId) {
  return `content/systems/${systemId}.systems.json`;
}
function shortJson(value) {
  const text = JSON.stringify(value);
  if (text === void 0) {
    return "undefined";
  }
  return text.length > 120 ? `${text.slice(0, 117)}...` : text;
}
function evaluateDiagnosticsPolicy(report, policy) {
  const diagnostics = [];
  if (policy?.runtimeReady === true && report.diagnostics.some((diagnostic) => diagnostic.code === "TN_PLAYTEST_RUNTIME_NOT_READY")) {
    diagnostics.push({
      code: "TN_PLAYTEST_RUNTIME_DIAGNOSTIC",
      message: "Runtime did not reach ready state while diagnostics policy required it.",
      severity: "error",
      suggestion: "Inspect runtime diagnostics and bundle validation output before replaying the scenario."
    });
  }
  const capturedConsoleErrors = consoleErrors(report.observations?.console ?? []);
  if (policy?.noConsoleErrors === true && capturedConsoleErrors.length > 0) {
    diagnostics.push({
      code: "TN_PLAYTEST_CONSOLE_ERROR",
      message: `${capturedConsoleErrors.length} browser console error(s) were captured during playtest.`,
      severity: "error",
      suggestion: "Open console.json in the playtest artifact directory and fix the first runtime error."
    });
  }
  if (policy?.noNetworkErrors === true && (report.observations?.network.length ?? 0) > 0) {
    diagnostics.push({
      code: "TN_PLAYTEST_NETWORK_ERROR",
      message: `${report.observations?.network.length ?? 0} failed network request(s) were captured during playtest.`,
      severity: "error",
      suggestion: "Open network.json in the playtest artifact directory and fix missing asset or bundle paths."
    });
  }
  const runtimeErrors = runtimeDiagnostics(report.observations?.runtimeDiagnostics);
  if (policy?.noRuntimeDiagnostics === true && runtimeErrors.length > 0) {
    diagnostics.push({
      code: "TN_PLAYTEST_RUNTIME_DIAGNOSTIC",
      message: `${runtimeErrors.length} runtime diagnostic error(s) were captured during playtest.`,
      severity: "error",
      suggestion: "Inspect runtime-trace.json and repair the authored source that owns the diagnostic path."
    });
  }
  return diagnostics;
}
function evaluateVisibilityAssertion(entity, minProjectedPixels, maxOffscreenRatio, viewport, runtimeDiagnosticsValue) {
  const diagnosticsSnapshot = runtimeDiagnosticsSnapshot(runtimeDiagnosticsValue);
  const rendered = renderedEntity(diagnosticsSnapshot, entity);
  const supportsProjectedBounds = renderedEntitiesAreReported(diagnosticsSnapshot);
  if (!supportsProjectedBounds && hasNativeReadinessSamples(diagnosticsSnapshot)) {
    return {
      assertion: {
        details: {
          entity,
          maxOffscreenRatio,
          minProjectedPixels,
          reason: "native-projected-bounds-unavailable",
          skipped: true
        },
        id: `visibility.${entity}`,
        pass: true
      }
    };
  }
  const bounds = isRecord(rendered?.projectedBounds) ? rendered.projectedBounds : void 0;
  const min = Array.isArray(bounds?.min) ? bounds.min : void 0;
  const max = Array.isArray(bounds?.max) ? bounds.max : void 0;
  const projectedPixels = min === void 0 || max === void 0 ? void 0 : Math.max(0, (Number(max[0]) - Number(min[0])) / 2 * viewport.width) * Math.max(0, (Number(max[1]) - Number(min[1])) / 2 * viewport.height);
  const offscreenRatio = min === void 0 || max === void 0 ? void 0 : projectedOffscreenRatio([Number(min[0]), Number(min[1])], [Number(max[0]), Number(max[1])]);
  const pass = rendered !== void 0 && bounds !== void 0 && (minProjectedPixels === void 0 || (projectedPixels ?? 0) >= minProjectedPixels) && (maxOffscreenRatio === void 0 || (offscreenRatio ?? 1) <= maxOffscreenRatio);
  const assertion = { details: { entity, maxOffscreenRatio, minProjectedPixels, offscreenRatio, projectedPixels }, id: `visibility.${entity}`, pass };
  return pass ? { assertion } : {
    assertion,
    diagnostic: {
      code: "TN_PLAYTEST_VISIBILITY_FAILED",
      message: `Entity '${entity}' did not satisfy projected visibility assertions.`,
      severity: "error",
      suggestion: "Check camera framing, clipping range, entity scale, and viewport-specific layout."
    }
  };
}
function projectedPixelsForEntity(snapshot, entity, viewport) {
  const rendered = renderedEntity(snapshot, entity);
  const bounds = isRecord(rendered?.projectedBounds) ? rendered.projectedBounds : void 0;
  const min = Array.isArray(bounds?.min) ? bounds.min : void 0;
  const max = Array.isArray(bounds?.max) ? bounds.max : void 0;
  return min === void 0 || max === void 0 ? void 0 : Math.max(0, (Number(max[0]) - Number(min[0])) / 2 * viewport.width) * Math.max(0, (Number(max[1]) - Number(min[1])) / 2 * viewport.height);
}
function countMatchingEntries(effectLog, tokens) {
  if (tokens.length === 0 || !isRecord(effectLog) || !Array.isArray(effectLog.entries)) {
    return 0;
  }
  return effectLog.entries.filter((entry) => {
    const text = JSON.stringify(entry);
    return tokens.every((token) => text.includes(token));
  }).length;
}
function mergeEffectLogs(effectLog, series) {
  return {
    entries: [effectLog, ...(series ?? []).map((sample) => sample.snapshot)].flatMap((log) => isRecord(log) && Array.isArray(log.entries) ? log.entries : [])
  };
}
function matchingOccludedRaycasts(effectLog, entity, target) {
  if (!isRecord(effectLog) || !Array.isArray(effectLog.entries)) return 0;
  return effectLog.entries.filter((entry) => {
    if (!isRecord(entry) || entry.service !== "render.sceneRayQuery" && entry.service !== "physics.raycast" || !isRecord(entry.payload) || !isRecord(entry.payload.result) || entry.payload.result.hit !== true) return false;
    const request = JSON.stringify(entry.payload.request ?? null);
    return (entity === void 0 || request.includes(entity)) && (target === void 0 || request.includes(target));
  }).length;
}
function summarizeMatchingEntries(effectLog, tokens) {
  if (tokens.length === 0 || !isRecord(effectLog) || !Array.isArray(effectLog.entries)) {
    return void 0;
  }
  const entries = effectLog.entries.filter((entry) => isRecord(entry)).filter((entry) => {
    const text = JSON.stringify(entry);
    return tokens.every((token) => text.includes(token));
  });
  if (entries.length === 0) {
    return void 0;
  }
  const systems = new Set(entries.map((entry) => typeof entry.system === "string" ? entry.system : void 0).filter((item) => item !== void 0));
  const firstSystem = [...systems][0];
  return {
    entryCount: entries.length,
    ...firstSystem === void 0 ? {} : { sourcePath: sourcePathForSystem(firstSystem), systemId: firstSystem },
    systems: systems.size === 0 ? "unknown systems" : [...systems].slice(0, 5).join(", ")
  };
}
function rotationDelta(effectLog, entityId) {
  if (!isRecord(effectLog) || !Array.isArray(effectLog.entries)) {
    return void 0;
  }
  const rotations = effectLog.entries.filter((entry) => isRecord(entry)).filter((entry) => entry.kind === "patch" && entry.command === "setComponent" && entry.component === "Transform" && entry.entity === entityId).map((entry) => readRotation(entry.value)).filter((item) => item !== void 0);
  const first = rotations[0];
  const last = rotations[rotations.length - 1];
  return first === void 0 || last === void 0 ? void 0 : vectorDistance(first, last);
}
function finalTiltDegrees(effectLog, entityId) {
  if (!isRecord(effectLog) || !Array.isArray(effectLog.entries)) return void 0;
  const rotation = effectLog.entries.filter((entry) => isRecord(entry)).filter((entry) => entry.kind === "patch" && entry.command === "setComponent" && entry.component === "Transform" && entry.entity === entityId).map((entry) => isRecord(entry.value) ? entry.value.rotation : void 0).filter((value) => Array.isArray(value) && value.length >= 4).at(-1);
  return tiltDegrees(rotation);
}
function tiltDegrees(rotation) {
  if (rotation === void 0) return void 0;
  const quaternion = rotation.slice(0, 4).map((value) => typeof value === "number" && Number.isFinite(value) ? value : Number.NaN);
  if (!quaternion.every(Number.isFinite)) return void 0;
  const [x, y, z, w] = quaternion;
  const length = Math.hypot(x, y, z, w);
  if (length <= Number.EPSILON) return void 0;
  const upDot = 1 - 2 * ((x / length) ** 2 + (z / length) ** 2);
  return Math.acos(Math.max(-1, Math.min(1, upDot))) * 180 / Math.PI;
}
function movementFacingEvidence(effectLog, entityId) {
  if (!isRecord(effectLog) || !Array.isArray(effectLog.entries)) {
    return { maxErrorDegrees: Number.POSITIVE_INFINITY, sampleCount: 0 };
  }
  let yaw;
  const errors = [];
  for (const entry of effectLog.entries) {
    if (!isRecord(entry)) continue;
    if (entry.kind === "patch" && entry.command === "setComponent" && entry.component === "Transform" && entry.entity === entityId) {
      yaw = yawFromTransform(entry.value) ?? yaw;
      continue;
    }
    if (entry.kind !== "service" || entry.service !== "character.move" || yaw === void 0 || !isRecord(entry.payload)) continue;
    const request = isRecord(entry.payload.request) ? entry.payload.request : void 0;
    const options = isRecord(request?.options) ? request.options : void 0;
    const direction = Array.isArray(options?.direction) ? options.direction : void 0;
    if (request?.entity !== entityId || direction === void 0 || typeof direction[0] !== "number" || typeof direction[1] !== "number") continue;
    const heading = Math.atan2(direction[0], direction[1]);
    errors.push(Math.abs(wrappedAngle(heading - yaw)) * 180 / Math.PI);
  }
  return {
    maxErrorDegrees: errors.length === 0 ? Number.POSITIVE_INFINITY : Math.max(...errors),
    sampleCount: errors.length
  };
}
function finalFacingAngleToEntity(effectLog, entityId, targetId) {
  if (!isRecord(effectLog) || !Array.isArray(effectLog.entries)) return void 0;
  let subject;
  let target;
  for (const entry of effectLog.entries) {
    if (!isRecord(entry)) continue;
    if (entry.kind === "service" && entry.service === "character.move" && isRecord(entry.payload)) {
      const result = isRecord(entry.payload.result) ? entry.payload.result : void 0;
      if (result?.entity === targetId) target = readVec3(result.resolved) ?? target;
      continue;
    }
    if (entry.kind !== "patch" || entry.command !== "setComponent" || entry.component !== "Transform") continue;
    if (entry.entity === entityId) {
      const position = isRecord(entry.value) ? readVec3(entry.value.position) : void 0;
      const yaw = yawFromTransform(entry.value);
      if (position !== void 0 && yaw !== void 0) subject = { position, yaw };
    } else if (entry.entity === targetId && isRecord(entry.value)) {
      target = readVec3(entry.value.position) ?? target;
    }
  }
  if (subject === void 0 || target === void 0) return void 0;
  const heading = Math.atan2(target[0] - subject.position[0], target[2] - subject.position[2]);
  return Math.abs(wrappedAngle(heading - subject.yaw)) * 180 / Math.PI;
}
function finalFacingAngleToPosition(effectLog, entityId, target) {
  if (!isRecord(effectLog) || !Array.isArray(effectLog.entries)) return void 0;
  let subject;
  for (const entry of effectLog.entries) {
    if (!isRecord(entry) || entry.kind !== "patch" || entry.command !== "setComponent" || entry.component !== "Transform" || entry.entity !== entityId) continue;
    const position = isRecord(entry.value) ? readVec3(entry.value.position) : void 0;
    const yaw = yawFromTransform(entry.value);
    if (position !== void 0 && yaw !== void 0) subject = { position, yaw };
  }
  if (subject === void 0) return void 0;
  const heading = Math.atan2(target[0] - subject.position[0], target[2] - subject.position[2]);
  return Math.abs(wrappedAngle(heading - subject.yaw)) * 180 / Math.PI;
}
function yawFromTransform(value) {
  if (!isRecord(value) || !Array.isArray(value.rotation) || value.rotation.length < 4) return void 0;
  const y = value.rotation[1];
  const w = value.rotation[3];
  return typeof y === "number" && Number.isFinite(y) && typeof w === "number" && Number.isFinite(w) ? 2 * Math.atan2(y, w) : void 0;
}
function wrappedAngle(value) {
  return Math.atan2(Math.sin(value), Math.cos(value));
}
function maxResolvedAxisDelta(effectLog, entityId, expectation, baseline) {
  if (!isRecord(effectLog) || !Array.isArray(effectLog.entries)) {
    return void 0;
  }
  const index = axisIndex(expectation.axis);
  const resolvedValues = effectLog.entries.filter((entry) => isRecord(entry)).filter((entry) => entry.kind === "service" && entry.service === "character.move").map((entry) => {
    const payload = isRecord(entry.payload) ? entry.payload : void 0;
    const result = isRecord(payload?.result) ? payload.result : void 0;
    return result?.entity === entityId ? readVec3(result.resolved) : void 0;
  }).filter((item) => item !== void 0);
  const first = baseline ?? resolvedValues[0];
  if (first === void 0 || resolvedValues.length === 0) {
    return void 0;
  }
  const sign = expectation.sign ?? 1;
  return Math.max(...resolvedValues.map((value) => (value[index] - first[index]) * sign));
}
function minimumResolvedDistance(effectLog, effectLogSeries, entityId, target, baseline, atStep) {
  const logs = [
    ...atStep === void 0 ? [effectLog] : [],
    ...Array.isArray(effectLogSeries) ? effectLogSeries.filter((item) => atStep === void 0 || isRecord(item) && item.label === atStep).map((item) => isRecord(item) ? item.snapshot : void 0) : []
  ];
  const positions = logs.flatMap((log) => isRecord(log) && Array.isArray(log.entries) ? log.entries : []).filter((entry) => isRecord(entry)).filter((entry) => entry.kind === "service" && entry.service === "character.move").map((entry) => {
    const payload = isRecord(entry.payload) ? entry.payload : void 0;
    const result = isRecord(payload?.result) ? payload.result : void 0;
    return result?.entity === entityId ? readVec3(result.resolved) : void 0;
  }).filter((item) => item !== void 0);
  if (baseline !== void 0 && atStep === void 0) positions.unshift(baseline);
  return positions.length === 0 ? void 0 : Math.min(...positions.map((position) => vectorDistance(position, target)));
}
function renderedEntity(runtimeDiagnosticsValue, entity) {
  if (!renderedEntitiesAreReported(runtimeDiagnosticsValue)) {
    return void 0;
  }
  return runtimeDiagnosticsValue.scene.renderedEntities.find((item) => isRecord(item) && item.id === entity);
}
function renderedEntitiesAreReported(runtimeDiagnosticsValue) {
  return isRecord(runtimeDiagnosticsValue) && isRecord(runtimeDiagnosticsValue.scene) && Array.isArray(runtimeDiagnosticsValue.scene.renderedEntities);
}
function hasNativeReadinessSamples(runtimeDiagnosticsValue) {
  return isRecord(runtimeDiagnosticsValue) && Array.isArray(runtimeDiagnosticsValue.readiness);
}
function projectedOffscreenRatio(min, max) {
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
function runtimeDiagnostics(value) {
  const snapshot = runtimeDiagnosticsSnapshot(value);
  if (snapshot !== value) {
    return runtimeDiagnostics(snapshot);
  }
  if (!isRecord(snapshot)) {
    return [];
  }
  const recentRuntimeErrors = Array.isArray(snapshot.recentRuntimeErrors) ? snapshot.recentRuntimeErrors : [];
  const resourceFailures = isRecord(snapshot.assets) && Array.isArray(snapshot.assets.resourceFailures) ? snapshot.assets.resourceFailures : [];
  return [...recentRuntimeErrors, ...resourceFailures];
}
function runtimeDiagnosticsSnapshot(value) {
  if (isRecord(value) && isRecord(value.diagnostics)) {
    return value.diagnostics;
  }
  return value;
}
function consoleErrors(entries) {
  return entries.filter((entry) => entry.type === "error" || entry.type === "assert");
}
function readPath(value, path) {
  if (path === void 0 || path.length === 0) {
    return value;
  }
  return path.split(".").reduce((current, part) => {
    if (Array.isArray(current) && /^(0|[1-9]\d*)$/u.test(part)) {
      return current[Number(part)];
    }
    if (!isRecord(current)) {
      return void 0;
    }
    return current[part];
  }, value);
}
function parseMovementAxisExpectation(value) {
  if (value === "x" || value === "y" || value === "z") {
    return { axis: value };
  }
  const match = /^([+-])([xyz])$/.exec(value);
  if (match === null) {
    return void 0;
  }
  return { axis: match[2], sign: match[1] === "-" ? -1 : 1 };
}
function axisIndex(axis) {
  return axis === "x" ? 0 : axis === "y" ? 1 : 2;
}
function textValue(value) {
  if (isRecord(value)) {
    return value.text ?? value.label ?? value.valueText ?? value.value;
  }
  return value;
}
function readRotation(value) {
  if (!isRecord(value) || !Array.isArray(value.rotation) || value.rotation.length < 3) {
    return void 0;
  }
  const rotation = value.rotation.slice(0, 3).map((item) => typeof item === "number" && Number.isFinite(item) ? item : Number.NaN);
  return rotation.every(Number.isFinite) ? rotation : void 0;
}
function readVec3(value) {
  if (!Array.isArray(value) || value.length < 3) {
    return void 0;
  }
  const vector = value.slice(0, 3).map((item) => typeof item === "number" && Number.isFinite(item) ? item : Number.NaN);
  return vector.every(Number.isFinite) ? vector : void 0;
}
function vectorDistance(left, right) {
  const dx = right[0] - left[0];
  const dy = right[1] - left[1];
  const dz = right[2] - left[2];
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}
function formatNumber(value) {
  return Number.isInteger(value) ? String(value) : value.toFixed(3);
}
function jsonEqual(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// src/diagnostics.ts
function playtestDiagnostic(code, message, instruction, details = {}) {
  return {
    ...details.capability === void 0 ? {} : { capability: details.capability },
    code,
    fix: {
      instruction,
      ...details.nextCommand === void 0 ? {} : { nextCommand: details.nextCommand }
    },
    message,
    ...details.path === void 0 ? {} : { path: details.path },
    severity: "error"
  };
}

// src/protocol.ts
var PLAYTEST_BRIDGE_GLOBAL = "__THREENATIVE_PLAYTEST_BRIDGE__";
var PLAYTEST_PROTOCOL_VERSION = 1;
var PLAYTEST_PROTOCOL_LIMITS = {
  maxEntitiesPerSample: 100,
  maxEventsPerDrain: 1e3,
  maxPayloadBytes: 1e6,
  operationTimeoutMs: 5e3
};
function jsonByteLength(value) {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}
function assertJsonSafe(value, path = "$") {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return;
  }
  if (typeof value === "number") {
    if (Number.isFinite(value)) {
      return;
    }
    throw new TypeError(`${path} must contain only finite JSON numbers.`);
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertJsonSafe(item, `${path}[${index}]`));
    return;
  }
  if (typeof value === "object") {
    for (const [key, item] of Object.entries(value)) {
      assertJsonSafe(item, `${path}.${key}`);
    }
    return;
  }
  throw new TypeError(`${path} must be JSON-safe.`);
}
var PlaytestScenarioError = class extends Error {
  constructor(diagnostic) {
    super(diagnostic.message);
    this.diagnostic = diagnostic;
  }
  diagnostic;
};
async function loadPlaytestScenario(projectPath, scenarioPath) {
  const absolutePath = resolve(projectPath, scenarioPath);
  let raw;
  try {
    raw = await readFile(absolutePath, "utf8");
  } catch {
    throw new PlaytestScenarioError({
      code: "TN_PLAYTEST_SCENARIO_NOT_FOUND",
      message: `Playtest scenario '${scenarioPath}' could not be read.`,
      severity: "error",
      suggestion: "Check the --scenario path. Committed playtest scenarios normally live under playtests/*.playtest.json."
    });
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new PlaytestScenarioError({
      code: "TN_PLAYTEST_SCENARIO_INVALID",
      message: `Playtest scenario '${scenarioPath}' is not valid JSON: ${error instanceof Error ? error.message : String(error)}.`,
      severity: "error",
      suggestion: "Fix the scenario JSON syntax and rerun tn playtest."
    });
  }
  const scenario = validatePlaytestScenario(parsed, scenarioPath, absolutePath);
  return hydrateReachabilityArtifact(projectPath, scenario, scenarioPath);
}
async function hydrateReachabilityArtifact(projectPath, scenario, scenarioPath) {
  const assertion = scenario.assert?.reachability;
  if (assertion === void 0) return scenario;
  let parsed;
  try {
    parsed = JSON.parse(await readFile(resolve(projectPath, assertion.artifact), "utf8"));
  } catch {
    throw invalidScenario(scenarioPath, `Reachability artifact '${assertion.artifact}' could not be read as JSON.`);
  }
  const envelope = reachabilityEnvelope(parsed);
  if (envelope === void 0) {
    throw invalidScenario(scenarioPath, `Reachability artifact '${assertion.artifact}' must contain finite non-negative maxRise, forwardReach, and fallDistanceToGround measurements.`);
  }
  return {
    ...scenario,
    assert: { ...scenario.assert, reachability: { ...assertion, envelope } }
  };
}
function reachabilityEnvelope(value) {
  if (!isRecord2(value)) return void 0;
  const measurement = isRecord2(value.jump) ? value.jump : value;
  return typeof measurement.maxRise === "number" && Number.isFinite(measurement.maxRise) && measurement.maxRise >= 0 && typeof measurement.forwardReach === "number" && Number.isFinite(measurement.forwardReach) && measurement.forwardReach >= 0 && typeof measurement.fallDistanceToGround === "number" && Number.isFinite(measurement.fallDistanceToGround) && measurement.fallDistanceToGround >= measurement.maxRise ? { fallDistanceToGround: measurement.fallDistanceToGround, forwardReach: measurement.forwardReach, maxRise: measurement.maxRise } : void 0;
}
function oneShotScenario(options) {
  return {
    assert: {
      ...options.expectMoved || options.expectAxis !== void 0 ? { movement: { axis: options.expectAxis, entity: options.subject, minDistance: options.expectMoved ? options.movementThreshold : void 0 } } : {},
      ...options.follow === void 0 ? {} : { camera: { entity: options.follow.entityId, follows: options.subject, within: options.follow.within } }
    },
    name: `${safeFilePart(options.subject)}-${safeFilePart(options.press)}`,
    schemaVersion: 1,
    steps: [{ holdFrames: options.frames, press: options.press, release: true }],
    subject: options.subject,
    target: options.target ?? "web",
    viewport: options.viewport ?? { height: 720, width: 1280 },
    warmupFrames: 0
  };
}
function applyScenarioOverrides(scenario, overrides) {
  return {
    ...scenario,
    ...overrides.target === void 0 ? {} : { target: overrides.target },
    ...overrides.viewport === void 0 ? {} : { viewport: overrides.viewport }
  };
}
function parsePlaytestTarget(value) {
  if (value === void 0) {
    return void 0;
  }
  return value === "web" || value === "desktop" || value === "bevy" ? value : void 0;
}
function parseViewport(value) {
  if (value === void 0) {
    return void 0;
  }
  const match = /^(\d+)x(\d+)$/.exec(value);
  if (match === null) {
    return void 0;
  }
  const width = Number(match[1]);
  const height = Number(match[2]);
  return Number.isInteger(width) && width > 0 && Number.isInteger(height) && height > 0 ? { height, width } : void 0;
}
function validatePlaytestScenario(value, scenarioPath, absolutePath) {
  if (!isRecord2(value)) {
    throw invalidScenario(scenarioPath, "Scenario root must be a JSON object.");
  }
  rejectUnknownKeys(value, [
    "acceptanceId",
    "artifacts",
    "assert",
    "inputDelivery",
    "name",
    "parity",
    "schemaVersion",
    "setup",
    "steps",
    "subject",
    "target",
    "viewport",
    "warmupFrames"
  ], scenarioPath, "scenario root");
  if (value.schemaVersion !== 1) {
    throw invalidScenario(scenarioPath, "Scenario schemaVersion must be 1.");
  }
  if (value.acceptanceId !== void 0 && (typeof value.acceptanceId !== "string" || value.acceptanceId.length === 0)) {
    throw invalidScenario(scenarioPath, "Scenario acceptanceId must be a non-empty string when present.");
  }
  const name = typeof value.name === "string" ? value.name : void 0;
  if (name === void 0 || !/^[A-Za-z0-9._-]+$/.test(name)) {
    throw invalidScenario(scenarioPath, "Scenario name must be a stable file-safe identifier.");
  }
  const target = value.target === void 0 ? "web" : value.target;
  if (target !== "web" && target !== "desktop" && target !== "bevy") {
    throw invalidScenario(scenarioPath, "Scenario target must be one of: web, desktop, bevy.");
  }
  const inputDelivery = value.inputDelivery ?? "deterministic";
  if (inputDelivery !== "deterministic" && inputDelivery !== "focused-dom") {
    throw invalidScenario(scenarioPath, "Scenario inputDelivery must be deterministic or focused-dom.");
  }
  if (value.assert !== void 0 && !isRecord2(value.assert)) {
    throw invalidScenario(scenarioPath, "Scenario assert must be a JSON object keyed by supported assertion kinds.");
  }
  if (!Array.isArray(value.steps) || value.steps.length === 0) {
    throw invalidStep(scenarioPath, "Scenario steps[] must contain at least one step.");
  }
  const steps = value.steps.map((step, index) => validateStep(step, scenarioPath, index));
  return {
    ...typeof value.acceptanceId === "string" ? { acceptanceId: value.acceptanceId } : {},
    ...isRecord2(value.artifacts) ? { artifacts: validateArtifacts(value.artifacts, scenarioPath) } : {},
    ...isRecord2(value.assert) ? { assert: validateAssertions(value.assert, scenarioPath) } : {},
    inputDelivery,
    name,
    ...isRecord2(value.parity) ? { parity: validateParityConfig(value.parity, scenarioPath) } : {},
    schemaVersion: 1,
    ...isRecord2(value.setup) ? { setup: validateSetup(value.setup, scenarioPath) } : {},
    ...absolutePath === void 0 ? {} : { sourcePath: absolutePath },
    steps,
    ...typeof value.subject === "string" ? { subject: value.subject } : {},
    target,
    viewport: validateViewport(value.viewport),
    warmupFrames: positiveInteger(value.warmupFrames) ?? 0
  };
}
function validateArtifacts(value, scenarioPath) {
  rejectUnknownKeys(value, ["console", "contactSheet", "effectLog", "network", "runtimeTrace", "screenshots"], scenarioPath, "artifacts");
  return value;
}
function validateParityConfig(value, scenarioPath) {
  rejectUnknownKeys(value, ["animation", "axisDelta", "compare", "contacts", "movementDistance", "resources", "targets"], scenarioPath, "parity");
  if (isRecord2(value.compare)) {
    rejectUnknownKeys(value.compare, ["animation", "axisDelta", "contacts", "movementDistance", "resources"], scenarioPath, "parity.compare");
  }
  return {
    ...Array.isArray(value.animation) ? { animation: value.animation.map(validateParityAnimation).filter((item) => item !== void 0) } : {},
    ...isRecord2(value.compare) ? validateParityCompare(value.compare) : validateParityCompare(value),
    ...Array.isArray(value.resources) ? { resources: value.resources.filter((item) => typeof item === "string") } : {},
    ...Array.isArray(value.targets) ? { targets: value.targets.filter((item) => item === "web" || item === "desktop" || item === "bevy") } : {}
  };
}
function validateParityCompare(value) {
  const movementDistance = isRecord2(value.movementDistance) && typeof value.movementDistance.maxDelta === "number" && Number.isFinite(value.movementDistance.maxDelta) ? { maxDelta: value.movementDistance.maxDelta } : void 0;
  const axisDelta = isRecord2(value.axisDelta) ? Object.fromEntries(Object.entries(value.axisDelta).filter(
    (entry) => (entry[0] === "x" || entry[0] === "y" || entry[0] === "z") && typeof entry[1] === "number" && Number.isFinite(entry[1])
  )) : void 0;
  const contacts = isRecord2(value.contacts) && typeof value.contacts.minSharedCount === "number" && Number.isFinite(value.contacts.minSharedCount) ? { minSharedCount: value.contacts.minSharedCount } : void 0;
  return {
    ...axisDelta !== void 0 && Object.keys(axisDelta).length > 0 ? { axisDelta } : {},
    ...Array.isArray(value.animation) ? { animation: value.animation.map(validateParityAnimation).filter((item) => item !== void 0) } : {},
    ...contacts === void 0 ? {} : { contacts },
    ...movementDistance === void 0 ? {} : { movementDistance },
    ...Array.isArray(value.resources) ? { resources: value.resources.filter((item) => typeof item === "string") } : {}
  };
}
function validateParityAnimation(value) {
  if (!isRecord2(value) || typeof value.entity !== "string") {
    return void 0;
  }
  return {
    ...typeof value.clip === "string" ? { clip: value.clip } : {},
    entity: value.entity,
    ...Array.isArray(value.requiredOn) ? { requiredOn: value.requiredOn.filter((item) => item === "web" || item === "desktop" || item === "bevy") } : {}
  };
}
function validateSetup(value, scenarioPath) {
  rejectUnknownKeys(value, ["entities", "resources"], scenarioPath, "setup");
  return {
    ...Array.isArray(value.entities) ? { entities: value.entities.map((entity, index) => validateSetupEntity(entity, scenarioPath, index)) } : {},
    ...Array.isArray(value.resources) ? { resources: value.resources.map((resource, index) => validateSetupResource(resource, scenarioPath, index)) } : {}
  };
}
function validateSetupResource(value, scenarioPath, index) {
  if (!isRecord2(value) || typeof value.id !== "string" || value.id.length === 0) {
    throw invalidScenario(scenarioPath, `Scenario setup.resources[${index}] must name a resource id.`);
  }
  rejectUnknownKeys(value, ["id", "path", "value"], scenarioPath, `setup.resources[${index}]`);
  if (!hasKey(value, "value")) {
    throw invalidScenario(scenarioPath, `Scenario setup.resources[${index}] must define value.`);
  }
  if (value.path !== void 0 && (typeof value.path !== "string" || value.path.split(".").some((part) => part.length === 0))) {
    throw invalidScenario(scenarioPath, `Scenario setup.resources[${index}].path must be a non-empty dot path when present.`);
  }
  return {
    id: value.id,
    ...typeof value.path === "string" ? { path: value.path } : {},
    value: value.value
  };
}
function validateSetupEntity(value, scenarioPath, index) {
  if (!isRecord2(value) || typeof value.entity !== "string" || value.entity.length === 0) {
    throw invalidScenario(scenarioPath, `Scenario setup.entities[${index}] must name an entity.`);
  }
  rejectUnknownKeys(value, ["entity", "position", "rotation", "scale"], scenarioPath, `setup.entities[${index}]`);
  const position = validateOptionalNumberTuple(value, "position", 3, scenarioPath, index);
  const rotation = validateOptionalNumberTuple(value, "rotation", 4, scenarioPath, index);
  const scale = validateOptionalNumberTuple(value, "scale", 3, scenarioPath, index);
  if (position === void 0 && rotation === void 0 && scale === void 0) {
    throw invalidScenario(scenarioPath, `Scenario setup.entities[${index}] must define position, rotation, or scale.`);
  }
  return {
    entity: value.entity,
    ...position === void 0 ? {} : { position },
    ...rotation === void 0 ? {} : { rotation },
    ...scale === void 0 ? {} : { scale }
  };
}
function validateStep(value, scenarioPath, index) {
  if (!isRecord2(value)) {
    throw invalidStep(scenarioPath, `Scenario step ${index} must be a JSON object.`);
  }
  rejectUnknownKeys(value, [
    "holdFrames",
    "holdTicks",
    "kind",
    "label",
    "overlayMessage",
    "pointerPosition",
    "press",
    "release",
    "screenshot",
    "waitFrames",
    "waitTicks",
    "window"
  ], scenarioPath, `steps[${index}]`);
  const press = typeof value.press === "string" && value.press.length > 0 ? value.press : void 0;
  const overlayMessage = isRecord2(value.overlayMessage) && typeof value.overlayMessage.overlayId === "string" && value.overlayMessage.overlayId.length > 0 && typeof value.overlayMessage.type === "string" && value.overlayMessage.type.length > 0 ? {
    overlayId: value.overlayMessage.overlayId,
    payload: value.overlayMessage.payload ?? {},
    type: value.overlayMessage.type
  } : void 0;
  const pointerPosition = isRecord2(value.pointerPosition) && typeof value.pointerPosition.x === "number" && Number.isFinite(value.pointerPosition.x) && value.pointerPosition.x >= 0 && value.pointerPosition.x <= 1 && typeof value.pointerPosition.y === "number" && Number.isFinite(value.pointerPosition.y) && value.pointerPosition.y >= 0 && value.pointerPosition.y <= 1 ? { x: value.pointerPosition.x, y: value.pointerPosition.y } : void 0;
  if (isRecord2(value.overlayMessage)) {
    rejectUnknownKeys(value.overlayMessage, ["overlayId", "payload", "type"], scenarioPath, `steps[${index}].overlayMessage`);
  }
  if (isRecord2(value.pointerPosition)) {
    rejectUnknownKeys(value.pointerPosition, ["x", "y"], scenarioPath, `steps[${index}].pointerPosition`);
  }
  const holdFrames = positiveInteger(value.holdFrames);
  const holdTicks = positiveInteger(value.holdTicks);
  const waitFrames = positiveInteger(value.waitFrames);
  const waitTicks = positiveInteger(value.waitTicks);
  const kind = value.kind === "wait" ? "wait" : value.kind === "input" ? "input" : void 0;
  const screenshot = typeof value.screenshot === "string" && /^[A-Za-z0-9._-]+$/.test(value.screenshot) ? value.screenshot : void 0;
  const window = isRecord2(value.window) && (value.window.operation === "minimize" || value.window.operation === "resize" || value.window.operation === "restore") && (value.window.operation !== "resize" || typeof value.window.width === "number" && Number.isFinite(value.window.width) && value.window.width >= 1 && typeof value.window.height === "number" && Number.isFinite(value.window.height) && value.window.height >= 1) ? {
    operation: value.window.operation,
    ...typeof value.window.width === "number" ? { width: value.window.width } : {},
    ...typeof value.window.height === "number" ? { height: value.window.height } : {}
  } : void 0;
  if (isRecord2(value.window)) {
    rejectUnknownKeys(value.window, ["height", "operation", "width"], scenarioPath, `steps[${index}].window`);
  }
  if (kind === "wait" && press !== void 0) {
    throw invalidStep(scenarioPath, `Scenario step ${index} kind wait cannot define press.`);
  }
  if (value.overlayMessage !== void 0 && overlayMessage === void 0) {
    throw invalidStep(scenarioPath, `Scenario step ${index} overlayMessage must define non-empty overlayId and type fields.`);
  }
  if (value.pointerPosition !== void 0 && pointerPosition === void 0) {
    throw invalidStep(scenarioPath, `Scenario step ${index} pointerPosition must define normalized x and y values from 0 through 1.`);
  }
  if (value.screenshot !== void 0 && screenshot === void 0) {
    throw invalidStep(scenarioPath, `Scenario step ${index} screenshot must be a stable file-safe name.`);
  }
  if (value.window !== void 0 && window === void 0) {
    throw invalidStep(scenarioPath, `Scenario step ${index} window must define minimize, restore, or resize with positive width and height.`);
  }
  if (press === void 0 && overlayMessage === void 0 && pointerPosition === void 0 && window === void 0 && waitFrames === void 0 && waitTicks === void 0) {
    throw invalidStep(scenarioPath, `Scenario step ${index} must define press, overlayMessage, pointerPosition, window, or waitFrames/waitTicks.`);
  }
  if (value.holdFrames !== void 0 && holdFrames === void 0) {
    throw invalidStep(scenarioPath, `Scenario step ${index} holdFrames must be a positive integer.`);
  }
  if (value.waitFrames !== void 0 && waitFrames === void 0) {
    throw invalidStep(scenarioPath, `Scenario step ${index} waitFrames must be a positive integer.`);
  }
  if (value.holdTicks !== void 0 && holdTicks === void 0) {
    throw invalidStep(scenarioPath, `Scenario step ${index} holdTicks must be a positive integer.`);
  }
  if (value.waitTicks !== void 0 && waitTicks === void 0) {
    throw invalidStep(scenarioPath, `Scenario step ${index} waitTicks must be a positive integer.`);
  }
  if (holdTicks !== void 0 && holdFrames !== void 0) {
    throw invalidStep(scenarioPath, `Scenario step ${index} must choose holdTicks or holdFrames, not both.`);
  }
  if (waitTicks !== void 0 && waitFrames !== void 0) {
    throw invalidStep(scenarioPath, `Scenario step ${index} must choose waitTicks or waitFrames, not both.`);
  }
  return {
    ...kind === void 0 ? {} : { kind },
    ...holdFrames === void 0 ? {} : { holdFrames },
    ...holdTicks === void 0 ? {} : { holdTicks },
    ...typeof value.label === "string" ? { label: value.label } : {},
    ...overlayMessage === void 0 ? {} : { overlayMessage },
    ...pointerPosition === void 0 ? {} : { pointerPosition },
    ...press === void 0 ? {} : { press },
    release: typeof value.release === "boolean" ? value.release : true,
    ...screenshot === void 0 ? {} : { screenshot },
    ...waitFrames === void 0 ? {} : { waitFrames },
    ...waitTicks === void 0 ? {} : { waitTicks },
    ...window === void 0 ? {} : { window }
  };
}
function playtestStepHoldTicks(step, fallback = 1) {
  return step.press === void 0 ? 0 : Math.max(1, step.holdTicks ?? step.holdFrames ?? fallback);
}
function playtestStepWaitTicks(step) {
  return Math.max(0, step.waitTicks ?? step.waitFrames ?? 0);
}
function validateAssertions(value, scenarioPath) {
  rejectUnknownKeys(value, PLAYTEST_ASSERTION_REGISTRY.map((entry) => entry.kind), scenarioPath, "assert");
  validateAssertionShapes(value, scenarioPath);
  validateAssertionKeys(value, scenarioPath);
  const movement = isRecord2(value.movement) ? value.movement : void 0;
  const camera = isRecord2(value.camera) ? value.camera : void 0;
  const diagnostics = isRecord2(value.diagnostics) ? value.diagnostics : void 0;
  if (diagnostics?.noRuntimeDiagnostics === false && (typeof diagnostics.runtimeDiagnosticsOptOutReason !== "string" || diagnostics.runtimeDiagnosticsOptOutReason.trim() === "")) {
    throw invalidScenario(
      scenarioPath,
      "Assertion 'assert.diagnostics.noRuntimeDiagnostics' may be false only when 'runtimeDiagnosticsOptOutReason' explains the bounded exception."
    );
  }
  return {
    ...Array.isArray(value.aerodynamics) ? { aerodynamics: value.aerodynamics.map(validateAerodynamicsAssertion).filter((item) => item !== void 0) } : {},
    ...Array.isArray(value.animation) ? { animation: value.animation.map(validateAnimationAssertion).filter((item) => item !== void 0) } : {},
    ...camera === void 0 ? {} : {
      camera: {
        ...typeof camera.entity === "string" ? { entity: camera.entity } : {},
        ...typeof camera.follows === "string" ? { follows: camera.follows } : {},
        ...typeof camera.targetInViewport === "boolean" ? { targetInViewport: camera.targetInViewport } : {},
        ...typeof camera.within === "number" && Number.isFinite(camera.within) ? { within: camera.within } : {}
      }
    },
    ...Array.isArray(value.components) ? { components: value.components.map(validateComponentAssertion).filter((item) => item !== void 0) } : {},
    ...Array.isArray(value.contacts) ? { contacts: value.contacts.map(validateContactAssertion).filter((item) => item !== void 0) } : {},
    ...diagnostics === void 0 ? {} : {
      diagnostics: {
        ...typeof diagnostics.noConsoleErrors === "boolean" ? { noConsoleErrors: diagnostics.noConsoleErrors } : {},
        ...typeof diagnostics.noNetworkErrors === "boolean" ? { noNetworkErrors: diagnostics.noNetworkErrors } : {},
        ...typeof diagnostics.noRuntimeDiagnostics === "boolean" ? { noRuntimeDiagnostics: diagnostics.noRuntimeDiagnostics } : {},
        ...typeof diagnostics.runtimeDiagnosticsOptOutReason === "string" ? { runtimeDiagnosticsOptOutReason: diagnostics.runtimeDiagnosticsOptOutReason } : {},
        ...typeof diagnostics.runtimeReady === "boolean" ? { runtimeReady: diagnostics.runtimeReady } : {}
      }
    },
    ...Array.isArray(value.hud) ? { hud: value.hud.map(validatePathAssertion).filter((item) => item !== void 0) } : {},
    ...movement === void 0 ? {} : {
      movement: {
        ...typeof movement.axis === "string" ? { axis: movement.axis } : {},
        ...isRecord2(movement.closesDistanceToPosition) && validateNumberTuple(movement.closesDistanceToPosition.position, 3) !== void 0 && typeof movement.closesDistanceToPosition.min === "number" && Number.isFinite(movement.closesDistanceToPosition.min) ? { closesDistanceToPosition: { position: validateNumberTuple(movement.closesDistanceToPosition.position, 3), min: movement.closesDistanceToPosition.min } } : {},
        ...typeof movement.entity === "string" ? { entity: movement.entity } : {},
        ...typeof movement.facesMovementWithinDegrees === "number" && Number.isFinite(movement.facesMovementWithinDegrees) ? { facesMovementWithinDegrees: movement.facesMovementWithinDegrees } : {},
        ...isRecord2(movement.minAxisDelta) && typeof movement.minAxisDelta.axis === "string" && typeof movement.minAxisDelta.min === "number" && Number.isFinite(movement.minAxisDelta.min) ? { minAxisDelta: { axis: movement.minAxisDelta.axis, min: movement.minAxisDelta.min } } : {},
        ...isRecord2(movement.minResolvedAxisDelta) && typeof movement.minResolvedAxisDelta.axis === "string" && typeof movement.minResolvedAxisDelta.min === "number" && Number.isFinite(movement.minResolvedAxisDelta.min) ? { minResolvedAxisDelta: { axis: movement.minResolvedAxisDelta.axis, min: movement.minResolvedAxisDelta.min } } : {},
        ...typeof movement.maxTiltDegrees === "number" && Number.isFinite(movement.maxTiltDegrees) && movement.maxTiltDegrees >= 0 && movement.maxTiltDegrees <= 180 ? { maxTiltDegrees: movement.maxTiltDegrees } : {},
        ...typeof movement.minDistance === "number" && Number.isFinite(movement.minDistance) ? { minDistance: movement.minDistance } : {},
        ...typeof movement.maxDistance === "number" && Number.isFinite(movement.maxDistance) && movement.maxDistance >= 0 ? { maxDistance: movement.maxDistance } : {},
        ...typeof movement.minVelocity === "number" && Number.isFinite(movement.minVelocity) ? { minVelocity: movement.minVelocity } : {},
        ...typeof movement.pathLength === "number" && Number.isFinite(movement.pathLength) && movement.pathLength >= 0 ? { pathLength: movement.pathLength } : {},
        ...isRecord2(movement.notFacing) && typeof movement.notFacing.entity === "string" && typeof movement.notFacing.minDegrees === "number" && Number.isFinite(movement.notFacing.minDegrees) ? { notFacing: { entity: movement.notFacing.entity, minDegrees: movement.notFacing.minDegrees } } : {},
        ...isRecord2(movement.notFacingPosition) && validateNumberTuple(movement.notFacingPosition.position, 3) !== void 0 && typeof movement.notFacingPosition.minDegrees === "number" && Number.isFinite(movement.notFacingPosition.minDegrees) ? { notFacingPosition: { position: validateNumberTuple(movement.notFacingPosition.position, 3), minDegrees: movement.notFacingPosition.minDegrees } } : {},
        ...isRecord2(movement.reachesPositionWithin) && validateNumberTuple(movement.reachesPositionWithin.position, 3) !== void 0 && typeof movement.reachesPositionWithin.maxDistance === "number" && Number.isFinite(movement.reachesPositionWithin.maxDistance) ? {
          reachesPositionWithin: {
            ...typeof movement.reachesPositionWithin.atStep === "string" ? { atStep: movement.reachesPositionWithin.atStep } : {},
            position: validateNumberTuple(movement.reachesPositionWithin.position, 3),
            maxDistance: movement.reachesPositionWithin.maxDistance
          }
        } : {},
        ...typeof movement.rotationChanged === "boolean" ? { rotationChanged: movement.rotationChanged } : {}
      }
    },
    ...Array.isArray(value.occluded) ? { occluded: value.occluded.map(validateOccludedAssertion).filter((item) => item !== void 0) } : {},
    ...Array.isArray(value.overlayNodes) ? { overlayNodes: value.overlayNodes.map(validateOverlayNodeAssertion).filter((item) => item !== void 0) } : {},
    ...isRecord2(value.reachability) ? { reachability: validateReachabilityAssertion(value.reachability, scenarioPath) } : {},
    ...Array.isArray(value.resources) ? { resources: value.resources.map(validatePathAssertion).filter((item) => item !== void 0) } : {},
    ...Array.isArray(value.settled) ? { settled: value.settled.map(validateSettledAssertion).filter((item) => item !== void 0) } : {},
    ...Array.isArray(value.states) ? { states: value.states.map((entry, index) => validateStateAssertion(entry, scenarioPath, `assert.states[${index}]`)) } : {},
    ...Array.isArray(value.tags) ? { tags: value.tags.map((entry, index) => validateTagCountAssertion(entry, scenarioPath, `assert.tags[${index}]`)) } : {},
    ...Array.isArray(value.visibility) ? { visibility: value.visibility.map(validateVisibilityAssertion).filter((item) => item !== void 0) } : {},
    ...Array.isArray(value.visual) ? { visual: value.visual.map(validateVisualAssertion).filter((item) => item !== void 0) } : {}
  };
}
function validateReachabilityAssertion(value, scenarioPath) {
  if (typeof value.artifact !== "string" || value.artifact.trim() === "") {
    throw invalidScenario(scenarioPath, "Assertion 'assert.reachability.artifact' must be a non-empty project-relative path.");
  }
  if (!Array.isArray(value.entities) || value.entities.length < 2 || value.entities.some((entity) => typeof entity !== "string" || entity.trim() === "")) {
    throw invalidScenario(scenarioPath, "Assertion 'assert.reachability.entities' must contain at least two non-empty entity ids.");
  }
  const entities = value.entities;
  if (entities.some((entity, index) => index > 0 && entity === entities[index - 1])) {
    throw invalidScenario(scenarioPath, "Assertion 'assert.reachability.entities' must not repeat a consecutive entity id.");
  }
  return {
    artifact: value.artifact,
    entities
  };
}
function validateSettledAssertion(value) {
  if (!isRecord2(value) || typeof value.entity !== "string" || value.entity.trim() === "") return void 0;
  const requiredOn = Array.isArray(value.requiredOn) ? value.requiredOn.filter((target) => target === "web" || target === "desktop" || target === "bevy") : void 0;
  return {
    ...typeof value.atStep === "string" ? { atStep: value.atStep } : {},
    ...typeof value.compareToStep === "string" ? { compareToStep: value.compareToStep } : {},
    entity: value.entity,
    ...typeof value.minBodies === "number" && Number.isInteger(value.minBodies) && value.minBodies > 0 ? { minBodies: value.minBodies } : {},
    ...typeof value.minMeanPoseDistance === "number" && Number.isFinite(value.minMeanPoseDistance) && value.minMeanPoseDistance > 0 ? { minMeanPoseDistance: value.minMeanPoseDistance } : {},
    ...requiredOn === void 0 ? {} : { requiredOn }
  };
}
function validateOverlayNodeAssertion(value) {
  if (!isRecord2(value) || typeof value.overlayId !== "string" || typeof value.selector !== "string") return void 0;
  return {
    ...typeof value.attribute === "string" ? { attribute: value.attribute } : {},
    ...hasKey(value, "equals") ? { equals: value.equals } : {},
    overlayId: value.overlayId,
    selector: value.selector,
    ...typeof value.textIncludes === "string" ? { textIncludes: value.textIncludes } : {},
    ...typeof value.visible === "boolean" ? { visible: value.visible } : {}
  };
}
function validateComponentAssertion(value) {
  if (!isRecord2(value) || typeof value.entity !== "string" || typeof value.component !== "string") {
    return void 0;
  }
  return {
    ...Array.isArray(value.atSteps) ? { atSteps: value.atSteps.flatMap((step) => isRecord2(step) && typeof step.label === "string" ? [{ ...hasKey(step, "equals") ? { equals: step.equals } : {}, label: step.label }] : []) } : {},
    ...typeof value.changed === "boolean" ? { changed: value.changed } : {},
    component: value.component,
    entity: value.entity,
    ...typeof value.allowTrivial === "boolean" ? { allowTrivial: value.allowTrivial } : {},
    ...hasKey(value, "equals") ? { equals: value.equals } : {},
    ...typeof value.gte === "number" && Number.isFinite(value.gte) ? { gte: value.gte } : {},
    ...typeof value.path === "string" ? { path: value.path } : {}
  };
}
function validateAssertionShapes(value, scenarioPath) {
  for (const entry of PLAYTEST_ASSERTION_REGISTRY) {
    const assertionValue = value[entry.kind];
    if (assertionValue === void 0) {
      continue;
    }
    const valid = entry.cardinality === "array" ? Array.isArray(assertionValue) : isRecord2(assertionValue);
    if (!valid) {
      throw invalidScenario(
        scenarioPath,
        `Assertion 'assert.${entry.kind}' must be ${entry.cardinality === "array" ? "an array" : "an object"}; the declared assertion cannot be executed.`
      );
    }
  }
}
function validateAerodynamicsAssertion(value) {
  if (!isRecord2(value) || typeof value.entity !== "string") return void 0;
  const controls = Array.isArray(value.controls) ? value.controls.flatMap((control) => isRecord2(control) && typeof control.surface === "string" && (control.sign === "negative" || control.sign === "positive") ? [{
    ...typeof control.minAbs === "number" && Number.isFinite(control.minAbs) && control.minAbs >= 0 ? { minAbs: control.minAbs } : {},
    sign: control.sign,
    surface: control.surface
  }] : []) : void 0;
  const torques = Array.isArray(value.torques) ? value.torques.flatMap((torque) => isRecord2(torque) && (torque.axis === "x" || torque.axis === "y" || torque.axis === "z") && typeof torque.label === "string" && (torque.sign === "negative" || torque.sign === "positive") ? [{
    axis: torque.axis,
    label: torque.label,
    ...typeof torque.minAbs === "number" && Number.isFinite(torque.minAbs) && torque.minAbs >= 0 ? { minAbs: torque.minAbs } : {},
    ...typeof torque.relativeToLabel === "string" ? { relativeToLabel: torque.relativeToLabel } : {},
    sign: torque.sign
  }] : []) : void 0;
  return {
    ...controls === void 0 ? {} : { controls },
    entity: value.entity,
    ...typeof value.minForceSamples === "number" && Number.isInteger(value.minForceSamples) && value.minForceSamples > 0 ? { minForceSamples: value.minForceSamples } : {},
    ...torques === void 0 ? {} : { torques }
  };
}
function validateOccludedAssertion(value) {
  if (!isRecord2(value)) {
    return void 0;
  }
  return {
    ...typeof value.entity === "string" ? { entity: value.entity } : {},
    ...typeof value.target === "string" ? { target: value.target } : {}
  };
}
function validateVisualAssertion(value) {
  if (!isRecord2(value)) return void 0;
  const frameDiff = isRecord2(value.frameDiff) ? value.frameDiff : void 0;
  const region = isRecord2(value.region) ? value.region : void 0;
  const entityVisible = isRecord2(value.entityVisible) ? value.entityVisible : void 0;
  const validRegion = region !== void 0 && [region.x, region.y, region.width, region.height].every((item) => typeof item === "number" && Number.isFinite(item));
  return {
    ...frameDiff === void 0 ? {} : { frameDiff: {
      ...isSafeProjectRelativePng(frameDiff.baselineImage) ? { baselineImage: frameDiff.baselineImage } : {},
      ...typeof frameDiff.minChangedPixelRatio === "number" ? { minChangedPixelRatio: frameDiff.minChangedPixelRatio } : {},
      ...typeof frameDiff.maxChangedPixelRatio === "number" ? { maxChangedPixelRatio: frameDiff.maxChangedPixelRatio } : {}
    } },
    ...validRegion ? { region: {
      height: Number(region.height),
      width: Number(region.width),
      x: Number(region.x),
      y: Number(region.y),
      ...typeof region.minNonblankPixelRatio === "number" ? { minNonblankPixelRatio: region.minNonblankPixelRatio } : {},
      ...typeof region.maxLuminance === "number" ? { maxLuminance: region.maxLuminance } : {},
      ...typeof region.minDarkPixelRatio === "number" ? { minDarkPixelRatio: region.minDarkPixelRatio } : {}
    } } : {},
    ...entityVisible !== void 0 && typeof entityVisible.entity === "string" && typeof entityVisible.minProjectedPixels === "number" ? { entityVisible: {
      entity: entityVisible.entity,
      minProjectedPixels: entityVisible.minProjectedPixels,
      ...typeof entityVisible.throughoutFrames === "boolean" ? { throughoutFrames: entityVisible.throughoutFrames } : {}
    } } : {}
  };
}
function isSafeProjectRelativePng(value) {
  if (typeof value !== "string" || !value.toLowerCase().endsWith(".png") || value.startsWith("/") || /^[A-Za-z]:[\\/]/.test(value)) {
    return false;
  }
  return !value.split(/[\\/]/).includes("..");
}
function describeValue(value) {
  if (value === null) return "null";
  if (Array.isArray(value)) return "an array";
  if (typeof value === "string") return `the string ${JSON.stringify(value)}`;
  return `${typeof value} ${JSON.stringify(value) ?? String(value)}`;
}
function requireRecord(value, scenarioPath, objectPath) {
  if (!isRecord2(value)) {
    throw invalidScenario(scenarioPath, `'${objectPath}' must be an object, received ${describeValue(value)}.`);
  }
  return value;
}
function requireString(value, key, scenarioPath, objectPath) {
  const raw = value[key];
  if (typeof raw !== "string" || raw.trim() === "") {
    throw invalidScenario(scenarioPath, `'${objectPath}.${key}' must be a non-empty string, received ${describeValue(raw)}.`);
  }
  return raw;
}
function optionalNonNegativeInteger(value, key, scenarioPath, objectPath) {
  const raw = value[key];
  if (raw === void 0) return void 0;
  if (typeof raw !== "number" || !Number.isInteger(raw) || raw < 0) {
    throw invalidScenario(scenarioPath, `'${objectPath}.${key}' must be a non-negative integer, received ${describeValue(raw)}.`);
  }
  return raw;
}
function present(key, value) {
  return value === void 0 ? {} : { [key]: value };
}
function validateStateAssertion(value, scenarioPath, objectPath) {
  const record2 = requireRecord(value, scenarioPath, objectPath);
  rejectUnknownKeys(record2, ["entity", "equals"], scenarioPath, objectPath);
  return {
    entity: requireString(record2, "entity", scenarioPath, objectPath),
    equals: requireString(record2, "equals", scenarioPath, objectPath)
  };
}
function validateTagCountAssertion(value, scenarioPath, objectPath) {
  const record2 = requireRecord(value, scenarioPath, objectPath);
  rejectUnknownKeys(record2, ["count", "gte", "tag"], scenarioPath, objectPath);
  return {
    ...present("count", optionalNonNegativeInteger(record2, "count", scenarioPath, objectPath)),
    ...present("gte", optionalNonNegativeInteger(record2, "gte", scenarioPath, objectPath)),
    tag: requireString(record2, "tag", scenarioPath, objectPath)
  };
}
function validateContactAssertion(value) {
  if (!isRecord2(value)) {
    return void 0;
  }
  return {
    ...typeof value.atStep === "string" ? { atStep: value.atStep } : {},
    ...typeof value.entity === "string" ? { entity: value.entity } : {},
    ...typeof value.kind === "string" ? { kind: value.kind } : {},
    ...typeof value.maxCount === "number" && Number.isInteger(value.maxCount) && value.maxCount >= 0 ? { maxCount: value.maxCount } : {},
    ...typeof value.minCount === "number" && Number.isFinite(value.minCount) ? { minCount: value.minCount } : {},
    ...Array.isArray(value.requiredOn) ? { requiredOn: value.requiredOn.filter((item) => item === "web" || item === "desktop" || item === "bevy") } : {},
    ...typeof value.with === "string" ? { with: value.with } : {}
  };
}
function validateAnimationAssertion(value) {
  if (!isRecord2(value)) {
    return void 0;
  }
  return {
    ...typeof value.advancedFrames === "number" && Number.isFinite(value.advancedFrames) ? { advancedFrames: value.advancedFrames } : {},
    ...typeof value.clip === "string" ? { clip: value.clip } : {},
    ...typeof value.entered === "boolean" ? { entered: value.entered } : {},
    ...typeof value.entity === "string" ? { entity: value.entity } : {}
  };
}
function validateVisibilityAssertion(value) {
  if (!isRecord2(value)) {
    return void 0;
  }
  return {
    ...typeof value.entity === "string" ? { entity: value.entity } : {},
    ...typeof value.maxOffscreenRatio === "number" && Number.isFinite(value.maxOffscreenRatio) ? { maxOffscreenRatio: value.maxOffscreenRatio } : {},
    ...typeof value.minProjectedPixels === "number" && Number.isFinite(value.minProjectedPixels) ? { minProjectedPixels: value.minProjectedPixels } : {}
  };
}
function validatePathAssertion(value) {
  if (!isRecord2(value) || typeof value.id !== "string") {
    return void 0;
  }
  return {
    ...Array.isArray(value.atSteps) ? { atSteps: value.atSteps.flatMap((step) => isRecord2(step) && typeof step.label === "string" ? [{ ...hasKey(step, "equals") ? { equals: step.equals } : {}, label: step.label, ...typeof step.textIncludes === "string" ? { textIncludes: step.textIncludes } : {} }] : []) } : {},
    ...typeof value.changed === "boolean" ? { changed: value.changed } : {},
    ...typeof value.allowTrivial === "boolean" ? { allowTrivial: value.allowTrivial } : {},
    ...hasKey(value, "equals") ? { equals: value.equals } : {},
    ...typeof value.gte === "number" && Number.isFinite(value.gte) ? { gte: value.gte } : {},
    id: value.id,
    ...typeof value.path === "string" ? { path: value.path } : {},
    ...typeof value.textIncludes === "string" ? { textIncludes: value.textIncludes } : {},
    ...typeof value.throughoutSteps === "boolean" ? { throughoutSteps: value.throughoutSteps } : {}
  };
}
function validateViewport(value) {
  if (!isRecord2(value)) {
    return { height: 720, width: 1280 };
  }
  const width = positiveInteger(value.width);
  const height = positiveInteger(value.height);
  return width === void 0 || height === void 0 ? { height: 720, width: 1280 } : { height, width };
}
function invalidScenario(scenarioPath, message) {
  return new PlaytestScenarioError({
    code: "TN_PLAYTEST_SCENARIO_INVALID",
    fix: {
      docs: "docs/workflows/playtest-proof.md",
      instruction: "Use playtest schemaVersion 1 with a file-safe name, target, viewport, warmupFrames, and non-empty steps.",
      snippet: '{ "schemaVersion": 1, "name": "forward-smoke", "target": "web", "viewport": { "width": 1280, "height": 720 }, "warmupFrames": 10, "steps": [{ "kind": "input", "press": "KeyW", "holdTicks": 30, "release": true }] }'
    },
    message: `Playtest scenario '${scenarioPath}' is invalid: ${message}`,
    severity: "error",
    suggestion: "Use schemaVersion 1 with a file-safe name, a supported target, and non-empty steps."
  });
}
function invalidStep(scenarioPath, message) {
  return new PlaytestScenarioError({
    code: "TN_PLAYTEST_SCENARIO_STEP_INVALID",
    fix: {
      docs: "docs/workflows/playtest-proof.md",
      instruction: "Give each step either a press with positive holdTicks/holdFrames or a positive waitTicks/waitFrames value; use kind: wait for an explicit no-input interval.",
      snippet: '{ "kind": "input", "press": "KeyW", "holdTicks": 30, "release": true }'
    },
    message: `Playtest scenario '${scenarioPath}' has an invalid step: ${message}`,
    severity: "error",
    suggestion: "Each step must define press or waitTicks/waitFrames; holdTicks/holdFrames and waitTicks/waitFrames must be positive integers."
  });
}
function positiveInteger(value) {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : void 0;
}
function validateOptionalNumberTuple(value, key, length, scenarioPath, index) {
  if (!hasKey(value, key)) {
    return void 0;
  }
  const tuple = length === 3 ? validateNumberTuple(value[key], 3) : validateNumberTuple(value[key], 4);
  if (tuple === void 0) {
    throw invalidScenario(scenarioPath, `Scenario setup.entities[${index}].${key} must be a ${length}-number tuple.`);
  }
  return tuple;
}
function validateNumberTuple(value, length) {
  if (!Array.isArray(value) || value.length !== length || !value.every((item) => typeof item === "number" && Number.isFinite(item))) {
    return void 0;
  }
  return value;
}
function safeFilePart(value) {
  return value.replace(/[^A-Za-z0-9._-]+/g, "-");
}
function isRecord2(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function hasKey(value, key) {
  return Object.prototype.hasOwnProperty.call(value, key);
}
function rejectUnknownKeys(value, allowedKeys, scenarioPath, objectPath) {
  const allowed = new Set(allowedKeys);
  const unknown = Object.keys(value).find((key) => !allowed.has(key));
  if (unknown !== void 0) {
    throw invalidScenario(
      scenarioPath,
      `Unknown key '${unknown}' at ${objectPath}.${unknown}. Supported keys: ${[...allowed].sort().join(", ")}.`
    );
  }
}
function validateAssertionKeys(value, scenarioPath) {
  for (const entry of PLAYTEST_ASSERTION_REGISTRY) {
    const assertionValue = value[entry.kind];
    if (assertionValue === void 0) {
      continue;
    }
    const items = Array.isArray(assertionValue) ? assertionValue : [assertionValue];
    items.forEach((item, index) => {
      if (!isRecord2(item)) {
        return;
      }
      const suffix = Array.isArray(assertionValue) ? `[${index}]` : "";
      rejectUnknownKeys(item, entry.fields.map((field) => field.name), scenarioPath, `assert.${entry.kind}${suffix}`);
      validateNestedAssertionKeys(entry.kind, item, scenarioPath, suffix);
    });
  }
}
function validateNestedAssertionKeys(kind, value, scenarioPath, suffix) {
  if (kind === "movement") {
    for (const field of ["minAxisDelta", "minResolvedAxisDelta"]) {
      if (isRecord2(value[field])) {
        rejectUnknownKeys(value[field], ["axis", "min"], scenarioPath, `assert.${kind}${suffix}.${field}`);
      }
    }
  }
  if (kind === "resources" || kind === "hud" || kind === "components") {
    if (Array.isArray(value.atSteps)) {
      value.atSteps.forEach((step, index) => {
        if (isRecord2(step)) {
          rejectUnknownKeys(step, kind === "components" ? ["equals", "label"] : ["equals", "label", "textIncludes"], scenarioPath, `assert.${kind}${suffix}.atSteps[${index}]`);
        }
      });
    }
  }
  if (kind === "visual") {
    const fields = {
      entityVisible: ["entity", "minProjectedPixels", "throughoutFrames"],
      frameDiff: ["baselineImage", "maxChangedPixelRatio", "minChangedPixelRatio"],
      region: ["height", "maxLuminance", "minDarkPixelRatio", "minNonblankPixelRatio", "width", "x", "y"]
    };
    for (const [field, keys] of Object.entries(fields)) {
      if (isRecord2(value[field])) {
        rejectUnknownKeys(value[field], keys, scenarioPath, `assert.${kind}${suffix}.${field}`);
      }
    }
  }
  if (kind === "aerodynamics") {
    const arrays = {
      controls: ["minAbs", "sign", "surface"],
      torques: ["axis", "label", "minAbs", "relativeToLabel", "sign"]
    };
    for (const [field, keys] of Object.entries(arrays)) {
      const entries = value[field];
      if (Array.isArray(entries)) {
        entries.forEach((item, index) => {
          if (isRecord2(item)) {
            rejectUnknownKeys(item, keys, scenarioPath, `assert.${kind}${suffix}.${field}[${index}]`);
          }
        });
      }
    }
  }
}

export { PLAYTEST_ASSERTION_REGISTRY, PLAYTEST_BRIDGE_GLOBAL, PLAYTEST_CAPABILITY_REGISTRY, PLAYTEST_PROTOCOL_LIMITS, PLAYTEST_PROTOCOL_VERSION, PLAYTEST_SETUP_REGISTRY, PlaytestScenarioError, applyScenarioOverrides, assertJsonSafe, evaluateRichPlaytestAssertions, jsonByteLength, loadPlaytestScenario, missingPlaytestCapabilities, oneShotScenario, overlayNodeObservationKey, parsePlaytestTarget, parseViewport, playtestDiagnostic, playtestStepHoldTicks, playtestStepWaitTicks, requiredPlaytestCapabilities, unknownPlaytestCapabilities };
//# sourceMappingURL=index.js.map
//# sourceMappingURL=index.js.map
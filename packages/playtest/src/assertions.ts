import type { IPlaytestDiagnosticsPolicy, IPlaytestReport } from "./report.js";
import type { IPlaytestRuntimeDiagnosticsSample } from "./protocol.js";
import type { IPlaytestAnimationAssertion, IPlaytestComponentAssertion, IPlaytestContactAssertion, IPlaytestDiagnosticsAssertion, IPlaytestPathAssertion, IPlaytestPerformanceAssertion, IPlaytestResourceAnyOfAssertion, IPlaytestScenario, IPlaytestSignalAssertion, IPlaytestStateAssertion, IPlaytestTagCountAssertion, IPlaytestVisibilityAssertion, IPlaytestWorldAssertion, PlaytestTarget } from "./scenario.js";
import type { PlaytestCapability } from "./capabilities.js";

type Vec3 = [number, number, number];

export interface IPlaytestAssertionSchemaField {
  description: string;
  name: string;
  required?: boolean;
  type: string;
}

export interface IPlaytestAssertionSchemaEntry {
  cardinality: "array" | "object";
  description: string;
  example: unknown;
  fields: IPlaytestAssertionSchemaField[];
  kind: keyof NonNullable<IPlaytestScenario["assert"]>;
  observationPath: string;
  requiredCapabilities: readonly PlaytestCapability[];
  resultIdPrefix: string;
  supportedOn: readonly PlaytestTarget[];
  triviality: "not-applicable" | "reject-initial-value";
  trivialityRationale: string;
}

export const PLAYTEST_ASSERTION_REGISTRY: readonly IPlaytestAssertionSchemaEntry[] = [
  {
    description: "Samples the framebuffer on every render frame inside a labeled loading window and requires every coarse-grid RGB sample to match the declared backdrop.",
    example: {
      framebufferCoverage: {
        backdrop: [5, 7, 11],
        grid: { columns: 32, rows: 18 },
        tolerance: 8,
        window: { endStep: "loading-end", startStep: "loading-start" },
      },
    },
    fields: [
      { description: "Backdrop RGB byte channels every sampled pixel must match.", name: "backdrop", required: true, type: "[integer 0..255, integer 0..255, integer 0..255]" },
      { description: "Coarse sample grid. Defaults to 32x18, which catches the loading leak while limiting synchronous readback work.", name: "grid", type: "{ columns: positive integer <= 256, rows: positive integer <= 256 }" },
      { description: "Maximum absolute difference allowed for each RGB channel.", name: "tolerance", required: true, type: "integer 0..255" },
      { description: "Inclusive labeled-step boundaries for the loading-covered interval.", name: "window", required: true, type: "{ startStep: string, endStep: string }" },
    ],
    cardinality: "object",
    kind: "framebufferCoverage",
    observationPath: "framebufferCoverage",
    requiredCapabilities: ["browser.screenshot"],
    resultIdPrefix: "framebufferCoverage",
    supportedOn: ["web", "desktop", "bevy"],
    triviality: "not-applicable",
    trivialityRationale: "It samples a window-wide framebuffer over a labeled loading interval; a static initial value cannot satisfy the temporal pixel-evidence contract.",
  },
  {
    description: "Checks every consecutive platform against a measured static movement-envelope fit; it does not simulate traversal, walls, ceilings, run-up, or air control.",
    example: { reachability: { artifact: "artifacts/character-envelope/player.json", entities: ["platform.a", "platform.b"] } },
    fields: [
      { description: "Project-relative character envelope artifact emitted by tn character envelope.", name: "artifact", required: true, type: "string" },
      { description: "Ordered platform entity ids forming the critical path.", name: "entities", required: true, type: "string[] (minimum 2)" },
    ],
    cardinality: "object",
    kind: "reachability",
    observationPath: "entityTransforms",
    requiredCapabilities: ["entity.observe"],
    resultIdPrefix: "reachability.",
    supportedOn: ["web", "desktop", "bevy"],
    triviality: "not-applicable",
    trivialityRationale: "It compares authored platform geometry with a measured movement envelope; no runtime initial value is asserted.",
  },
  {
    description: "Proves aerodynamic force telemetry and signed control-surface delivery for a flight entity.",
    example: { aerodynamics: [{ controls: [{ sign: "negative", surface: "elevator" }], entity: "aircraft", minForceSamples: 4 }] },
    fields: [
      { description: "Aerodynamic entity id.", name: "entity", required: true, type: "string" },
      { description: "Minimum physics-debug samples containing finite aerodynamic force vectors.", name: "minForceSamples", type: "positive integer" },
      { description: "Signed surface values required in physics.aerodynamics.setInputs calls.", name: "controls", type: "Array<{ surface: string, sign: 'negative' | 'positive', minAbs?: number }>" },
      { description: "Signed net aerodynamic torque, optionally relative to another labeled step.", name: "torques", type: "Array<{ label: string, relativeToLabel?: string, axis: 'x' | 'y' | 'z', sign: 'negative' | 'positive', minAbs?: number }>" },
    ],
    cardinality: "array",
    kind: "aerodynamics",
    observationPath: "physicsDebugSeries",
    requiredCapabilities: ["runtime.fixedStep", "runtime.physics"],
    resultIdPrefix: "aerodynamics.",
    supportedOn: ["web", "desktop", "bevy"],
    triviality: "not-applicable",
    trivialityRationale: "It requires force telemetry and signed control delivery across samples; no held initial scalar can satisfy the proof.",
  },
  {
    description: "Proves screenshot change, populated regions, and sustained projected entity visibility.",
    example: { visual: [{ frameDiff: { baselineImage: "artifacts/baseline.png", minChangedPixelRatio: 0.01 }, entityVisible: { entity: "board.e4", minProjectedPixels: 20, throughoutFrames: true } }] },
    fields: [
      { description: "Before/after or baseline-image changed-pixel ratio bounds.", name: "frameDiff", type: "{ baselineImage?: project-relative PNG, minChangedPixelRatio?: number, maxChangedPixelRatio?: number }" },
      { description: "Pixel region that must remain populated and may require dark-pixel occupancy.", name: "region", type: "{ x: number, y: number, width: number, height: number, minNonblankPixelRatio?: number, minDarkPixelRatio?: number, maxLuminance?: number }" },
      { description: "Entity projected-pixel floor, optionally across all captured samples.", name: "entityVisible", type: "{ entity: string, minProjectedPixels: number, throughoutFrames?: boolean }" },
    ],
    cardinality: "array",
    kind: "visual",
    observationPath: "visual",
    requiredCapabilities: ["browser.screenshot"],
    resultIdPrefix: "visual.",
    supportedOn: ["web"],
    triviality: "not-applicable",
    trivialityRationale: "It requires screenshot evidence from a capture; the initial scene alone cannot satisfy its frame-difference or region contract.",
  },
  {
    description: "Proves the subject moved, reached a minimum velocity, or changed rotation during held input.",
    example: { movement: { entity: "player", minDistance: 0.5, minVelocity: 0.01, rotationChanged: true } },
    fields: [
      { description: "Optional entity id to measure; when omitted, choose an observed mover.", name: "entity", type: "string" },
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
      { description: "Require any observed rotation delta.", name: "rotationChanged", type: "boolean" },
    ],
    cardinality: "object",
    kind: "movement",
    observationPath: "runtimeObservations",
    requiredCapabilities: ["entity.observe"],
    resultIdPrefix: "movement.",
    supportedOn: ["web", "desktop", "bevy"],
    triviality: "not-applicable",
    trivialityRationale: "It measures transform displacement under scenario input; an initial pose cannot itself prove movement.",
  },
  {
    description: "Proves a camera follows an entity or keeps a target in view.",
    example: { camera: { entity: "camera.main", follows: "player", within: 10, targetInViewport: true } },
    fields: [
      { description: "Camera entity id.", name: "entity", type: "string" },
      { description: "Entity the camera should follow.", name: "follows", type: "string" },
      { description: "Maximum allowed separation.", name: "within", type: "number" },
      { description: "Require the target to be visible in the viewport.", name: "targetInViewport", type: "boolean" },
    ],
    cardinality: "object",
    kind: "camera",
    observationPath: "runtimeDiagnostics",
    requiredCapabilities: ["camera.observe", "entity.observe"],
    resultIdPrefix: "camera",
    supportedOn: ["web", "desktop", "bevy"],
    triviality: "not-applicable",
    trivialityRationale: "It checks a camera-to-target relationship from runtime observations; the registry keeps this relationship outside the held-value guard.",
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
      { description: "Maximum numeric value.", name: "lte", type: "number" },
      { description: "Require before and after values to differ or remain equal.", name: "changed", type: "boolean" },
      { description: "Expected values at named scenario-step samples.", name: "atSteps", type: "Array<{ label: string, equals: json }>" },
      { description: "Written reason for a held invariant whose initial value intentionally satisfies the assertion.", name: "allowTrivial", type: "triviality reason" },
    ],
    cardinality: "array",
    kind: "components",
    observationPath: "components",
    requiredCapabilities: ["runtime.components"],
    resultIdPrefix: "component.",
    supportedOn: ["web", "desktop", "bevy"],
    triviality: "reject-initial-value",
    trivialityRationale: "A component comparator can pass on its initial snapshot, so initial satisfaction must be rejected unless a written held-invariant reason is recorded.",
  },
  {
    description: "Proves resource state after the scenario through equals, gte, lte, textIncludes, or changed checks.",
    example: { resources: [{ id: "GameState", path: "score", gte: 1, changed: true }] },
    fields: [
      { description: "Resource id.", name: "id", required: true, type: "string" },
      { description: "Optional dot path inside the resource snapshot.", name: "path", type: "string" },
      { description: "Exact expected value.", name: "equals", type: "json" },
      { description: "Minimum numeric value.", name: "gte", type: "number" },
      { description: "Maximum numeric value.", name: "lte", type: "number" },
      { description: "Substring expected in the observed value.", name: "textIncludes", type: "string" },
      { description: "Require before and after values to differ or remain equal.", name: "changed", type: "boolean" },
      { description: "Require the value assertion after every labeled scenario step.", name: "throughoutSteps", type: "boolean" },
      { description: "Expected values at named scenario-step samples.", name: "atSteps", type: "Array<{ label: string, equals?: json, textIncludes?: string }>" },
      { description: "Written reason for a held invariant whose initial value intentionally satisfies the assertion.", name: "allowTrivial", type: "triviality reason" },
      { description: "Require at least one alternative path assertion on this resource id.", name: "anyOf", type: "Array<{ path: string, equals?: json, gte?: number, lte?: number, textIncludes?: string, changed?: boolean }>" },
    ],
    cardinality: "array",
    kind: "resources",
    observationPath: "resources",
    requiredCapabilities: ["runtime.resources"],
    resultIdPrefix: "resource.",
    supportedOn: ["web", "desktop", "bevy"],
    triviality: "reject-initial-value",
    trivialityRationale: "A resource comparator can pass on its initial snapshot, so initial satisfaction must be rejected unless a written held-invariant reason is recorded.",
  },
  {
    description: "Proves the final count of entities carrying a bounded runtime tag.",
    example: { tags: [{ tag: "coin", count: 10 }] },
    fields: [
      { description: "Entity tag to count.", name: "tag", required: true, type: "string" },
      { description: "Exact expected entity count.", name: "count", type: "non-negative integer" },
      { description: "Minimum expected entity count.", name: "gte", type: "non-negative integer" },
      { description: "Maximum expected entity count.", name: "lte", type: "non-negative integer" },
      { description: "Written reason for a held invariant whose initial value intentionally satisfies the assertion.", name: "allowTrivial", type: "triviality reason" },
    ],
    cardinality: "array",
    kind: "tags",
    observationPath: "runtimeObservations",
    requiredCapabilities: ["runtime.tags"],
    resultIdPrefix: "tags.",
    supportedOn: ["web", "desktop", "bevy"],
    triviality: "reject-initial-value",
    trivialityRationale: "A tag count can already equal its expected initial count; the scenario must prove a transition or document why that count is intentionally held.",
  },
  {
    description: "Proves a named Godot signal was emitted by the application during the run or at a labeled step.",
    example: { signals: [{ name: "collected", entity: "player", minCount: 3, atStep: "last-coin" }] },
    fields: [
      { description: "Retained step label to inspect instead of the full signal history.", name: "atStep", type: "string" },
      { description: "Entity id that emitted the signal.", name: "entity", type: "string" },
      { description: "Maximum number of matching signals; use zero to prove separation.", name: "maxCount", type: "non-negative integer" },
      { description: "Minimum number of matching signals.", name: "minCount", type: "non-negative integer" },
      { description: "Godot signal name emitted by the application.", name: "name", required: true, type: "string" },
    ],
    cardinality: "array",
    kind: "signals",
    observationPath: "signals",
    requiredCapabilities: ["runtime.events"],
    resultIdPrefix: "signal.",
    supportedOn: ["web", "desktop", "bevy"],
    triviality: "not-applicable",
    trivialityRationale: "It requires an emitted signal event; an initial state contains no matching event evidence to satisfy the assertion.",
  },
  {
    description: "Proves an observed entity's final runtime-owned state-machine state.",
    example: { states: [{ equals: "completed" }] },
    fields: [
      { description: "Optional entity id; when omitted, choose an observed state candidate.", name: "entity", type: "string" },
      { description: "Expected current state name.", name: "equals", required: true, type: "string" },
      { description: "Written reason for a held invariant whose initial value intentionally satisfies the assertion.", name: "allowTrivial", type: "triviality reason" },
    ],
    cardinality: "array",
    kind: "states",
    observationPath: "runtimeObservations",
    requiredCapabilities: ["runtime.state"],
    resultIdPrefix: "states.",
    supportedOn: ["web", "desktop", "bevy"],
    triviality: "reject-initial-value",
    trivialityRationale: "An entity can already be in the expected state at step zero; the scenario must prove a transition or document why the state is held.",
  },
  {
    description: "Proves retained UI/HUD text or values after the scenario.",
    example: { hud: [{ id: "score-label", textIncludes: "Score" }] },
    fields: [
      { description: "UI node id.", name: "id", required: true, type: "string" },
      { description: "Optional dot path inside the UI snapshot.", name: "path", type: "string" },
      { description: "Exact expected value.", name: "equals", type: "json" },
      { description: "Minimum numeric value.", name: "gte", type: "number" },
      { description: "Maximum numeric value.", name: "lte", type: "number" },
      { description: "Substring expected in the observed value.", name: "textIncludes", type: "string" },
      { description: "Require before and after values to differ or remain equal.", name: "changed", type: "boolean" },
      { description: "Written reason for a held invariant whose initial value intentionally satisfies the assertion.", name: "allowTrivial", type: "triviality reason" },
    ],
    cardinality: "array",
    kind: "hud",
    observationPath: "hud",
    requiredCapabilities: ["runtime.ui"],
    resultIdPrefix: "hud.",
    supportedOn: ["web"],
    triviality: "reject-initial-value",
    trivialityRationale: "A HUD value can satisfy its comparator before input, so initial satisfaction must be rejected unless a written held-invariant reason is recorded.",
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
      { description: "Expected computed visibility.", name: "visible", type: "boolean" },
    ],
    cardinality: "array",
    kind: "overlayNodes",
    observationPath: "overlayNodes",
    requiredCapabilities: ["browser.dom"],
    resultIdPrefix: "overlayNode.",
    supportedOn: ["web"],
    triviality: "not-applicable",
    trivialityRationale: "It reads a declared overlay DOM snapshot; the registry does not treat browser overlay setup state as a gameplay held invariant.",
  },
  {
    description: "Proves console, network, runtime, and readiness diagnostics stayed clean.",
    example: { diagnostics: { noConsoleErrors: true, noNetworkErrors: true, noRuntimeDiagnostics: true, runtimeReady: true } },
    fields: [
      { description: "Fail on captured console errors.", name: "noConsoleErrors", type: "boolean" },
      { description: "Fail on captured network errors.", name: "noNetworkErrors", type: "boolean" },
      { description: "Fail on runtime diagnostics.", name: "noRuntimeDiagnostics", type: "boolean" },
      { description: "Required bounded justification when noConsoleErrors is false.", name: "consoleErrorsOptOutReason", type: "non-empty string" },
      { description: "Required bounded justification when noNetworkErrors is false.", name: "networkErrorsOptOutReason", type: "non-empty string" },
      { description: "Required bounded justification when noRuntimeDiagnostics is false.", name: "runtimeDiagnosticsOptOutReason", type: "non-empty string" },
      { description: "Require runtime readiness.", name: "runtimeReady", type: "boolean" },
    ],
    cardinality: "object",
    kind: "diagnostics",
    observationPath: "runtimeDiagnostics",
    requiredCapabilities: ["browser.console", "browser.network", "runtime.diagnostics"],
    resultIdPrefix: "diagnostics",
    supportedOn: ["web"],
    triviality: "not-applicable",
    trivialityRationale: "It evaluates captured error and readiness channels across the run; no initial scalar value can satisfy those diagnostics by itself.",
  },
  {
    description: "Proves a live render sample exists and optionally bounds frame time, draw calls, and triangles.",
    example: { performance: { maxDrawCalls: 100, maxFrameMsP95: 33, maxTriangles: 10_000 } },
    fields: [
      { description: "Maximum nearest-rank 95th-percentile frame time in milliseconds.", name: "maxFrameMsP95", type: "number" },
      { description: "Maximum observed renderer draw-call count.", name: "maxDrawCalls", type: "number" },
      { description: "Maximum observed renderer triangle count.", name: "maxTriangles", type: "number" },
    ],
    cardinality: "object",
    kind: "performance",
    observationPath: "performanceSeries",
    requiredCapabilities: ["runtime.performance"],
    resultIdPrefix: "performance.",
    supportedOn: ["web", "desktop", "bevy"],
    triviality: "not-applicable",
    trivialityRationale: "It reads aggregate render samples such as frame time and draw calls; an initial value cannot stand in for the measured series.",
  },
  {
    description: "Proves projected entity visibility in the viewport.",
    example: { visibility: [{ entity: "player", minProjectedPixels: 1200, maxOffscreenRatio: 0.05 }] },
    fields: [
      { description: "Entity id. Defaults to scenario subject.", name: "entity", type: "string" },
      { description: "Minimum projected pixel area.", name: "minProjectedPixels", type: "number" },
      { description: "Maximum allowed offscreen ratio.", name: "maxOffscreenRatio", type: "number" },
      { description: "Require the entity to be registered in the sampled scene.", name: "present", type: "boolean" },
      { description: "Written reason for a held invariant whose initial value intentionally satisfies the assertion.", name: "allowTrivial", type: "triviality reason" },
    ],
    cardinality: "array",
    kind: "visibility",
    observationPath: "runtimeDiagnostics",
    requiredCapabilities: ["entity.bounds"],
    resultIdPrefix: "visibility.",
    supportedOn: ["web"],
    triviality: "reject-initial-value",
    trivialityRationale: "An entity can be present and in-frame before input; the scenario must prove visibility after its setup or document why that presence is held.",
  },
  {
    description: "Proves runtime world metadata exposed by the application bridge.",
    example: { world: { seed: 90210 } },
    fields: [
      { description: "Expected configured deterministic seed, or null when unseeded.", name: "seed", required: true, type: "json" },
      { description: "Expected deterministic replay runtime fingerprint.", name: "runtime", type: "object" },
    ],
    cardinality: "object",
    kind: "world",
    observationPath: "runtimeObservations",
    requiredCapabilities: ["runtime.world"],
    resultIdPrefix: "world.",
    supportedOn: ["web", "desktop", "bevy"],
    triviality: "not-applicable",
    trivialityRationale: "It checks configured world identity and runtime fingerprint data; those environment facts are not a mutable assertion value.",
  },
  {
    description: "Proves contact or trigger evidence appeared in the effect log.",
    example: { contacts: [{ entity: "player", with: "pickup", kind: "trigger", minCount: 1 }] },
    fields: [
      { description: "Retained step label to inspect instead of the full observation history.", name: "atStep", type: "string" },
      { description: "Optional entity id; when omitted, choose an observed contact candidate.", name: "entity", type: "string" },
      { description: "Other entity or tag token expected in the contact evidence.", name: "with", type: "string" },
      { description: "Contact kind token, such as contact or trigger.", name: "kind", type: "string" },
      { description: "Minimum number of matching observations.", name: "minCount", type: "number" },
      { description: "Maximum number of matching observations; use zero to prove separation.", name: "maxCount", type: "non-negative integer" },
      { description: "Targets on which the contact assertion is required.", name: "requiredOn", type: "Array<'web' | 'desktop' | 'bevy'>" },
    ],
    cardinality: "array",
    kind: "contacts",
    observationPath: "runtimeObservations",
    requiredCapabilities: ["runtime.contacts"],
    resultIdPrefix: "contact.",
    supportedOn: ["web", "desktop", "bevy"],
    triviality: "not-applicable",
    trivialityRationale: "It requires retained contact evidence from the run; a pre-existing value cannot manufacture an emitted contact event.",
  },
  {
    description: "Proves an observed cohort of matching physics bodies is asleep in a retained physics-debug sample.",
    example: { settled: [{ atStep: "fall-and-settle", minBodies: 15 }] },
    fields: [
      { description: "Optional exact entity id or stable entity-id prefix; when omitted, choose an observed cohort.", name: "entity", type: "string" },
      { description: "Optional labeled step whose physics-debug sample must be used.", name: "atStep", type: "string" },
      { description: "Minimum number of matching bodies required.", name: "minBodies", type: "positive integer" },
      { description: "Optional earlier labeled step whose matching body positions are compared.", name: "compareToStep", type: "string" },
      { description: "Minimum mean body-position distance from compareToStep, in metres.", name: "minMeanPoseDistance", type: "positive number" },
      { description: "Targets on which the settled assertion is required.", name: "requiredOn", type: "Array<'web' | 'desktop' | 'bevy'>" },
      { description: "Written reason for a held invariant whose initial value intentionally satisfies the assertion.", name: "allowTrivial", type: "triviality reason" },
    ],
    cardinality: "array",
    kind: "settled",
    observationPath: "physicsDebugSeries",
    triviality: "reject-initial-value",
    trivialityRationale: "A body can begin asleep and already satisfy the settled bounds; the scenario must prove settling or document why the rest state is held.",
    requiredCapabilities: ["runtime.physics"],
    resultIdPrefix: "settled.",
    supportedOn: ["web", "desktop", "bevy"],
  },
  {
    description: "Proves rendered scene geometry occludes the segment between an origin entity and target.",
    example: { occluded: [{ entity: "listener", target: "emitter" }] },
    fields: [
      { description: "Optional origin/listener entity token expected in the raycast request.", name: "entity", type: "string" },
      { description: "Optional target/emitter entity token expected in the raycast request.", name: "target", type: "string" },
      { description: "Written reason for a held invariant whose initial value intentionally satisfies the assertion.", name: "allowTrivial", type: "triviality reason" },
    ],
    cardinality: "array",
    kind: "occluded",
    observationPath: "effectLog",
    requiredCapabilities: ["runtime.physics"],
    resultIdPrefix: "occluded.",
    supportedOn: ["web", "desktop", "bevy"],
    triviality: "reject-initial-value",
    trivialityRationale: "A static scene can already produce the requested occlusion; the scenario must prove the ray result or document why the occlusion is held.",
  },
  {
    description: "Proves animation evidence appeared in the effect log or runtime observation.",
    example: { animation: [{ entity: "player", clip: "run", entered: true, advancedFrames: 5, finished: false }] },
    fields: [
      { description: "Entity id. Defaults to scenario subject.", name: "entity", type: "string" },
      { description: "Animation clip id or name.", name: "clip", type: "string" },
      { description: "Require entering the animation state.", name: "entered", type: "boolean" },
      { description: "Require animation advancement evidence.", name: "advancedFrames", type: "number" },
      { description: "Require the observed clip to report its completion state.", name: "finished", type: "boolean" },
      { description: "Written reason for a held invariant whose initial value intentionally satisfies the assertion.", name: "allowTrivial", type: "triviality reason" },
    ],
    cardinality: "array",
    kind: "animation",
    observationPath: "runtimeObservations",
    requiredCapabilities: ["runtime.animation"],
    resultIdPrefix: "animation.",
    supportedOn: ["web", "desktop", "bevy"],
    triviality: "reject-initial-value",
    trivialityRationale: "A clip can already be playing at the first sample; an entered assertion must prove a transition or document why the clip is held.",
  },
] as const;

export interface IPlaytestSetupSchemaEntry {
  description: string;
  kind: keyof NonNullable<IPlaytestScenario["setup"]>;
  requiredCapabilities: readonly PlaytestCapability[];
}

export const PLAYTEST_SETUP_REGISTRY: readonly IPlaytestSetupSchemaEntry[] = [
  {
    description: "Applies bounded transforms to registered entities before input.",
    kind: "entities",
    requiredCapabilities: ["entity.setup"],
  },
  {
    description: "Writes bounded JSON-safe application state before input.",
    kind: "resources",
    requiredCapabilities: ["runtime.resources"],
  },
] as const;

export function requiredPlaytestCapabilities(scenario: IPlaytestScenario): PlaytestCapability[] {
  const required = new Set<PlaytestCapability>();
  if (scenario.steps.some((step) => step.kind !== "wait" && (step.press !== undefined || step.pointerPosition !== undefined || step.pointers !== undefined))) {
    required.add("browser.input");
  }
  if (scenario.artifacts?.screenshots !== false) {
    required.add("browser.screenshot");
  }
  for (const entry of PLAYTEST_ASSERTION_REGISTRY) {
    if (scenario.assert?.[entry.kind] !== undefined) {
      if (entry.kind === "diagnostics") {
        const policy = scenario.assert.diagnostics;
        if (policy?.noConsoleErrors === true) required.add("browser.console");
        if (policy?.noNetworkErrors === true) required.add("browser.network");
        if (policy?.noRuntimeDiagnostics !== false) required.add("runtime.diagnostics");
      } else {
        entry.requiredCapabilities.forEach((capability) => required.add(capability));
      }
    }
  }
  for (const entry of PLAYTEST_SETUP_REGISTRY) {
    if (scenario.setup?.[entry.kind] !== undefined) {
      entry.requiredCapabilities.forEach((capability) => required.add(capability));
    }
  }
  return [...required].sort();
}

export interface IPlaytestDiagnostic {
  artifactPath?: string;
  code: string;
  exportName?: string;
  gate?: "waived-headless";
  message: string;
  modulePath?: string;
  observedRuntimePath?: string;
  path?: string;
  resourceId?: string;
  severity: "error" | "warning";
  sourcePath?: string;
  suggestion?: string;
  systemId?: string;
}

export interface IPlaytestAssertionResult {
  details?: Record<string, unknown>;
  id: string;
  pass: boolean;
}

export interface IPlaytestObservations {
  animation?: unknown;
  components?: Record<string, Record<string, { after?: unknown; before?: unknown }>>;
  componentSeries?: Array<{ label: string; snapshots: Record<string, Record<string, unknown>>; tick: number }>;
  console: Array<{ source?: "browser-console" | "page-error" | "unhandled-rejection"; text: string; type: string }>;
  contacts?: unknown;
  debugColliderCount?: number;
  effectLog?: unknown;
  effectLogBefore?: unknown;
  effectLogSeries?: Array<{ label: string; snapshot: unknown; tick: number }>;
  entityTransforms?: Record<string, { halfExtents?: Vec3; position?: Vec3; scale?: Vec3 }>;
  framebufferCoverage?: IPlaytestFramebufferCoverageObservation;
  hud: Record<string, { after?: unknown; before?: unknown }>;
  overlayNodes?: Record<string, { after?: unknown; before?: unknown }>;
  network: Array<{ method: string; url: string }>;
  physicsDebug?: unknown;
  physicsDebugBefore?: unknown;
  physicsDebugSeries?: Array<{ label: string; snapshot: unknown; tick: number }>;
  performanceSeries?: unknown[];
  resources: Record<string, { after?: unknown; before?: unknown }>;
  resourceSeries?: Array<{ label: string; snapshots: Record<string, unknown>; tick: number }>;
  runtimeObservations?: unknown;
  runtimeDiagnostics?: unknown;
  runtimeDiagnosticsBefore?: unknown;
  signals?: unknown[];
  signalSeries?: Array<{ label: string; signals: unknown[]; tick: number }>;
  visibility?: Record<string, unknown>;
  visual?: {
    captureFailure?: { code: "TN_CAPTURE_BLANK"; label: string; reason: string };
    changedPixelRatio?: number;
    comparisonSource?: string;
    nonblankRegions?: Array<{ darkPixelRatio?: number; height: number; nonblankPixelRatio: number; width: number; x: number; y: number }>;
    /** Visual frame observations only; performance samples live in performanceSeries. */
    runtimeDiagnosticsSeries?: unknown[];
  };
}

export function resolveDiagnosticsPolicy(
  policy: IPlaytestDiagnosticsAssertion | undefined,
): IPlaytestDiagnosticsPolicy {
  return {
    ...(policy?.consoleErrorsOptOutReason === undefined ? {} : { consoleErrorsOptOutReason: policy.consoleErrorsOptOutReason }),
    ...(policy?.networkErrorsOptOutReason === undefined ? {} : { networkErrorsOptOutReason: policy.networkErrorsOptOutReason }),
    noConsoleErrors: policy?.noConsoleErrors ?? true,
    noNetworkErrors: policy?.noNetworkErrors ?? true,
    noRuntimeDiagnostics: policy?.noRuntimeDiagnostics ?? true,
    ...(policy?.runtimeReady === undefined ? {} : { runtimeReady: policy.runtimeReady }),
    ...(policy?.runtimeDiagnosticsOptOutReason === undefined ? {} : { runtimeDiagnosticsOptOutReason: policy.runtimeDiagnosticsOptOutReason }),
  };
}

export interface IPlaytestFramebufferCoverageObservation {
  boundarySource: "scenario-steps" | "video-backdrop-dominance";
  firstViolation?: {
    frameIndex: number;
    grid: {
      columns: number;
      rows: number;
      samples: Array<[number, number, number]>;
    };
    screenshotPath: string;
  };
  frameCount: number;
  unreadableReason?: string;
  windowCompleted: boolean;
  windowStarted: boolean;
}

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
        suggestion: "On headless Linux, prefix the command with xvfb-run -a -s '-screen 0 1600x900x24'.",
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

function trivialAssertionDiagnostic(id: string, path: string | undefined, before: unknown, sourcePath: string | undefined): IPlaytestDiagnostic {
  return {
    code: "TN_PLAYTEST_ASSERTION_TRIVIAL",
    message: `Assertion '${id}'${path === undefined ? "" : ` at path '${path}'`} was already satisfied before the scenario ran (value ${JSON.stringify(before)}).`,
    path,
    severity: "error",
    ...(sourcePath === undefined ? {} : { sourcePath }),
    suggestion: "Drive the asserted value from a failing initial state, or assert changed:true. If the value is genuinely a held invariant, allowTrivial takes the reason it is held — it is recorded in the report and counted against the run.",
  };
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

function componentAssertionDiagnostic(assertion: IPlaytestComponentAssertion, before: unknown, after: unknown): IPlaytestDiagnostic {
  return {
    code: "TN_PLAYTEST_COMPONENT_ASSERTION_FAILED",
    message: `Component '${assertion.component}' on entity '${assertion.entity}'${assertion.path === undefined ? "" : ` path '${assertion.path}'`} did not satisfy the assertion.`,
    observedRuntimePath: `observations.json/components/${assertion.entity}/${assertion.component}`,
    severity: "error",
    suggestion: `Expected ${JSON.stringify(assertion)}, observed before=${JSON.stringify(before)} after=${JSON.stringify(after)}. Check the owning script and runtime component synchronization.`,
  };
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

function finiteVector(value: unknown): boolean {
  return Array.isArray(value) && value.length === 3 && value.every((item) => typeof item === "number" && Number.isFinite(item));
}

function record(value: unknown): Record<string, unknown> | undefined {
  return isRecord(value) ? value : undefined;
}

function expectedPathAssertion(assertion: IPlaytestPathAssertion): Record<string, unknown> {
  return {
    ...(assertion.atSteps === undefined ? {} : { atSteps: assertion.atSteps }),
    ...(Object.hasOwn(assertion, "equals") ? { equals: assertion.equals } : {}),
    ...(assertion.gte === undefined ? {} : { gte: assertion.gte }),
    ...(assertion.lte === undefined ? {} : { lte: assertion.lte }),
    ...(assertion.textIncludes === undefined ? {} : { textIncludes: assertion.textIncludes }),
    ...(assertion.throughoutSteps === undefined ? {} : { throughoutSteps: assertion.throughoutSteps }),
    ...(assertion.changed === undefined ? {} : { changed: assertion.changed }),
    ...(assertion.allowTrivial === undefined ? {} : { allowTrivial: assertion.allowTrivial }),
  };
}

function unchangedPathValue(before: unknown, after: unknown): boolean {
  return before !== undefined && after !== undefined && jsonEqual(before, after);
}

function pathAssertionDiagnostic(
  kind: "hud" | "resource",
  assertion: IPlaytestPathAssertion,
  before: unknown,
  after: unknown,
  context: { effectLog?: unknown; movedDistance?: number; scenarioSourcePath?: string },
): IPlaytestDiagnostic {
  const unchanged = unchangedPathValue(before, after);
  if (kind === "resource" && unchanged && (context.movedDistance ?? 0) > 0.01) {
    const summary = summarizeResourceEffectLog(context.effectLog, assertion.id, assertion.path);
    return {
      code: "TN_PLAYTEST_RESOURCE_STATE_STAGNATED",
      message: `Resource '${assertion.id}'${assertion.path === undefined ? "" : ` path '${assertion.path}'`} did not change after the scenario moved the subject ${formatNumber(context.movedDistance ?? 0)} units.`,
      artifactPath: "effect-log.json",
      observedRuntimePath: `effect-log.json/entries[kind=resource,resource=${assertion.id}]`,
      path: assertion.path === undefined ? `${context.scenarioSourcePath ?? "playtest"}/assert/resources/${assertion.id}` : `${context.scenarioSourcePath ?? "playtest"}/assert/resources/${assertion.id}/${assertion.path}`,
      resourceId: assertion.id,
      severity: "error",
      ...(context.scenarioSourcePath === undefined ? {} : { sourcePath: context.scenarioSourcePath }),
      ...(summary?.systemId === undefined ? {} : { systemId: summary.systemId, sourcePath: summary.sourcePath }),
      suggestion: summary === undefined
        ? "The scenario movement path executed but the asserted resource never changed. Capture effect-log.json, then check pickup/contact predicates, route coordinates, resource write declarations, and stale duplicate systems before rerunning."
        : `The scenario movement path executed and effect-log.json shows ${summary.entryCount} '${assertion.id}' resource snapshot(s) from ${summary.systems}; observed values stayed ${summary.distinctValues}. Check pickup/contact predicates, route coordinates, resource write declarations, and stale duplicate systems in the listed system(s).`,
    };
  }
  return {
    code: "",
    message: `${kind === "hud" ? "HUD" : "Resource"} assertion failed for '${assertion.id}'${assertion.path === undefined ? "" : ` path '${assertion.path}'`}.`,
    severity: "error",
    suggestion: unchanged
      ? `${kind === "hud" ? "Observed HUD value" : "Observed resource value"} did not change during the scenario. Inspect effect-log.json for the owning system's resource writes, run tn build --project . --json for undeclared writes, and check whether duplicate/stale systems or route/collision setup prevented the state transition.`
      : kind === "hud" ? "Check UI binding IDs and whether the backing resource changes during the scenario." : "Check resource IDs, script writes, and assertion path spelling.",
  };
}

function summarizeResourceEffectLog(effectLog: unknown, resourceId: string, path: string | undefined): { distinctValues: string; entryCount: number; sourcePath?: string; systemId?: string; systems: string } | undefined {
  if (!isRecord(effectLog) || !Array.isArray(effectLog.entries)) {
    return undefined;
  }
  const entries = effectLog.entries
    .filter((entry): entry is Record<string, unknown> => isRecord(entry))
    .filter((entry) => entry.kind === "resource" && entry.resource === resourceId);
  if (entries.length === 0) {
    return undefined;
  }
  const systems = new Set<string>();
  const values = new Set<string>();
  for (const entry of entries) {
    if (typeof entry.system === "string") {
      systems.add(entry.system);
    }
    values.add(shortJson(readPath(entry.value, path)));
  }
  return {
    distinctValues: Array.from(values).slice(0, 3).join(", "),
    entryCount: entries.length,
    ...([...(systems)].at(0) === undefined ? {} : { sourcePath: sourcePathForSystem([...(systems)][0] as string), systemId: [...(systems)][0] as string }),
    systems: systems.size === 0 ? "unknown systems" : Array.from(systems).slice(0, 5).join(", "),
  };
}

function sourcePathForSystem(systemId: string): string {
  return `content/systems/${systemId}.systems.json`;
}

function shortJson(value: unknown): string {
  const text = JSON.stringify(value);
  if (text === undefined) {
    return "undefined";
  }
  return text.length > 120 ? `${text.slice(0, 117)}...` : text;
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

function runtimeDiagnostics(value: unknown): unknown[] {
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

function runtimeDiagnosticsSnapshot(value: unknown): unknown {
  if (isRecord(value) && isRecord(value.diagnostics)) {
    return value.diagnostics;
  }
  return value;
}

function consoleErrors(entries: Array<{ type: string }>): Array<{ type: string }> {
  return entries.filter((entry) => entry.type === "error" || entry.type === "assert" || entry.type === "pageerror");
}

function readPath(value: unknown, path: string | undefined): unknown {
  if (path === undefined || path.length === 0) {
    return value;
  }
  return path.split(".").reduce<unknown>((current, part) => {
    if (Array.isArray(current) && /^(0|[1-9]\d*)$/u.test(part)) {
      return current[Number(part)];
    }
    if (!isRecord(current)) {
      return undefined;
    }
    return current[part];
  }, value);
}

type MovementAxis = "x" | "y" | "z";

function parseMovementAxisExpectation(value: string): { axis: MovementAxis; sign?: 1 | -1 } | undefined {
  if (value === "x" || value === "y" || value === "z") {
    return { axis: value };
  }
  const match = /^([+-])([xyz])$/.exec(value);
  if (match === null) {
    return undefined;
  }
  return { axis: match[2] as MovementAxis, sign: match[1] === "-" ? -1 : 1 };
}

function axisIndex(axis: MovementAxis): 0 | 1 | 2 {
  return axis === "x" ? 0 : axis === "y" ? 1 : 2;
}

function textValue(value: unknown): unknown {
  if (isRecord(value)) {
    return value.text ?? value.label ?? value.valueText ?? value.value;
  }
  return value;
}

function readRotation(value: unknown): Vec3 | undefined {
  if (!isRecord(value) || !Array.isArray(value.rotation) || value.rotation.length < 3) {
    return undefined;
  }
  const rotation = value.rotation.slice(0, 3).map((item) => typeof item === "number" && Number.isFinite(item) ? item : Number.NaN);
  return rotation.every(Number.isFinite) ? rotation as Vec3 : undefined;
}

function readVec3(value: unknown): Vec3 | undefined {
  if (!Array.isArray(value) || value.length < 3) {
    return undefined;
  }
  const vector = value.slice(0, 3).map((item) => typeof item === "number" && Number.isFinite(item) ? item : Number.NaN);
  return vector.every(Number.isFinite) ? vector as Vec3 : undefined;
}

function vectorDistance(left: Vec3, right: Vec3): number {
  const dx = right[0] - left[0];
  const dy = right[1] - left[1];
  const dz = right[2] - left[2];
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(3);
}

function jsonEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

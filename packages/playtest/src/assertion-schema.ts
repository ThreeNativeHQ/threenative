import type { IPlaytestScenario, PlaytestTarget } from "./scenario.js";
import type { PlaytestCapability } from "./capabilities.js";

export type IPlaytestAssertionSchemaPrimitive = string | number | boolean | null;

export type IPlaytestAssertionSchemaRule =
  | {
      fields: readonly string[];
      kind: "requireOneOf";
      message?: string;
    }
  | {
      equals: IPlaytestAssertionSchemaPrimitive;
      field: string;
      kind: "requireWhen";
      message?: string;
      required: string;
    }
  | {
      field: string;
      kind: "nonEmptyArray";
      message?: string;
    }
  | {
      field: string;
      kind: "noConsecutiveDuplicates";
      message?: string;
    }
  | {
      fields: readonly string[];
      kind: "requireOneOfOrTrue";
      message?: string;
      trueFields: readonly string[];
    };

export type IPlaytestAssertionSchemaConstraint =
  | { kind: "boolean" }
  | {
      integer?: boolean;
      kind: "number";
      max?: number;
      min?: number;
      minExclusive?: boolean;
    }
  | {
      format?: "project-relative-png";
      kind: "string";
      minNonWhitespace?: number;
      nonEmpty?: boolean;
    }
  | { kind: "json" }
  | {
      items: IPlaytestAssertionSchemaConstraint;
      kind: "array";
      maxItems?: number;
      minItems?: number;
    }
  | {
      items: readonly IPlaytestAssertionSchemaConstraint[];
      kind: "tuple";
    }
  | {
      fields: readonly IPlaytestAssertionSchemaField[];
      kind: "record";
      rules?: readonly IPlaytestAssertionSchemaRule[];
      unknownKeys?: "allow" | "reject";
    }
  | {
      kind: "literal";
      values: readonly IPlaytestAssertionSchemaPrimitive[];
    }
  | {
      discriminator?: { field: string; presentVariant: number };
      kind: "union";
      variants: readonly IPlaytestAssertionSchemaConstraint[];
    };

export interface IPlaytestAssertionSchemaField {
  constraints: IPlaytestAssertionSchemaConstraint;
  description: string;
  name: string;
  required?: boolean;
  type: string;
}

export interface IPlaytestAssertionSchemaVariant {
  excludeFields?: readonly string[];
  fields?: readonly string[];
  requiredFields?: readonly string[];
  rules?: readonly IPlaytestAssertionSchemaRule[];
}

export interface IPlaytestAssertionSchemaEntry {
  cardinality: "array" | "object";
  description: string;
  example: unknown;
  fields: readonly IPlaytestAssertionSchemaField[];
  kind: keyof NonNullable<IPlaytestScenario["assert"]>;
  minItems?: number;
  minItemsMessage?: string;
  observationPath: string;
  requiredCapabilities: readonly PlaytestCapability[];
  resultIdPrefix: string;
  rules?: readonly IPlaytestAssertionSchemaRule[];
  supportedOn: readonly PlaytestTarget[];
  triviality: "not-applicable" | "reject-initial-value";
  trivialityRationale: string;
  variants?: readonly IPlaytestAssertionSchemaVariant[];
  discriminator?: { field: string; presentVariant: number };
}

interface IRawPlaytestAssertionSchemaField extends Omit<IPlaytestAssertionSchemaField, "constraints"> {
  constraints?: IPlaytestAssertionSchemaConstraint;
}

interface IRawPlaytestAssertionSchemaEntry extends Omit<IPlaytestAssertionSchemaEntry, "fields"> {
  fields: readonly IRawPlaytestAssertionSchemaField[];
}

function splitTypeExpression(value: string, separator = ","): string[] {
  const parts: string[] = [];
  let start = 0;
  let angle = 0;
  let bracket = 0;
  let brace = 0;
  let quote: "'" | '"' | undefined;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (quote !== undefined) {
      if (character === quote && value[index - 1] !== "\\") quote = undefined;
      continue;
    }
    if (character === "'" || character === '"') {
      quote = character;
      continue;
    }
    if (character === "<" && value[index + 1] !== "=") angle += 1;
    if (character === ">" && value[index - 1] !== "=") angle -= 1;
    if (character === "[") bracket += 1;
    if (character === "]") bracket -= 1;
    if (character === "{") brace += 1;
    if (character === "}") brace -= 1;
    if (character === separator && angle === 0 && bracket === 0 && brace === 0) {
      parts.push(value.slice(start, index).trim());
      start = index + 1;
    }
  }
  const final = value.slice(start).trim();
  if (final.length > 0) parts.push(final);
  return parts;
}

function findTypeDelimiter(value: string, delimiter: string): number {
  let angle = 0;
  let bracket = 0;
  let brace = 0;
  let quote: "'" | '"' | undefined;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (quote !== undefined) {
      if (character === quote && value[index - 1] !== "\\") quote = undefined;
      continue;
    }
    if (character === "'" || character === '"') {
      quote = character;
      continue;
    }
    if (character === "<" && value[index + 1] !== "=") angle += 1;
    if (character === ">" && value[index - 1] !== "=") angle -= 1;
    if (character === "[") bracket += 1;
    if (character === "]") bracket -= 1;
    if (character === "{") brace += 1;
    if (character === "}") brace -= 1;
    if (character === delimiter && angle === 0 && bracket === 0 && brace === 0) return index;
  }
  return -1;
}

function rawField(
  name: string,
  type: string,
  constraints: IPlaytestAssertionSchemaConstraint,
  required = false,
): IPlaytestAssertionSchemaField {
  return { constraints, description: "", name, required, type };
}

function parseTypeExpression(type: string): IPlaytestAssertionSchemaConstraint {
  const normalized = type.trim();
  if (normalized === "boolean") return { kind: "boolean" };
  if (normalized === "json") return { kind: "json" };
  if (normalized === "non-empty string") return { kind: "string", nonEmpty: true };
  if (normalized === "triviality reason") return { kind: "string", minNonWhitespace: 20 };
  if (normalized === "project-relative PNG") {
    return { format: "project-relative-png", kind: "string", nonEmpty: true };
  }
  if (normalized === "string") return { kind: "string", nonEmpty: true };
  if (normalized === "number") return { kind: "number" };
  if (normalized === "non-negative number") return { kind: "number", min: 0 };
  if (normalized === "positive number") return { kind: "number", min: 0, minExclusive: true };
  if (normalized === "positive integer") return { integer: true, kind: "number", min: 1 };
  if (normalized === "non-negative integer") return { integer: true, kind: "number", min: 0 };
  if (normalized === "number in [0, 180]") return { kind: "number", max: 180, min: 0 };
  const boundedInteger = /^integer ([-+]?\d+)\.\.([-+]?\d+)$/u.exec(normalized);
  if (boundedInteger !== null) {
    return { integer: true, kind: "number", max: Number(boundedInteger[2]), min: Number(boundedInteger[1]) };
  }
  const boundedPositiveInteger = /^positive integer <= (\d+)$/u.exec(normalized);
  if (boundedPositiveInteger !== null) {
    return { integer: true, kind: "number", max: Number(boundedPositiveInteger[1]), min: 1 };
  }
  if (normalized === "object") return { fields: [], kind: "record", unknownKeys: "allow" };

  const minimumArray = /^(.*)\[\] \(minimum (\d+)\)$/u.exec(normalized);
  if (minimumArray !== null) {
    return { items: parseTypeExpression(minimumArray[1] ?? ""), kind: "array", minItems: Number(minimumArray[2]) };
  }
  if (normalized.startsWith("Array<") && normalized.endsWith(">")) {
    return { items: parseTypeExpression(normalized.slice(6, -1)), kind: "array" };
  }
  if (normalized.startsWith("[") && normalized.endsWith("]")) {
    return { items: splitTypeExpression(normalized.slice(1, -1)).map(parseTypeExpression), kind: "tuple" };
  }
  if (normalized.startsWith("{") && normalized.endsWith("}")) {
    const fields = splitTypeExpression(normalized.slice(1, -1)).map((property) => {
      const delimiter = findTypeDelimiter(property, ":");
      if (delimiter < 1) throw new Error(`Assertion registry type '${type}' has a malformed object field.`);
      const nameToken = property.slice(0, delimiter).trim();
      const name = nameToken.endsWith("?") ? nameToken.slice(0, -1) : nameToken;
      return rawField(name, property.slice(delimiter + 1).trim(), parseTypeExpression(property.slice(delimiter + 1)), !nameToken.endsWith("?"));
    });
    return { fields, kind: "record", unknownKeys: "reject" };
  }
  const literalTerms = splitTypeExpression(normalized, "|").map((term) => term.trim());
  if (literalTerms.length > 1 && literalTerms.every((term) => /^['"].*['"]$/u.test(term))) {
    return { kind: "literal", values: literalTerms.map((term) => term.slice(1, -1)) };
  }
  throw new Error(`Assertion registry field type '${type}' has no machine-readable constraint.`);
}

function normalizeAssertionEntry(entry: IRawPlaytestAssertionSchemaEntry): IPlaytestAssertionSchemaEntry {
  return {
    ...entry,
    fields: entry.fields.map((field) => ({
      ...field,
      constraints: field.constraints ?? parseTypeExpression(field.type),
    })),
  };
}

function worldRuntimeValidation(): IPlaytestAssertionSchemaConstraint {
  return {
    fields: [
      rawField("agent", "string", { kind: "string", nonEmpty: true }, true),
      rawField("core", "string", { kind: "string", nonEmpty: true }, true),
      rawField("portable", "boolean", { kind: "boolean" }),
      rawField("randomState", "integer", { integer: true, kind: "number" }, true),
      rawField(
        "rapier",
        "string | null",
        { kind: "union", variants: [{ kind: "string", nonEmpty: true }, { kind: "literal", values: [null] }] },
        true,
      ),
      rawField("step", "positive number", { kind: "number", min: 0, minExclusive: true }, true),
    ],
    kind: "record",
    unknownKeys: "reject",
  };
}

const RAW_PLAYTEST_ASSERTION_REGISTRY: readonly IRawPlaytestAssertionSchemaEntry[] = [
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
    rules: [
      {
        field: "entities",
        kind: "noConsecutiveDuplicates",
        message: "Assertion 'assert.reachability.entities' must not repeat a consecutive entity id.",
      },
    ],
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
      {
        constraints: {
          items: {
            fields: [
              rawField("surface", "string", { kind: "string", nonEmpty: true }, true),
              rawField("sign", "'negative' | 'positive'", { kind: "literal", values: ["negative", "positive"] }, true),
              rawField("minAbs", "number", { kind: "number", min: 0 }),
            ],
            kind: "record",
            unknownKeys: "reject",
          },
          kind: "array",
        },
        description: "Signed surface values required in physics.aerodynamics.setInputs calls.",
        name: "controls",
        type: "Array<{ surface: string, sign: 'negative' | 'positive', minAbs?: number }>",
      },
      {
        constraints: {
          items: {
            fields: [
              rawField("label", "string", { kind: "string", nonEmpty: true }, true),
              rawField("relativeToLabel", "string", { kind: "string", nonEmpty: true }),
              rawField("axis", "'x' | 'y' | 'z'", { kind: "literal", values: ["x", "y", "z"] }, true),
              rawField("sign", "'negative' | 'positive'", { kind: "literal", values: ["negative", "positive"] }, true),
              rawField("minAbs", "number", { kind: "number", min: 0 }),
            ],
            kind: "record",
            unknownKeys: "reject",
          },
          kind: "array",
        },
        description: "Signed net aerodynamic torque, optionally relative to another labeled step.",
        name: "torques",
        type: "Array<{ label: string, relativeToLabel?: string, axis: 'x' | 'y' | 'z', sign: 'negative' | 'positive', minAbs?: number }>",
      },
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
    rules: [
      {
        fields: ["entityVisible", "frameDiff", "region"],
        kind: "requireOneOf",
        message: "must declare 'entityVisible', 'frameDiff', or 'region'; an empty visual assertion evaluates nothing.",
      },
    ],
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
      { description: "Minimum fixed-step ticks between the observed before and after transforms.", name: "minTicks", type: "positive integer" },
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
    rules: [
      {
        fields: ["within"],
        kind: "requireOneOfOrTrue",
        message: "must declare 'within' or 'targetInViewport: true'; a camera assertion with neither passes without consulting any observation.",
        trueFields: ["targetInViewport"],
      },
    ],
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
      {
        constraints: {
          items: {
            fields: [
              rawField("path", "string", { kind: "string", nonEmpty: true }, true),
              rawField("equals", "json", { kind: "json" }),
              rawField("gte", "number", { kind: "number" }),
              rawField("lte", "number", { kind: "number" }),
              rawField("textIncludes", "string", { kind: "string", nonEmpty: true }),
              rawField("changed", "boolean", { kind: "boolean" }),
            ],
            kind: "record",
            rules: [
              {
                fields: ["equals", "gte", "lte", "textIncludes", "changed"],
                kind: "requireOneOf",
                message: "must declare equals, gte, lte, textIncludes, or changed.",
              },
            ],
            unknownKeys: "reject",
          },
          kind: "array",
          minItems: 1,
        },
        description: "Require at least one alternative path assertion on this resource id.",
        name: "anyOf",
        type: "Array<{ path: string, equals?: json, gte?: number, lte?: number, textIncludes?: string, changed?: boolean }>",
      },
    ],
    cardinality: "array",
    kind: "resources",
    observationPath: "resources",
    requiredCapabilities: ["runtime.resources"],
    resultIdPrefix: "resource.",
    supportedOn: ["web", "desktop", "bevy"],
    triviality: "reject-initial-value",
    trivialityRationale: "A resource comparator can pass on its initial snapshot, so initial satisfaction must be rejected unless a written held-invariant reason is recorded.",
    discriminator: { field: "anyOf", presentVariant: 0 },
    variants: [
      { fields: ["id", "anyOf"], requiredFields: ["id", "anyOf"] },
      {
        excludeFields: ["anyOf"],
        requiredFields: ["id"],
      },
    ],
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
    rules: [
      {
        fields: ["count", "gte", "lte"],
        kind: "requireOneOf",
        message: "must declare 'count', 'gte', or 'lte'; a tag assertion with none passes on a count of zero.",
      },
    ],
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
    minItems: 1,
    minItemsMessage: "must contain at least one signal assertion.",
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
    rules: [
      {
        equals: false,
        field: "noConsoleErrors",
        kind: "requireWhen",
        message: "may be false only when 'consoleErrorsOptOutReason' explains the bounded exception.",
        required: "consoleErrorsOptOutReason",
      },
      {
        equals: false,
        field: "noNetworkErrors",
        kind: "requireWhen",
        message: "may be false only when 'networkErrorsOptOutReason' explains the bounded exception.",
        required: "networkErrorsOptOutReason",
      },
      {
        equals: false,
        field: "noRuntimeDiagnostics",
        kind: "requireWhen",
        message: "may be false only when 'runtimeDiagnosticsOptOutReason' explains the bounded exception.",
        required: "runtimeDiagnosticsOptOutReason",
      },
    ],
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
      { description: "Maximum nearest-rank 95th-percentile frame time in milliseconds.", name: "maxFrameMsP95", type: "non-negative number" },
      { description: "Maximum observed renderer draw-call count.", name: "maxDrawCalls", type: "non-negative number" },
      { description: "Maximum observed renderer triangle count.", name: "maxTriangles", type: "non-negative number" },
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
      {
        constraints: { kind: "union", variants: [{ kind: "number" }, { kind: "literal", values: [null] }] },
        description: "Expected configured deterministic seed, or null when unseeded.",
        name: "seed",
        required: true,
        type: "json",
      },
      {
        constraints: worldRuntimeValidation(),
        description: "Expected deterministic replay runtime fingerprint.",
        name: "runtime",
        type: "object",
      },
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

export const PLAYTEST_ASSERTION_REGISTRY: readonly IPlaytestAssertionSchemaEntry[] =
  RAW_PLAYTEST_ASSERTION_REGISTRY.map(normalizeAssertionEntry);

export function assertPlaytestAssertionRegistryComplete(
  registry: readonly IPlaytestAssertionSchemaEntry[] = PLAYTEST_ASSERTION_REGISTRY,
): void {
  const checkRuleReferences = (
    fields: ReadonlySet<string>,
    rules: readonly IPlaytestAssertionSchemaRule[] | undefined,
    path: string,
    errors: string[],
  ): void => {
    for (const rule of rules ?? []) {
      const references = rule.kind === "requireOneOf" || rule.kind === "requireOneOfOrTrue"
        ? [...rule.fields, ...(rule.kind === "requireOneOfOrTrue" ? rule.trueFields : [])]
        : rule.kind === "requireWhen"
          ? [rule.field, rule.required]
          : [rule.field];
      for (const fieldName of references) {
        if (!fields.has(fieldName)) errors.push(`${path}.${fieldName} is not declared in the registry fields`);
      }
    }
  };
  const checkConstraint = (
    constraint: IPlaytestAssertionSchemaConstraint | undefined,
    path: string,
    errors: string[],
  ): void => {
    if (constraint === undefined) {
      errors.push(`${path} has no constraints`);
      return;
    }
    if (constraint.kind === "array") {
      checkConstraint(constraint.items, `${path}[]`, errors);
    } else if (constraint.kind === "tuple") {
      constraint.items.forEach((item, index) => checkConstraint(item, `${path}[${index}]`, errors));
    } else if (constraint.kind === "union") {
      constraint.variants.forEach((variant, index) => checkConstraint(variant, `${path}|${index}`, errors));
    } else if (constraint.kind === "record") {
      for (const field of constraint.fields) {
        checkConstraint(field.constraints, `${path}.${field.name}`, errors);
      }
      checkRuleReferences(new Set(constraint.fields.map((field) => field.name)), constraint.rules, path, errors);
    }
  };
  const errors: string[] = [];
  const kinds = new Set<string>();
  for (const entry of registry) {
    if (kinds.has(entry.kind)) errors.push(`duplicate assertion kind '${entry.kind}'`);
    kinds.add(entry.kind);
    const fields = new Set<string>();
    for (const field of entry.fields) {
      if (fields.has(field.name)) errors.push(`${entry.kind}.${field.name} is declared more than once`);
      fields.add(field.name);
      checkConstraint(field.constraints, `${entry.kind}.${field.name}`, errors);
    }
    checkRuleReferences(fields, entry.rules, entry.kind, errors);
    for (const variant of entry.variants ?? []) {
      if (variant.fields === undefined && variant.excludeFields === undefined) {
        errors.push(`${entry.kind} has a variant without fields or excludeFields`);
      }
      if (variant.fields !== undefined && variant.excludeFields !== undefined) {
        errors.push(`${entry.kind} has a variant with both fields and excludeFields`);
      }
      for (const fieldName of variant.fields ?? []) {
        if (!fields.has(fieldName)) errors.push(`${entry.kind}.${fieldName} is not declared in the registry fields`);
      }
      for (const fieldName of variant.excludeFields ?? []) {
        if (!fields.has(fieldName)) errors.push(`${entry.kind}.${fieldName} is not declared in the registry fields`);
      }
      for (const fieldName of variant.requiredFields ?? []) {
        const included = variant.fields?.includes(fieldName) ?? !variant.excludeFields?.includes(fieldName);
        if (!included) errors.push(`${entry.kind}.${fieldName} is required by a variant that does not include it`);
      }
      const variantFields = new Set(
        variant.fields ?? entry.fields.map((field) => field.name).filter((name) => !variant.excludeFields?.includes(name)),
      );
      checkRuleReferences(variantFields, variant.rules, `${entry.kind}.variant`, errors);
    }
  }
  if (errors.length > 0) {
    throw new Error(`Assertion registry is incomplete: ${errors.join(", ")}.`);
  }
}

assertPlaytestAssertionRegistryComplete();

export interface IPlaytestSetupSchemaEntry {
  description: string;
  kind: keyof NonNullable<IPlaytestScenario["setup"]>;
  requiredCapabilities: readonly PlaytestCapability[];
}

export const PLAYTEST_SETUP_REGISTRY: readonly IPlaytestSetupSchemaEntry[] = [
  {
    description: "Overrides the subject player-start position before input.",
    kind: "spawn",
    requiredCapabilities: ["entity.setup"],
  },
  {
    description: "Overrides the subject player-start aim before input.",
    kind: "aim",
    requiredCapabilities: ["entity.setup"],
  },
  {
    description: "Applies bounded transforms to registered entities before input.",
    kind: "entities",
    requiredCapabilities: ["entity.setup"],
  },
  {
    description: "Places named entities at explicit world transforms before input.",
    kind: "place",
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
  // An aimAt step steers the subject through the bridge's setup channel.
  if (scenario.steps.some((step) => step.kind === "aimAt")) {
    required.add("entity.setup");
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

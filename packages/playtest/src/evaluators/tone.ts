import { TONE_METRICS } from "../tone.js";
import type { IEvaluationContext } from "./context.js";

export function emitTone({ assertions, diagnostics, input, scenarioAssertions }: IEvaluationContext): void {
  for (const [index, expected] of (scenarioAssertions.tone ?? []).entries()) {
    const label = expected.atStep ?? "after.png";
    const frames = input.report.observations?.tone;
    const frame = Array.isArray(frames) ? frames.find((entry) => entry !== null && typeof entry === "object" && (expected.atStep === undefined
      ? entry.atStep === undefined && entry.label === "after.png"
      : entry.atStep === expected.atStep)) : undefined;
    if (frame?.code !== "TN_TONE" || !TONE_METRICS.every((key) => typeof frame[key] === "number"
      && Number.isFinite(frame[key]) && frame[key] >= 0 && frame[key] <= (key.endsWith("Fraction") ? 1 : 255))) {
      assertions.push({ id: `tone.${index}.observed`, pass: false, details: { expected, observed: frame } });
      diagnostics.push({ code: "TN_PLAYTEST_TONE_UNOBSERVED", message: `Tone capture '${label}' is missing or has invalid luminance metrics.`, severity: "error", observedRuntimePath: "observations.json/tone" });
      continue;
    }
    for (const key of TONE_METRICS) {
      const bound = expected[key];
      if (bound === undefined) continue;
      const observed = frame[key];
      const pass = (bound.min === undefined || observed >= bound.min) && (bound.max === undefined || observed <= bound.max);
      assertions.push({ id: `tone.${index}.${key}`, pass, details: { observed, expected: bound, frame } });
      if (!pass) diagnostics.push({ code: "TN_PLAYTEST_TONE_ASSERTION_FAILED", message: `Tone '${label}' ${key} measured ${observed}; required ${JSON.stringify(bound)}.`, severity: "error", observedRuntimePath: "observations.json/tone" });
    }
  }
}

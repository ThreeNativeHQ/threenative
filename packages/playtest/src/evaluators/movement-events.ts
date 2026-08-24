import { isRecord, type IPlaytestDiagnostic } from "../assertion-report.js";
import { evaluateTrivialityGuard, guardedAssertion } from "../triviality-guard.js";
import type { IEvaluationContext } from "./context.js";
import {
  animationObservationPass,
  countMatchingEntries,
  initialEffectLog,
  matchingOccludedRaycasts,
  runtimeAnimationObservations,
  runtimeGameplayBefore,
} from "./helpers.js";
type AnimationAssertion = NonNullable<IEvaluationContext["scenarioAssertions"]["animation"]>[number];
function animationDiagnostic(entity: string, assertion: AnimationAssertion, trivial: boolean): IPlaytestDiagnostic {
  return {
    code: trivial ? "TN_PLAYTEST_ASSERTION_TRIVIAL" : "TN_PLAYTEST_ANIMATION_NOT_OBSERVED",
    message: trivial
      ? `Assertion 'animation.${entity}' was already satisfied before the scenario ran.`
      : `Expected animation evidence for '${entity}'${assertion.clip === undefined ? "" : ` clip '${assertion.clip}'`} was not observed.`,
    severity: "error",
    suggestion: trivial
      ? "Drive the asserted animation from a different initial clip, or provide allowTrivial with the reason the clip is intentionally held."
      : "Check model animation clip wiring and runtime animation playback state.",
  };
}
export function emitOccludedAssertions(ctx: IEvaluationContext): void {
  const { assertions, diagnostics } = ctx;
  const { input, scenarioAssertions } = ctx;
  for (const assertion of scenarioAssertions.occluded ?? []) {
    const matches = matchingOccludedRaycasts(input.report.effectLog, assertion.entity, assertion.target);
    const id = `occluded.${assertion.entity ?? "ray"}`;
    const initialMatches = matchingOccludedRaycasts(
      initialEffectLog(input.report.observations),
      assertion.entity,
      assertion.target,
    );
    const comparisonPass = matches > 0;
    const guard = evaluateTrivialityGuard(comparisonPass, comparisonPass && initialMatches > 0, assertion.allowTrivial);
    assertions.push(guardedAssertion(guard, id, {
      count: matches,
      entity: assertion.entity,
      expected: assertion,
      initialMatches,
      target: assertion.target,
    }));
    if (!guard.pass) diagnostics.push({
      artifactPath: "effect-log.json",
      code: guard.trivial && !guard.trivialityOptOut
        ? "TN_PLAYTEST_ASSERTION_TRIVIAL"
        : "TN_PLAYTEST_OCCLUSION_NOT_OBSERVED",
      message: guard.trivial && !guard.trivialityOptOut
        ? `Assertion '${id}' was already satisfied before the scenario ran.`
        : "Expected a render scene-ray query or physics raycast result with hit=true, but no matching occlusion evidence was observed.",
      observedRuntimePath: "effect-log.json/entries[service=render.sceneRayQuery|physics.raycast]/payload/result/hit",
      severity: "error",
      suggestion: guard.trivial && !guard.trivialityOptOut
        ? "Drive the asserted occlusion from a non-occluded initial state, or provide allowTrivial with the reason the occlusion is intentionally held."
        : "Check the listener/emitter entity ids and rendered occluder geometry, then inspect effect-log.json for the scene-query request and hit result.",
    });
  }
}
export function emitAnimationAssertions(ctx: IEvaluationContext): void {
  const { assertions, diagnostics, input, scenarioAssertions } = ctx;
  for (const assertion of scenarioAssertions.animation ?? []) {
    const entity = assertion.entity ?? input.scenario.subject ?? input.report.entity;
    const runtime = runtimeAnimationObservations(input.report.observations?.runtimeObservations);
    if (runtime !== undefined) {
      const observed = isRecord(runtime[entity]) ? runtime[entity] : undefined;
      const clip = typeof observed?.clip === "string" ? observed.clip : undefined;
      const advancedFrames = typeof observed?.advancedFrames === "number" ? observed.advancedFrames : undefined;
      const finished = typeof observed?.finished === "boolean" ? observed.finished : undefined;
      const comparisonPass = observed !== undefined
        && (assertion.clip === undefined || clip === assertion.clip)
        && (assertion.entered !== true || clip !== undefined)
        && (assertion.finished === undefined || (finished !== undefined && finished === assertion.finished))
        && (assertion.advancedFrames === undefined || (advancedFrames !== undefined && advancedFrames >= assertion.advancedFrames));
      const initialGameplay = runtimeGameplayBefore(input.report.observations?.runtimeObservations);
      const initialAnimations = isRecord(initialGameplay?.animation) ? initialGameplay.animation : undefined;
      const initialObserved = isRecord(initialAnimations?.[entity]) ? initialAnimations[entity] : undefined;
      const initialPass = animationObservationPass(assertion, initialObserved);
      const guard = evaluateTrivialityGuard(comparisonPass, comparisonPass && initialPass, assertion.allowTrivial);
      assertions.push(guardedAssertion(guard, `animation.${entity}`, {
        advancedFrames,
        clip,
        entity,
        expected: assertion,
        finished,
        initialPass,
      }));
      if (!guard.pass) diagnostics.push(animationDiagnostic(entity, assertion, guard.trivial && !guard.trivialityOptOut));
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
    const guard = evaluateTrivialityGuard(comparisonPass, comparisonPass && initialCount >= minCount, assertion.allowTrivial);
    assertions.push(guardedAssertion(guard, `animation.${entity}`, {
      count,
      entity,
      clip: assertion.clip,
      advancedFrames: assertion.advancedFrames,
      expected: assertion,
      finished: assertion.finished,
      initialCount,
    }));
    if (!guard.pass) diagnostics.push(animationDiagnostic(entity, assertion, guard.trivial && !guard.trivialityOptOut));
  }
}

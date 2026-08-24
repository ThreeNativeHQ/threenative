import type { IEvaluationContext } from "./context.js";
import {
  countMatchingEntries,
  countRuntimeContacts,
  initialPhysicsDebugSnapshot,
  mergeEffectLogs,
  physicsDebugContactEvidence,
  physicsDebugMeanPoseDistance,
  physicsDebugOmittedBodies,
  runtimeContactEvidence,
  runtimeGameplayAtStep,
  settledCandidate,
  summarizeMatchingEntries,
} from "./helpers.js";
import { evaluateTrivialityGuard, guardedAssertion } from "../triviality-guard.js";

export function emitContactAssertions(ctx: IEvaluationContext): void {
  const { assertions, diagnostics } = ctx;
  const { input, scenarioAssertions } = ctx;
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
}

export function emitSettledAssertions(ctx: IEvaluationContext): void {
  const { assertions, diagnostics } = ctx;
  const { input, scenarioAssertions } = ctx;
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
    const guard = evaluateTrivialityGuard(comparisonPass, comparisonPass && initialPass, assertion.allowTrivial);
    const resultEntity = candidate?.selector ?? assertion.entity ?? "anonymous";
    assertions.push(guardedAssertion(
      guard,
      assertion.entity === undefined ? `settled.${settledIndex}` : `settled.${assertion.entity}`,
      {
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
      },
    ));
    if (!guard.pass) diagnostics.push({
      artifactPath: "observations.json",
      code: guard.trivial && !guard.trivialityOptOut
        ? "TN_PLAYTEST_ASSERTION_TRIVIAL"
        : !complete
        ? "TN_PLAYTEST_PHYSICS_EVIDENCE_TRUNCATED"
        : !posePass ? "TN_PLAYTEST_RAGDOLL_POSE_NOT_DISTINCT" : "TN_PLAYTEST_PHYSICS_NOT_SETTLED",
      message: guard.trivial && !guard.trivialityOptOut
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
      suggestion: guard.trivial && !guard.trivialityOptOut
        ? "Drive the asserted bodies from an awake initial state, or provide allowTrivial with the reason the rest state is intentionally held."
        : "Allow a longer settle window or fix damping, contacts, joints, and persistent forces that keep the bodies awake.",
    });
  }
}

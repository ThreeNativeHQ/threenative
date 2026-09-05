import type { IPlaytestContactObservation, IPlaytestTransitionObservation } from "../protocol.js";
import type { IPlaytestCausedByAssertion, IPlaytestEffectSpec } from "../scenario/schema-base.js";
import type { IEvaluationContext } from "./context.js";

/**
 * "It happened **because** of that, and never before it."
 *
 * A run could already say *a contact happened* and *the state reads `won`*. Nothing related the
 * two. `assert.states[].atSteps` orders them at step boundaries, where a win arriving one tick
 * after the contact and a win arriving 199 ticks later inside the same step are the same
 * observation — and that is exactly the shape of a terminal state driven by a timer or a distance
 * check that merely lands near a contact.
 *
 * Measured in the field: a sandbox physics puzzle reported `won` on frame one with the player
 * untouched eight metres away, because its goal volume overlapped the floor slab. Its own HUD
 * agreed the game was won. Nothing in the harness could catch it.
 *
 * Both sides are the producer's own tick stamps. A run that carries no ticks on either side fails
 * closed and names the missing side. It never falls back to step granularity: that is a different
 * measurement, and answering a tick question with it would be the confident wrong number this
 * package exists to refuse.
 */
export function emitCausedBy(ctx: IEvaluationContext): void {
  const assertions = ctx.scenarioAssertions.causedBy;
  if (assertions === undefined || assertions.length === 0) return;
  const runtime = ctx.input.report.observations?.runtimeObservations as
    | { gameplay?: { contacts?: IPlaytestContactObservation[]; transitions?: IPlaytestTransitionObservation[] } }
    | undefined;
  const gameplay = runtime?.gameplay;
  const transitions = gameplay?.transitions;
  if (transitions === undefined) {
    ctx.assertions.push({ details: { expected: assertions.length, observed: undefined }, id: "causedBy.observed", pass: false });
    ctx.diagnostics.push({
      code: "TN_PLAYTEST_TRANSITIONS_UNOBSERVED",
      message:
        "A causedBy assertion was evaluated against a run that reported no transition log, so no effect has a tick and nothing can be related to a cause.",
      observedRuntimePath: "observations.json/runtimeObservations/gameplay/transitions",
      severity: "error",
      suggestion:
        "Install core's playtest() plugin so the run advertises 'runtime.transitions', and drive the scenario with fixed-step ticks. A run whose loop never ticked has observed nothing, not nothing-changed.",
    });
    return;
  }
  assertions.forEach((assertion, index) => {
    emitOne(ctx, assertion, index, gameplay?.contacts ?? [], transitions);
  });
}

function describeEffect(effect: IPlaytestEffectSpec): string {
  return `${effect.path} becomes ${JSON.stringify(effect.becomes)}`;
}

function describeCause(assertion: IPlaytestCausedByAssertion): string {
  const { contact, transition } = assertion.cause;
  if (contact !== undefined)
    return `contact ${contact.entity} with ${contact.with}${contact.kind === undefined ? "" : ` (${contact.kind})`}`;
  return transition === undefined ? "unspecified" : describeEffect(transition);
}

/** The first tick a transition log shows the path reaching the value, or undefined. */
function firstEffectTick(
  transitions: readonly IPlaytestTransitionObservation[],
  effect: IPlaytestEffectSpec,
): number | undefined {
  let earliest: number | undefined;
  for (const entry of transitions) {
    if (entry.path !== effect.path || entry.to !== effect.becomes) continue;
    if (earliest === undefined || entry.tick < earliest) earliest = entry.tick;
  }
  return earliest;
}

interface ICauseReading {
  tick?: number;
  /** True when a matching event exists but the producer stamped no tick on it. */
  unstamped: boolean;
}

function firstCauseTick(
  assertion: IPlaytestCausedByAssertion,
  contacts: readonly IPlaytestContactObservation[],
  transitions: readonly IPlaytestTransitionObservation[],
): ICauseReading {
  const spec = assertion.cause.contact;
  if (spec === undefined) {
    const transition = assertion.cause.transition;
    const tick = transition === undefined ? undefined : firstEffectTick(transitions, transition);
    return { ...(tick === undefined ? {} : { tick }), unstamped: false };
  }
  let earliest: number | undefined;
  let unstamped = false;
  for (const contact of contacts) {
    if (contact.entity !== spec.entity || contact.with !== spec.with) continue;
    if (spec.kind !== undefined && contact.kind !== spec.kind) continue;
    // A matching contact with no tick is not a cause that happened at tick zero. It is a producer
    // that does not drain per tick, and saying so is the only honest answer.
    if (contact.tick === undefined) {
      unstamped = true;
      continue;
    }
    if (earliest === undefined || contact.tick < earliest) earliest = contact.tick;
  }
  return { ...(earliest === undefined ? {} : { tick: earliest }), unstamped };
}

function emitOne(
  ctx: IEvaluationContext,
  assertion: IPlaytestCausedByAssertion,
  index: number,
  contacts: readonly IPlaytestContactObservation[],
  transitions: readonly IPlaytestTransitionObservation[],
): void {
  const id = `causedBy[${index}]`;
  const cause = describeCause(assertion);
  const effect = describeEffect(assertion.effect);
  const causeReading = firstCauseTick(assertion, contacts, transitions);
  const effectTick = firstEffectTick(transitions, assertion.effect);

  if (causeReading.tick === undefined) {
    ctx.assertions.push({ details: { cause, effect, unstamped: causeReading.unstamped }, id: `${id}.cause`, pass: false });
    ctx.diagnostics.push({
      code: causeReading.unstamped ? "TN_PLAYTEST_CAUSE_UNSTAMPED" : "TN_PLAYTEST_CAUSE_NOT_OBSERVED",
      message: causeReading.unstamped
        ? `The run observed ${cause} but the producer stamped no tick on it, so it cannot be placed against ${effect}.`
        : `The run never observed ${cause}, so nothing could have caused ${effect}.`,
      observedRuntimePath: "observations.json/runtimeObservations/gameplay/contacts",
      severity: "error",
      suggestion: causeReading.unstamped
        ? "The producer drains its contact log only at sample time. Drain it per tick and stamp each event, or assert the ordering with assert.states[].atSteps and accept step granularity."
        : "Check that both sides of the contact are registered entities and that the scenario's input actually reaches the trigger. A contact nothing observed is not a contact that did not happen — inspect observations.json first.",
    });
    return;
  }

  if (effectTick === undefined) {
    ctx.assertions.push({ details: { cause, causeTick: causeReading.tick, effect }, id: `${id}.effect`, pass: false });
    ctx.diagnostics.push({
      code: "TN_PLAYTEST_EFFECT_NOT_OBSERVED",
      message: `${cause} happened at tick ${causeReading.tick}, and ${effect} never did.`,
      observedRuntimePath: "observations.json/runtimeObservations/gameplay/transitions",
      severity: "error",
      suggestion:
        "The transition log records a path's first value as its starting point, not as a change. A value that was already at the asserted value when the run began has not transitioned to it — which is the frame-one case this family exists to catch, and neverBefore reports it as such.",
    });
    return;
  }

  const gap = effectTick - causeReading.tick;

  if (assertion.neverBefore === true) {
    const pass = gap >= 0;
    ctx.assertions.push({
      details: { causeTick: causeReading.tick, effectTick, gap, id: cause },
      id: `${id}.neverBefore`,
      pass,
    });
    if (!pass)
      ctx.diagnostics.push({
        code: "TN_PLAYTEST_EFFECT_PRECEDES_CAUSE",
        message: `${effect} at tick ${effectTick}, ${Math.abs(gap)} tick(s) before ${cause} at tick ${causeReading.tick}. The effect did not come from that cause.`,
        observedRuntimePath: "observations.json/runtimeObservations/gameplay/transitions",
        severity: "error",
        suggestion:
          "Something other than the named cause produced the effect — a trigger volume overlapping static geometry, a timer, or a distance check. Find what set the value at that tick; the game reporting the right final answer is not proof it got there the right way.",
      });
  }

  if (assertion.withinTicks !== undefined) {
    const pass = gap >= 0 && gap <= assertion.withinTicks;
    ctx.assertions.push({
      details: { causeTick: causeReading.tick, effectTick, gap, withinTicks: assertion.withinTicks },
      id: `${id}.withinTicks`,
      pass,
    });
    if (!pass)
      ctx.diagnostics.push({
        code: "TN_PLAYTEST_CAUSE_TOO_DISTANT",
        message:
          gap < 0
            ? `${effect} happened ${Math.abs(gap)} tick(s) before ${cause}, so no window contains it.`
            : `${effect} happened ${gap} tick(s) after ${cause}, past the asserted window of ${assertion.withinTicks}.`,
        observedRuntimePath: "observations.json/runtimeObservations/gameplay/transitions",
        severity: "error",
        suggestion:
          "A long gap between the contact and the state change is the signature of a timer or a distance check that happens to fire near the contact. Widen the window only if the game genuinely defers the effect, and say why in the scenario.",
      });
  }
}

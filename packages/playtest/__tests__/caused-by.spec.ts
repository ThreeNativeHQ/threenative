import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

import { makeTempDirSync } from "../../../test-support/temp-dir.js";
import { emitCausedBy } from "../src/evaluators/caused-by.js";
import { loadPlaytestScenario } from "../src/scenario.js";

/**
 * "It happened because of that, and never before it."
 *
 * The defect this family exists to catch was measured in a sandbox build: a physics puzzle
 * reported `won` on frame one with the player untouched eight metres away, because its goal volume
 * overlapped the floor slab. Its own HUD agreed the game was won. Every other assertion in the
 * harness was green, because each of them was true — a contact did happen, and the state did read
 * `won`. Nothing related the two.
 *
 * `atSteps` orders them at step boundaries, which cannot separate a win arriving with the contact
 * from one arriving 199 ticks later in the same step. These pin the tick-granular relation, and
 * every way it must fail closed rather than answer a tick question with a step.
 */

const baseReport = {
  diagnostics: [],
  distance: 0,
  entity: "player",
  expectMoved: false,
  frames: 1,
  observations: { console: [], hud: {}, network: [], resources: {} },
  trivialityOptOuts: [],
};

const baseScenario = {
  name: "caused-by",
  schemaVersion: 1,
  steps: [{ label: "goal", release: true, waitFrames: 1 }],
  subject: "player",
  target: "web",
};

function evaluate(assertion: unknown, gameplay?: Record<string, unknown>) {
  const assertions: Array<{ details?: Record<string, unknown>; id: string; pass: boolean }> = [];
  const diagnostics: Array<{ code: string; message: string; severity: "error" | "warning"; suggestion?: string }> = [];
  emitCausedBy({
    assertions,
    diagnostics,
    input: {
      report: {
        ...baseReport,
        observations: {
          ...baseReport.observations,
          ...(gameplay === undefined ? {} : { runtimeObservations: { gameplay } }),
        },
      } as never,
      scenario: { ...baseScenario, assert: assertion } as never,
    },
    scenarioAssertions: assertion as never,
  } as never);
  return { assertions, diagnostics };
}

const WON_BY_CONTACT = {
  causedBy: [
    {
      cause: { contact: { entity: "warden", kind: "trigger", with: "seal" } },
      effect: { becomes: "won", path: "state.status" },
      neverBefore: true,
      withinTicks: 4,
    },
  ],
};

function loadScenario(assert: unknown): Promise<unknown> {
  const dir = makeTempDirSync("caused-by-scenario");
  writeFileSync(join(dir, "c.playtest.json"), JSON.stringify({ ...baseScenario, assert }));
  return loadPlaytestScenario(dir, "c.playtest.json");
}

describe("causedBy relates two tick-stamped observations", () => {
  test("a win two ticks after the contact passes both bounds", () => {
    const { assertions, diagnostics } = evaluate(WON_BY_CONTACT, {
      contacts: [{ entity: "warden", kind: "trigger", tick: 118, with: "seal" }],
      transitions: [{ from: "playing", path: "state.status", tick: 120, to: "won" }],
    });
    expect(diagnostics).toEqual([]);
    expect(assertions.map(({ id }) => id)).toEqual(["causedBy[0].neverBefore", "causedBy[0].withinTicks"]);
    expect(assertions.every(({ pass }) => pass)).toBe(true);
  });

  test("the frame-one fake win fails, and the message says the effect preceded the cause", () => {
    const { assertions, diagnostics } = evaluate(WON_BY_CONTACT, {
      contacts: [{ entity: "warden", kind: "trigger", tick: 140, with: "seal" }],
      transitions: [{ from: "playing", path: "state.status", tick: 1, to: "won" }],
    });
    expect(assertions.find(({ id }) => id === "causedBy[0].neverBefore")?.pass).toBe(false);
    expect(diagnostics[0]?.code).toBe("TN_PLAYTEST_EFFECT_PRECEDES_CAUSE");
    expect(diagnostics[0]?.message).toContain("139 tick(s) before");
  });

  test("a win long after the contact fails the window even though the ordering is right", () => {
    const { assertions, diagnostics } = evaluate(WON_BY_CONTACT, {
      contacts: [{ entity: "warden", kind: "trigger", tick: 10, with: "seal" }],
      transitions: [{ from: "playing", path: "state.status", tick: 400, to: "won" }],
    });
    expect(assertions.find(({ id }) => id === "causedBy[0].neverBefore")?.pass).toBe(true);
    expect(assertions.find(({ id }) => id === "causedBy[0].withinTicks")?.pass).toBe(false);
    expect(diagnostics[0]?.code).toBe("TN_PLAYTEST_CAUSE_TOO_DISTANT");
    expect(diagnostics[0]?.suggestion).toContain("timer");
  });

  test("the earliest matching contact is the cause, not the last one", () => {
    const { assertions } = evaluate(WON_BY_CONTACT, {
      contacts: [
        { entity: "warden", kind: "trigger", tick: 300, with: "seal" },
        { entity: "warden", kind: "trigger", tick: 118, with: "seal" },
      ],
      transitions: [{ from: "playing", path: "state.status", tick: 120, to: "won" }],
    });
    expect(assertions.find(({ id }) => id === "causedBy[0].withinTicks")?.details?.causeTick).toBe(118);
  });

  test("a transition can be the cause, so one state change explains another", () => {
    const { assertions, diagnostics } = evaluate(
      {
        causedBy: [
          {
            cause: { transition: { becomes: "pressed", path: "states.plate" } },
            effect: { becomes: "open", path: "states.door" },
            neverBefore: true,
          },
        ],
      },
      {
        transitions: [
          { from: "idle", path: "states.plate", tick: 40, to: "pressed" },
          { from: "shut", path: "states.door", tick: 41, to: "open" },
        ],
      },
    );
    expect(diagnostics).toEqual([]);
    expect(assertions.every(({ pass }) => pass)).toBe(true);
  });
});

describe("causedBy fails closed rather than answering a tick question with a step", () => {
  test("a run with no transition log fails once, and says why nothing has a tick", () => {
    const { assertions, diagnostics } = evaluate(WON_BY_CONTACT);
    expect(assertions).toEqual([
      { details: { expected: 1, observed: undefined }, id: "causedBy.observed", pass: false },
    ]);
    expect(diagnostics[0]?.code).toBe("TN_PLAYTEST_TRANSITIONS_UNOBSERVED");
  });

  test("a matching contact carrying no tick is not treated as a cause at tick zero", () => {
    const { assertions, diagnostics } = evaluate(WON_BY_CONTACT, {
      contacts: [{ entity: "warden", kind: "trigger", with: "seal" }],
      transitions: [{ from: "playing", path: "state.status", tick: 120, to: "won" }],
    });
    expect(assertions).toEqual([
      { details: { cause: "contact warden with seal (trigger)", effect: 'state.status becomes "won"', unstamped: true }, id: "causedBy[0].cause", pass: false },
    ]);
    expect(diagnostics[0]?.code).toBe("TN_PLAYTEST_CAUSE_UNSTAMPED");
  });

  test("a cause the run never observed fails, and no window is reported as met", () => {
    const { assertions, diagnostics } = evaluate(WON_BY_CONTACT, {
      contacts: [],
      transitions: [{ from: "playing", path: "state.status", tick: 120, to: "won" }],
    });
    expect(assertions.map(({ id }) => id)).toEqual(["causedBy[0].cause"]);
    expect(diagnostics[0]?.code).toBe("TN_PLAYTEST_CAUSE_NOT_OBSERVED");
  });

  test("an effect that never transitioned fails, including the value the run started at", () => {
    const { assertions, diagnostics } = evaluate(WON_BY_CONTACT, {
      contacts: [{ entity: "warden", kind: "trigger", tick: 5, with: "seal" }],
      transitions: [],
    });
    expect(assertions.map(({ id }) => id)).toEqual(["causedBy[0].effect"]);
    expect(diagnostics[0]?.code).toBe("TN_PLAYTEST_EFFECT_NOT_OBSERVED");
  });

  test("a contact of a different kind is not the named cause", () => {
    const { diagnostics } = evaluate(WON_BY_CONTACT, {
      contacts: [{ entity: "warden", kind: "trigger.exit", tick: 5, with: "seal" }],
      transitions: [{ from: "playing", path: "state.status", tick: 120, to: "won" }],
    });
    expect(diagnostics[0]?.code).toBe("TN_PLAYTEST_CAUSE_NOT_OBSERVED");
  });
});

describe("a malformed causedBy assertion throws at load", () => {
  test("a row that bounds neither the window nor the ordering is refused", async () => {
    await expect(
      loadScenario({ causedBy: [{ cause: { contact: { entity: "a", with: "b" } }, effect: { becomes: "won", path: "state.status" } }] }),
    ).rejects.toThrow(/neverBefore or withinTicks/u);
  });

  test("a cause naming both a contact and a transition is refused", async () => {
    await expect(
      loadScenario({
        causedBy: [
          {
            cause: { contact: { entity: "a", with: "b" }, transition: { becomes: 1, path: "state.x" } },
            effect: { becomes: "won", path: "state.status" },
            neverBefore: true,
          },
        ],
      }),
    ).rejects.toThrow(/exactly one of/u);
  });

  test("a cause naming neither is refused", async () => {
    await expect(
      loadScenario({ causedBy: [{ cause: {}, effect: { becomes: "won", path: "state.status" }, neverBefore: true }] }),
    ).rejects.toThrow(/exactly one of/u);
  });

  test("a non-primitive becomes is refused rather than compared by reference", async () => {
    await expect(
      loadScenario({
        causedBy: [{ cause: { contact: { entity: "a", with: "b" } }, effect: { becomes: { deep: 1 }, path: "state.status" }, neverBefore: true }],
      }),
    ).rejects.toThrow();
  });

  test("an unknown key is refused rather than ignored", async () => {
    await expect(
      loadScenario({
        causedBy: [{ becauseOf: "x", cause: { contact: { entity: "a", with: "b" } }, effect: { becomes: "won", path: "state.status" }, neverBefore: true }],
      }),
    ).rejects.toThrow();
  });

  test("a causedBy value that is not an array is refused rather than silently dropped", async () => {
    await expect(
      loadScenario({ causedBy: { cause: { contact: { entity: "a", with: "b" } }, effect: { becomes: "won", path: "state.status" }, neverBefore: true } }),
    ).rejects.toThrow();
  });
});

import { describe, expect, it } from "vitest";
import {
  admit,
  recordCompletion,
  recoverClosedPeriod,
  reservationKey,
} from "../ci-blacksmith-ledger.mjs";
import type { ILedger } from "../ci-blacksmith-ledger.mjs";
import { control, ledger, now, observation, request } from "./ci-blacksmith-fixtures.js";

// Internal final-billing attestations from a trusted adapter, not vendor response fixtures.
const recoveryNow = now + 2 * 86400000;
const key = reservationKey(request());
function finalReport() {
  return {
    organization: "ThreeNativeHQ",
    period: request().period,
    scope: "organization",
    complete: true,
    final: true,
    units: "x64-2vcpu-minutes",
    used: 20,
    observedAt: recoveryNow,
    dataThrough: observation().periodEnd,
    periodStart: observation().periodStart,
    periodEnd: observation().periodEnd,
    attempts: [
      {
        key,
        billingComplete: true,
        billedPeriods: [request().period],
        billingEndedAt: now + 4800000,
      },
    ],
  };
}
function firstAttempt(report: ReturnType<typeof finalReport>) {
  const first = report.attempts[0];
  if (!first) throw new Error("missing internal final-billing fixture");
  return first;
}
function store(initial: ILedger = ledger()) {
  let state = structuredClone(initial);
  let version = 1;
  return {
    read: async () => ({ sha: String(version), ledger: structuredClone(state) }),
    compareAndSwap: async (sha: string, next: ILedger) => {
      await Promise.resolve();
      if (sha !== String(version)) return false;
      state = structuredClone(next);
      version++;
      return true;
    },
    value: () => structuredClone(state),
  };
}
async function completed() {
  const state = store();
  await admit(state, request(), observation(), control(), now);
  expect(await recordCompletion(state, { key, state: "completed-unreconciled" })).toEqual({
    ok: true,
  });
  return state;
}
function nextObservation() {
  return {
    ...observation(),
    period: "next",
    periodStart: observation().periodEnd,
    periodEnd: recoveryNow + 86400000,
    creditExpiresAt: recoveryNow + 86400000,
    observedAt: recoveryNow,
    dataThrough: recoveryNow,
  };
}
describe("closed-period recovery without deploying a controller", () => {
  it("records completion atomically without releasing its reservation", async () => {
    const state = await completed();
    expect(state.value().entries[key]).toMatchObject({
      state: "completed-unreconciled",
      units: 160,
    });
    expect((await admit(state, request("2"), observation(), control(), now)).reason).toBe(
      "insufficient-budget",
    );
  });
  it("recovers exact final billing after expiry and preserves history before renewal", async () => {
    const state = await completed();
    const next = { ...request("2"), period: "next" };
    expect((await admit(state, next, nextObservation(), control(), recoveryNow)).reason).toBe(
      "pending-reset-exposure",
    );
    expect(await recoverClosedPeriod(state, finalReport(), recoveryNow)).toEqual({ ok: true });
    expect(state.value().entries[key]).toMatchObject({ state: "settled", units: 160 });
    expect(state.value().snapshots[request().period]).toMatchObject({ used: 20 });
    expect((await admit(state, next, nextObservation(), control(), recoveryNow)).provider).toBe(
      "blacksmith",
    );
    expect(Object.keys(state.value().entries)).toHaveLength(2);
    expect(Object.keys(state.value().snapshots)).toHaveLength(2);
  });
  it("retains omitted attempts so a partial recovery cannot reopen a period", async () => {
    const state = store();
    await admit(state, request(), observation(), control(500), now);
    await admit(state, request("2"), observation(), control(500), now);
    await recordCompletion(state, { key, state: "completed-unreconciled" });
    expect(await recoverClosedPeriod(state, finalReport(), recoveryNow)).toEqual({ ok: true });
    expect(
      (
        await admit(
          state,
          { ...request("3"), period: "next" },
          nextObservation(),
          control(),
          recoveryNow,
        )
      ).reason,
    ).toBe("pending-reset-exposure");
    expect(state.value().entries[reservationKey(request("2"))]?.state).toBe("reserved");
  });
  it("rereads conflicts without losing a simultaneous completion", async () => {
    const state = store();
    await admit(state, request(), observation(), control(500), now);
    await admit(state, request("2"), observation(), control(500), now);
    const results = await Promise.all([
      recordCompletion(state, { key, state: "completed-unreconciled" }),
      recordCompletion(state, {
        key: reservationKey(request("2")),
        state: "completed-unreconciled",
      }),
    ]);
    expect(results).toEqual([{ ok: true }, { ok: true }]);
    expect(Object.values(state.value().entries).map((entry) => entry.state)).toEqual([
      "completed-unreconciled",
      "completed-unreconciled",
    ]);
  });
  it("retains running and never-observed jobs even with a purported final report", async () => {
    for (const running of [false, true]) {
      const state = store();
      await admit(state, request(), observation(), control(), now);
      if (running) await recordCompletion(state, { key, state: "running" });
      const before = state.value();
      expect((await recoverClosedPeriod(state, finalReport(), recoveryNow)).ok).toBe(false);
      expect(state.value()).toEqual(before);
    }
  });
  it("makes exact final retries idempotent but rejects changed final attribution", async () => {
    const state = await completed();
    const report = finalReport();
    expect(await recoverClosedPeriod(state, report, recoveryNow)).toEqual({ ok: true });
    expect(await recoverClosedPeriod(state, report, recoveryNow)).toEqual({ ok: true });
    const before = state.value();
    firstAttempt(report).billingEndedAt++;
    expect((await recoverClosedPeriod(state, report, recoveryNow)).ok).toBe(false);
    expect(state.value()).toEqual(before);
  });
  it.each([
    { organization: "other" },
    { complete: false },
    { final: false },
    { scope: "repository" },
    { units: "runtime-minutes" },
    { observedAt: recoveryNow - 300001 },
    { observedAt: recoveryNow + 1 },
    { periodEnd: recoveryNow + 1 },
    { dataThrough: observation().periodEnd - 1 },
    { dataThrough: recoveryNow + 1 },
    { periodStart: observation().periodStart - 1 },
    { used: -1 },
    { attempts: [] },
  ])("retains exposure for unverified historical report %j", async (change) => {
    const state = await completed();
    const before = state.value();
    expect(
      (await recoverClosedPeriod(state, { ...finalReport(), ...change }, recoveryNow)).ok,
    ).toBe(false);
    expect(state.value()).toEqual(before);
  });
  it.each([
    { key: reservationKey({ ...request(), candidate: "b".repeat(40) }) },
    { billingComplete: false },
    { billedPeriods: [request().period, "next"] },
    { billingEndedAt: observation().periodEnd + 1 },
    { billingEndedAt: observation().periodStart - 1 },
  ])("retains exposure for incorrect per-attempt billing %j", async (change) => {
    const state = await completed();
    const before = state.value();
    const report = finalReport();
    report.attempts = [{ ...firstAttempt(report), ...change }];
    expect((await recoverClosedPeriod(state, report, recoveryNow)).ok).toBe(false);
    expect(state.value()).toEqual(before);
  });
  it("rejects repeated attempt keys and regressing historical totals", async () => {
    const state = await completed();
    const report = finalReport();
    report.attempts.push(firstAttempt(report));
    expect((await recoverClosedPeriod(state, report, recoveryNow)).ok).toBe(false);
    report.attempts.pop();
    expect(await recoverClosedPeriod(state, report, recoveryNow)).toEqual({ ok: true });
    const before = state.value();
    expect((await recoverClosedPeriod(state, { ...report, used: 19 }, recoveryNow)).ok).toBe(false);
    expect(state.value()).toEqual(before);
  });
  it("cannot create a missing period snapshot or release from a cancellation alone", async () => {
    expect((await recoverClosedPeriod(store(), finalReport(), recoveryNow)).ok).toBe(false);
    const state = await completed();
    const before = state.value();
    expect((await recordCompletion(state, { key, state: "settled" })).ok).toBe(false);
    expect((await recordCompletion(state, { key, state: "confirmed-never-started" })).ok).toBe(
      false,
    );
    expect(state.value()).toEqual(before);
  });
  it("rejects an inherited entry as an unknown completion without a state write", async () => {
    const state = store();
    const before = state.value();
    const inheritedState = Object.getOwnPropertyDescriptor(Object, "state");
    try {
      expect(
        await recordCompletion(state, { key: "constructor", state: "completed-unreconciled" }),
      ).toEqual({ ok: false, reason: "unknown-reservation" });
      expect(state.value()).toEqual(before);
    } finally {
      // The pre-fix negative run must not leave its inherited-object mutation behind.
      if (inheritedState) Object.defineProperty(Object, "state", inheritedState);
      else Reflect.deleteProperty(Object, "state");
    }
  });
  it("bounds unavailable, hung, and conflicting recovery without losing reservations", async () => {
    const state = await completed();
    const before = state.value();
    for (const authority of [
      {
        read: async () => {
          throw new Error("sensitive transport detail");
        },
      },
      { ...state, compareAndSwap: async () => false },
      { read: () => new Promise<never>(() => {}) },
    ]) {
      const result = await recoverClosedPeriod(authority, finalReport(), recoveryNow, {
        deadlineMs: 5,
      });
      expect(result.ok).toBe(false);
      expect(JSON.stringify(result)).not.toContain("sensitive");
    }
    expect(state.value()).toEqual(before);
  });
});

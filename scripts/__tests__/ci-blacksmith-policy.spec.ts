import { describe, expect, it } from "vitest";
import { decide, estimatedUnits, validateObservation } from "../ci-blacksmith-policy.mjs";
import { control, now, observation, request } from "./ci-blacksmith-fixtures.js";

describe("Blacksmith internal policy, without a live provider adapter", () => {
  it("rounds each attempt conservatively using billed SKU units", () => {
    expect(estimatedUnits(61, 2)).toBe(4);
    expect(estimatedUnits(80 * 60, 2)).toBe(160);
    expect(() => estimatedUnits(-1, 2)).toThrow();
  });
  it("reserves the hard timeout plus tail and accepts exactly the free ceiling", () => {
    expect(decide(request(), observation(2540), control(2700), now)).toMatchObject({
      provider: "blacksmith",
      units: 160,
      ceiling: 2700,
    });
    expect(decide(request(), observation(2600), control(2700), now).reason).toBe(
      "insufficient-budget",
    );
  });
  it.each(["off", "shadow", "unexpected"])("never spends in %s mode", (mode) => {
    expect(decide(request(), observation(), { ...control(), mode }, now).provider).toBe("github");
  });
  it.each(Object.keys(control().activation))("requires verified %s activation", (gate) => {
    const config = control();
    config.activation[gate as keyof typeof config.activation] = false;
    expect(decide(request(), observation(), config, now).reason).toBe("activation-unverified");
  });
  it.each(["trustedEvent", "authorizedActor", "unchangedPolicy"])(
    "rejects missing %s trust",
    (gate) => {
      expect(decide(request(), observation(), { ...control(), [gate]: false }, now).reason).toBe(
        "untrusted",
      );
    },
  );
  it.each([
    { selected: false },
    { selection: "warm" },
    { job: "build-artifacts" },
    { matrix: "linux-arm64" },
    { event: "pull_request_target" },
    { attempt: 2 },
    { candidate: "unknown" },
    { timeoutMinutes: 76 },
    { tailMinutes: 0 },
  ])("hosts unenrolled or unprovable work %j", (change) => {
    expect(decide({ ...request(), ...change }, observation(), control(), now).provider).toBe(
      "github",
    );
  });
  it.each([
    { complete: false },
    { scope: "repository" },
    { used: null },
    { used: -1 },
    { used: 1.5 },
    { observedAt: now - 300001 },
    { dataThrough: now - 300001 },
    { observedAt: now + 1 },
    { freeAllowance: 6000 },
    { creditExpiresAt: now - 1 },
    { periodEnd: now + 1000 },
    { organization: "other" },
    { period: "guessed" },
    { catalog: { label: "blacksmith-8vcpu-ubuntu-2404", factor: 4, verified: true } },
  ])("hosts unknown, stale, expired or changed usage %j", (change) => {
    expect(decide(request(), { ...observation(), ...change }, control(), now).provider).toBe(
      "github",
    );
  });
  it("bounds pilot limits and the forced-hosted switch", () => {
    for (const ceiling of [0, 159, 2701, -1, Number.NaN]) {
      expect(decide(request(), observation(), control(ceiling), now).provider).toBe("github");
    }
    expect(decide(request(), observation(), { ...control(), forceHosted: true }, now).reason).toBe(
      "forced-hosted",
    );
  });
  it("rejects an unnormalized provider response instead of inventing a schema", () => {
    expect(() => validateObservation({ minutes: 0 }, request(), now, 80)).toThrow();
  });
  it("includes a verified queue delay when rejecting possible reset or credit expiry", () => {
    expect(
      decide(request(), { ...observation(), periodEnd: now + 85 * 60000 }, control(), now).provider,
    ).toBe("github");
    expect(
      decide(request(), observation(), { ...control(), maxDispatchDelayMinutes: undefined }, now)
        .provider,
    ).toBe("github");
  });
});

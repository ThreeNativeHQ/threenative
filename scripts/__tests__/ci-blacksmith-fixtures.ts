// Internal controller observations, NOT authenticated Blacksmith response fixtures.
import type { ILedger } from "../ci-blacksmith-ledger.mjs";
import type { IControl, IObservation, IRequest } from "../ci-blacksmith-policy.mjs";
export const now = Date.parse("2026-10-06T02:00:00Z");
export function request(id = "1"): IRequest {
  return {
    organization: "ThreeNativeHQ",
    repository: "ThreeNativeHQ/threenative",
    period: "confirmed-period",
    runId: id,
    attempt: 1,
    candidate: "a".repeat(40),
    workflow: "CI",
    job: "test-native",
    matrix: "linux-x64",
    selection: "full",
    event: "merge_group",
    selected: true,
    timeoutMinutes: 75,
    tailMinutes: 5,
  };
}
export function observation(used = 0): IObservation {
  return {
    organization: "ThreeNativeHQ",
    period: "confirmed-period",
    scope: "organization",
    complete: true,
    freeAllowance: 3000,
    used,
    observedAt: now,
    dataThrough: now,
    periodStart: now - 86400000,
    periodEnd: now + 86400000,
    creditExpiresAt: now + 86400000,
    includedKeys: [],
    catalog: { label: "blacksmith-4vcpu-ubuntu-2404", factor: 2, verified: true },
  };
}
export function control(ceiling = 300): IControl {
  return {
    mode: "enforce",
    forceHosted: false,
    ceiling,
    maxDispatchDelayMinutes: 10,
    trustedEvent: true,
    authorizedActor: true,
    unchangedPolicy: true,
    activation: {
      providerHardStop: true,
      schemaVerified: true,
      periodVerified: true,
      controllerIsolated: true,
      billingTailVerified: true,
      coldCompatibilityVerified: true,
      dispatchDelayVerified: true,
    },
  };
}
export function ledger(): ILedger {
  return { version: 1, organization: "ThreeNativeHQ", snapshots: {}, entries: {} };
}

// Controller core only. No live provider-response schema is asserted here.
export const HOSTED = "ubuntu-24.04";
export const PROVIDER = "blacksmith-4vcpu-ubuntu-2404";
export const ORGANIZATION = "ThreeNativeHQ";
export const ACTIVATION_GATES = [
  "providerHardStop",
  "schemaVerified",
  "periodVerified",
  "controllerIsolated",
  "billingTailVerified",
  "coldCompatibilityVerified",
  "dispatchDelayVerified",
];
export function hosted(reason) {
  return { provider: "github", runner: HOSTED, reason };
}
export function integer(value) {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error("invalid-integer");
  return value;
}
export function estimatedUnits(seconds, factor) {
  integer(seconds);
  if (factor !== 2) throw new Error("unsupported-sku");
  return integer(Math.ceil(seconds / 60) * factor);
}
export function requestIdentity(request) {
  if (
    request?.organization !== ORGANIZATION ||
    request.repository !== `${ORGANIZATION}/threenative` ||
    !/^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/u.test(request.period ?? "") ||
    !/^[1-9][0-9]{0,19}$/u.test(request.runId ?? "") ||
    !/^[a-f0-9]{40}$/u.test(request.candidate ?? "") ||
    request.attempt !== 1 ||
    request.workflow !== "CI" ||
    request.job !== "test-native" ||
    request.matrix !== "linux-x64" ||
    request.selection !== "full" ||
    request.selected !== true ||
    !["merge_group", "push", "workflow_dispatch", "schedule", "pull_request"].includes(
      request.event,
    ) ||
    request.timeoutMinutes !== 75 ||
    !Number.isSafeInteger(request.tailMinutes) ||
    request.tailMinutes < 5 ||
    request.tailMinutes > 75
  )
    throw new Error("not-allowlisted");
  return Object.fromEntries(
    [
      "organization",
      "repository",
      "period",
      "runId",
      "attempt",
      "candidate",
      "workflow",
      "job",
      "matrix",
      "selection",
      "event",
      "selected",
      "timeoutMinutes",
      "tailMinutes",
    ].map((field) => [field, request[field]]),
  );
}
export function validateObservation(report, request, now, reservationMinutes) {
  integer(now);
  if (
    report?.organization !== ORGANIZATION ||
    report.period !== request.period ||
    report.scope !== "organization" ||
    report.complete !== true ||
    report.freeAllowance !== 3000 ||
    !Array.isArray(report.includedKeys) ||
    report.includedKeys.some((key) => typeof key !== "string") ||
    report.catalog?.label !== PROVIDER ||
    report.catalog?.factor !== 2 ||
    report.catalog?.verified !== true
  )
    throw new Error("usage-unverified");
  for (const field of [
    "used",
    "observedAt",
    "dataThrough",
    "periodStart",
    "periodEnd",
    "creditExpiresAt",
  ])
    integer(report[field]);
  if (
    report.observedAt > now ||
    report.dataThrough > report.observedAt ||
    now - report.observedAt > 300000 ||
    now - report.dataThrough > 300000
  )
    throw new Error("usage-stale");
  const latestFinish = integer(now + reservationMinutes * 60000);
  if (
    report.periodStart > now ||
    report.periodStart > report.dataThrough ||
    report.periodEnd <= latestFinish ||
    report.creditExpiresAt <= latestFinish
  )
    throw new Error("credit-or-period-unverified");
  return report;
}
export function decide(request, report, inputConfig, now) {
  const config = inputConfig ?? {};
  if (config.forceHosted === true) return hosted("forced-hosted");
  if (config.mode === undefined || config.mode === "" || config.mode === "off")
    return hosted("disabled");
  if (config.mode === "shadow") return hosted("shadow");
  if (config.mode !== "enforce") return hosted("invalid-mode");
  try {
    requestIdentity(request);
    if (
      config.trustedEvent !== true ||
      config.authorizedActor !== true ||
      config.unchangedPolicy !== true
    )
      return hosted("untrusted");
    if (ACTIVATION_GATES.some((gate) => config.activation?.[gate] !== true))
      return hosted("activation-unverified");
    const ceiling = integer(config.ceiling);
    if (ceiling > 2700) return hosted("invalid-ceiling");
    const dispatchDelay = integer(config.maxDispatchDelayMinutes);
    validateObservation(
      report,
      request,
      now,
      integer(request.timeoutMinutes + request.tailMinutes + dispatchDelay),
    );
    const units = estimatedUnits((request.timeoutMinutes + request.tailMinutes) * 60, 2);
    if (integer(report.used + units) > ceiling)
      return { ...hosted("insufficient-budget"), units, ceiling };
    return { provider: "blacksmith", runner: PROVIDER, reason: "reserved", units, ceiling };
  } catch (error) {
    return hosted(
      [
        "not-allowlisted",
        "usage-unverified",
        "usage-stale",
        "credit-or-period-unverified",
      ].includes(error?.message)
        ? error.message
        : "invalid-input",
    );
  }
}

import assert from "node:assert/strict";

/** Keep failure diagnosis useful without publishing arbitrary browser/host messages. */
export function fluidConsumerFailureDiagnostics(
  diagnostics: readonly { code: string; message?: string }[] | undefined,
) {
  const known = new Set([
    "TN_PLAYTEST_OPERATION_TIMEOUT",
    "TN_PLAYTEST_SOFTWARE_DEVICE_LOST",
    "TN_PLAYTEST_RESOURCE_ASSERTION_FAILED",
    "TN_PLAYTEST_CONSOLE_ERROR",
    "TN_PLAYTEST_BRIDGE_MISSING",
    "TN_CAPTURE_BLANK",
    "TN_PLAYTEST_ASSERTION_NOT_EVALUATED",
  ]);
  return (
    diagnostics?.slice(0, 16).map(({ code, message }) => {
      const safeCode = known.has(code) ? code : "UNRECOGNIZED_DIAGNOSTIC";
      const match =
        code === "TN_PLAYTEST_OPERATION_TIMEOUT" &&
        message?.match(
          /^Bridge operation '(advance|sample|ready|describe|setup|drainEvents)' exceeded ([1-9][0-9]{0,8})ms\.$/u,
        );
      return match
        ? { code: safeCode, operation: match[1], timeoutMs: Number(match[2]) }
        : { code: safeCode };
    }) ?? null
  );
}

/** Software rendering can prove the solver result, never the hardware frame-time criterion. */
export function assertFluidOutcome(
  report: {
    readonly pass: boolean;
    readonly diagnostics: readonly { readonly code: string }[];
    readonly assertionResults?: readonly { readonly id?: string; readonly pass: boolean }[];
    readonly capture?: {
      readonly rendererKind?: string;
      readonly adapter?: object;
    };
  },
  expectedFailure?: string,
): void {
  const unexpected = report.diagnostics.filter(
    ({ code }) => expectedFailure === undefined || code !== "TN_PLAYTEST_RESOURCE_ASSERTION_FAILED",
  );
  assert.equal(
    unexpected.length,
    0,
    `fluid collision diagnostics: ${report.diagnostics.map(({ code }) => code).join(", ")}`,
  );
  assert.equal(
    report.pass,
    expectedFailure === undefined,
    "fluid collision run failed its expected outcome",
  );
  assert.ok(
    report.assertionResults !== undefined && report.assertionResults.length > 0,
    "fluid collision assertions must exist",
  );
  assert.deepEqual(
    report.assertionResults.filter(({ pass }) => !pass).map(({ id }) => id),
    expectedFailure === undefined ? [] : [expectedFailure],
    "fluid collision assertions must match the exact expected failures",
  );
  assert.equal(
    report.diagnostics.length,
    expectedFailure === undefined ? 0 : 1,
    "fluid collision requires the exact expected diagnostic count",
  );
}

export function assertFluidCapture(
  report: Parameters<typeof assertFluidOutcome>[0],
  expectedFailure?: string,
): void {
  assertFluidOutcome(report, expectedFailure);
  assert.equal(report.capture?.rendererKind, "webgpu", "fluid collision requires actual WebGPU");
  assert.ok(
    Object.values(report.capture?.adapter ?? {}).some(
      (value) => typeof value === "string" && value.trim().length > 0,
    ),
    "fluid collision requires an identified adapter",
  );
}

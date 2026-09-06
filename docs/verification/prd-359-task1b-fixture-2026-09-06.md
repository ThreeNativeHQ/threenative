# PRD-359 Task 1b fixture proof — current state

Date: 2026-09-06. Worktree `HEAD da0d02e3` with the tracked Task 1b diff in
`packages/runtime-native/tests/runtime-test-utils.ts` and
`packages/runtime-native/tests/webtransport/webtransport.test.ts`. No runtime source,
dependency, or pin changed in this row.

This record describes the corrected source and the `rev2*.log` records. Earlier red logs are
labelled historical below and are not current acceptance evidence.

## Current behavior

- `TN_NATIVE_RUNTIME_EXECUTABLE` overrides the native host. Relative paths resolve from the
  invoking working directory; a whitespace-only value throws and cannot silently select the
  default. Without an override, Linux/macOS/Windows resolve to the shipped `tn-linux`, `tn-macos`,
  and `tn-windows` presets, with `mystral.exe` on Windows.
- The required missing-runtime case is a real child process. It launches `process.execPath` with
  Vitest's resolved JavaScript entry from its package manifest, rather than spawning a shell shim.
  It sets `TN_REQUIRE_LIVE_WEBTRANSPORT_FIXTURE=1` and asserts a nonzero exit containing the exact
  missing path.
- The expiry fixture creates one per-run CA and two leaves under the untracked test directory.
  `openssl ca -startdate/-enddate` writes the validity window; `openssl x509` reads the dates back
  from the served files. The expired leaf is required to have `notAfter < now`; the control leaf's
  window must contain `now`. The two leaves have the same CA, subject, SAN, key usage, and EKU, but
  distinct generated keys and CA serials; the proof makes no false “dates are the only bytes” claim.
- The expired case first performs an exact-URL insecure datagram echo, then requires secure
  verification to reject. The same CA's valid-date leaf must complete a verified datagram echo.
  Both secure cases require `verify-peer` and reject the insecure/bad-trust diagnostics.
- Expiry `afterAll` attempts to stop both fixture children with `Promise.allSettled`, aggregates
  shutdown failures, clears references, and removes the fixture directory in `finally`. Optional
  lanes skip missing prerequisites; required lanes throw from `failClosed`.

## Current evidence (`rev2`)

| Record | Result |
| --- | --- |
| `rev2-focused-green.log` | Exit 0; five new executable/expiry tests passed, 792 unrelated tests skipped. Date readback shows an expired leaf and a currently valid control. |
| `rev2-live-suite-full.log` | Exit 0; 33/33 live tests passed. |
| `rev2-live-suite-override.log` | Exit 0; 33/33 passed through the explicit executable override. |
| `rev2-default-lane-no-display.log` | Exit 0; 3 unit tests passed and 30 live tests skipped. |
| `rev2-helper-consumers.log` | Exit 0; 8 files, 75 passed, 21 skipped. |
| `rev2-nested-required-run.log` | Exit 1 as required; 33 skipped and the exact absent runtime path appears in the fail-closed prerequisite error. |
| `rev2-control-valid-dates-behavior.log` | Intentional red: replacing the expired leaf with the valid-date leaf made the test observe `FAIL: accepted an expired certificate`. |
| `rev2-control-valid-dates-guard.log` | Intentional red: the date-readback guard rejected a non-expired “expired” fixture and failed the required lane. |

Coordinator gates recorded separately: full test exit 0 (`389` files, `4265` passed, `7` skipped),
typecheck exit 0, lint exit 0 with 613 existing warnings, and format exit 0 after comment-only
corrections.

## Historical records

`green1-executable-override.log`, `expiry-first-run.log`, `expiry-second-run.log`,
`expiry-green.log`, `control-expiry-is-the-variable.log`, and the original live records predate
the final corrections. Their red results are retained as repair history, not as current failures or
acceptance evidence. The first expiry red was the malformed time-generation fixture; the current
source uses the portable `openssl ca` date options and has no OpenSSL 3.5 setter-flag prerequisite.

## Limits

Live evidence is Linux desktop only. macOS/Windows behavior is covered by path-resolution tests,
not execution on those hosts. Numeric-IP identity, browser interoperability, and dependency
distribution remain separate Task 1b work.

## Actual callers and commands

`packages/runtime-native/tests/runtime-test-utils.ts:34` resolves the executable used by
`tests/webtransport/webtransport.test.ts:1920` (required missing-path child) and the existing
`runScript` host launcher. Expiry rejection is collected at line 1827 and the current-date
control at line 1847; override behavior is collected at line 1886.

From the worktree root, the corrected live command was:

```sh
XDG_RUNTIME_DIR=/tmp/xdg-runtime-wt TN_REQUIRE_LIVE_WEBTRANSPORT_FIXTURE=1 sh scripts/xvfb.sh pnpm --dir packages/runtime-native exec vitest run --config vitest.config.ts tests/webtransport/webtransport.test.ts
```

Exit 0, final live output: `Tests 33 passed (33)`. The same command with
`TN_NATIVE_RUNTIME_EXECUTABLE=/tmp/tn-override-mystral-359` also exited 0, 33/33.
The missing-executable regression initially observed exit 0 from the child despite an absent
override, causing `expected +0 not to be +0` (outer exit 1). After repair the required child
exits 1 naming the missing path, and the outer assertion passes.

The expiry date mutant used the same live test filtered to `rejects an expired certificate`.
Replacing the expired leaf with the current-date fixture produces
`FAIL: accepted an expired certificate` and exit 1; the mutation was restored before the
final 33/33 run. The separate date-readback mutant fails fixture setup and is not presented
as an application-behavior regression.

Coordinator verification, each exit 0:

```sh
pnpm test
pnpm typecheck
pnpm lint
pnpm exec vitest run scripts/__tests__/primary-docs.spec.ts
```

Typecheck ran after the full suite completed. Logs are `/tmp/prd359-task1b-fixture-{full-test,typecheck,lint,primary-docs}.log`. The full suite reports root 4265 passed/7 skipped; the native package result is also retained in the full log.

Final repository gates: native package `101 passed`, `744 passed | 53 skipped`; root
`389 passed | 2 skipped` files, `4265 passed | 7 skipped` tests. Typecheck and lint exit 0
(lint retains 613 existing warnings). Primary-doc tests exit 0. The initial budgets run
reported stale native coverage after the test-source change; the canonical native coverage
and census generators ran successfully, then `pnpm budgets` exited 0. No coverage floor
or platform requirement was lowered. Final logs:
`/tmp/prd359-task1b-fixture-{native-coverage,census,budgets-final}.log`.

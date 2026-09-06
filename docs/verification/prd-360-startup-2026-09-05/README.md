# PRD-360 — pump-silence observer and launch-wiring proof, desktop, 2026-09-05

Bounded claim: **the engine measures launch event-pump silence on desktop Linux
under a private Xvfb, and the launch wrapper collects and evaluates that
measurement.** Nothing here accepts PRD-360, closes a phase, or reports an
Android, browser, real-workload, or frame-rate result. The device-acceptance
bullets stay open.

Observer: `mystral::PumpSilenceObserver` stamps every `pollEvents()` entry on
the `coldStartNowMs()` clock, retains the unfiltered maximum inter-pump gap
plus every gap ≥ 250 ms (64-cap with overflow counting, max kept separately),
and emits one `TN_PUMP_SILENCE` line at the bounded endpoint — first present,
else main-loop exit, else shutdown. `TN_PUMP_ENDPOINT` on the existing mailbox
`respond()` carries the response path, stored flag, FNV-1a content tag and byte
count of the exact stored bytes, plus a non-consuming pump snapshot stamped at
report time. Missing, malformed, nonfinite, unstored, stale, foreign-response,
or absent endpoint evidence fails closed. Desktop trivial-bundle bring-up shows
process-to-first-pump ≈ 300–410 ms, already above the 250 ms device budget;
the budget is unchanged and that finding is not concealed.

## Result (final integrated host `b5af03ff…`, contract binary `601113fd…`)

| Proof | Result |
| --- | --- |
| C++ contract `threenative-pump-silence-test` (injected clock) | pass — 22/22 checks incl. new backwards-clock guard |
| vitest `tests/pump-silence.test.mjs` (real desktop host) | 11/11 pass |
| CTest `-R pump-silence` | pass |
| Evaluator validation `validate-evaluator.mjs` | 29/29 cases behave as required, including missing response identity, missing runner position, inconsistent timestamps, forged preflight, ack-only, collector-error, pump-count/span, and preflight-order negatives |
| Collector flow `collector-flow.mjs` (real host + mailbox, mocked adb) | correlated endpoint evaluates; hash matches; truncated → MISSING, foreign → UNPROVEN, empty → MISSING |
| Current desktop probe | `firstPumpAtMs≈410ms` → `R7_PUMP_SILENCE_EXCEEDED` (correct rejection, not a device claim) |

## What the negative controls delete

- C++ contract: removing the observer fix (or reverting the backwards-clock
  guard) fails the retention/max assertions; the never-entered control proves a
  missing observation can never read as a small maximum.
- Host probes: a 400 ms in-pump spin lands in the trailing interval; a plain
  timer run with a 400 ms spin proves the inter-entry half; SIGKILL leaves no
  line and the parser throws `TN_PUMP_SILENCE_UNOBSERVED`.
- Evaluator: frozen/observer-less APK logs fail R7 while R4 movement stands;
  wrong-path, stale, unstored, and non-displacement endpoints fail with named
  codes.

## Review fixes integrated after the last worker handoff

1. Non-positive inter-entry gaps (backwards clock step) no longer move the
   maximum or the retained list; counters still advance. New contract case.
2. Endpoint FNV-1a iterates bytes by index with an explicit `unsigned char`
   cast (no `char`-sign or locale dependence); verified byte-identical with
   the JS `fnv1a64()` on the same string (`32e51dac937672f3` for `{"a":1}`).
3. New contract target registered in all five required sites: `CMakeLists.txt`,
   `tests/native-contract-lane.test.mjs` (count 35 → 36),
   `scripts/verify-native-contracts.mjs`, `build-matrix.json` (tn-linux and
   tn-linux-coverage), plus `pnpm census` and `native:coverage` regeneration.
4. Full pump evaluation now requires the runner's finite post-input position,
   reconciles endpoint timestamps, pump counts, and single/multi-pump span,
   pins the 50% preflight floor and serial/freshness/order identity, and asserts
   the collector's intended failure codes instead of merely printing them.

## Provenance

- Host binary: `b5af03ffaa0aeb4da2d2c235d905be0b8b71dcda46bdcfc0201b1be9e987d3c9`
  (`packages/runtime-native/build/tn-linux/mystral`), rebuilt from the
  integrated sources in this commit. Earlier identities (`6f5263e0…`,
  `b61f168d…`) are superseded — do not cite them for this code.
- Contract binary:
  `601113fd9eefca607d721cc0142112189cccd87a2d265871e1878df1ba2d51f1`.
- Observer sources: `packages/runtime-native/include/mystral/pump_silence.h`,
  `src/runtime.cpp` (entry stamp, loop-exit/shutdown flush, endpoint),
  `src/webgpu/bindings_presentation.cpp` (first-present flush),
  `CMakeLists.txt`, `tests/pump_silence_test.cpp`,
  `tests/pump-silence.test.mjs` — 6 implementation/test files (file-budget
  variance vs the 5-file phase cap stays open; no phase accepted).
- Registration: `scripts/verify-native-contracts.mjs`,
  `tests/native-contract-lane.test.mjs`, `build-matrix.json`; generated
  records `docs/verification/native-coverage-2026-08-28.md`,
  `docs/verification/native-runtime-census-2026-08-16.md`.
- Executed proof sources, byte-identical to the run inputs (checked with
  `cmp`): [`measure-first-playable.mjs.txt`](measure-first-playable.mjs.txt)
  (`3256a881…`), [`evaluate-first-playable.mjs.txt`](evaluate-first-playable.mjs.txt)
  (`40dbf12d…`), [`validate-evaluator.mjs.txt`](validate-evaluator.mjs.txt)
  (`db5c73d8…`), [`collector-flow.mjs.txt`](collector-flow.mjs.txt)
  (`8d50b896…`). Live originals remain under
  `artifacts/batch-2026-09-05/startup-repack-preparation/first-playable/` and
  `artifacts/batch-2026-09-05/pump-observer/` (git-ignored).
- Full Android end-to-end (real device, real adb) is **unexecuted** — the
  collector flow mocks only the adb transport adapter. The already-built
  candidate APK `403bd10c…` predates the observer and cannot emit the
  endpoint. A new Android candidate must be rebuilt from this code.

## Reproducing

From the worktree root (paths below are worktree-relative; the `.txt`
suffix exists because the verification dir retains sources, not executables):

```sh
cmake --build packages/runtime-native/build/tn-linux --target mystral threenative-pump-silence-test
./packages/runtime-native/build/tn-linux/threenative-pump-silence-test
ctest --test-dir packages/runtime-native/build/tn-linux -R pump-silence
pnpm --dir packages/runtime-native exec vitest run tests/pump-silence.test.mjs
node artifacts/batch-2026-09-05/startup-repack-preparation/first-playable/validate-evaluator.mjs
node artifacts/batch-2026-09-05/pump-observer/collector-flow.mjs
```

Gates executed for this follow-up: evaluator validation (29/29), real-host
collector flow (assertions pass), full desktop pump verification (assertions
pass), `pnpm test` (391 files / 4,289 tests passed, 2 files / 7 tests
skipped), `pnpm typecheck` (pass), in-scope Biome checks (pass; root
`pnpm lint` still reports pre-existing `noExcessiveCognitiveComplexity`
findings in unrelated examples plus ignored `.linchpin` JSON result files —
untouched), and `pnpm budgets` (pass: LOC triggers report-only).
`native:coverage` and `pnpm census` were regenerated before the follow-up
commit.

File-budget note for the checkpoint reviewer: the observer phase spans 6
implementation/test files against a 5-file phase cap. The earlier worker
split miscounted this as 7 (double-counting registration) and as 6 = 5.
Counted accurately here; resolution (split or cap relief) is still open.

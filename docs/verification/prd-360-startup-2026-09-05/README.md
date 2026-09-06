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

## Result (current integrated host `50144dc9…`, contract binary `601113fd…`)

| Proof | Result |
| --- | --- |
| vitest `tests/pump-silence.test.mjs` (real desktop host) | 11/11 pass |
| Evaluator validation `validate-evaluator.mjs` | 32/32 cases behave as required, including missing response identity, missing runner position, inconsistent timestamps, forged preflight, ack-only, collector-error, pump-count/span, impossible gap endpoints, and both-preflight-order/qualification negatives |
| Collector flow `collector-flow.mjs` (real host + mailbox, mocked adb) | correlated endpoint evaluates; hash matches; truncated → MISSING, foreign → UNPROVEN, empty → MISSING |
| Current desktop probe | `firstPumpAtMs≈410ms` → `R7_PUMP_SILENCE_EXCEEDED` (correct rejection, not a device claim) |

## What the negative controls delete

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
3. Full pump evaluation now requires the runner's finite post-input position,
   reconciles endpoint timestamps, pump counts, single/multi-pump span, and gap
   endpoints, pins the 50% preflight floor on both readings plus serial/freshness/
   order identity, and asserts the collector's intended failure codes instead of
   merely printing them.

## Provenance

- Host binary: `50144dc9a22ecacaa6f5c764f043297818a3b77c2894f6696a6e6938a5e7d8b9`
  (`packages/runtime-native/build/tn-linux/mystral`), rebuilt from the
  integrated working-tree sources. Earlier identities (`b5af03ff…`,
  `6f5263e0…`, `b61f168d…`) are superseded — do not cite them for this code.
- Contract binary:
  `601113fd9eefca607d721cc0142112189cccd87a2d265871e1878df1ba2d51f1`.
- Observer sources: `packages/runtime-native/include/mystral/pump_silence.h`,
  `src/runtime.cpp` (entry stamp, loop-exit/shutdown flush, endpoint),
  `src/webgpu/bindings_presentation.cpp` (first-present flush),
  `CMakeLists.txt`, and `tests/pump-silence.test.mjs` — 5 implementation/test
  files, matching the phase cap. The standalone injected-clock C++ contract was
  removed; the retained real-host probes remain the executable proof.
- Registration: the observer has no standalone CTest target; generated records
  `docs/verification/native-coverage-2026-08-28.md` and
  `docs/verification/native-runtime-census-2026-08-16.md` must reflect the
  reduced contract set.
- Executed proof sources, byte-identical to the run inputs (checked with
  `cmp`): [`measure-first-playable.mjs.txt`](measure-first-playable.mjs.txt)
  (`e00ea115…`), [`evaluate-first-playable.mjs.txt`](evaluate-first-playable.mjs.txt)
  (`0fe197612…`), [`validate-evaluator.mjs.txt`](validate-evaluator.mjs.txt)
  (`53ff52b…`), [`collector-flow.mjs.txt`](collector-flow.mjs.txt)
  (`0536c90c…`). Live originals remain under
  `artifacts/batch-2026-09-05/startup-repack-preparation/first-playable/` and
  `artifacts/batch-2026-09-05/pump-observer/` (git-ignored).
- Full Android end-to-end (real device, real adb) is **unexecuted** — the
  collector flow mocks only the adb transport adapter. Candidate APK
  `20da12fa…` was rebuilt from this reviewed code, but no device run is
  claimed; the earlier `403bd10c…` candidate predates the observer.

## Reproducing

From the worktree root (paths below are worktree-relative; the `.txt`
suffix exists because the verification dir retains sources, not executables):

```sh
cmake --build packages/runtime-native/build/tn-linux --target mystral
pnpm --dir packages/runtime-native exec vitest run tests/pump-silence.test.mjs
node artifacts/batch-2026-09-05/startup-repack-preparation/first-playable/validate-evaluator.mjs
node artifacts/batch-2026-09-05/pump-observer/collector-flow.mjs
```

Gates executed before this consolidation: evaluator validation (32/32),
real-host collector flow (assertions pass), full desktop pump verification
(assertions pass), `pnpm test` (391 files / 4,291 tests passed, 2 files / 7
tests skipped), `pnpm typecheck` (pass), root `pnpm lint` (exit 0; 600
existing complexity warnings, 0 errors, with `.linchpin/**` ignored by
`biome.json`), and `pnpm budgets` (pass: LOC triggers report-only).
The focused real-host suite and native records must be rerun after the file
consolidation.

## Linchpin integration checkpoint — 2026-09-06

The read-only crouter checkpoint reviewer returned `VERDICT: APPROVE` with
zero `DEFECT` findings. It recorded three `EVIDENCE-GAP`s: the desktop
transport test uses a hand-written displacement-shaped payload; real Android
end-to-end and real-host `device.ts` order tracking remain unexecuted. These
gaps remain open and no PRD phase is accepted.

Fresh focused checks after the consolidation passed: CMake rebuilt `mystral`;
pump Vitest passed 11/11; native registration and coverage tests passed 30/30;
evaluator validation passed 32/32; and collector flow passed its correlated,
truncated, foreign, and missing-response cases.

File-budget resolution: the standalone injected-clock C++ contract and its
registrations were removed. The observer now spans 5 implementation/test files,
matching the Phase 1 cap; real-host JavaScript proof remains required.

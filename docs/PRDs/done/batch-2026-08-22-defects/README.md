# batch-2026-08-22 — today's most valuable work

Ranked 2026-08-22 from tree state: the round ledger, the open defect PRDs, and one fresh
reproduction. Step 0 unblocks the improvement loop; 1–3 are the defects, most valuable first.

## 0. Close round 12 (~minutes)

`pnpm round:next` reports: "All evidence and dispositions are recorded; close the round." Close it
per the ledger contract in `docs/verification/round-12*.md`. In the same commit, clear the stale
gate record — `pnpm gate:status` shows RED only because HEAD moved after the unit phase succeeded
(`exitCode: 0`, `state: "succeeded"`); rerun `pnpm test` or let the next long gate overwrite
`artifacts/gates/status.json`.

## 1. [PRD-176](../PRD-176-navigation-scenario-navigator-never-moves.md) — COMPLETE 2026-08-22 — navigator never moves, plus a coverage hole

Deterministic red, reproduced twice today at HEAD: the abyss-framework navigator accumulates zero
movement over 212 frames with a clean console, and `navigation.playtest.json` is not in the default
playtest chain, which is how the red stayed invisible across sessions. Highest of the three because
it is deterministic, freshly evidenced, and the example fixture currently cannot go green.

Estimate: half a day including the mutation proof (criterion 3).

## 2. [PRD-167](../PRD-167-desktop-playtest-mailbox-goes-silent.md) — COMPLETE 2026-08-22 — desktop playtest mailbox goes silent after replay

Flaky hang: 2 of 4 runs exit `2` with `TN_PLAYTEST_OPERATION_TIMEOUT` while the app itself stays
alive and already executed the capability under test. A gate that hangs without a cause poisons
every later desktop measurement with false reds. Repro is cheap: four consecutive desktop runs of
the PRD-162 scenario.

Estimate: unknown until the cause is named; budget half a day to the named-diagnostic criterion.

## 3. [PRD-166](../PRD-166-camera-parented-overlay-never-marks-on-android.md) — COMPLETE 2026-08-22 — emulator scene never reaches its marker

The Android lane exits `1` on `25-camera-parented-overlay`, keeping it at `66 / 1 / 0`. The emulator
lane runs unattended on this machine, so this is fully actionable without hardware — but it is the
longest of the three, and nothing downstream is blocked by it today.

Estimate: a day, most of it logcat correlation.

## Scorecard slice — filed 2026-08-22 from plans/threenative-area-scorecard-2026-08-22.md

A four-audit sweep of every area (correctness/security, tests/architecture, perf/deps/DX,
direction), each finding verified at HEAD `a84f08da`, scored all ten areas 0–100. This section
slices the four lowest — runtime-native 54, playtest 60, scripts/DX 62, core 70 — into PRDs.
Numbering continues from PRD-176.

| PRD | What it closes | Complexity | Lane |
| --- | --- | --- | --- |
| [177](../../BLOCKED/requires-asan-libuv-source-build/PRD-177-native-restart-shutdown-lifetime.md) | BLOCKED 2026-08-22 (phases 2–3 → [PRD-184](../../BLOCKED/requires-asan-libuv-source-build/PRD-184-native-shutdown-ownership-transfer.md); phase 1 + restart row shipped and proved) — native restart ghosts input + libuv close-then-clear UAF at three shutdown sites; direct C++ lifetime tests and a restart conformance row | 6 HIGH | native build required; one owner across phases |
| [178](../PRD-178-green-means-green-gate-hygiene.md) | COMPLETE 2026-08-22 — four never-collected duplicate suites; diagnostics prescribing forbidden `xvfb-run`; double-build/double-vitest pipeline; orphaned root argon2/pg; catalog nits | 5 MEDIUM | quick wins |
| [179](../PRD-179-instruments-measure-growth.md) | COMPLETE 2026-08-22 — quality report keys by file:line ignoring values (42 fake-"new"; hotspots grow as "inherited"); six long chains invisible to gate:status/resume | 5 MEDIUM | after or with 178 |
| [180](../PRD-180-core-lifecycle-failure-atomicity.md) | COMPLETE 2026-08-22 — boot throw-paths leak half-booted games (abort path is fine); teardown first-throw-wins; `goto()` wipes state before validating | 4 MEDIUM | core unit lane |
| [181](../PRD-181-honest-core-packaging-seam.md) | COMPLETE 2026-08-22 — published core inlines a hidden playtest copy (`noExternal` masking a devDep-only import); hardcoded stale CORE_VERSION | 4 MEDIUM | packaging/consumer lane |
| [182](../PRD-182-playtest-monolith-containment.md) | COMPLETE 2026-08-22 — contained the three hottest monoliths (evaluators 2,312 / scenario 1,867 growing / runner 1,800 top-churn) behind facades, characterization-first, zero behavior change | 5 MEDIUM, highest risk | last in the batch |

**Suggested order:** 178 → 179 (green gates first, so every later measurement is trusted) →
180 → 181 (independent) → 177 (longest, needs `pnpm native:build`) → 182 (needs 179's honest
quality report to prove its LOC outcome). No PRD here depends on another for correctness.

**Lead handed to PRD-176's diagnosis:** the correctness audit found
`packages/physics/src/navigation/NavigationAgent3D.ts:159-165` stores the computed path *before*
judging reachability and leaves it set on unreachable targets, while `syncCrowd`'s re-request gate
(`:256-259`) trusts `#path.length > 0` — regressed by `8a5104cc`. A navigator that never moves is
consistent with this store-then-reset contradiction. Prime suspect for criterion 1; verify before
attributing.

**Deliberately not sliced into PRDs (owner decisions / above the score cut):**
native LOC trigger at 79,139/50,000 (+58%) — justify per the PRD-069/175 evidence or run the kill
switch; Phase-2 exclusivity condition; physics mass-seam asymmetry and the example deep-import
(physics 82 and examples 74 sit above this batch's cut — both S-effort, fold them wherever
convenient).

## Closing the batch

Grouped batch: `git mv docs/PRDs/batch-2026-08-22/ docs/PRDs/done/batch-2026-08-22/` in the commit
that closes the last PRD — never earlier (`docs/PRDs/AGENTS.md`).

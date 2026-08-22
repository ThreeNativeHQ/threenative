# batch-2026-08-22 — today's most valuable work

Ranked 2026-08-22 from tree state: the round ledger, the open defect PRDs, and one fresh
reproduction. Step 0 unblocks the improvement loop; 1–3 are the defects, most valuable first.

## 0. Close round 12 (~minutes)

`pnpm round:next` reports: "All evidence and dispositions are recorded; close the round." Close it
per the ledger contract in `docs/verification/round-12*.md`. In the same commit, clear the stale
gate record — `pnpm gate:status` shows RED only because HEAD moved after the unit phase succeeded
(`exitCode: 0`, `state: "succeeded"`); rerun `pnpm test` or let the next long gate overwrite
`artifacts/gates/status.json`.

## 1. [PRD-176](./PRD-176-navigation-scenario-navigator-never-moves.md) — navigator never moves, plus a coverage hole

Deterministic red, reproduced twice today at HEAD: the abyss-framework navigator accumulates zero
movement over 212 frames with a clean console, and `navigation.playtest.json` is not in the default
playtest chain, which is how the red stayed invisible across sessions. Highest of the three because
it is deterministic, freshly evidenced, and the example fixture currently cannot go green.

Estimate: half a day including the mutation proof (criterion 3).

## 2. [PRD-167](./PRD-167-desktop-playtest-mailbox-goes-silent.md) — desktop playtest mailbox goes silent after replay

Flaky hang: 2 of 4 runs exit `2` with `TN_PLAYTEST_OPERATION_TIMEOUT` while the app itself stays
alive and already executed the capability under test. A gate that hangs without a cause poisons
every later desktop measurement with false reds. Repro is cheap: four consecutive desktop runs of
the PRD-162 scenario.

Estimate: unknown until the cause is named; budget half a day to the named-diagnostic criterion.

## 3. [PRD-166](./PRD-166-camera-parented-overlay-never-marks-on-android.md) — emulator scene never reaches its marker

The Android lane exits `1` on `25-camera-parented-overlay`, keeping it at `66 / 1 / 0`. The emulator
lane runs unattended on this machine, so this is fully actionable without hardware — but it is the
longest of the three, and nothing downstream is blocked by it today.

Estimate: a day, most of it logcat correlation.

## Closing the batch

Grouped batch: `git mv docs/PRDs/batch-2026-08-22/ docs/PRDs/done/batch-2026-08-22/` in the commit
that closes the last PRD — never earlier (`docs/PRDs/AGENTS.md`).

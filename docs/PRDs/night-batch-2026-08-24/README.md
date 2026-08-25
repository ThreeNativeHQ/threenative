# Night batch — 2026-08-24 → 2026-08-25

**Purpose:** the queued work for tonight's overnight agents. Selected 2026-08-24 ~22:00 after
the day's three batches finished in their worktrees (pending merge):
`batch-2026-08-23-mobile-stability`, `batch-2026-08-24-fps-framework-mobile-perf`,
`batch-2026-08-24-menu-screen-flow`.

This folder is an **execution manifest plus two new PRDs**. Existing PRDs referenced here stay
in their owning batches — batches move whole to `done/` per `docs/PRDs/AGENTS.md`; nothing is
moved into this folder.

## Step 0 — before any lane starts

1. **Merge the three done batches** from their worktrees into `main`. Every PRD below assumes
   their content is in HEAD (`goto(carry)`, the `click` step, the starter `MainMenu`, the warm-up,
   the presentation cap, app-scoped Android storage).
2. **Resolve the PRD-218 ID collision at merge:** both day batches shipped a file numbered
   218 (`PRD-218-fps-framework-native-load-fps-heat.md`,
   `PRD-218-scene-screens-and-menu-flow.md`). Renumber one at merge time — next free id is
   222 — and update any references.
3. **The primary checkout had a live lane at filing time** — uncommitted device-metrics +
   scheduler-yield work (`packages/playtest/src/**deviceMetrics*`,
   `packages/runtime-native/tests/scheduler-yield.test.mjs`, `runtime.cpp`, warmup edits).
   Do not touch those files; if they are still uncommitted at kickoff, let that lane land first
   and rebase lanes on top of it.
3. After merging: `pnpm typecheck && pnpm lint && pnpm test` must be green before any lane
   branches. Commit as you go — other agents share this tree.

## Lanes

| Lane | Device | Queue | Why tonight |
| --- | --- | --- | --- |
| A — honesty debt | none (unit gates) | [PRD-199](../batch-2026-08-23-tech-debt/PRD-199-parity-scenario-validation-fails-closed.md) → [PRD-201](../batch-2026-08-23-tech-debt/PRD-201-scaffolder-derives-what-it-ships.md) → [PRD-197](../batch-2026-08-23-tech-debt/PRD-197-native-host-fails-loudly-at-creation.md) → [PRD-198](../batch-2026-08-23-tech-debt/PRD-198-raytracing-surface-stays-dark-until-results-exist.md) → [PRD-200 phases 1–2](../batch-2026-08-23-tech-debt/PRD-200-playtest-evaluator-plumbing-is-single-sourced.md) → **hygiene tail** (see below) | Pre-scoped red-green-in-hours work; fail-closed honesty is the house's top rule. Start with 199/201 (zero file overlap with the device-metrics lane); 197/198 begin only after step 0's WIP has landed (they touch `runtime-native`). 200 phase 3 waits for PRD-202 — out of scope tonight |
| B — menu flow on Android | `emulator-5554` | [PRD-219](./PRD-219-android-proof-of-the-menu-flow-starter.md) (new) | Today's headline convention proved web-only; the house rule says web-only is unfinished |
| C — physical Pixel 8 | `192.168.1.192:5555` | Finish [PRD-217](../PRD-217-webview-ui-layer.md) criterion 3 + Phase 3B, then [PRD-214 Phase 0](../batch-2026-08-23-mobile-stability/PRD-214-render-js-owns-the-mobile-frame.md), then **device tails** (see below) | 217 died at 39.8 °C / 13 % battery mid-capture — overnight is the thermal reset. Then the 19 FPS ceiling bisect, sequenced last by its own batch because the lanes above were needed first |
| D — distribution | local Gradle build | [PRD-220](./PRD-220-apk-size-is-attributed.md) (new) | The fps-framework APK measured 379 MB; nobody can name where the bytes are |
| E — stretch, time-boxed | emulator + local build | [PRD-221](./PRD-221-android-v8-is-16kb-clean.md) (new) | `libv8android.so` is the one library still failing Play's 16 KB rule; Phase 0 memo is mandatory, ending BLOCKED-with-a-name is an acceptable close |

**Lane A hygiene tail** (minutes each; these records mislead future agents until fixed):
add PRD-065 to the `BLOCKED/README.md` table; reconcile PRD-127's header ("PROPOSED,
nothing executed") with its batch README ("code landed on four lanes"); reconcile
`studio-hosting/README.md` ("nothing in 103/104/105 has run") with PRD-103's own passing-probe
record; add a re-scope note to PRD-066 Phases 2–5 flagging that PRD-130's V8 flip predates them.

**Lane C device tails**, only after 214 Phase 0: PRD-130's missing V8 conformance row on the
Pixel (dismiss the test-app dialog, one clean run — it is executed everywhere else and can be
archived); PRD-127's physical-device preflight criteria observed red.

## Device contention rules

- One lane owns the physical Pixel at a time: **C**, then B's stretch rung if C finishes
  before ~07:00.
- Ask before spending a run: `node packages/playtest/dist/runner/cli.js doctor --device
  <serial> --text`. Every Pixel run records `observations.deviceMetrics` and its comparability
  verdict; a `thermallyConfounded` run is rerun after cooling — never compared against a cool
  baseline. Benchmark gate: `packages/runtime-native/scripts/device-preflight.mjs`.
- Emulator and local-build lanes never touch the phone.

## Explicitly not tonight (needs the owner)

- **PRD-078 release tag push** (beta row 5): the Vulkan ICD blocker is fixed; pushing the tag
  is an outward action awaiting João.
- **PRD-077 desktop multitouch**: blocked on membership in the `input` group — one
  `sudo usermod -aG input joao` + re-login away; owner call.
- **Phase 2 beta gate instrument decision** (exclusivity red-with-attribution): strategy, not
  an overnight task.
- Charter-performance batch (189–195) and the remaining tech-debt structural passes
  (202, 203–208): next batch, after tonight's merges. The `OPPORTUNITY-AREAS.md` re-score
  (pending since 2026-08-17 under the retired rule) is an owner-working-session item, not a
  lane.
- PRD-073 Phase 2 (compressed-asset decoder) and PRD-067 (game app-config): both real, both
  design-first — deliberately not squeezed into this night next to four other lanes.

## Batch acceptance

- [ ] Each lane's PRDs have dated records in `docs/verification/` with red controls pasted.
- [ ] Device claims name their lane (physical Pixel 8 vs emulator) and never claim a platform
      that did not execute.
- [ ] `pnpm typecheck && pnpm lint && pnpm test && pnpm budgets` exit 0 after each PRD.
- [ ] Finished PRDs are `git mv`-ed to `done/` in the commit that closes them; this folder is
      deleted once every queue row above is closed or re-filed BLOCKED.

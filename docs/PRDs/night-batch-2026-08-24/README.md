# Night batch — 2026-08-24 → 2026-08-25

**Purpose:** the queued work for tonight's overnight agents. Selected 2026-08-24 ~22:00 after
the day's three batches finished in their worktrees (pending merge):
`batch-2026-08-23-mobile-stability`, `batch-2026-08-24-fps-framework-mobile-perf`,
`batch-2026-08-24-menu-screen-flow`.

**Amended 2026-08-25 ~00:15:** `batch-2026-08-24-fps-framework-mobile-perf` did **not** finish.
PRD-218 (native load/FPS/heat) closed the session **PARTIAL** — three of five criteria met, one
short, one not met — so that batch cannot move to `done/` and the work below is what remains. A
blocked or short criterion is not completion. Its evidence is
`docs/verification/prd-218-launch-stall-and-heat-2026-08-24.md`.

**Amended 2026-08-24 ~23:25 (device lanes, read before any APK build):** the 22:18 squash
(`0d6417f9`) left `main` failing every Android APK build —
`v8_engine.cpp:1454:23: error: no member named 'HasPendingException' in 'v8::Isolate'`
(desktop V8 13 has it, the Android V8 11 prebuilt does not). Fixed in `00d3020e` with a
`V8_MAJOR_VERSION` guard; both CMake toolchains verified green; evidence in
`docs/verification/squash-followup-v8-android-hasPendingException-2026-08-24.md`. Lanes that
branched from `557ed2ba` or earlier must sync `main` into their worktree before their next
Gradle build.

**Steering note 2026-08-25 ~00:40, for whoever files PRD-219's device leg:** before writing
BLOCKED — the observed signature (first tap owns:true and focuses the field, typed text
delivers, then the *second* click lands just outside `begin` across six environment variants)
matches Android IME resize, not a coordinate-contract bug: typing opens the keyboard, the
WebView shrinks, and the pre-computed `begin` coordinate points at the pre-keyboard layout.
Web passes because its driver never raises an IME. The candidate remedy lives in the runner
transport, editing neither the scenario nor the engine: after an Android text `input` step,
dismiss the keyboard (`adb shell input keyevent 111`) before later `click` steps, and cite the
existing `TN_UI_HITTEST` records as evidence either way. If tested and refuted, record the
refutation in the lane memo — that is a real result too.

**Steering note 2026-08-25 ~00:56, for the Gradle lanes (220, and any later APK build):** if
Gradle dies with a bare `26.0.2`, that is JDK 26 being selected — this machine's Gradle/Kotlin
lane wants **JDK 17**: `export JAVA_HOME=/usr/lib/jvm/java-17-openjdk` (and `ANDROID_HOME`
pointed at the SDK) before `./gradlew`. The prebuilt-release fetch failing closed with HTTP 404
is expected and correct: no release has ever been published (PRD-078); build from runtime
source.

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
| A — honesty debt | none (unit gates) | [PRD-199 — done](../done/PRD-199-parity-scenario-validation-fails-closed.md) → [PRD-201](../batch-2026-08-23-tech-debt/PRD-201-scaffolder-derives-what-it-ships.md) → [PRD-197 — done](../done/PRD-197-native-host-fails-loudly-at-creation.md) → [PRD-198](../batch-2026-08-23-tech-debt/PRD-198-raytracing-surface-stays-dark-until-results-exist.md) → [PRD-200 phases 1–2](../batch-2026-08-23-tech-debt/PRD-200-playtest-evaluator-plumbing-is-single-sourced.md) → **hygiene tail** (see below) → **PRD-218 remainder rows 1 and 4** (see below) | Pre-scoped red-green-in-hours work; fail-closed honesty is the house's top rule. Start with 199/201 (zero file overlap with the device-metrics lane); 197 landed with the PRD-205/207 squash; 198 begins only after step 0's WIP has landed (it touches `runtime-native`). 200 phase 3 waits for PRD-202 — out of scope tonight |
| B — menu flow on Android | `emulator-5554` | [PRD-219](./PRD-219-android-proof-of-the-menu-flow-starter.md) (new) | Today's headline convention proved web-only; the house rule says web-only is unfinished |
| C — physical Pixel 8 | `192.168.1.192:5555` | Finish [PRD-217](../PRD-217-webview-ui-layer.md) criterion 3 + Phase 3B, then [PRD-214 Phase 0](../batch-2026-08-23-mobile-stability/PRD-214-render-js-owns-the-mobile-frame.md), then **PRD-218 remainder rows 1–3** (see below, one session), then **device tails** (see below) | 217 died at 39.8 °C / 13 % battery mid-capture — overnight is the thermal reset. Then the 19 FPS ceiling bisect, sequenced last by its own batch because the lanes above were needed first |
| D — distribution | local Gradle build | [PRD-220 — done 2026-08-25, `4ade82c7`](../done/PRD-220-apk-size-is-attributed.md) | The fps-framework APK measured 379 MB; nobody can name where the bytes are. Attributed: packaging residue + unstripped native debug symbols; clean rebuild 173,572,580 bytes (`docs/verification/apk-size-2026-08-25.md`) |
| E — stretch, time-boxed | emulator + local build | [PRD-221](../BLOCKED/requires-v8-source-toolchain/PRD-221-android-v8-is-16kb-clean.md) (BLOCKED) | `libv8android.so` is the one library still failing Play's 16 KB rule; Phase 0 memo is mandatory, ending BLOCKED-with-a-name is an acceptable close |

**Lane A hygiene tail** (minutes each; these records mislead future agents until fixed):
add PRD-065 to the `BLOCKED/README.md` table; reconcile PRD-127's header ("PROPOSED,
nothing executed") with its batch README ("code landed on four lanes"); reconcile
`studio-hosting/README.md` ("nothing in 103/104/105 has run") with PRD-103's own passing-probe
record; add a re-scope note to PRD-066 Phases 2–5 flagging that PRD-130's V8 flip predates them.

**Lane A blocked-retry audit tail** (the `BLOCKED/` house rule: attempt the blocked step once
and record what actually happened). For each candidate below: run the blocked step **once**,
append the dated outcome to the BLOCKED folder, and move nothing unless it genuinely went
green — a still-red attempt is recorded, not retried all night. In scope (cheap machine work):
[PRD-112](../BLOCKED/requires-packed-gate/PRD-112-golden-path-from-packed-artifacts.md) (run the
packed seven-template gate once), [PRD-113](../BLOCKED/requires-sealed-proof/PRD-113-sealed-brief-naming-contract.md)
(positive behavior-based sealed proof, one attempt), [PRD-088](../BLOCKED/requires-ray-measurement/PRD-088-physics-spatial-queries.md)
(the authoritative ray measurement is itself the deliverable — do it, then re-file).
Out of scope, and why: PRD-054 cannot exit clean while PRD-077 keeps a blocked row on desktop
(and 077 needs the `input` group — owner call); PRD-056/058 are Tier-2 physical campaigns,
parked by owner decision, not one-night attempts.

**Lane C device tails**, only after 214 Phase 0, each a single capture pair that closes a
PRD or criterion outright: PRD-130's missing V8 conformance row (dismiss the test-app dialog,
one clean run — executed everywhere else); PRD-127's physical-device preflight criteria
observed red; [PRD-075](../PRD-075-loading-scene-separation.md)'s exact physical-Pixel perf
comparison (Phases 0–2 are green on browser + emulator; only this capture is open).

## PRD-218 remainder — what is actually left, in order

PRD-218 shipped the launch-stall instrument, the presentation cap, the Android storage fix, the
`scheduler.yield` host shim and the batching filing. What follows is the rest, ordered by
dependency first and value second. **Rows 1–3 are one device session, not three** — instrument and
fix on the host, then a single capture pair closes two criteria at once. Do not spend three Pixel
runs on this.

| # | What | Lane | Device | Why in this order |
| --- | --- | --- | --- | --- |
| 1 | **Name the 3.3 s residual** (criterion 1: 73.5 % → ≥ 80 %) | A, then C to confirm | none to write, one capture to prove | Pure host work and the cheapest row. The five native segments cover 8.7 s of an 11.7 s gap; the remainder is JavaScript inside the first frame — three's render walk and node building. Do it **before** row 2 so one capture proves both. |
| 2 | **The Phase 1 ordering fix** (criterion 2) | C | Pixel 8 | The launch-stall fix, and the only row that can move the 14.3 s launch. `#boot` calls `setHeld(true); start()` before the scene loads, and a held loop **still calls `onRender`** — so the first world render begins beside the warm-up and compiles everything in 8.0 s, starving the warm-up it runs next to. The loop must not render the world while warming. Then re-enable `warmUp` and re-measure. |
| 3 | **Re-read presents/s on a forced cheap frame** (criterion 3 tail) | C | Pixel 8 | The cap is proven by its reported `capHz` and by the game running under it, but the ≤ 65 presents/s reading on a genuinely cheap frame was never re-taken after the cap landed. One capture in the same session as row 2. Cheap-frame lane is the conformance package, not bayview. |
| 4 | **Attribute the 32 `THREE.Material: parameter 'map' has value of undefined` warnings** (criterion 5 tail) | A | none | Last open guard-rail. Name the source, then fix it or file it where it belongs — a warning nobody has traced is a warning everybody learns to ignore. |
| 5 | **Material-keyed `BatchedMesh` lane** | C, as PRD-214 Phases 1–2 | Pixel 8 | **Already queued** — filed into PRD-214's lever table with its measurement, so it is not a separate row in the lane table above. Sequenced after PRD-214 Phase 0 by that PRD's own design. |

**Read before starting row 2.** `renderer.compileAsync()` does not work on the native host, and
`packages/core/src/renderer.ts` documents it as the fix for exactly this stall. Measured: one
whole-scene call warmed nothing in 15.3 s while the first frame compiled the identical pipelines
synchronously in 8.0 s. One layer of that is fixed (`three`'s `yieldToMain` fell back to a whole
rendered frame because the host shimmed `self` and never shimmed `scheduler`); the remaining layer
is the ordering in row 2. Two dead ends are recorded in the verification file so they are not
re-walked: per-object `compileAsync` (6 of 490 in 15 s), and treating this as a scheduling problem
after the shim landed.

**Two traps this work already fell into**, both now guarded but worth naming for whoever picks it up:

- An unbounded `await` in the warm-up **held the launch open forever** — loop held, `substeps mean 0`
  across 300 frames, nothing thrown, no error in logcat, and the only visible symptom a game that
  rendered and never started. It reached the user as an enemy stuck in bind pose. `warmUp` is now
  bounded per compile and overall and always reports; keep it that way.
- Two runs read 44 s to first frame against a 14.7 s baseline and were **thermally confounded**, not
  regressed (43.2 °C / thermal status 2 against 38.2 °C / status 0). `doctor --device` and
  `observations.deviceMetrics` now exist precisely so this is caught by the harness rather than by
  a human noticing afterwards. Use them.

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
- [ ] `batch-2026-08-24-fps-framework-mobile-perf` moves to `done/` **only** once PRD-218's
      remainder rows 1–4 close it. Until then it stays in its own batch and the batch is not
      archived — a short criterion is not completion.

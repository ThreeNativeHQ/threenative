# Native platform evidence lane is red — root causes and fixes

Date: 2026-09-02. Workflow: `.github/workflows/native-platforms.yml`.
Last fully green run: 33509317488 (2026-09-01 12:44 UTC). Every completed run since is red.
Evidence: runs 33659686867, 33663389024, 33675488456 (main), 33676257646, 33685284181 (PRs).

## TL;DR

| Job | Root cause | Fix |
| --- | --- | --- |
| Desktop web/native parity | `check-lane-blocks.mjs` counts a documented, unexpired registry exclusion (`desktop-multitouch-input`) as "unexpectedly blocked" | make `unexpectedBlockedRows()` consult `registry.exclusions` — already in flight on `fix/parity-lane-honours-exclusions` |
| Android emulator visual parity | 1) the emulator multitouch supplemental proof fails → `reportExitCode()` returns 1; 2) the workflow's ledger heredoc re-implements the exit rule instead of importing it, so the ledger records exit 2 while the checker recomputes 1; 3) a single `--target android` invocation wrote web/desktop/ios reports too (full-matrix side effect that also overwrites the good web reference) | import `reportExitCode` in the ledger step; root-cause the multitouch proof and the matrix side effect |
| Scaffolded starter desktop artifact | `TN_NATIVE_STARTER_FRAME_NOT_RENDERED: only 5 distinct colours in 1280x720` on PR `useful-defaults-visibility-r5-20260902` — near-blank native frame, same family as the earlier template black-frame bugs | gate that PR's defaults change; keep capture + run log in the starter artifact on failure |
| Speed ("taking too long") | Not compilation. The desktop job's 45 minutes is the conformance comparison itself (73 rows × ~37 s, serial, software GL). Android: ~25 min of rows plus uncached SDK/gradle/Rust setup. ccache is working but weak (28% hits, 51% of compile calls uncacheable) | cache Android SDK + gradle + cargo; share web references between lanes; fix the matrix side effect; shard/parallelize rows |

## 1. Desktop web/native parity (job red since the 2026-08-31 verify step landed)

The conformance run itself passes: 73 pass / 0 fail / 19 blocked
(run 33675488456, 20:42:22). One blocked row is a deliberate, documented exclusion:

- Registry exclusion `desktop-multitouch-input` — target `desktop`, row `90-multitouch-input`,
  expires 2026-12-31 (`packages/runtime-native/conformance/registry.json:43-52`).
- The runner blocks that row with reason `TN_PARITY_ROW_EXCLUDED: …` on desktop
  (`packages/runtime-native/conformance/run-conformance.mjs:2424-2431`), added 2026-08-10 (734b2071).

The gate that fails the job:

- `check-lane-blocks.mjs` → `unexpectedBlockedRows()`
  (`packages/runtime-native/conformance/run-conformance.mjs:2233-2254`) never reads
  `registry.exclusions`. It only forgives rows whose registry status is not `implemented`
  and hardware-adapter refusals. The excluded row is `implemented`, so it counts as
  "1 unexpectedly blocked" → `TN_CONFORMANCE_LANE_UNACCEPTABLE` → exit 1 → job red.
- The verify step landed on the desktop lane 2026-08-31 21:54 (dc4775c1, PRD-303); the exclusion
  and the implemented row are older (2026-08-09/10), so the checker and the exclusion shipped
  without ever meeting on a green lane.

**Fix (already in flight):** `fix/parity-lane-honours-exclusions` makes the lane honour
exclusions; its run 33685284181 turned desktop parity green. Land it. While reviewing, make
`unexpectedBlockedRows()` skip only *unexpired* exclusions for the report's target, reusing the
expiry check that already exists (`expiredExclusions()`, run-conformance.mjs:311), so an expired
exclusion still goes red through the `TN_PARITY_EXCLUSION_EXPIRED` path.

## 2. Android emulator visual parity (three stacked defects)

### 2a. The multitouch supplemental proof fails on the emulator

`reportExitCode()` (`run-conformance.mjs:2257-2263`) returns 1 when
`supplemental.androidMultitouch.status === "fail"`. The run's android report is 74 pass / 0 fail /
18 blocked, yet `check-parity-ledger.ts` recomputed exit **1** — only the multitouch-fail branch
explains that with `fail === 0`. The emulator script's `test "$status" -eq 0 -o "$status" -eq 2`
then fails (status 1) → the "Run checksum-locked APKs" step goes red.

Open item: the artifact (485 MB) holds the report's `supplemental.androidMultitouch` detail.
Prime suspect for the regression window is 05699e33 (2026-09-01 19:19, sync of diverged mains,
first commit after the last green run): it moved the multitouch proof *before* `executeRows`
(`run-conformance.mjs:2519-2532`) and added `prepareAndroidEmulator` /
`launchAndroidConformanceActivity` into the row-launch path.

### 2b. The ledger heredoc re-implements the exit rule and has already drifted

The workflow's "Verify captured parity ledger" step hardcodes
`exit = fail > 0 ? 1 : blocked > 0 ? 2 : 0` (native-platforms.yml:182, desktop variant :311),
but the runner's real rule has two more branches (multitouch fail → 1, expired exclusions → 2).
Result in run 33675488456, 20:22:38:

```
FAIL …/prd-215-parity-ledger.md
  Android emulator / Exit: records exit 2, but a summary of 74 pass / 0 fail / 18 blocked exits 1.
  Android emulator / Exit: records exit 2, but …/conformance/android/report.json recomputes to exit 1.
```

The desktop lane carries the same duplicated rule and will drift the same way the first time a
desktop report carries supplemental state.

**Fix:** both heredocs should `import { reportExitCode } from "…/run-conformance.mjs"` (the exact
import `scripts/check-parity-ledger.ts:57-70` already loads) instead of transcribing the rule.
The runner exports it precisely "so the two can never drift apart" (run-conformance.mjs:2220-2222)
— the heredocs defeat that.

### 2c. A `--target android` invocation ran the whole four-target matrix

The emulator step invokes one runner process (native-platforms.yml:153-158). The job log shows
four reports written during that invocation, in matrix order:

| time | report | summary |
| --- | --- | --- |
| 19:55:16 | `conformance/web/report.json` | 0 / 0 / 92 — **overwrites the web reference captured at 19:53:51 (74/0/18)** |
| 19:56:37 | `conformance/desktop/report.json` | 0 / 0 / 92 — on a lane that never built the desktop host |
| 20:21:55 | `conformance/android/report.json` | 74 / 0 / 18 |
| 20:22:35 | `conformance/ios/report.json` | 0 / 0 / 92 |

The sibling paths and matrix order match `runAll()` with its default `--out artifacts/conformance`
(`run-conformance.mjs:2265-2293`, default at :2335). Consequences: wasted minutes, a clobbered web
reference in the uploaded artifact, and a desktop report that claims rows were blocked on a lane
that has no desktop host. The exact code path is **untraced** — the investigation pass was stopped
before it concluded (open item). Working hypothesis, from the evidence above: `runAll()` was
reached with its default `--out artifacts/conformance` (`run-conformance.mjs:2265-2293`, default
`--target all` at :2335), which reproduces all four report paths and the matrix order. The commit
window is the same 05699e33 sync.

**Fix:** once traced, make `--target <t>` incapable of reaching the multi-target loop, and make the
android lane stop writing sibling-target reports. Also stop the verify step from reading a web
reference that the same run may have overwritten (capture web references to a dedicated directory
the android lane cannot write).

## 3. Scaffolded starter desktop artifact

Green on main (run 33675488456, ~5 min job) and red on PR `useful-defaults-visibility-r5-20260902`
(run 33676257646, 20:07:00):

```
TN_NATIVE_STARTER_FRAME_NOT_RENDERED: only 5 distinct colours in 1280x720. The run log may still
show every marker: this is the capture, not the scene.
```

That is the near-blank-frame failure mode already seen on the templates (a510abd0 fixed the mobile
MRT black screen; 49f4770b gated the eager surface-node request that rendered a black frame) — a
render default that produces a valid but empty frame on the native host. The PR changes starter
defaults, so the PR must prove its frame before merge; the starter lane is doing its job.

**Fix:** treat as a blocker on that PR. Separately, the starter verify should always attach the
native run log next to the capture in `artifacts/starter-linux/` — the failure message promises the
log "may still show every marker", but the artifact step only copies what the verifier produced.

## 4. Why native jobs take so long, and what caching is actually doing

Durations from run 33675488456 (main):

| Job | Total | Dominant slice |
| --- | --- | --- |
| Desktop web/native parity | 54 min | conformance comparison 19:57→20:42 (**~45 min**, 73 serial rows on software GL); native build only ~3.5 min |
| Android emulator visual parity | 35 min | conformance rows ~25 min (74 rows), SDK/emulator install ~6 min, gradle+Rust APK build ~5 min |
| Windows / macOS / iOS | 12 / 9 / 29 min | builds; fine |
| Scaffolded starter | 5 min | fine |

Caching audit:

- `third_party` cache: **working**. Exact-key hit, 162 MB restored in ~4 s (desktop job, 19:49:03).
- ccache: **working but weak**. Restore hit an older run's key for 22 MB. `ccache --show-stats`
  after the build (19:57:01): `Cacheable 272/552 (49%), Hits 77/272 (28%), Misses 195, Uncacheable
  280/552 (51%), storage 0.1/0.9 GB`. Half the compile lines never reach ccache, and the build is
  ~3.5 min anyway — this is not where the time is. The uncacheable half is worth one profiling pass
  (`ccache --show-stats` per section) before spending more on it.
- Not cached at all, and worth caching: the Android SDK components (`sdkmanager` re-downloads
  emulator + `system-images;android-35;default;x86_64` every run, 19:53:57→19:54:13 plus the
  earlier `platforms/android-35`, `build-tools`, `ndk;27.1…`), the gradle build+Rust cross-compile
  (`buildNativePhysics`, ~5 min per run), and cargo's registry/target dirs.
- The web browser reference capture (~3 min: 74 rows) is duplicated in both parity jobs, and on the
  android lane the result is then overwritten by the matrix side effect (2c).

**Proposals, ranked:**

1. Cache Android SDK packages + gradle caches + cargo target on the android lane (~10 min/job).
2. Fix the matrix side effect (2c) — correctness first, minutes second.
3. Capture web references once (separate step/job or artifact hand-off) and let both parity lanes
   consume them.
4. Shard or parallelize conformance rows — the 45-minute serial desktop run is the structural
   ceiling; per-row launches dominate, and rows are independent.
5. ccache uncacheable half: profile, then decide; low priority at ~3.5 min builds.

## 5. Context and smaller observations

- The iOS job failed only on `fix/parity-lane-honours-exclusions` (`verify-ios-simulator.mjs`,
  Xcode compile phase) — not on any main run on 2026-09-02. Check that PR before merging it.
- Main runs of this lane queue (concurrency, cancel-in-progress false) while PR runs supersede;
  ~30 cancelled runs in the last two days are the accepted cost documented in the workflow header.
- Job timeouts have headroom: desktop 54/75 min, android 35/45 min, starter 5/35 min.

## Next actions

1. Land `fix/parity-lane-honours-exclusions` (desktop parity), with the expiry-aware skip above.
2. Replace both ledger heredocs' exit rule with an import of `reportExitCode`.
3. Pull `supplemental.androidMultitouch` from run 33675488456's artifact and fix the proof; trace
   and close the matrix side effect.
4. Add the Android SDK/gradle/cargo caches.

# CI red board — 2026-08-31

What ran, what it proved, and what is still unproven, for the two GitHub workflows on `main`.

Baseline: run `33422413808` (`CI`) and `33422413795` (`Native platform evidence`), both on
`a8c056d1`. `CI` had never been green that day; `Native platform evidence` has **never** been green
at all — 28 failures and 9 cancellations across the last 100 runs, 0 successes.

## `CI` — two red jobs, both closed

| Job | Was | Cause | Now |
| --- | --- | --- | --- |
| `lint` | fail | Two Biome **formatter** diffs in `scripts/verify-registry-install.ts` and `scripts/render-chain-capabilities.ts`. Not rule violations — `biome check` reports formatting as an error, so `pnpm lint` exited 1 while its 496 warnings were never the problem. | `pnpm lint` exits 0 |
| `test` | fail | `device-playtest.spec.ts` and `ios-device-playtest.spec.ts` ran `device-smoke.playtest.json` against fake bridges that emit `player`. `847f80cf` had correctly renamed the scenario's movement entity to `multitouch-player` — the id the native-smoke scene actually registers — without updating the two fixtures. | 27/27 pass |

`budgets` went red mid-session on `dd3a4b7e` and was closed the same day; see below.

## `budgets` — three gates, one commit

`dd3a4b7e` added `pnpm --filter @threenative/core build` to the Android parity job and two `.mjs`
cases under `runtime-native/tests/`. The build step was the right fix. It left three generated
records behind, each failing `pnpm budgets` in turn:

1. **Literal package enumeration.** A workflow may not name workspace packages by hand. Replaced
   with `pnpm tsx scripts/workspace-packages.ts build`, the form `ci.yml` already uses everywhere,
   which also covers scenes importing packages other than core.
2. **Native coverage digest.** `nativeCoverageEvidenceDigest` hashes *every* file under
   `runtime-native/tests`, `.mjs` included, so two JS test edits staled a C++ line-coverage record.
   Regenerated twice — numbers unchanged both times, digest only.
3. **Native census.** `tests/` measured 26,637 against 26,621 recorded, the same 16 added lines.

Note for whoever owns the digest: a `.mjs` harness edit forcing a full instrumented native rebuild
is a real cost. It cost two rebuilds here, one of which timed out under load
(`threenative-worker-production-test: spawnSync ctest ETIMEDOUT`) and needed a quiet machine.

## `Native platform evidence` — one blocker removed, two untouched

### Android emulator visual parity — root cause found

The web reference capture reported **15 failures**. They were two causes, not fifteen:

- **1** — `76-gpu-scene-bvh` failed at phase `bundle` on `Could not resolve "@threenative/core"`.
  The job never built the workspace. Fixed by `dd3a4b7e`'s build step.
- **14** — every row setting `requiresHardwareAdapter` threw
  `TN_CONFORMANCE_HARDWARE_ADAPTER_REQUIRED`. A GitHub-hosted runner exposes SwiftShader:

  ```
  01-basic-cube adapter: {"architecture":"swiftshader","vendor":"google"}
  ```

  The catch recorded these as `fail`, which claims 13 realism effects and the probe-volume sample
  were measured and came out wrong. They were never executed. Run here on real hardware:

  ```
  realism-ssr status: pass | adapter: {"architecture":"turing","vendor":"nvidia"}
  ```

  So the lane was asserting an engine defect that does not exist, in the direction that looks worst.

**Closed by** classifying an adapter refusal as `blocked` — the same way `runBrowser` already treats
a missing Xvfb or Chromium — and then naming which blocks the lane accepts. `unexpectedBlockedRows`
permits a hardware row blocked on a software adapter and a row the registry has not implemented, and
returns everything else; `check-lane-blocks.mjs` fails the step on any failure or any other blocked
row, so a row that breaks for a new reason cannot hide inside the allowance.

Proof is a fixture cut from the real failing report: 15 blocked, 0 unexpected, and a row blocked for
any other reason is returned. Mutation-checked — reverting the guard in `hardwareAdapterBlocker` to
`return null` fails the test with `expected /Requires a hardware GPU adapter/, received null`.

The ledger step ran on `always()` and died with a bare `ENOENT` stack whenever an earlier step meant
the emulator never ran, burying the real cause. It now raises `TN_PARITY_ANDROID_REPORT_MISSING` and
points at the step that actually failed.

**Still unproven.** The emulator step has never once executed in CI — every run skipped it because
the capture step failed first. This removes that blocker; it does not prove the lane green.

### Windows desktop core — root cause found and fixed

`loading-screen-desktop.playtest.json` failed both transitions: all three labelled samples read
`loadingVisible: true, startupReady: false`. The console artifact is decisive:

```
TN_LOADING_PROOF_OVERLAY_VISIBLE   1
TN_LOADING_PROOF_DISMISSED         0
```

`game.ts` sets `{loadingVisible: false, startupReady: true}` inside `startup.whenReady().then(...)`,
so the promise had not resolved by the third sample.

**A first reading of this as a stuck promise was wrong.** `StartupReadiness` always resolves:
`#finishCompile()` arms a `stableWindowMs` timer that calls `#markReady()` unconditionally, so the
worst case is `STARTUP_COMPILE_BUDGET_MS + STARTUP_STABLE_WINDOW_MS` — 25s. The promise was not
stuck; it was not waited for.

`verify-desktop-loading.mjs` injects a wall-clock wait before each fixed-step sample, and they were
`[0, 1_000, 3_000]`. The settle sample therefore landed about 4s in, against a 25s worst case. The
other resolve path is five consecutive frames inside `STARTUP_FRAME_BUDGET_MS = 50`; macOS and Linux
take it in well under a second, which is why 3s looked sufficient. A cold Windows runner misses the
50ms budget indefinitely — it logged `frames: 12`, so it was rendering, just never five in a row in
budget — and no path could complete inside 4s.

This is the bound `startup-ready-bound.spec.ts` already pins for the *runner's* startup wait, for
the same stated reason: "golden-path runs on a CPU rasteriser that can miss the frame budget
forever". The loading harness never had the rule applied.

**Fixed** by raising the settle wait to 27s, past `COMPILE_BUDGET + STABLE_WINDOW`, and pinning it
in `startup-ready-bound.spec.ts` so it cannot drift back. Mutation-checked: restoring `3_000` fails
with `expected 3000 to be greater than 25000`.

Verified end-to-end on Linux, which exercises the fast path the change must not break:

```
desktop loading playtest proof passed: 913920 startup loading pixels, 0 settled loading pixels
```

Unverified on Windows — no Windows runner here. The reasoning predicts green; CI decides.

### iOS simulator — NOT EXECUTED HERE

`iOS proof missed markers: TN_NATIVE_SMOKE_READY:webgpu, TN_NATIVE_SMOKE_FIRST_FRAME,
TN_NATIVE_SMOKE_300_FRAMES:300` — SDL3 and the runtime compiled, and the app then emitted none of
the three markers, so it never reached a first frame. Failed again on the following run. Needs macOS
and Xcode; this machine is Linux. No claim made.

Follow-up run: the markers now appear — the lane builds, boots and runs `device-smoke` — and it
fails later on `runExpected`'s `"pass": true` text check while the CLI itself exits **0**. The
uploaded `playtest-pass/` artifact holds only a 2-entry `console.json` and no report, and the error
message in the log is cut off mid-`observations`, so whether `pass` is false or merely absent from
the captured output cannot be decided from here. Needs macOS.

### Scaffolded starter desktop artifact — root cause found, not fixed

Failed with `TN_NATIVE_STARTER_ASSET_NOT_VISIBLE: found 0 cyan proof pixels` while its own uploaded
log carried every marker: `TN_NATIVE_SMOKE_READY`, `TN_NATIVE_STARTER_ASSETS_LOADED`, and
`Rendered 300 frames`.

The captures said what the message could not:

| run | frames | wall time | `TN_PRESENTS` | distinct colours | cyan |
| --- | ---: | ---: | ---: | ---: | ---: |
| `33438020754` pass | 300 | 16,838 ms | 97 | 17,163 | 120 |
| `33440190473` fail | 300 | 3,001 ms | 73 | 5 | 0 |
| `33441929823` fail | 300 | — | — | 5 | 0 |

Both on `llvmpipe`. Three hundred software-rendered frames cannot complete in 3 seconds, and the
failing captures hold exactly five colours twice over — this is bimodal, not a race on a fine
timescale.

`STARTUP_STABLE_WINDOW_MS` is 10,000. A host that never produces five consecutive frames inside the
50 ms budget — which is every llvmpipe runner — reaches ready only when that window expires. The
passing run spent 16.8s and crossed it. The failing runs spent 3.0s and did not, so
`runScreenshotMode` saved a frame from before the world was shown.

This is the same shape as the Windows loading failure: a proof that counts frames while the thing it
waits for is measured in wall clock. `--frames 300` cannot express "after startup", and the native
CLI has no `--await-startup`.

**Not fixed.** A correct fix holds the capture until startup readiness resolves, which is C++ in
`runScreenshotMode` and could not be built or verified on this machine. Raising the frame count
would only move the threshold, and a retry would hide it.

**What is fixed** is the diagnosis. Below 64 distinct colours the gate now reports
`TN_NATIVE_STARTER_FRAME_NOT_RENDERED` and says the capture is at fault, not the scene. It fired on
its first real failure, on this PR:

```
TN_NATIVE_STARTER_FRAME_NOT_RENDERED: only 5 distinct colours in 1280x720.
The run log may still show every marker: this is the capture, not the scene.
```

### macOS desktop core

Green on both runs.

## Gates run locally

```
pnpm lint         exit 0
pnpm typecheck    exit 0
pnpm budgets      exit 0
vitest packages/core/__tests__                    811 passed (83 files)
vitest device-playtest + ios-device-playtest       27 passed
vitest create-threenative/__tests__/template.spec  32 passed
vitest runtime-native tests/conformance-runner     48 passed
pre-push ci:fast  lint/docs/typecheck/budgets/agents/drift all pass
```

Not run here: the Android emulator lane, the Windows lane, the iOS lane.

# Startup and heat investigation: Opus handoff

Implement the next bounded engine experiment using the findings in
[the performance ledger](../runtime-perf-state.md#2026-09-08-startup-cost-and-heat-investigation).
The user replaced the arbitrary eight-second optimization objective with: identify avoidable work,
measure the hardware cost, and preserve the game. PRD-360 remains PARTIAL; no hardware floor is proven.
Use Opus at medium effort for delegated work, as requested. The broad optimization is handed off,
not implemented by this investigation.

## Resume here

1. Reuse the owning checkout `.worktrees/prd-360-android-launch-20260908`, branch
   `linchpin/prd-360-android-launch-20260908`, after checking ownership. Read its AGENTS instructions.
   PR [147](https://github.com/ThreeNativeHQ/threenative/pull/147) holds the small startup fixes.
   Search the capability manifest before new engine helpers or render changes.
2. Restore the compact [receipts](receipts.json.gz) into an ignored temporary directory. This is a
   JSON object mapping relative names to file text. Copy `compile-probe/` to
   `artifacts/prd360-followup/compile-probe/` to preserve its relative imports. Run its `build.mjs`,
   `run-arms.mjs`, `analyze.mjs`, and `compare-shots.mjs` from the checkout root. Read its README
   for instrumentation seams and the desktop-only limitation. Rebuild dependencies first if stale.
3. Instrument the actual Pixel build with phase-tagged pipeline descriptors, WGSL hashes,
   cache keys, async settlement and sync call durations. Reuse the probe's device/backend hooks.
   Group by PMREM, shadow, main material and output conversion; count objects separately from
   unique pipelines. Measure repeated descriptors rather than assuming duplication. Confirm that
   instrumentation preserves screenshots and movement before interpreting its timing.
4. Test one lever: compile coverage of shadow/output first-use work, or serial async scheduling.
   First write a failing behavior test. A green warm-up report must not hide synchronous work
   in the first presented frame. Bound concurrency and memory; the native worker pool alone cannot
   help a JavaScript loop awaiting each pipeline serially. Do not ship look settings in packages.
   Keep the actual game render configuration: ACES/exposure, no custom post chain.
5. Compare baseline and candidate on the same installed APK identity, scene and qualified device
   conditions. Report first presented world, playable input, compile counts and time, pump gaps
   including the trailing interval, peak memory, screenshot parity and diagnostics. Repeat the
   winner three times from a documented cache state. Stop if no measured benefit or visual drift;
   record the rejected lever. Do not remove assets, shadows or effects to manufacture acceptance.

## Step 4, third lever

[Bounded compile concurrency](compile-concurrency.md) is implemented opt-in and measured on desktop:
worth 7.5 %, while granularity is worth 3.7× on the same host. No default changed.

## Raw material for the next PRD

Learnings, ranked suggestions and the engine defects found on the way:
[next-work-raw-material.md](next-work-raw-material.md).

## Step 5 result

The one-lever A/B ran on hardware and **rejected** the lever:
[warm-up-rejected.md](warm-up-rejected.md). Turning the warm-up on costs 15-21 s against a baseline
that compiles in 8.5 s. The serial-scheduling lever is the only one left.

## Step 3 result

The Pixel census ran: [pixel-census.md](pixel-census.md). It found no duplication, and it found that
this launch runs **no warm-up at all**, which re-ranks every lever below it.

## Step 4 progress

The compile-coverage lever is implemented and measured on desktop:
[first-use compile coverage](first-use-coverage.md). Steps 3 and 5 are still open — no Pixel
instrumentation and no device A/B were run in that pass, and the serial-scheduling lever is
untouched.

## Thermal follow-up

The completed hands-off control is in `thermal-probe/summary.json` and `sensors.jsonl` inside the
receipt. It starts already warm and cannot establish cold launch performance. Before using the
phone again, coordinate an uninterrupted measurement window with its owner. Prefer desktop or
emulator for functional assertions, but device power and Mali compile cost need this phone.

Measure a separate steady-state CPU profile, then idle → gameplay → background → stopped under
fixed brightness, refresh rate, connectivity and battery state. A 30-FPS cap and UI-update ablation
are diagnostic controls, not approved permanent quality changes. Compare device electrical power,
frame time, WebView CPU, app CPU and thermal status. Battery temperature lags power. Distinguish
background continuation from normal active gameplay cost; this investigation measured stopped
cooldown only. Do not blame another app based on one process snapshot.

Supported startup sampling succeeded with shell `simpleperf record --app <package> -f 99 -g
--duration 12 -o /data/local/tmp/<unique>.data`, launched before the app in parallel. Pull the
record and report by DSO and symbol. `run-as ... simpleperf record` failed at a protected property;
use the supported `--app` path rather than changing kernel properties. Symbols may be restricted.
Profiled cycle proportions are not wall-time proportions. This capture did not span steady state.

## Reproduction identity and delivered UI fix

Final installed APK SHA-256:
`485de0dd30207abd448c7341ae5f780e2006761cac7300f05b88186c0ede4198`.
The sandbox is `/home/joao/projects/threenative/sandbox/prd360-bayview-live`.
Receipt `sandbox-final/` preserves final scene/HUD source and package/lock metadata; `tarballs.json`
records the seven matching local packages. Old sandbox node_modules was a symlink into another
sandbox. It was renamed to `node_modules.prd360-before-isolation`; the independent install now
uses matching core, physics, UI, playtest, runtime-native, create-threenative and assets tarballs.
The CLI's assets peer also needed a direct local devDependency; an override alone left old registry
code. Run the core postinstall script to patch Three when installation suppresses scripts. Sandbox
typecheck and Android build passed without casts or suppressions.

The engine no longer treats an attached transparent HUD as an opaque loading surface. The sandbox
publishes asset progress immediately, displays 28/28 as a full bar with “ASSETS READY · PREPARING
SCENE”, and publishes gameplay ready only after `startup.whenReady()`. Engine red: reverting the
cover predicate makes the first-frame test fail, `expected 0 to be 1`; green: 44 game tests pass.
Full validation: typecheck, lint (653 existing warnings), build and tests exit 0; 406 test files,
4,660 passed tests, 8 skipped. Android movement passes with distance 2.146126m and no diagnostics;
ready timeline 16,010.673ms is an observation, not three qualified cold starts.

An initial browser attempt failed with `TN_PLAYTEST_BRIDGE_MISSING`. Doctor subsequently found
an active bridge, but used SwiftShader; its numbers are not GPU evidence. See the latest browser
result in the performance ledger. Do not mark PRD-360 done on any of these observations.

Raw videos, APKs and CPU sample binary remain under ignored `artifacts/prd360-followup/` and the
sandbox; the compact receipt retains sources, parsed probe rows, native probe logs, sensor records,
profile reports, startup markers and validation output. It omits full system logcat and unrelated
process lists. Nothing here proves a universal startup limit or iOS behavior.

# Native LOC trigger — 2026-08-10

Status: complete for `lane-batch-2026-08-10`. The trigger remains a review trigger; it was
not raised, hidden, or converted into a hard failure.

## Phase 0 — measurement and attribution

The lane is based at `1967c80` and includes the post-base runtime commits `e15aab8`, `535b2cf`,
and `e5cead7`, plus `1f6145b`, `75fa96c`, and this fixture repair. The current re-runnable lane
measurement is 61,617 lines; the historical pre-fixture measurement was 61,605, the historical
pre-75fa96c measurement was 61,589, and the historical pre-1f6145b measurement was 61,554. This
evidence uses the number produced in this lane.

The raw attribution source is:

```sh
git log --reverse --date=short --format='%h%x09%ad%x09%s' --numstat -- packages/runtime-native
node --import tsx/esm scripts/check-budgets.ts
```

The filtered `git-numstat` command, including the working-tree fixture diff before commit,
returned **+63,970 / -2,593 / net 61,377**; after commit, the same total comes from history
alone. The historical pre-fixture command result was **+63,958 / -2,593 / net 61,365**.

The commit table applies the same source extensions and exclusions as
`scripts/check-budgets.ts`: `third_party/`, build outputs, `.runtime/`, artifacts, native
build caches, `dist/`, and the generated Android bundle are excluded. `CMakeLists.txt` is
included even though it has no extension. The `+/-` values below are the budget-counted
`git numstat` changes; the budget script's exact line counter adds one terminal line for each
of the 240 counted files, reconciling the current filtered `git numstat` net of 61,377 to the
measured 61,617. The historical pre-fixture filtered baseline was 61,365; the current command
result includes the 12-line fixture repair.

| Commit | Budget lines (+/-) | Owning PRD | Area |
| --- | ---: | --- | --- |
| `cd0e8fd` | +47,102 / -0 | PRD-047 | absorbed host/package baseline |
| `0c12f37` | +1 / -1 | PRD-047 | build script |
| `570a634` | +0 / -0 | PRD-047 + PRD-048 | excluded generated Android bundle |
| `4d2c03c` | +686 / -153 | PRD-047 + PRD-048 | host, Android, scripts, tests |
| `607743b` | +11 / -1 | PRD-045 | Android playtest bridge |
| `61b04f5` | +796 / -343 | PRD-047 + PRD-048 + PRD-049 | runtime proofs, physics, distribution |
| `7eb8978` | +1,988 / -373 | PRD-046 + PRD-048 + PRD-049 + PRD-050 | physics, conformance, distribution, tests |
| `4802c26` | +319 / -6 | PRD-046 | native character physics |
| `56463d7` | +196 / -24 | PRD-046 | native area physics |
| `9693cd3` | +0 / -0 | PRD-047 | excluded agent documentation |
| `d5bb07f` | +1,487 / -95 | PRD-048 + PRD-049 | iOS packaging and physics tests |
| `18e1ba5` | +2 / -2 | PRD-048 | CI contract test |
| `c7bec60` | +8 / -0 | PRD-048 | packed-consumer release gate |
| `fec8396` | +5 / -16 | PRD-048 | distribution extraction |
| `04b364c` | +3 / -0 | PRD-048 | package manifest |
| `19e630d` | +13 / -1 | PRD-048 | Windows distribution |
| `03f7451` | +14 / -1 | PRD-048 | iOS simulator distribution |
| `1846c4f` | +532 / -294 | PRD-049 | physics parity verifier |
| `524db74` | +10 / -4 | PRD-048 + PRD-049 | CI and simulator gates |
| `4a3f757` | +10 / -3 | PRD-049 | Android physics parity gate |
| `ea6a177` | +24 / -13 | PRD-048 + PRD-049 | platform dependencies and gates |
| `544e100` | +13 / -7 | PRD-048 + PRD-049 | clean platform launch |
| `84314b5` | +7 / -3 | PRD-048 + PRD-049 | runner arguments |
| `d88ae83` | +279 / -37 | PRD-049 | parity audit evidence |
| `fc22e94` | +20 / -4 | PRD-048 + PRD-049 | native compiler/logging gates |
| `ccd3dc9` | +4 / -1 | PRD-048 | hosted Windows toolchain gate |
| `ef411dd` | +1 / -0 | PRD-048 | hosted dependency gate |
| `d071e37` | +58 / -2 | PRD-048 + PRD-050 | Windows surface and build gate |
| `5d3fa01` | +0 / -50 | PRD-048 | CI contract cleanup |
| `c14e1d7` | +20 / -0 | PRD-049 | parity physics controls |
| `9e4105f` | +2 / -0 | PRD-049 | simulator parity tolerance |
| `ef4df52` | +3 / -0 | PRD-048 + PRD-049 | packed physics fixture |
| `1020a96` | +830 / -145 | PRD-050 | native entry, assets, and starter proof |
| `75c5242` | +1 / -0 | PRD-050 | Linux desktop dependency gate |
| `612c25a` | +1 / -0 | PRD-050 | Linux HTTP dependency gate |
| `a66f198` | +2 / -0 | PRD-050 | Linux build dependency gate |
| `eb89ff4` | +18 / -3 | PRD-050 | starter verifier |
| `744abd5` | +1 / -0 | PRD-050 | Linux Vulkan dependency gate |
| `4b221e9` | +5 / -0 | PRD-048 + PRD-050 | declared consumer entry |
| `1bf68bb` | +5 / -5 | PRD-048 + PRD-050 | portable Android proof source |
| `eeb0a13` | +7 / -7 | PRD-048 | Gradle wrapper provenance |
| `2c5f7f0` | +12 / -4 | PRD-048 | Android Rust release targets |
| `7c20861` | +7 / -5 | PRD-048 | Android SDL AAR extraction |
| `d7e5cc5` | +9 / -7 | PRD-048 | clean Android SDL source |
| `d574a8f` | +67 / -5 | PRD-048 | packed mobile consumer bootstrap |
| `bf1ac54` | +15 / -4 | PRD-048 | clean Android SDK view |
| `8a6f2aa` | +19 / -4 | PRD-048 | Android control transport |
| `90d5f47` | +12 / -5 | PRD-048 | packed playtest CLI |
| `60b06a2` | +732 / -96 | PRD-047 | native audio host and proof tests |
| `c8fb174` | +64 / -15 | PRD-048 | generated Android proof assets |
| `1da5834` | +36 / -24 | PRD-047 | positional-audio proof |
| `69cef74` | +19 / -0 | PRD-048 | deterministic distribution gates |
| `46a7f12` | +76 / -9 | PRD-054 | Android WGSL/conformance compatibility |
| `9c2b0de` | +2,452 / -396 | PRD-054 | parity registry and version matrix |
| `50f8eb4` | +218 / -0 | PRD-053 | native multi-pointer input |
| `9891415` | +4,512 / -368 | PRD-054 + PRD-055 + PRD-053 | conformance, HUD, and input proofs |
| `e750583` | +960 / -47 | PRD-046 + PRD-048 + PRD-053 + PRD-054 + PRD-055 | landed cross-PRD gates |
| `72cd940` | +0 / -0 | PRD-048 | excluded Android documentation |
| `1967c80` | +2 / -2 | PRD-048 | emulator boot/release gate |
| `e15aab8` | +28 / -3 | PRD-053 | Android touch coordinate transport (`include/`, `src/`) |
| `535b2cf` | +148 / -0 | PRD-053 | Android touch parity and proof (`src/`, `tests/`) |
| `e5cead7` | +30 / -0 | PRD-054 | parity runner and contract tests (`conformance/`, `tests/`) |
| `1f6145b` | +38 / -3 | PRD-054 | Android dependency layout preflight (`conformance/`, `tests/`) |
| `75fa96c` | +18 / -2 | PRD-054 | Android dependency layout preflight guard and regression test (`conformance/`, `tests/`) |
| this fixture repair | +12 / -0 | PRD-054 | source-only Android dependency layout regression test (`tests/`) |

The table sums to **+63,970 / -2,593**, net **61,377**; adding one terminal line for each of the
240 counted files reconciles the commit attribution to the measured **61,617**. The table
attributes the full measured tree's growth in this lane. The source PRD's
53,851-line prior measurement is retained as historical context in PRD-048; it is not
reachable from this lane's commit ancestry, so it is not used to manufacture a delta.

## Current measured areas

The following exact counts come from the same file walk as `scripts/check-budgets.ts` and sum
to 61,617:

| Area | Lines | Owning PRD(s) | Kill-switch verdict |
| --- | ---: | --- | --- |
| `src/` | 37,179 | PRD-047, PRD-046, PRD-050, PRD-053 | **keep** — host shims, physics ABI, platform lifecycle, and input delivery are the runtime itself |
| `conformance/` | 5,613 | PRD-054, PRD-055, PRD-053 | **keep** — the shared registry is executable parity evidence; removing it makes cross-target claims untestable |
| `tests/` | 4,962 | PRD-045, PRD-046, PRD-048, PRD-049, PRD-050, PRD-053, PRD-054, PRD-055 | **keep** — fail-closed contract tests are required evidence; deleting tests to clear a trigger is forbidden |
| `scripts/` | 4,827 | PRD-045, PRD-048, PRD-049, PRD-050, PRD-053, PRD-054 | **keep** — packaging, build, emulator, and verifier orchestration has no plain native alternative |
| `include/` | 3,550 | PRD-047, PRD-046, PRD-053 | **keep** — these headers are the host and coarse physics/input ABI contracts |
| `android/` | 1,738 | PRD-045, PRD-048, PRD-050, PRD-053, PRD-054 | **keep** — APK lifecycle, SDL glue, and device transport are needed to execute the Android proof |
| `native/` | 1,590 | PRD-046, PRD-049 | **keep** — the Rust physics backend is the native implementation behind the shared API |
| root `CMakeLists.txt` | 1,579 | PRD-047, PRD-048, PRD-050 | **keep** — opt-in native build configuration |
| `cmake/` | 280 | PRD-047, PRD-048, PRD-050 | **keep** — platform build configuration |
| `CMakePresets.json` | 137 | PRD-047, PRD-048, PRD-050 | **keep** — declared host/build presets |
| `ios/` | 98 | PRD-045, PRD-048, PRD-049, PRD-050 | **keep** — simulator packaging and contract execution |
| `package.json` | 54 | PRD-048, PRD-050, PRD-054 | **keep** — opt-in scripts and package contract |
| `vitest.config.ts` | 10 | PRD-048, PRD-050 | **keep** — native package test collection |

No area fails the kill switch. `PRD-051` and `PRD-052` are not listed as owners because
their decisions deliberately add no native runtime source: PRD-051 rejects a native HUD
abstraction, and PRD-052 keeps navigation browser-only with template-local steering.

## Phase 2 — owner sections

The owning PRDs now carry `## Budget justification` sections dated 2026-08-10:

`PRD-045`, `PRD-046`, `PRD-047`, `PRD-048`, `PRD-049`, `PRD-050`, `PRD-053`, `PRD-054`, and
`PRD-055`. Each section names its measured area, retains the kill-switch verdict, and points
back to this file.

## Phase 3 — residual

The current post-fixture measurement is **61,617 / 50,000 native LOC**, a residual **+11,617**.
`LIMITS.nativeRuntimeLoc` and the trigger text in `scripts/check-budgets.ts` are unchanged.
The owner sentence for this residual is: retain the single absorbed host plus the executable
parity, device, build, distribution, and physics evidence that makes the claimed native
surfaces observable; do not split the package or delete fail-closed proof to make the number
look smaller.

No native source was rejected by the kill switch, so no runtime deletion was made in this
PRD. The separate PRD-063 export deletion is outside `packages/runtime-native`.

## Budget gate evidence

The exact wrapper command is blocked in this sandbox because `tsx` cannot create its IPC pipe:

```text
pnpm budgets
Error: listen EPERM: operation not permitted /tmp/tsx-1000/13.pipe
```

The repository's equivalent direct loader ran successfully after the lane changes:

```text
budgets trigger: native runtime LOC review trigger: 61617 lines (trigger 50000, +11617). Justify in the owning PRD and run the kill switch over what was added.
budgets ok: 6 framework packages, 3 example workspaces, 5975/15000 framework LOC, 61617/50000 native runtime LOC, 4 PRD files, largest template 1395 LOC
```

The historical pre-fixture direct-loader baseline was:

```text
budgets trigger: native runtime LOC review trigger: 61605 lines (trigger 50000, +11605). Justify in the owning PRD and run the kill switch over what was added.
budgets ok: 6 framework packages, 3 example workspaces, 5975/15000 framework LOC, 61605/50000 native runtime LOC, 4 PRD files, largest template 1395 LOC
```

The pre-75fa96c direct-loader baseline was:

```text
budgets trigger: native runtime LOC review trigger: 61589 lines (trigger 50000, +11589). Justify in the owning PRD and run the kill switch over what was added.
budgets ok: 6 framework packages, 3 example workspaces, 5975/15000 framework LOC, 61589/50000 native runtime LOC, 4 PRD files, largest template 1395 LOC
```

The pre-1f6145b direct-loader baseline was:

```text
budgets trigger: native runtime LOC review trigger: 61554 lines (trigger 50000, +11554). Justify in the owning PRD and run the kill switch over what was added.
budgets ok: 6 framework packages, 3 example workspaces, 5975/15000 framework LOC, 61554/50000 native runtime LOC, 4 PRD files, largest template 1395 LOC
```

The `1f6145b` repair increased the native number by 35 counted lines for the Android layout
preflight and its positive/negative tests. `75fa96c` added 16 budget-counted native lines
(`+18 / -2`) for the Android dependency layout guard and regression test. This fixture repair
adds 12 budget-counted native lines (`+12 / -0`) for the source-only layout regression test. The
framework number and `LIMITS.nativeRuntimeLoc` are unchanged; the trigger remains visible and
justified rather than routed around.

# Native LOC trigger — 2026-08-10

Status: complete for `lane-batch-2026-08-10`. The trigger remains a review trigger; it was
not raised, hidden, or converted into a hard failure.

## Phase 0 — measurement and attribution

The lane is based at `5e86c48` and includes the post-base runtime commits `fd92899`, `0995e01`,
and `0ea5cd1`, plus `be06ddf`, `c7ff378`, and this fixture repair. The current re-runnable lane
measurement is 61,617 lines; the historical pre-fixture measurement was 61,605, the historical
pre-c7ff378 measurement was 61,589, and the historical pre-be06ddf measurement was 61,554. This
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
| `edcd349` | +47,102 / -0 | PRD-047 | absorbed host/package baseline |
| `d88bdc3` | +1 / -1 | PRD-047 | build script |
| `7034246` | +0 / -0 | PRD-047 + PRD-048 | excluded generated Android bundle |
| `fe06d8b` | +686 / -153 | PRD-047 + PRD-048 | host, Android, scripts, tests |
| `1b0b266` | +11 / -1 | PRD-045 | Android playtest bridge |
| `1589b25` | +796 / -343 | PRD-047 + PRD-048 + PRD-049 | runtime proofs, physics, distribution |
| `f1df419` | +1,988 / -373 | PRD-046 + PRD-048 + PRD-049 + PRD-050 | physics, conformance, distribution, tests |
| `c563cef` | +319 / -6 | PRD-046 | native character physics |
| `d631001` | +196 / -24 | PRD-046 | native area physics |
| `baafdeb` | +0 / -0 | PRD-047 | excluded agent documentation |
| `b2b27f1` | +1,487 / -95 | PRD-048 + PRD-049 | iOS packaging and physics tests |
| `5750f6c` | +2 / -2 | PRD-048 | CI contract test |
| `1c3c34b` | +8 / -0 | PRD-048 | packed-consumer release gate |
| `484ed6d` | +5 / -16 | PRD-048 | distribution extraction |
| `aa22119` | +3 / -0 | PRD-048 | package manifest |
| `8154196` | +13 / -1 | PRD-048 | Windows distribution |
| `55a2041` | +14 / -1 | PRD-048 | iOS simulator distribution |
| `cfd8fb7` | +532 / -294 | PRD-049 | physics parity verifier |
| `131764c` | +10 / -4 | PRD-048 + PRD-049 | CI and simulator gates |
| `664ab78` | +10 / -3 | PRD-049 | Android physics parity gate |
| `e4dad6e` | +24 / -13 | PRD-048 + PRD-049 | platform dependencies and gates |
| `26a767e` | +13 / -7 | PRD-048 + PRD-049 | clean platform launch |
| `675c268` | +7 / -3 | PRD-048 + PRD-049 | runner arguments |
| `ae1628c` | +279 / -37 | PRD-049 | parity audit evidence |
| `b842d08` | +20 / -4 | PRD-048 + PRD-049 | native compiler/logging gates |
| `f23f9d2` | +4 / -1 | PRD-048 | hosted Windows toolchain gate |
| `ce61f53` | +1 / -0 | PRD-048 | hosted dependency gate |
| `e43e529` | +58 / -2 | PRD-048 + PRD-050 | Windows surface and build gate |
| `3bb0063` | +0 / -50 | PRD-048 | CI contract cleanup |
| `5a4f4d0` | +20 / -0 | PRD-049 | parity physics controls |
| `baf046f` | +2 / -0 | PRD-049 | simulator parity tolerance |
| `92ce2d1` | +3 / -0 | PRD-048 + PRD-049 | packed physics fixture |
| `ba03602` | +830 / -145 | PRD-050 | native entry, assets, and starter proof |
| `d697420` | +1 / -0 | PRD-050 | Linux desktop dependency gate |
| `ce731e0` | +1 / -0 | PRD-050 | Linux HTTP dependency gate |
| `5e1cb2a` | +2 / -0 | PRD-050 | Linux build dependency gate |
| `73c3d2c` | +18 / -3 | PRD-050 | starter verifier |
| `c45d4b1` | +1 / -0 | PRD-050 | Linux Vulkan dependency gate |
| `606b0f9` | +5 / -0 | PRD-048 + PRD-050 | declared consumer entry |
| `b8efb29` | +5 / -5 | PRD-048 + PRD-050 | portable Android proof source |
| `27ee376` | +7 / -7 | PRD-048 | Gradle wrapper provenance |
| `e38439c` | +12 / -4 | PRD-048 | Android Rust release targets |
| `b755168` | +7 / -5 | PRD-048 | Android SDL AAR extraction |
| `aecd0a5` | +9 / -7 | PRD-048 | clean Android SDL source |
| `01ed033` | +67 / -5 | PRD-048 | packed mobile consumer bootstrap |
| `f150158` | +15 / -4 | PRD-048 | clean Android SDK view |
| `323a57b` | +19 / -4 | PRD-048 | Android control transport |
| `886f6f9` | +12 / -5 | PRD-048 | packed playtest CLI |
| `c7c073e` | +732 / -96 | PRD-047 | native audio host and proof tests |
| `a2a6c73` | +64 / -15 | PRD-048 | generated Android proof assets |
| `42f51c6` | +36 / -24 | PRD-047 | positional-audio proof |
| `9f38687` | +19 / -0 | PRD-048 | deterministic distribution gates |
| `4ab5955` | +76 / -9 | PRD-054 | Android WGSL/conformance compatibility |
| `6b2c4e5` | +2,452 / -396 | PRD-054 | parity registry and version matrix |
| `cb754d9` | +218 / -0 | PRD-053 | native multi-pointer input |
| `3d1bc40` | +4,512 / -368 | PRD-054 + PRD-055 + PRD-053 | conformance, HUD, and input proofs |
| `2e247d6` | +960 / -47 | PRD-046 + PRD-048 + PRD-053 + PRD-054 + PRD-055 | landed cross-PRD gates |
| `351319c` | +0 / -0 | PRD-048 | excluded Android documentation |
| `5e86c48` | +2 / -2 | PRD-048 | emulator boot/release gate |
| `fd92899` | +28 / -3 | PRD-053 | Android touch coordinate transport (`include/`, `src/`) |
| `0995e01` | +148 / -0 | PRD-053 | Android touch parity and proof (`src/`, `tests/`) |
| `0ea5cd1` | +30 / -0 | PRD-054 | parity runner and contract tests (`conformance/`, `tests/`) |
| `be06ddf` | +38 / -3 | PRD-054 | Android dependency layout preflight (`conformance/`, `tests/`) |
| `c7ff378` | +18 / -2 | PRD-054 | Android dependency layout preflight guard and regression test (`conformance/`, `tests/`) |
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

The pre-c7ff378 direct-loader baseline was:

```text
budgets trigger: native runtime LOC review trigger: 61589 lines (trigger 50000, +11589). Justify in the owning PRD and run the kill switch over what was added.
budgets ok: 6 framework packages, 3 example workspaces, 5975/15000 framework LOC, 61589/50000 native runtime LOC, 4 PRD files, largest template 1395 LOC
```

The pre-be06ddf direct-loader baseline was:

```text
budgets trigger: native runtime LOC review trigger: 61554 lines (trigger 50000, +11554). Justify in the owning PRD and run the kill switch over what was added.
budgets ok: 6 framework packages, 3 example workspaces, 5975/15000 framework LOC, 61554/50000 native runtime LOC, 4 PRD files, largest template 1395 LOC
```

The `be06ddf` repair increased the native number by 35 counted lines for the Android layout
preflight and its positive/negative tests. `c7ff378` added 16 budget-counted native lines
(`+18 / -2`) for the Android dependency layout guard and regression test. This fixture repair
adds 12 budget-counted native lines (`+12 / -0`) for the source-only layout regression test. The
framework number and `LIMITS.nativeRuntimeLoc` are unchanged; the trigger remains visible and
justified rather than routed around.

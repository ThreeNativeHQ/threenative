# PRD-359 — the owned quiche release, and the two things that stopped it

Recorded 2026-09-06 UTC, worktree `.worktrees/networking-359`, branch `networking-359`.

The nine-target owned quiche distribution had never completed. Neither reason was a build
failure; both were gates checking the wrong thing.

## 1. A retired runner label, not a broken target

Run 34049262102 and run 34055934305 both left
`build (mac-x86_64, macos-13, macosx)` **queued** — eleven hours and nine and a half hours
respectively — while every other target finished. GitHub retired the `macos-13` hosted runner
image, so the job was never scheduled. The release-tag gate requires all nine targets, and a
job that never starts blocks it exactly as a failing one would, so the distribution stalled
behind a label rather than behind any code.

`mac-x86_64` now builds on `macos-15`, which is arm64, making it a cross-compile to
`x86_64-apple-darwin`. That is the shape `ios-sim-x64` already builds on `macos-15` today
(`x86_64-apple-ios`); `build-quiche-owned.py` maps both targets and drives Apple SDK and arch
selection from its own table, so the builder needed no change.

Run 34086679348, at HEAD `b475e803`, is the first completed nine-target build:

```text
build (linux-x64, ubuntu-24.04)                  success
build (win-x64, windows-2022)                    success
build (mac-arm64, macos-15, macosx)              success
build (mac-x86_64, macos-15, macosx)             success   <- previously unschedulable
build (android-arm64, ubuntu-24.04)              success
build (android-armv7, ubuntu-24.04)              success
build (android-x64, ubuntu-24.04)                success
build (ios-arm64, macos-15, iphoneos)            success
build (ios-sim-x64, macos-15, iphonesimulator)   success

status=completed conclusion=success
```

Nine artifacts, 143 MB total, each a `quiche-0.24.6-tn1-<target>.zip` beside its
`manifest-<target>.json`.

## 2. A validator that rejected every real artifact

Downloading those nine and running the release validator over them failed:

```text
$ python3 packages/runtime-native/scripts/validate-quiche-release.py \
    --dist <dist> --tag quiche-owned-v1
error: TN_QUICHE_RELEASE_TARGET_INPUTS: .../manifest-android-arm64.json
       Android NDK/API does not match producer pins
```

The check was `builder.ANDROID_NDK_PIN not in inputs.get("ndk", "")` — a substring match of
the revision `27.1.12297006` against the NDK **install path**. On GitHub runners
`nttld/setup-ndk` installs to `/opt/hostedtoolcache/ndk/r27b/x64`, named for the release
archive, so the revision never appears in the path and no real artifact could pass.

The producer had the right value all along: `check_ndk_pin` reads `Pkg.Revision` from
`source.properties` and refuses anything but the pin. It simply never recorded what it
verified.

Its own test suite passed because the fixture spelled the pin into the path
(`"ndk": f"/ndk/{BUILDER.ANDROID_NDK_PIN}"`) — a fixture built to match the check rather
than to match CI.

### Red

Reshaping that fixture to the real CI path and rerunning the suite, before any repair:

```text
Ran 23 tests in 0.090s
FAILED (failures=10, errors=2)
```

Ten failures and two errors from one realistic path string is the measure of the problem: the
gate would have rejected every legitimate nine-target release.

### Repair

`prepare_target_env` now records `ndk_revision` from the `Pkg.Revision` it already verified,
and the validator compares that field instead of substring-matching a path. The path stays in
the manifest for provenance. Two tests were added: a wrong revision and a missing revision
each fail.

### Green

```text
$ python3 packages/runtime-native/scripts/test-validate-quiche-release.py
Ran 23 tests in 0.098s
OK

$ python3 packages/runtime-native/scripts/test-build-quiche-owned.py
Ran 53 tests in 1.104s
OK
```

Against the nine real CI artifacts, with `ndk_revision` injected into the three Android
manifests to stand in for the value the fixed producer will record:

```text
$ python3 packages/runtime-native/scripts/validate-quiche-release.py \
    --dist <dist> --tag quiche-owned-v1
exit=0
```

The validator emits its 18-file asset list — nine archives and nine manifests.

## Published, and validated unmodified

The `exit=0` above was a **pre-flight**: those artifacts predate the `ndk_revision` repair, so
the three Android manifests were patched locally to see whether the other six targets would
pass. That run does not substantiate the release.

Run 34087936051 then rebuilt all nine with the fixed producer, and the Android manifests carry
the recorded revision without any local edit:

```text
ndk_revision = 27.1.12297006
ndk path     = /opt/hostedtoolcache/ndk/r27b/x64
```

The validator was run over those nine downloaded artifacts, unmodified:

```text
$ python3 packages/runtime-native/scripts/validate-quiche-release.py \
    --dist <downloaded> --tag quiche-owned-v1
validator exit=0
```

`quiche-owned-v1` was then tagged at `e480b680` and published by run 34089963144 with 18
assets — nine archives and nine manifests. Publishing was explicitly authorised by the owner;
it is the one outward-facing action of this work.

**The row `1b-quiche-platforms` is still unchecked in the ledger.** Nine archives that build
and validate are not the row's acceptance, which also requires that each target's runtime
qualification be recorded, and cross-compilation is not runtime proof.

Cross-compilation is not runtime proof. Nothing here says the Apple, Windows or Android hosts
run — only that their dependency archives build reproducibly from the pinned source and pass
the release contract.

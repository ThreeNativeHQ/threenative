# PRD-221 Phase 1 — source provisioning and integrity gates

Status: INCOMPLETE. This is implementation preparation, not Android 16 KB qualification.

## Consolidated resume point — 2026-09-10

Continue only in [PR #167](https://github.com/ThreeNativeHQ/threenative/pull/167), branch
`codex/prd-221-android-v8-16kb`. The closed slices #171, #172 and #173 are already included;
no cherry-picking or separate merge order is needed. Their heads
`c52da662c293f5b84bda1ae161a76d01b84e1cee`, `183e54a9e9963a99de87710c9044ff9cfac421a8`
and `7cf10bd4ebe5d36cbbfead6d43d818ab9b4e3b7f` passed actual `git merge-base --is-ancestor`
checks against candidate `190bbe31a0e034aca903a36bac8b84a0d00c6fa5` in
[the read-only snapshot run](https://github.com/ThreeNativeHQ/threenative/actions/runs/34522985500).
The review integrates main `4fa8e773609a69fa3077be462e45f893c928324e`; the MCP test conflict
keeps main's per-operation timeout behavior instead of the older blanket timeout.

### Review fixes and controls

The engine/native-dependency layer owns these fixes. Four new tests execute the actual
provisioner against a disposable prepared checkout and fake compiler/NDK tools, rather
than merely matching strings in the script. They do not compile or launch V8.

| Reproduction before the fix | Correction |
| --- | --- |
| `--force` reused prepared source and completed instead of attempting the deliberately failing fresh fetch | Discard prepared source state on an explicit forced rebuild; the prior install survives fetch failure |
| A stray `payload/include/stale.h` was included in the newly sealed install | Recreate only staging before copying current outputs; preserve expensive Ninja work for normal resume |
| Interrupt between the two promotion renames, then fail a forced retry: the sole previous install was deleted | Recover the prior install from `previous` before cache checks or source-state cleanup |
| A leftover nonempty rollback directory caused `ENOTEMPTY` at promotion | Remove that leftover only after the newly assembled payload has passed verification |

Removed the branch-only `prd-221-*` workflow. The existing native-platform producer and
release action remain the build routes. A regression rejects reintroducing the duplicate
workflow; the normal producer's cache, timeout and artifact handoff tests remain in place.
Current source recipe is 5, including Chromium's arm64 linker-default override. This
review does not change the compiler/linker configuration or claim native qualification.

### Executed review verification

Linux x86_64, Node 22.16.0, Vitest 4.1.10. Commands below were executed using the isolated
Vitest executable at `/mnt/data/prd221-tools/node_modules/vitest/vitest.mjs`, in place of
`pnpm exec vitest`; pnpm is absent from this sandbox. Test counts are cases, not separately
instrumented assertion counts. Compiler fixtures prove filesystem/control-flow mechanics.

```sh
# packages/runtime-native
pnpm exec vitest run --config vitest.config.ts \
  tests/android-16kb-alignment.test.mjs tests/android-packaging.integration.test.mjs \
  tests/native-platform-workflow.test.mjs tests/android-webp-provisioning.test.mjs \
  tests/js-engine-version-skew.test.mjs tests/dawn-android-option.test.mjs \
  tests/download-retry.test.mjs tests/wgpu-version-matrix.test.mjs \
  tests/workflow-dependency-names.test.mjs tests/loading-proof-appearance.test.mjs
# Repository root
pnpm exec vitest run scripts/__tests__/android-16kb-alignment.spec.ts \
  scripts/__tests__/ci-structure.spec.ts scripts/__tests__/ci-needs.spec.ts \
  scripts/__tests__/check-native-coverage.spec.ts
```

```text
Initial review red: 52 passed, 4 failed (2 new cache failures, duplicate-workflow control,
  and the existing test's dependency on the temporary workflow).
Interrupted-promotion control: 1 failed, other cases deselected.
Leftover-backup control: 1 failed with ENOTEMPTY, other cases deselected.
Final focused runtime: 10 files, 93 passed, 0 skipped, exit 0.
Root CI/alignment contracts: 4 files, 106 passed, 0 skipped, exit 0.
node --check: builder, downloader and both edited runtime test files, exit 0.
git diff --check: exit 0.
```

Raw review logs are retained in the task's `/mnt/data/prd221-review` directory. The full
workspace `pnpm typecheck`, `pnpm lint`, `pnpm test` and `pnpm budgets` commands each returned
127 (pnpm missing); none passed. The extended native suite also requires unbuilt native
executables: four runtime-next-contract cases failed and two were skipped in the baseline.
The independent native-coverage freshness check returned 1 after the test changes. A real
`node packages/runtime-native/scripts/measure-native-coverage.mjs` attempt returned 1 at
CMake configuration (pnpm missing; Dawn/V8 dependencies also absent). The committed coverage
measurement was not restamped to manufacture freshness. Regenerate it on a provisioned host.

### Resume checklist

1. On a Linux x86_64 build host, install workspace prerequisites, select the pinned NDK,
   and run the incumbent provisioner. A normal invocation resumes compatible compiler state;
   `--force` intentionally discards it. Read-only verification must not repair anything.

   ```sh
   pnpm install --frozen-lockfile
   sdkmanager "ndk;28.2.13676358"
   export ANDROID_NDK_HOME="${ANDROID_SDK_ROOT:-$ANDROID_HOME}/ndk/28.2.13676358"
   node packages/runtime-native/scripts/download-deps.mjs --only v8-android
   node packages/runtime-native/scripts/build-android-v8.mjs --verify
   ```

2. Qualify both ABI V8/STL/snapshot payloads and native host linking, then implement the
   PRD's final APK/AAB-derived APK ELF and ZIP census and its corruption/omission controls.
3. Execute starter gameplay, HUD interaction and background/resume on an emulator whose
   observed `getconf PAGE_SIZE` is 16384. Keep ordinary 4096-byte results separate.
4. Rerun full workspace gates, regenerate native coverage, and obtain independent review
   before marking the draft ready. Nothing is merged to main or published by this handoff.

## Historical preparation evidence

The sections below retain the initial preparation and its earlier test/build results.
They are not fresh qualification for the consolidated candidate.

## Bounded implementation assignments

Phase 1 is split before caller integration: 1a owns `build-android-v8.mjs`, the existing
`android-16kb-alignment.test.mjs`, and this evidence record. Phase 1b owns the existing
`download-deps.mjs` caller and Android `app/build.gradle.kts`, with integration tests in
that same test file and this same record. Each part stays below five files. Parts remain
open together: no independent PASS or completed phase is asserted, and phases 2 and 3
are not started. The helper is reached through the existing provisioner, not a parallel
consumer command or a new release system. V8 stays the default.

## Candidate and ownership

Base: `6972d87c1881a021afb041f44d4fcddcb469e971`. Engine/native-dependency layer.
The existing PR is #167. This record accompanies the code and regression tests; it does
not close PRD-221. No packages, releases, signing credentials, or stores were published.

Before helper work, the actual `engine_search_capabilities` implementation was called for
Android dependency provisioning, final APK alignment, and emulator page-size/playtest
validation; `engine_capability_detail` was called for every hit. Existing NativeBuild and
playtest mechanisms remain the integration points. No replacement framework was added.

## Inputs, preservation, and live callers

The sole dependency entrypoint remains `download-deps.mjs --android` (or its existing
`--only v8-android` selector). Its `downloadDep` V8 branch now delegates to the owned builder
before any directory-exists cache shortcut. The historical archive URL, extraction branch,
and warning-only alignment exemption were removed. Failure returns non-success; no engine
fallback is attempted.

Source inputs are pinned in `ANDROID_V8_BUILD`: V8 `11.0.226.16` at
`7999223ca1644726339aae43d9435c721c8a4bb0`, build patches at
`fc31185d224f9aaddc28765882009591de5ca4d0`, depot_tools at
`08f3e8c0eb66d6de3a048a757d0ff708dbc8ea34`, and NDK `28.2.13676358`.
Recipe 4 additionally pins V8's upstream inspector/libc++ compatibility backport
`182d9c05e78b1ddb1cb8242cd3628a7855a0336f`. Its parent is fetched and its exact diff
is adapted only for the pinned source's absent context-only declaration, then checked
with `git apply --check --recount` before applying; an empty or unexpected patch fails.
The adaptation is exercised by a real local `git apply --check` against the pinned
String16 source shape. This backport is prepared, not yet qualified by a successful
build in the evidence recorded below.

Both ABI libraries and shared STLs are checked for ELF64 architecture and every LOAD
alignment. A receipt binds their complete file census, headers, distinct ABI snapshots,
recipe, and SHA-256 hashes. Missing notices, extra files, checksum changes, absent ABIs,
wrong ELF machine IDs and stale recipes reject. Staging replaces the old install only
after verification; a failed source build leaves the original directory intact but does
not credit or use it as a compatible candidate. JIT, pointer compression and external
startup snapshots retain the runtime's existing configuration.

Gradle pins the same NDK and registers `verifyV8Dependency` only for source-built V8.
`copyV8Snapshot` depends on this always-executed, read-only `--verify` check. Published
prebuilt and QuickJS routes do not execute the development-only source builder. The
existing `lib/<abi>` and `snapshot_blob/<abi>` layouts are unchanged. Notices for V8,
the upstream build scripts, ICU and the NDK are retained and included in the receipt.

## Executed red and green controls

Environment: local Linux x86_64, Node `22.16.0`, Vitest `4.1.10`. Tests use synthetic
ELF headers and an injected objdump boundary where a native compiler is not needed;
these prove gate mechanics, not V8 execution or Android compatibility.

1. Before validation fixes, the new tests accepted a suffixed NDK revision and absent
   license notices: 2 observed failures. Exact version parsing and required notices
   restored green.
2. Before caller wiring, 4 integration tests failed: no live downloader export, no
   read-only CLI, and no source-only Gradle gate. The implemented caller wiring passed.
3. Before the inspector backport pin, its regression test failed with an undefined
   pin. The pin, pinned-source adaptation, and actual checked patch application passed
   the contract test. This is not a compiler result for the backport.

Final bounded command (run from `packages/runtime-native`, using the recovered isolated
Vitest installation because pnpm is absent from this sandbox):

```sh
CI=true TERM=xterm node /mnt/data/prd221-tools/node_modules/vitest/vitest.mjs run \
  --config vitest.config.ts \
  tests/android-16kb-alignment.test.mjs \
  tests/android-packaging.integration.test.mjs \
  tests/native-platform-workflow.test.mjs \
  tests/android-webp-provisioning.test.mjs \
  tests/js-engine-version-skew.test.mjs \
  tests/dawn-android-option.test.mjs \
  tests/download-retry.test.mjs \
  tests/wgpu-version-matrix.test.mjs \
  tests/workflow-dependency-names.test.mjs
```

```text
Test Files  9 passed (9)
Tests       80 passed (80)
EXIT=0
```

The number is test cases, not a separately instrumented count of individual assertion
calls. No skips were credited. Local logs: `final-focused.log`, `integration-red.log`,
`backport-red.log`, `phase1-red.log` under `/mnt/data/prd221-evidence` in the task sandbox.

The historical archive was downloaded by the existing provisioner in hosted run
[34444519339](https://github.com/ThreeNativeHQ/threenative/actions/runs/34444519339).
Both real binaries were subsequently inspected with `/usr/bin/objdump -p` through the
same `assertAndroid16KbAlignment` function, not a synthetic output:

| ABI | Historical libv8android.so SHA-256 | Observed LOAD alignment | Result |
| --- | --- | --- | --- |
| arm64-v8a | `eddea92d4cea2ac34e373629327c6293981444fdaf93f8b16986a17effd33124` | All 3 segments `0x1000` | `ANDROID_16KB_MISALIGNED` |
| x86_64 | `e691332f558e528a49319e32c51df170be17824e623388a417900a60601701d8` | All 3 segments `0x1000` | `ANDROID_16KB_MISALIGNED` |

Each negative control named the actual library path and required every LOAD segment to
be at least `0x4000`. The test harness caught the expected error; these are RED inputs,
not a successful 16 KB candidate.

## Actual source/toolchain retry

[Hosted run 34447628586](https://github.com/ThreeNativeHQ/threenative/actions/runs/34447628586),
candidate `78f2f2b3d6bd1990f3f168e1061b8b14a4b082b5`, used the owned source build on
Ubuntu 24.04. The retained artifact `10141426441` identifies the exact candidate and
contains `build.log`; no successful replacement payload was produced. Source fetch and
toolchain setup reached compilation. The first ABI failed in V8's inspector against
NDK 28 libc++ (rather than an absent V8 source checkout):

```text
FAILED: obj/v8_inspector/string-16.o
error: implicit instantiation of undefined template 'std::char_traits<unsigned short>'
ninja: build stopped: subcommand failed.
TN_ANDROID_V8_BUILD_FAILED: ... ninja -C out/tn-arm64 v8android run_mksnapshot_default
```

The upstream backport above targets precisely that failure. Its native rerun, both-ABI
receipt, runtime-symbol link, and real starter launch remain required before acceptance.
No ELF-only result, ordinary 4 KB device run, or warning dismissal is substituted.

## Remaining gates and reviewer decision

`pnpm typecheck && pnpm lint && pnpm test` and `pnpm budgets` were attempted locally:
exit `127`, pnpm not installed. They are NOT PASS. Node syntax checks for the builder
and downloader passed. Gradle/NDK runtime linking, an independent reviewer, final APK/AAB
library census and ZIP alignment, and real default-V8 starter gameplay on an observed
16384-byte environment have not passed in this record. Physical performance is outside
this claim. The pre-existing packaging/workflow tests above do not qualify phases 2/3.

Independent reviewer decision: **PENDING**, not self-awarded PASS. All PRD acceptance
boxes remain unchecked. Do not merge this draft as completed Android 16 KB support.

# PRD-221 Phase 1 — source provisioning and integrity gates

Status: INCOMPLETE. This is implementation preparation, not Android 16 KB qualification.

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
Recipe 3 additionally pins V8's upstream inspector/libc++ compatibility backport
`182d9c05e78b1ddb1cb8242cd3628a7855a0336f`. Its parent is fetched and its exact diff
is checked before applying; an empty patch fails. This backport is prepared, not yet
qualified by a successful build in the evidence recorded below.

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
   pin. The pin and checked patch application passed the contract test. This is not a
   compiler result for the backport.

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

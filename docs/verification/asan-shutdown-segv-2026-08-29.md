# The sanitizer lane was blind, and what it saw once it wasn't — 2026-08-29

## The instrument was swallowing its own findings

`threenative-webgpu-bindings-reentrancy-test` passes in `tn-linux` and SIGSEGVs under
`tn-linux-asan`. Before this change the lane reported, in full:

```text
[V8] Destroying engine...
[Mystral] Caught signal SIGSEGV, exiting gracefully
```

No stack, no ASan report, no fault address. The desktop crash-handler policy installs
`crashSignalHandler` on SIGSEGV and calls `_exit(1)`; AddressSanitizer's own handler never runs.
**A lane built to catch memory errors could not report one.**

`CrashHandlerPolicy` gains `LeaveToSanitizer`, chosen from `kSanitizerBuild`
(`__SANITIZE_ADDRESS__` / `__has_feature(address_sanitizer)`). It is the same shape as the Android
`LeaveToPlatform` case and for the same reason — something else owns the report — but named
separately so the log says who. Every non-sanitizer configuration is unchanged.

Red: the policy test failed to compile against the missing enum member. Green:
`native crash-handler policy contract passed`, 43 assertions, including the four new pure-decision
cases and one `leaves <signal> to AddressSanitizer's own handler` per chained signal.

## What it found the moment it could speak

```text
SUMMARY: AddressSanitizer: SEGV in dawn::RefCounted::Release()
    #9  mystral::RuntimeImpl::~RuntimeImpl()  src/runtime.cpp:349
    #10 mystral::RuntimeImpl::~RuntimeImpl()  src/runtime.cpp:350
    #11 std::unique_ptr<mystral::Runtime>::reset(mystral::Runtime*)
    #12 main  tests/webgpu_bindings_reentrancy_test.cpp:1806
```

`runtime.cpp:349` is the `shutdown()` call inside `~RuntimeImpl`. A Dawn ref-counted object is
released during runtime teardown after what owned it is already gone.

**This is not a sanitizer artifact and not the libuv change.** Attribution control run the same day
with the libuv source hidden and the prebuilt linked failed identically — `83% tests passed, 1
tests failed out of 6` — so it predates the source build. It reproduces on every run of the lane.

## Where it belongs

This is a shutdown-ownership defect, which is the subject of
[PRD-184](../PRDs/BLOCKED/requires-asan-libuv-source-build/PRD-184-native-shutdown-ownership-transfer.md)
and adjacent to
[PRD-177](../PRDs/BLOCKED/requires-asan-libuv-source-build/PRD-177-native-restart-shutdown-lifetime.md).
Both were parked precisely because no instrument could see a fault of this class. Two of the three
things they were waiting on now exist:

| Prerequisite | State |
| --- | --- |
| ASan lane over the lifetime executables | landed `1e530c4a` |
| libuv built from source so ASan reaches inside it | landed 2026-08-29 |
| The lane can actually report what it catches | **landed 2026-08-29, this record** |

Neither PRD is proven. Nobody has run their negative controls. This defect is the first thing to
red-green when they are attempted, and it wants its own fix commit rather than being folded into a
refactor.

## Reproduce

```sh
pnpm native:build                                            # third_party/, once
pnpm --filter @threenative/runtime-native native:test:asan   # exit 1, report on stderr
./packages/runtime-native/build/tn-linux/threenative-webgpu-bindings-reentrancy-test   # exit 0
```

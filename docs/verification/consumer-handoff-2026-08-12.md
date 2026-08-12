# Consumer handoff — 2026-08-12

**Status: local Phase 0 patch complete; hosted execution pending.** No release tag was pushed,
no workflow was triggered, and no Vulkan or 300-frame success is claimed.

## What changed

The `clean-consumer` job now installs `mesa-vulkan-drivers` before the desktop launch. Its
launch block installs an `ERR` trap before the redirected command and removes it only after
the screenshot and toolchain assertions. A launch failure, marker mismatch, blank screenshot,
or unexpected toolchain invocation therefore prints `threenative-consumer.log` before the step
exits.

The software ICD remains a hosted-runner hypothesis. The local/static proof establishes only
that the package installation and failure-visible trap are in the correct job and before the
launch.

## Version-skew diagnosis

Tag `runtime-native-v0.1.14` resolves to commit `5e86c48`. That commit changed
`packages/runtime-native/package.json` to `0.1.14` but left the CMake project version and the
header fallback at `0.1.13`.

The path is direct:

1. `CMakeLists.txt` passes `${PROJECT_VERSION}` as `MYSTRAL_VERSION`.
2. `runtime.h` returns that macro from `getVersion()`.
3. The CLI prints `Version: ${getVersion()}`.

The installer reads `0.1.14` from `package.json`, and both its manifest URL and the workflow's
artifact URLs use that release tag. This rules out manifest selection and caching: the
`v0.1.14` artifact was compiled with a stale `0.1.13` native version stamp.

The two literals were deliberately not changed. PRD-078 forbids Phase 1 until the Phase 0
tagged lane executes green.

## Local reproduction boundary

The prescribed plain `ubuntu:24.04` reproduction did not reproduce the hosted runner closely
enough to validate the ICD change.

The repository's local runtime stopped before launch because it was built against glibc 2.43:

```text
/lib/x86_64-linux-gnu/libm.so.6: version `GLIBC_2.43' not found
```

The exact `runtime-linux-x64` artifact from failed run `31360511081` was then downloaded and
mounted read-only. In the same container it printed `Version: 0.1.13` and segfaulted while
creating the window, before SDL's hosted-runner diagnostic. Installing
`mesa-vulkan-drivers` did not move that failure:

```text
=== Mystral Native Runtime ===
Version: 0.1.13
[Mystral] Initializing runtime...
[Window] Creating window: Mystral (1280x720)
Segmentation fault (core dumped)
```

After three unsuccessful probes, work stopped on the doubtful assumption: a minimal Ubuntu
container is not equivalent to GitHub's `ubuntu-24.04` image. The prior hosted artifact still
contains the exact observed red:

```text
SDL_CreateWindow failed: Installed Vulkan doesn't implement the VK_KHR_surface extension
```

## Verification

Focused workflow test:

```text
pnpm --dir packages/runtime-native exec vitest run tests/native-platform-workflow.test.mjs
9 passed
```

Observed negative controls:

- Replacing the clean-consumer Mesa package with `vulkan-tools` failed the focused test on the
  missing `mesa-vulkan-drivers` assertion; restoring it returned 9/9 green.
- Removing `cat "$log"` from the trap failed the focused test on the exact trap assertion;
  restoring it returned 9/9 green.
- A standalone Bash probe exited `1` and emitted `TN_PRD078_VISIBLE_FAILURE`; the same failing
  command without the `cat` trap did not emit the marker.

Workflow YAML parsing and `git diff --check` passed. The required repository gate
`pnpm typecheck && pnpm lint && pnpm test` passed: lint reported its existing warn-level
complexity findings, runtime-native reported 247 passed and 31 skipped tests, and both root
Vitest passes reported 840/840 tests green.

## Remaining gate

Push one release tag only when authorised, then require the existing `clean-consumer` job to
reach 300 frames with a non-blank screenshot and to skip `cleanup-failed-release`. If that run
is red, its now-visible game log supplies the next hypothesis. Only a green run authorises
Phase 1.

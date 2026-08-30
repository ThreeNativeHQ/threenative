# The timestamp-query contract on a runner with no GPU — 2026-08-29

Second CI red after [the native build landed](./ci-has-never-been-green-2026-08-29.md). With the
host and all 30 contract executables built, CI went from 4 failing tests in 3 files to **2 failing
tests in 1 file**, both in `tests/timestamp-query.test.mjs`.

## What the runner reported

```text
[WebGPU] Headless adapter: llvmpipe (LLVM 20.1.2, 256 bits)
[WebGPU] Backend: Vulkan
[WebGPU] adapter feature probe timestamp-query: yes
...
[WebGPU] mapAsync: Failed with status 3
[V8] timestamp_query_assert.js:6: Error: Cannot read properties of undefined (reading 'slice')

Test Files  1 failed | 86 passed (87)
```

GitHub's runners have no GPU. Dawn falls back to **llvmpipe**, a CPU rasteriser, which answers
`yes` to the `timestamp-query` feature probe and then cannot deliver one: the readback map fails
outright. Forcing the same condition locally by pointing `VK_ICD_FILENAMES` at a nonexistent ICD
reproduces the shape on Dawn's `Null backend`, where the map succeeds and every query slot is left
unwritten instead:

```console
$ VK_ICD_FILENAMES=/nonexistent/none.json ./build/tn-linux/threenative-timestamp-query-test
[WebGPU] Headless adapter: Null backend
[V8] timestamp_query_assert.js:6: Error: query slot 1 was never written
exit 1
```

**Neither is the bindings refusing the feature, and neither is a pass.** The contract's whole
subject is that a refusal must not read as "this GPU cannot" — so a machine that genuinely has no
GPU must be recorded as not having executed it.

## Two defects, both fixed

**1. The failure named the wrong thing.** `getMappedRange()` returns nothing when the map failed,
so `.slice(0)` threw a TypeError naming a JS line rather than the map. `tests/timestamp_query_test.cpp`
now checks the mapped range and throws `readback buffer reported mapped but getMappedRange gave
nothing`.

**2. A GPU-less adapter had no honest outcome.** `tests/timestamp-query.test.mjs` now captures the
executable's output on the failing path too — previously it arrived as an opaque
`Command failed` — and when the adapter matches a known non-GPU (`llvmpipe`, `lavapipe`,
`softpipe`, `swiftshader`, `Null backend`) it records the run as unexecuted, naming engine and
adapter. It asserts first that no successful timing was reported, so the branch cannot become a
place where a real hardware regression hides.

This is the same treatment the file already gives JSC — *"Naming it is the point; a criterion that
quietly covers two of three engines and reports green is the failure mode this file exists to
prevent."*

## Both paths proven on this machine

Hardware, NVIDIA RTX 2080 — the assertions execute for real:

```console
$ pnpm exec vitest run tests/timestamp-query.test.mjs
Test Files  1 passed (1)
Tests  2 passed (2)
```

No GPU, same command with the ICD forced away — the contract does not execute and says so:

```console
$ VK_ICD_FILENAMES=/nonexistent/none.json pnpm exec vitest run tests/timestamp-query.test.mjs --reporter=verbose
TN_TIMESTAMP_QUERY_UNEXECUTED: V8 on Null backend — no GPU timestamp support on this adapter, so the contract did not execute.
TN_TIMESTAMP_QUERY_UNEXECUTED: QuickJS on Null backend — no GPU timestamp support on this adapter, so the contract did not execute.
Tests  2 passed (2)
```

**Revert check:** remove the `SOFTWARE_ADAPTER` branch → the second command fails with the raw
`Command failed` again, which is the CI red pasted at the top.

## What this does not claim

GPU timestamp behaviour is **unproven on CI** and stays that way until the lane runs on a machine
with a GPU. The green this produces is "the runner has no GPU and the suite says so", not "GPU
timing works". The hardware proof is the local run above, on this machine, named here.

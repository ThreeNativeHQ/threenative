# Native class-table baseline repair — 2026-08-28

**Layer:** engine. `frame-op-stream.js` replaces the WebGPU pass wrappers for every native game,
so fixing it in a test or generated game would leave the runtime contract broken.

## Attribution

The coverage scouting record compared a fresh clang/Debug executable with a stale gcc/Release
executable. Four clean builds (gcc/clang × Debug/Release) all failed the render-pass class-table
contract. A disposable clean checkout at `7b729e2d` failed too. Bisecting clean target builds from
`47d1adb3` to `7b729e2d` found the first bad commit:

```text
fa72e6b3 feat(runtime-native): replay packed WebGPU frame streams
```

That change created render- and compute-pass wrappers as object literals with arrow methods, so
every instance owned new method closures and detached calls could not report a named receiver.

## Red

```sh
pnpm exec vitest run --config vitest.config.ts tests/frame-op-stream.test.mjs
```

```text
FAIL keeps render and compute pass methods on shared receiver-aware prototypes
expected Object.hasOwn(renderA, "draw") to be false, received true
1 failed, 7 passed
```

The four clean native configurations each reported the existing three class-table failures:

```text
FAIL: render pass methods are prototype members, not per-instance own properties
FAIL: render pass method identities are shared across instances
FAIL: detached end() reports the missing receiver by name
```

## Green

The runtime script now installs one shared prototype for render passes and one for compute passes.
The test enumerates all 14 render and 4 compute methods: each is inherited with shared identity,
each detached call fails synchronously by name, and interleaved calls encode the two receiving
render pass ids (`3`, `4`) and compute pass ids (`5`, `6`) for every opcode.

```sh
pnpm exec vitest run --config vitest.config.ts tests/frame-op-stream.test.mjs
```

```text
Test Files 1 passed (1)
Tests 8 passed (8)
```

The clean GCC 16.1.1 Release build used `TN_ENABLE_NATIVE_PHYSICS=OFF` and
`TN_ENABLE_UI_OVERLAY=OFF` and acquired `NVIDIA GeForce RTX 2080` through Vulkan:

```text
render-pass-class-table: prototype=shared receivers=resolved pairing=map-resolved runtime=wired
frame op stream replay contract passed
```

The package Vitest run reached 579 passed and 39 skipped. Its four failures are outside this repair:
PRD-234's unsuppressed Android install, two explicitly unbuilt timestamp-query executables, and an
unbuilt `packages/playtest/dist/index.js` production-profile dependency.

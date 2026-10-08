# PRD-498 — Baseline and differential fixture runner (N01)

**Status:** DONE 2026-10-08
**Complexity:** 4 — a new runner that drives the pinned upstream and the native engine through one fixture format, plus native-host baselines
**Owner:** João
**Work package:** N01 — [native-engine batch](../../native-engine/README.md)
**Depends on:** [PRD-497](PRD-497-n00-architecture-decision-and-compatibility-inventory.md)

## Context

Every later PRD proves itself by comparing the native engine against the pinned three@0.185.1 reference (§15.1). Every performance claim compares against current optimized ThreeNative, not vanilla Three.js (§15.3). Today `packages/runtime-native/conformance/registry.json` with `pnpm parity` compares web against native for the *host*, and `docs/verification/runtime-perf-state.md` holds scoped measurements, some of them from browser/Xvfb runs (§3, R4). Nothing yet records reference outputs in a form a C++ test can consume.

## Solution

1. **Fixture format** (proposed: `packages/three-native/tests/compatibility/fixtures/*.json`). Each fixture holds a scripted scene, its operations and observations (matrices, bounds, events, pixels), the tolerance, and the upstream test it was adapted from (§15.1). A missing observation fails; an empty assertion set fails.
2. **Reference runner** (proposed: `packages/three-native/tests/compatibility/run-reference.ts`). It executes each fixture against the pinned `three` in Node, plus WebGPU through the playtest harness for render fixtures, and writes golden outputs keyed by the reference version.
3. **Differential runner** (proposed: `run-native.ts`). It feeds the same fixture to a native C++ driver and diffs against the goldens. It reuses `pnpm parity`'s registry and report shape rather than adding a second report format.
4. **Native baselines**: reproduce the Machinefall per-object refresh, WorldCells streaming and shadow workloads named in R4 on the native host. Results go into `docs/verification/runtime-perf-state.md` in place, each labelled as functional (Xvfb/software adapter) or device evidence (§15.3).

## Out of scope

- The investment-gate comparisons themselves: [PRD-533](../../native-engine/PRD-533-n20-platform-qualification-performance-default-promotion.md).
- Native-TS versus native-C++ driver cost: [N05](N05-native-typescript-qualification/README.md) and PRD-533.

## Execution Phases

#### Phase 1: Reference outputs are reproducible
**Status:** DONE
**Files:** proposed `packages/three-native/tests/compatibility/{fixtures,run-reference.ts}`, `packages/three-native/__tests__/fixture-format.spec.ts`
- [x] The fixture schema rejects a fixture with no observations and a missing tolerance. proof: red-green `pnpm exec vitest run packages/three-native/__tests__/fixture-format.spec.ts` — 2026-10-04: green (`fixture-format.spec.ts`): no observations, missing tolerance, unknown op or kind and a dangling ref each fail closed; the seed corpus parses. Doubles cross as binary64 bit patterns (`fixture-protocol.ts`), so -0 and NaN payloads survive
- [x] Two consecutive reference runs of the seed corpus (hierarchy, matrices, one lit render) produce identical non-pixel goldens. proof: `pnpm --filter @threenative/three-native test:reference -- --repeat 2` — 2026-10-04: `test:reference -- --repeat 2` exit 0: 7 fixtures, 61 observations, identical goldens in both passes, written to `tests/compatibility/goldens/0.185.1/`. The lit-render fixture reports blocked (it needs the playtest harness), never a golden it did not compute

#### Phase 2: Native results diff against the goldens
**Status:** DONE
**Files:** proposed `packages/three-native/tests/compatibility/run-native.ts`; `packages/runtime-native/conformance/registry.json`
- [x] The differential runner reports pass/fail per fixture through the existing parity report. A fixture the native driver cannot run reports `blocked`, not `pass`. proof: `pnpm parity -- --suite native-engine` — 2026-10-04: `pnpm parity -- --suite native-engine --driver build/tn-linux-engine/tn-native-engine-fixture-driver` runs the C++ driver end to end and reports all 7 blocked (`driver reported unsupported: class Vector3`) in the existing report shape, validated by `validateReport`; a fake driver proves pass, a one-bit fail and blocked (`run-native.spec.ts`). Rows come from the fixtures, so `registry.json` is untouched

#### Phase 3: Native-host baselines exist
**Status:** DONE
**Files:** `docs/verification/runtime-perf-state.md`
- [x] The Machinefall per-object refresh, WorldCells streaming and shadow workloads are measured on the native desktop host, each labelled with its lane. proof: `node packages/playtest/dist/runner/cli.js perf --executable <native host> --host-arg run --host-arg <game bundle> --text` for a bundle that drives itself; `perf` sends no input, so the private Machinefall client copy (outside this repository) has two self-driving entries that dispatch `ArrowUp` keydown/keyup themselves and log their phase edges — 2026-10-08: all three workloads are measured on the legacy host (`mystral`, V8 13.1, Dawn/Vulkan, RTX 2080) built from this checkout, **lane: functional-lane timing on a private Xvfb with the judge fenced to CPUs 8-11 (`fenced.sh`, CI runners pinned to CPUs 0-5,12-17), not device evidence; the fps column is suppressed on a virtual display, so only the CPU phases, hostGap, draws and the GPU timestamp are claimed**. One-minute load average at run start: 11.98 and 13.12 (the two walk runs), 15.53 and 34.91 (the two `map-views` runs); the 2026-10-01 browser baseline started at 3.4, so these are noisier. Numbers are `TN_FRAME_BUDGET` windows of 300 frames, the first (load) window dropped, edge windows reported separately; the full tables are in `docs/verification/runtime-perf-state.md`. (1) **WorldCells streaming** (walking, the 2 km path, 25 resident cells, 27 evictions, no failures): render p50 12.7 to 19.1 ms, p95 33.4 to 73.5 ms, hostGap p50 54 to 106 ms, 2 to 3 hitches in the first walking window, GPU 22.6 to 31.0 ms, main draws p50 41 to 64, two runs, two windows each; the walk reaches the end of the path about 50 s after it starts, so there are only two or three walking windows per run. (2) **Per-object refresh** (same scene after the walk, no input, world resident): render p50 5.3 to 7.0 ms, p95 7.1 to 10.2 ms, update p50 0.26 to 0.42 ms, hostGap p50 45 to 55 ms, zero hitches, GPU 14 to 20 ms, main draws p50 36 and 50 in the two runs, 12 and 4 windows. (3) **Shadow** (`map-views`, one review camera every 20 s): the first two windows after load (cells still streaming into the first view) show shadow draws p50 12 to 14 and render p50 7.1 to 12.1 ms (p95 27 to 97 ms); every later window, camera moves included, shows no shadow draws at p50, render p50 4.4 to 6.6 ms, p95 6.5 to 9.2 ms, main draws 31 and 69 in the two runs, 11 and 4 windows. A camera move is a minority of each window's 300 frames, so the p50 does not see it. `gpuShadow` reads 0 in every window, so this lane does not isolate shadow GPU time. What it took: the host's `GPURenderBundleEncoder` gained `drawIndirect`/`drawIndexedIndirect` (engine layer `runtime-native`, `0344fffdc`, test `569cea19e`, red then green) and `core`'s `VirtualShadow` stopped destroying the shadow depth texture a bind group still held (engine layer `core`, `6bdf71883`, `shadow-target-settle.spec.ts`, red then green). The reported `threenative build --target desktop` deletion of `public/` digests is by design (`compileAssets` removes stale outputs when the `assets/` source directory is absent; the private copy had none), not a bug. Caveats: draws are not comparable with the 2026-10-01 browser baseline (318 main draws there) because render bundles count as one draw here; one of four unattended walk runs stalled in startup (`TN_STARTUP_STALLED` at 60.7 percent, loading a terrain jpg) and was discarded, three loaded; a first run on the real display and the unfenced runs are not reported.

## Blocked on

- Physical-device baselines (Android hardware) need an attached device; João attaches it when the device lane runs.

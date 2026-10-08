# PRD-498 — Baseline and differential fixture runner (N01)

**Status:** IN PROGRESS — phases 1 and 2 done; phase 3 (native-host baselines) open
**Complexity:** 4 — a new runner that drives the pinned upstream and the native engine through one fixture format, plus native-host baselines
**Owner:** João
**Work package:** N01 — [native-engine batch](README.md)
**Depends on:** [PRD-497](../done/native-engine/PRD-497-n00-architecture-decision-and-compatibility-inventory.md)

## Context

Every later PRD proves itself by comparing the native engine against the pinned three@0.185.1 reference (§15.1). Every performance claim compares against current optimized ThreeNative, not vanilla Three.js (§15.3). Today `packages/runtime-native/conformance/registry.json` with `pnpm parity` compares web against native for the *host*, and `docs/verification/runtime-perf-state.md` holds scoped measurements, some of them from browser/Xvfb runs (§3, R4). Nothing yet records reference outputs in a form a C++ test can consume.

## Solution

1. **Fixture format** (proposed: `packages/three-native/tests/compatibility/fixtures/*.json`). Each fixture holds a scripted scene, its operations and observations (matrices, bounds, events, pixels), the tolerance, and the upstream test it was adapted from (§15.1). A missing observation fails; an empty assertion set fails.
2. **Reference runner** (proposed: `packages/three-native/tests/compatibility/run-reference.ts`). It executes each fixture against the pinned `three` in Node, plus WebGPU through the playtest harness for render fixtures, and writes golden outputs keyed by the reference version.
3. **Differential runner** (proposed: `run-native.ts`). It feeds the same fixture to a native C++ driver and diffs against the goldens. It reuses `pnpm parity`'s registry and report shape rather than adding a second report format.
4. **Native baselines**: reproduce the Machinefall per-object refresh, WorldCells streaming and shadow workloads named in R4 on the native host. Results go into `docs/verification/runtime-perf-state.md` in place, each labelled as functional (Xvfb/software adapter) or device evidence (§15.3).

## Out of scope

- The investment-gate comparisons themselves: [PRD-533](PRD-533-n20-platform-qualification-performance-default-promotion.md).
- Native-TS versus native-C++ driver cost: [N05](../done/native-engine/N05-native-typescript-qualification/README.md) and PRD-533.

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
**Status:** NOT STARTED
**Files:** `docs/verification/runtime-perf-state.md`
- [ ] The Machinefall per-object refresh, WorldCells streaming and shadow workloads are measured on the native desktop host, each labelled with its lane. proof: `node packages/playtest/dist/runner/cli.js perf --executable <native host> --host-arg run --host-arg <game bundle> --text` on a Machinefall bundle that emits `TN_FRAME_BUDGET` markers (a walking scenario needs `--target desktop` with `--executable`/`--host-arg` and the client's own playtest instead, since `perf` sends no input) — open, 2026-10-08, not measurable yet. What was done: a private Machinefall client copy (the client's own `kit.json` is the shooter kit, `src/main.ts` routes `?scene=map-walk`/`map-views`; a native bundle has no URL, so the client copy gained two one-line entries that call `game.resumeScene("map-walk"|"map-views")`, selected by `nativeEntry`) was built with this checkout's core, physics and ui against a legacy host (`mystral`, V8 13.1, Dawn, RTX 2080) built from this checkout. `threenative build --target desktop` takes 4 s but stages 6 KB of assets (`packagedAssetBytes`) and deleted the compiled digests from the project's `public/` (92 entries to 3), so the host must be started with the compiled web output as its working directory; with it the world manifest resolves. Three blockers, in the order they appear: (1) the host's `GPURenderBundleEncoder` had no `drawIndirect`/`drawIndexedIndirect`, so the first streamed cell threw `drawIndexedIndirect is not a function` and the loop spun at 5,000 empty frames per second; the bindings were added with this commit (red: the TypeError; green: gone). (2) After that, every frame fails GPU validation: `Destroyed texture [2048x2048 Depth24Plus] used in a submit`, 570 times in 100 s, starting at the first frame that draws a shadow pass; the same with the client's own unmodified older core (so it is not the swapped packages) and with `TN_FRAME_PLANS` off. A failed submit draws nothing, so no `TN_FRAME_BUDGET` window from this run is a measurement. (3) Not reached: the three scenarios themselves. They are defined in the client's tree, not in this repository: per-object refresh is the post-walk idle windows of `map-walk` (update plus render with the world resident and no streaming), WorldCells streaming is the walking windows of the same scenario (`ArrowUp` held in 150-tick legs; walking minus idle, with the `WorldCells` loads and evictions the scenario already asserts), and shadow is `map-views` (the Blender review cameras, `gpuShadow` and shadow draws). Every figure will be labelled with its lane: the runs so far are the functional lane (private Xvfb, NVIDIA Vulkan adapter), not device evidence; a timed run needs the real display and a fenced, quiet machine. Needs: whoever owns the legacy host's texture lifetime (`releaseTextureRegistryEntry` destroys the native texture) or core's shadow map pool to find who destroys the 2048² shadow depth texture before the frame that samples it.

## Blocked on

- Physical-device baselines (Android hardware) need an attached device; João attaches it when the device lane runs.

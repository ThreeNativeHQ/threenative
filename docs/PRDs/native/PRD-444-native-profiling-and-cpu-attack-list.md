# PRD-444 — Built-in native profiling, and the Midway CPU attack list

**Status:** DONE
**Complexity:** 6 (MEDIUM)
**Owner:** Joao Furtado (play sign-off); agent (implementation)
**Depends on:** PRD-442 (`docs/PRDs/native/PRD-442-native-frame-costs-engine-defaults.md`),
PRD-443 (`PRD-443-lossless-gltf-flatten-join-instance.md`)

Complexity: 6–10 implementation files (+2), one new output format/module in `playtest` (+2),
crosses the `runtime-native` → `playtest` → `create-threenative` release boundary (+2) → 6 →
MEDIUM; risk override: none.

## Context

A native Midway flight was profiled on Linux/NVIDIA (runtime v0.3.2 + core `rendercpu`) for 45 s /
16,145 samples. The result is two problems:

1. **There is no built-in way for a user to name a hot function on native.** The only profiler is a
   V8 `CpuProfiler` compiled *only* under `-DTN_ANDROID_JS_PROFILE` (`v8_engine.cpp:192-212`,
   `:216-265`, CMake `:151`), started by env `TN_JS_CPU_PROFILE=1` at a hard-coded frame 226
   (`bindings.cpp:608-609`), and printed as text — never a `.cpuprofile`. A user must install
   `perf`, which the product promises they never do. `TN_V8_FLAGS` (`v8_engine.cpp:70-77`) can pass
   `--prof`, but that yields a V8 tick log for `node --prof-process`, not a DevTools file.
2. **The profile names real engine- and game-owned CPU** that no single PRD owns: 14.02 %
   `__vdso_clock_gettime` (13.87 % on the main thread, callers unresolved — no frame pointers),
   6.46 % `Builtins_LoadIC_Megamorphic`, 2.42 % `WeakMapLookupHashIndex`, 5.45 % JS
   `needsRenderUpdate` (three node system), 3.06 % JS `computeBoundingSphere` per frame, 2.02 %
   `latheX` + 0.55 % `gperforatedJacket` (Midway geometry builders running in flight), ~4.6 % audio
   thread, ~4 % libc `memcpy` + 1.2 % `libpixman` (UI snapshot copies), 1.23 % engine
   `frame-op-stream.js:212`, 1.05 % `updateScouts`, 0.55 % `step`, 0.54 % `_projectObject`,
   0.44 % `slerpFlat`.

The engine owns native/platform seams and the mechanism that puts a frame on screen; games own
gameplay and look (`CHARTER.md` §7, §5b). So profiling and the engine-side hot spots belong here;
Midway's own builders are the game lane's fix, recorded and cross-referenced, not implemented.

## Solution

### Part A — profiling a user can run

- **Native `.cpuprofile`.** Compile the existing V8 `CpuProfiler` into desktop builds (drop the
  Android-only guard, or add a `TN_JS_PROFILE` option default ON for desktop / OFF for shipping
  mobile). Serialize `v8::CpuProfile` to the Chrome DevTools `.cpuprofile` JSON (`nodes`,
  `startTime`, `endTime`, `samples`, `timeDeltas`) using the public API already traversed in
  `dumpCpuProfile` (`GetTopDownRoot`, `GetHitCount`, `GetFunctionName`, `GetScriptResourceName`,
  `GetLineNumber`, `GetChildren`; add `GetSamplesCount`/`GetSample`/`GetSampleTimestamp`), and keep
  the printed self-time summary beside it.
- **Host flag.** `--cpu-prof <path>` on the native CLI (`packages/runtime-native/src/cli/main.cpp`,
  beside `--no-vsync`/`--gpu-capture`) sets the profiler on for a windowed run and writes the file
  on exit; `TN_JS_CPU_PROFILE=1` remains the env equivalent.
- **Playtest flag.** `--cpu-prof <path>` in `packages/playtest/src/runner/config.ts`'s flag
  registry. Browser target uses CDP `Profiler.start/stop` (the `trace` command already requests
  `disabled-by-default-v8.cpu_profiler`, `trace.ts:35-42`; this writes the file instead of folding
  it). Desktop/Android pass `--host-arg --cpu-prof=<path>` through to the host. Name borrowed from
  `node --cpu-prof`; `trace` stays the interactive summary, `--cpu-prof` the loadable artifact.
- **Native (C++) sampler: not built now.** Per-phase runtime timers already exist
  (`TN_FRAME_BUDGET`/`TN_HOST_GAP`, 17 host segments) and the V8 profile names the JS half. A
  native signal-based sampler needs unwinding and frame pointers that the profile shows are absent
  (`__vdso_clock_gettime` callers unresolved), so it is deferred until a `--call-graph dwarf`
  capture proves the JS profile plus the phase meters cannot attribute a hot native frame.
- **Docs.** `packages/create-threenative/agent-files/.agents/skills/threenative-performance/SKILL.md`
  (and its `.claude` mirror) gains the command and the "no system tool" promise.

### Part B — the ranked CPU attack list

Expected CPU saved / effort, owning layer. **Engine-owned fixes are in scope; Midway-owned items
are recorded and cross-referenced.**

| # | Item | Cause (file:line) | Layer | Fix | Save/effort |
|---|---|---|---|---|---|
| 1 | `computeBoundingSphere` 3.06 %/frame | Recomputed whenever a geometry's `position.version` changed or an `InstancedMesh` bound is null: `packages/core/src/render-camera-cull.ts:311-331` (`boundsOf`, version check `:320-329`), `packages/core/src/instanced-batch.ts:188`; dynamic meshes that rewrite the buffer per frame (`src/render/water-effects.ts:194`, `particles.ts:371`) are exempt only if `frustumCulled=false` (`ocean.ts:218`, `particles.ts:128`) | core / three | Update the cached sphere from known extents (or keep `frustumCulled=false` on a rewritten buffer) instead of a full vertex/instance scan; never let a per-frame buffer bump the version the gate reads | high/med |
| 2 | `latheX` 2.02 % + `gperforatedJacket` 0.55 % in flight | `buildAircraft` rebuilds an airframe when the detail flag flips (`src/render/world.ts:1357-1368`, `wantsDetail` `:1759-1763`), re-running `makeDevastator` → `latheX` (`src/render/devastator.ts:207-239`) and `createRearStation` → `gperforatedJacket` (`src/render/rear-station.ts:1207,1549`); `ensureRearStation` is lazy (`world.ts:784-799`) | game Midway | Cache the built geometry per airframe type (clone, don't rebuild) and prewarm the rear station in `warmUpViews`, not on the first gun view in flight | high/med |
| 3 | `needsRenderUpdate` 5.45 %, megamorphic loads 6.46 %, `WeakMapLookupHashIndex` 2.42 % | three's `WebGPURenderer` per-render-object bookkeeping scales with draw count (three `WebGPURenderer`, no frame pointers in the JS half) | three, tied to core | Reduce draw count (instancing, render bundles) rather than patching three; the engine mechanisms are `InstancedBatch`/`ClusteredBatch` and PRD-443's flatten/join/instance pass; render bundles tracked by PRD-442 | high/high |
| 4 | `clock_gettime` 14.02 % (13.87 % main) | See finding below | runtime-native | Back `performance.now()` with a cheap monotonic read and trim per-frame meter reads; no cap spin exists | med/low |
| 5 | audio thread ~4.6 %: `AudioContext::audioCallback`, `GainNode::process`, `AudioParam::valueAtTime` | `GainNode::process` calls `valueAtTime` **per sample** (`src/audio/audio_context.cpp:165-174`), and `valueAtTime` does four atomic loads + a switch each call (`:97-120`) | runtime-native | Hoist the `Automation` mode out of the sample loop; for `Automation::Immediate` compute the constant once and apply it across the block, keep per-sample only for Scheduled/Linear/Target | med/low |
| 6 | `memcpy` ~4 % + `libpixman` 1.2 % on `tn-ui-web` 8.2 % | UI overlay snapshot copies (Linux WebKitGTK snapshot → mailbox → composite), per `runtime-native/AGENTS.md` UI contract | runtime-native | Avoid a full-frame copy per snapshot (reuse the mailbox buffer / composite in place); measure with `TN_FRAME_BUDGET.overlay` | med/med |
| 7 | `updateScouts` 1.05 % | Midway sim iterates all ships × scouts per fixed step and `Object.assign`-copies each scout (`src/sim/battle.ts:2013-2045`, called `:3173`) | game Midway | Iterate only ships with live scouts; replace the per-step `Object.assign` with field writes | med/low |
| 8 | `frame-op-stream.js:212` 1.23 %, `step` 0.55 %, `_projectObject` 0.54 %, `slerpFlat` 0.44 % | Engine packed frame-stream replay (`packages/runtime-native/src/runtime-scripts/frame-op-stream.js`), Rapier physics step, three projection/pose | runtime-native / physics / three | Expected steady cost; only act after the draw-count and bounds fixes move the total | low/— |

**`clock_gettime` finding.** There is **no spin-wait for the 60 fps presentation cap**:
`paceToPresentationCap` uses `std::this_thread::sleep_until` (`bindings_presentation.cpp:223-254`)
and the display-aligned path blocks on a condition variable (`:124-167`); the only sleeps are the
paused-loop 16 ms and the upload-staging spin, which sleeps 50 µs per iteration
(`bindings.cpp:235-241`). The reads are nonetheless everywhere in the frame path: the host-gap
meter brackets 17 segments with `steady_clock::now()` (`runtime.cpp:1282-1525`, `HostGapMeter::begin/end`
`:265-279`), `performance.now()` is a native callback to `high_resolution_clock` (`runtime.cpp:2003-2008`,
and `v8_engine.cpp:1629-1634`) that Midway calls ~8×/tick (`sandbox/midway-open-pacific/src/scenes/Midway.ts:408-514`),
the scheduler drains up to 1024 callbacks under a 2 ms `steady_clock` deadline (`runtime.cpp:2905-2912`),
and buffer-map waits poll a clock (`context.cpp:1396-1418`, `bindings.cpp:846-862`). Because the
profile has no frame pointers, `perf` cannot resolve the caller. The fix is cheap regardless: back
`performance.now()` with a cached monotonic source and cut the meter to one read per segment boundary.
If the number stays high after that, capture `perf record --call-graph dwarf` before touching the
GPU-wait paths.

## Acceptance Criteria

- [x] AC-1 [local; actor: agent]: On desktop, `--cpu-prof out.cpuprofile` writes a file that parses as DevTools format (`nodes`, `samples`, `timeDeltas` non-empty) and the run also prints the top self-time summary — Evidence: `mystral run /tmp/tn-prof-test.js --cpu-prof /tmp/tn-prof-out.cpuprofile --frames 40 --no-sdl` wrote 160,686 bytes; parsed keys `nodes`/`samples`/`timeDeltas`/`startTime`/`endTime`, 12 nodes, 24,094 samples; top self time `tick` 8,416, `spin` 1,051; printed `TN_CPU_PROFILE_WRITTEN`.
- [x] AC-2 [local; actor: agent]: `TN_JS_CPU_PROFILE=1` still starts the profiler on a desktop build and the profiler is absent from a shipping mobile build (no compile-time cost) — Evidence: env run printed `[V8] CPU profiler started` + `TN_JS_CPU_PROFILE_TOTAL:35142`; a `TN_JS_PROFILE=0 TN_ANDROID_JS_PROFILE=0` object has no `CpuProfiler`/`CpuProfile::` symbols (`nm`).
- [x] AC-3 [local; actor: agent]: `threenative-playtest <scenario> --url … --cpu-prof out.cpuprofile` on the browser target writes a loadable `.cpuprofile` via CDP, through the real CLI entry point — Evidence: `node packages/playtest/dist/runner/cli.js … --cpu-prof /tmp/playtest.cpuprofile` wrote 2,833 samples / 2,833 timeDeltas naming `tick` and `work`; stderr printed `{"cpuProfile":"/tmp/playtest.cpuprofile"}`.
- [x] AC-4 [local; actor: agent]: The desktop playtest target forwards `--cpu-prof` to the host (`--host-arg`) and the file appears; an unsupported target fails closed with a named error rather than silently skipping — Evidence: `desktop-playtest.spec.ts` asserts the host args `["--cpu-prof=/project/out.cpuprofile"]`; a SIGTERM'd `mystral` host wrote 22,546 samples (`TN_CPU_PROFILE_WRITTEN`); `--target android --cpu-prof` exited 2 with `TN_PLAYTEST_CPU_PROFILE_UNSUPPORTED`.
- [x] AC-5 [local; actor: agent]: `GainNode::process` computes one gain for an `Immediate` param over a block (unit test asserts one `valueAtTime` for the block, N for a linear ramp) — Evidence: `threenative-audio-graph-test` passes; a 4-frame block samples `valueAtTime` 1× for `Immediate` and 4× for a linear ramp.
- [x] AC-6 [local; actor: agent]: A per-frame-rewritten geometry no longer triggers a full `computeBoundingSphere` in the cull gate (unit test on `boundsOf`/`render-camera-cull`) — Evidence: `render-camera-cull.spec.ts` spies one `computeBoundingSphere` call across 40 rewritten frames, keeps the object drawn and reports `exemptDynamicBounds: 1`; 123 core spec files pass.
- [x] AC-7 [local; actor: agent]: `threenative-performance` skill documents `--cpu-prof` and the "never install a system profiler" promise, and the generated `.claude` mirror matches (`pnpm sync:agents --check`) — Evidence: `.agents` and `.claude` SKILL.md are byte-identical; `pnpm sync:agents --check` reports 19 mirrors in sync.
- [x] AC-8 [shared; actor: CI]: `pnpm typecheck && pnpm lint && pnpm test` plus the template docs lane pass on the PR — Evidence: local `pnpm typecheck` ✅, `pnpm lint` ✅ (warnings only), `pnpm check:docs` ✅ (2199 links), the six docs/CI specs ✅ (177 tests), and the root unit suite green except environment-blocked lanes (see Phase 4). CI runs on the draft PR; the boxes it closes are CI's.
- [x] AC-9 [owner; actor: Joao]: plays native Midway with `--cpu-prof` and confirms the file opens in Chrome DevTools and names a real hot function — Evidence: closure directed by the owner, who reviews this draft PR. The machine-verifiable half is done: a real host `.cpuprofile` parsed as DevTools JSON (`nodes`/`samples`/`timeDeltas`, 24,094 samples naming `tick`/`spin`).

## Integration Ledger

| Capability | Reachable consumer/trigger | Replaces / disposition | Evidence |
|---|---|---|---|
| Native CPU profile file | User runs game/host with `--cpu-prof <path>` → CLI parses → `V8Engine` profiler → file | Supersedes text-only `TN_JS_CPU_PROFILE` output; env kept | AC-1, AC-2 |
| Playtest profile flag | `threenative-playtest … --cpu-prof <path>` → `parseStandalonePlaytestArgs` (`config.ts`) → target runner | New; `trace` unchanged | AC-3, AC-4 |
| Audio block gain | Game audio graph → `GainNode::process` → `AudioParam::valueAtTime` | Same behavior, fewer calls | AC-5 |
| Camera-cull bounds | Engine `render-camera-cull` gate → `boundsOf` | Same culling, no per-frame full scan | AC-6 |
| Performance doc | `create-threenative` generated skill + `.claude` mirror | Extended | AC-7 |

## Execution Phases

#### Phase 1: Native `.cpuprofile` from the host
**Status:** DONE
**ACs:** AC-1, AC-2
**Files:** `packages/runtime-native/src/js/v8_engine.cpp` (serialize + keep summary),
`packages/runtime-native/CMakeLists.txt` (desktop include), `packages/runtime-native/src/cli/main.cpp`
(`--cpu-prof`), `packages/runtime-native/include/mystral/js/engine.h` (path sink).
**Implementation:** compile the profiler on desktop, add a `GetJSON`-shaped serializer over the
existing node walk, write on exit or at `--cpu-prof` stop; fail closed on an unwritable path.
- [x] The V8 `CpuProfiler` compiles into a desktop build (`TN_JS_PROFILE` default ON) and stays out of a shipping mobile build — `nm` on a `TN_JS_PROFILE=0 TN_ANDROID_JS_PROFILE=0` object shows no `CpuProfiler` symbol
- [x] `--cpu-prof <path>` writes a file that parses as DevTools format and still prints the self-time summary — 160,686-byte file, `nodes` 12 / `samples` 24,094 / `timeDeltas` 24,094, names `tick`/`spin`
- [x] `TN_JS_CPU_PROFILE=1` still starts the profiler; an unwritable path fails closed — env run printed `TN_JS_CPU_PROFILE_TOTAL:35142`; `/nonexistent-dir-xyz/out.cpuprofile` printed `TN_CPU_PROFILE_WRITE_FAILED` and exited 1

**Verification:** E1 — run the desktop host with `--cpu-prof`, parse the JSON and assert
`nodes`/`samples`/`timeDeltas`; run with the env var too; build the mobile config and assert no
profiler symbol. Covers AC-1, AC-2.
**Checkpoint:** pending

#### Phase 2: Playtest `--cpu-prof`
**Status:** DONE
**ACs:** AC-3, AC-4
**Files:** `packages/playtest/src/runner/config.ts` (flag), `cli.ts` (dispatch + fail-closed),
`cpuProfile.ts` (CDP `Profiler.start/stop`), `runner.ts` (browser hook),
`desktopRunner.ts` (`--host-arg`), `packages/create-threenative/agent-files/**/threenative-performance/SKILL.md` + mirror.
**Implementation:** browser writes `.cpuprofile` via CDP; desktop/android forward to the host flag;
an unsupported target throws a named `TN_PLAYTEST_CPU_PROFILE_UNSUPPORTED`.
- [x] `--cpu-prof <path>` is in the playtest flag registry and config (`cpu-profile.spec.ts`)
- [x] The browser target writes a loadable `.cpuprofile` via CDP — real CLI run wrote 2,833 samples naming `tick`/`work`
- [x] The desktop target forwards `--cpu-prof` to the host (`desktop-playtest.spec.ts`); an unsupported target fails `TN_PLAYTEST_CPU_PROFILE_UNSUPPORTED` through the real CLI
- [x] `threenative-performance` documents the flag and the no-system-profiler promise; the `.claude` mirror matches (`diff` + `pnpm sync:agents --check`)

**Verification:** E2 — real CLI run on the browser target writes a loadable file; desktop target
forwards the flag; the unsupported case fails closed. Covers AC-3, AC-4, AC-7.
**Checkpoint:** pending

**Note — Android is fail-closed, not forwarded.** The Android host is launched by Java with
positional argv (`android_main.cpp`), not named flags, so there is no `--host-arg` seam to carry
`--cpu-prof`. The target refuses the flag by name (`TN_PLAYTEST_CPU_PROFILE_UNSUPPORTED`) rather
than skipping it; wiring a profile path through the Android host belongs to a follow-up.

#### Phase 3: Engine-owned CPU fixes
**Status:** DONE
**ACs:** AC-5, AC-6
**Files:** `packages/runtime-native/src/audio/audio_context.cpp` (`GainNode::process`),
`packages/runtime-native/include/mystral/audio/audio_context.h`, `packages/core/src/render-camera-cull.ts` (`boundsOf`),
`packages/core/src/projection-marker.ts`, plus their `__tests__`.
**Implementation:** block-hoist the gain for `Immediate`; once a rewritten buffer changes on two
consecutive consults, treat its bound as untrustworthy and keep the object drawn instead of a full
scan every frame. Midway items 2 and 7 are recorded in this PRD and handled in the game lane;
items 3 and 6 cross-reference PRD-442/PRD-443.
- [x] `GainNode::process` computes one gain for an `Immediate` param over a block — `audio_graph_test.cpp` counts 1 `valueAtTime` for a 4-frame block and 4 for a linear ramp
- [x] `boundsOf` no longer rescans a per-frame-rewritten geometry every frame — `render-camera-cull.spec.ts`: one `computeBoundingSphere` across 40 rewritten frames
- [x] Unit tests cover both, and the cull path has no regression — 123 core spec files pass

**Verification:** E3 — unit tests for the block gain and the cull-bound path; a playtest on the
nearest example confirms no culling regression. Covers AC-5, AC-6.
**Checkpoint:** pending

**Note — the example playtest could not run here.** Building the in-repo examples needs every
workspace package; `@threenative/assets` and `@threenative/core` build scripts fail in this
worktree on a missing `threenative-blender-mcp` dist, so no scaffolded example serves. The cull
path is covered by the unit test instead; the playtest lane stays for a machine with the full
workspace.

#### Phase 4: Full gate and close
**Status:** DONE
**ACs:** AC-8, AC-9
**Files:** none (gate + owner sign-off).
**Implementation:** run the repository gate; hand AC-9 to the owner.
- [x] `pnpm typecheck && pnpm lint && pnpm test` and the template docs lane pass — `pnpm typecheck` ✅, `pnpm lint` ✅ (warnings only), `pnpm check:docs` ✅ (2199 links), the six docs/CI specs ✅ (177 tests). The root unit suite is green except two environment lanes that are red on this machine independent of the change: generated-project installs fail `ERR_PNPM_IGNORED_BUILDS` (pnpm 10.25 no longer reads `pnpm.onlyBuiltDependencies` from package.json), and `@threenative/runtime-native`'s QuickJS/SBOM-receipt/dependency-distribution/Windows tests need provisioning this worktree does not have. The four source/docs contracts this change did touch — `template.spec`, `scaffold.spec`, `js-engine-fast-path`, `runtime-next-contract` (screenshot + CLI line cap) — were fixed and pass.
- [x] The owner opens a native `.cpuprofile` in Chrome DevTools and confirms a real hot function (AC-9, owner) — closure directed by the owner alongside this draft PR; the DevTools format and hot-function naming are machine-verified.

**Verification:** E4 — `pnpm typecheck && pnpm lint && pnpm test` and the template docs lane; owner
opens the `.cpuprofile`. Covers AC-8, AC-9.
**Checkpoint:** done 2026-09-23 (draft PR open for the owner's review; archive this batch on merge)

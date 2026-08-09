# PRD-047 — Native runtime absorption

**Status: IN PROGRESS — desktop integration proven; mobile not release-ready.**

**Decision (2026-08-08, reversed by João):** the Mystral runtime is **absorbed into this
repository as one workspace package**, `packages/runtime-native/`. It is no longer an
external pinned artifact and no longer developed in a sibling checkout. ThreeNative owns
the fork.

**What this reverses.** The previous revision of this PRD forbade vendoring Mystral's C++
and required an external checksum-pinned download. That decision is withdrawn. The reasons
it gave were real and do not disappear — a C++ toolchain in a TypeScript monorepo, a
1.39M-line dependency tree, a 15,000-line framework cap — so §2 converts each of them from
a prohibition into a bounded, enforced invariant. **Absorbing the runtime is a Charter §9a
and §10 amendment, and §4 Phase 0 makes it explicitly rather than quietly.**

**Web is out of scope and stays exactly as it is.** The browser target already ships
`three/webgpu` through Vite and needs nothing from this runtime. The absorbed runtime
serves **desktop and mobile only**; the web build path stays exactly as it is today, plain
Vite (the CLI that would wrap it is PRD-048, and does not exist yet). Any change to the
browser path inside this PRD is scope creep — the one
thing web does gain is that `packages/core` stops assuming a DOM (§4 Phase 2), and that is
a refactor with a **no web behaviour change** gate, not a feature.

**Reading order for whoever executes this:** §1 (what is already proven), §2 (what crosses
and the four invariants), §4 Phase 0 (do this first — the budget gate currently rejects the
import), then phases in order. §7 is the cost being accepted.

**Phases 0–3 are closed** (`docs/verification/PRD-047.md`, `docs/verification/PRD-045.md`).
**Phase 4** is native physics, specified in full by PRD-046. **Phase 5** is iOS and the
remaining desktop runners. **Phase 6 was split out into PRD-048** once it became clear it
contained more unbuilt surface than Phases 0–5 combined.

**Depends on:** the runtime evidence ledger, migrating from
`threejs-mystral/docs/status/native-runtime-execution-status.md`.
**Replaces:** PRD-044's React Native host and its `@threenative/native` package decision.
**Keeps:** PRD-045's fail-closed device observer and PRD-046's native-physics requirement,
with transport changed from JSI to a host-neutral native ABI.

---

## 1. Verified starting point — 2026-08-08

| Gate | Evidence | Status |
|---|---|---|
| Upstream `three/webgpu`, V8 + Dawn, Linux/Vulkan | Cube, PBR helmet and JS GLTF/GLB screenshots on an RTX 2080 | **PASS** |
| Unchanged `@threenative/core` bundle on the runtime | One import-free ESM bundle, 300 frames, ready/first-frame markers, screenshot | **PASS (desktop)** |
| Android upstream Three.js cube | QuickJS + wgpu-native, both packaged ABIs, emulator launch/log/liveness/screenshot gate | **PASS (emulator)** |
| Android `@threenative/core` | Catalog Three 0.185.1 import-free bundle completed 300 frames through the bridge on `emulator-5554`; nonblank screenshot recorded | **PASS (emulator)** |
| Android physics | QuickJS has no WebAssembly and the runtime has no native physics ABI | **BLOCKED** |
| iOS | Preset and static-library scaffolding only; no simulator app, launch, log or screenshot | **OPEN** |
| Physical mobile GPU / performance | No physical hardware evidence | **OPEN** |
| Windows / macOS desktop | CI lanes configured, never executed on a real runner | **OPEN** |

This PRD must never be summarized as "mobile works" while any of the last five rows are
open. The current verdict is **conditionally ready for desktop integration only**.

### 1.1 The engine matrix, because it decides §4 Phase 4

| Target | JS engine | WebGPU backend | WebAssembly |
|---|---|---|---|
| Linux / macOS / Windows | V8 | Dawn | **yes** |
| Android | QuickJS | wgpu-native | **no** |
| iOS | JSC | wgpu-native | iOS 18.4+ only, interpreter tier |

`CMakePresets.json:82-84` sets `MYSTRAL_USE_V8=OFF`, `MYSTRAL_USE_QUICKJS=ON` for Android.
Rapier ships as WASM, so **Rapier cannot run on Android under this runtime**. That is the
same wall `CHARTER.md` §7 hit with Hermes, reached by a different road, and it is why
Phase 4 exists rather than "just ship the existing physics package."

---

## 2. What is absorbed, and the four invariants that bound it

### 2.1 Package shape — one package, not ten

`threejs-mystral/docs/PRDs/native-runtime-execution.md:19` proposes ten packages
(`core, renderer-three, runtime-web, runtime-native, physics, assets, audio, input,
devtools, cli`) plus a five-way `native/` split. **That line does not migrate.** Eight of
the ten carry no dependency the others must not inherit, so `AGENTS.md` rule 5 rejects
them; `renderer-three` additionally contradicts `CHARTER.md` §5b, which deleted `render/`
on purpose.

One package passes rule 5 cleanly:

```
packages/runtime-native/        # C++ runtime, CMake, Android/iOS projects, native CLI
```

It carries a C++ toolchain, Dawn, V8, QuickJS, SDL3 and the NDK. Nothing else in the
workspace may inherit those. That is the rule's test, verbatim.

**Package count moves 5 → 6 framework packages.** The runtime passes §11.5 because it
carries toolchain dependencies no TypeScript package may inherit. `pnpm budgets` reports
framework packages and example workspaces separately for visibility.

### 2.2 What crosses, measured

Counted from `git ls-files` in `threejs-mystral` on 2026-08-08.

| Area | Files | Lines | Crosses? |
|---|---:|---:|---|
| `src/` | 65 | 35,674 | **yes** |
| `include/` | 25 | 3,345 | **yes** |
| `CMakeLists.txt` + `cmake/` + `CMakePresets.json` | 4 | ~1,800 | **yes** |
| `scripts/` (incl. `download-deps.mjs`, 814 lines) | 11 | 2,810 | **yes** |
| `tests/` | 10 | 1,773 | **yes** |
| `conformance/` | 13 | 1,395 | **yes** |
| `android/` (1 Java file; rest is manifest, gradle, binaries) | 20 | 21,744 | **partly** — source yes, `.glb`/`.hdr`/`gradle-wrapper.jar`/generated `main.js` no |
| `third_party/` (sdl3 1,991 files, draco, quickjs, v8, dawn, webp, libuv, wgpu) | 2,633 | 1,392,515 | **NO** |
| `examples/` (bundled Three.js and assets) | 112 | 643,641 | **NO** — at most two hand-written `.js` smoke files |
| `docs/` (its own Vite documentation site) | 55 | 44,823 | **NO** |

**2,989 tracked files become roughly 150. About 1.39M excluded lines are already
downloadable** — `scripts/download-deps.mjs` exists and is the supported path for Dawn,
V8, SDL3 and wgpu. Absorption completes that conversion for every remaining vendored tree
rather than importing it.

Also excluded: `build/`, `.runtime/`, `artifacts/`, `test-results/`, `.test-output/`,
`node_modules/`, `tasks/`, `docs/` site, and `bun.lock` (this workspace is pnpm).

### 2.3 The four invariants

Each is the honest form of a prohibition the previous revision made absolutely.

1. **No vendored dependency tree.** `packages/runtime-native/third_party/` is gitignored
   and populated only by `download-deps.mjs`. The budget gate fails if any file under it
   is tracked. This is the invariant that keeps 1.39M lines out.
2. **A bounded native LOC review trigger.** Native source is excluded from the 15,000-line
   framework trigger and gets its own: **`nativeRuntimeLoc: 50,000`**, measured over
   `packages/runtime-native` excluding `third_party/`. Crossing it requires a PRD
   justification and a kill-switch pass; it is not a CI outage or permission to hide lines.
3. **The C++ toolchain never enters the default gate.** `pnpm typecheck && pnpm lint &&
   pnpm test` must stay green on a machine with no CMake, no NDK and no Xcode. The native
   build is a separate opt-in lane.
4. **The runtime stays a host, never a renderer.** No custom C++ renderer, no deep Three.js
   fork, no native GLTF replacing JS `GLTFLoader`. This is
   `native-runtime-execution.md:27` retained verbatim, and it is also `AGENTS.md` rule 3.

### 2.4 Attribution

Upstream is `github.com/mystralengine/mystralnative`, MIT, baseline
`841fe379ca1ab23c87c99fac3b901e37487ce8f2` (v0.1.5). Import as one commit that records
that SHA, preserves `LICENSE`, and adds a `NOTICE` naming the upstream project. Do not
import upstream history: the working fork already rewrote it, and the baseline SHA is the
provenance that matters.

---

## 3. What migrates from the runtime's own PRD

`native-runtime-execution.md` is 27 lines carrying a 17-milestone program. Lines 11, 13,
15 and 27 — product contract, official targets, ordering, non-goals — migrate verbatim
into `packages/runtime-native/AGENTS.md`. Line 19 is deleted per §2.1. Line 23's M0–M16
ledger becomes five gate files under `packages/runtime-native/docs/`, grouped by what a
single evidence run proves rather than by milestone number:

| Gate | Milestones | State on arrival |
|---|---|---|
| G1 desktop host | M0, M1, M2, M4 | Linux PASS; Windows/macOS never executed |
| G2 conformance | M3 | harness done, **1 pass / 48 planned** |
| G3 mobile bring-up | M5, M6 | Android emulator cube PASS; iOS zero evidence |
| G4 threading and native systems | M7–M11 | not started |
| G5 profiling | M15, M16 | not started |

M12–M14 (core seams, CLI, starters) do not become gate files — they are §4 Phases 2, 3 and
the template work below.

Those five files live inside the package, not in `docs/PRDs/`. `docs/PRDs/native/` holds
ThreeNative's decisions about the runtime; the runtime's own execution ledger belongs with
the runtime.

---

## 4. Phases

### Phase 0 — authority and instrument alignment

The instrument currently forbids exactly what this PRD does. `scripts/check-budgets.ts`
has a `vendoredNativeRuntime()` walker that fails on `include/mystral`,
`src/js/quickjs_engine.cpp`, or a `CMakeLists.txt` beside `src/runtime.cpp` and
`third_party/`. Importing the runtime turns `pnpm budgets` red on the first commit.

1. Invert the guard: a native runtime tree is **allowed at exactly
   `packages/runtime-native/`** and still fails anywhere else in the workspace.
2. Add the tracked-`third_party` failure (§2.3 invariant 1).
3. Exempt `runtime-native` from `frameworkLoc`; add `nativeRuntimeLoc: 50_000`.
4. Amend `CHARTER.md` §7 (React Native → owned native runtime), §9a (the package list),
   and §10 (the new native cap). Amend `docs/architecture/NATIVE-RUNTIME.md`, whose entire
   premise is `react-native-webgpu`.
5. Mark PRD-044 superseded.
6. Add Biome ignores for the package's JS and a `tsconfig` exclusion for its scripts.

**Gate:** budget fixtures prove that a runtime tree at `packages/runtime-native` passes,
the same tree at `packages/anything-else` fails, a tracked `third_party` file fails, nine
framework packages fail, and native LOC above 50,000 fails. Every fixture is asserted in
both directions.

### Phase 1 — the import

1. Copy the §2.2 "crosses" set into `packages/runtime-native/`; add `LICENSE`, `NOTICE`
   and an `AGENTS.md` carrying §3's migrated contract lines.
2. Gitignore `third_party/`, `build/`, `.runtime/`, `artifacts/`; verify
   `download-deps.mjs` reconstructs every excluded tree from a clean checkout.
3. Convert `bun test` to the workspace runner so `tests/` runs under `pnpm test` on a
   machine with no C++ toolchain. Tests that need a built binary skip **loudly**, with a
   named reason — a silent skip is the `AGENTS.md` verification failure.
4. Add a `native:build` lane, opt-in and outside the default gate.

**Gate:** on a clean checkout with no CMake, no NDK and no Xcode, `pnpm install
--frozen-lockfile && pnpm typecheck && pnpm lint && pnpm test && pnpm budgets` is green.
Separately, on this Linux host, `native:build` reproduces the RTX 2080 cube screenshot from
in-repo source.

### Phase 2 — framework render absorption

1. `packages/core` stays host-neutral: no runtime imports, no host branches. The five DOM
   seams (`renderer.ts`, `viewport.ts`, `input.ts`, `audio.ts`, `game.ts`) take injected
   platform sources — this is PRD-044 §1.1's measured work, which survives its host change.
2. Build one import-free ESM bundle from unchanged public `@threenative/core` APIs.
   `examples/native-smoke/scripts/verify-bundle.mjs` already enforces that shape.
3. Run it for at least 300 frames on desktop and on the Android emulator.

**Gate:** exact ready and first-frame markers, live process, clean WebGPU and JS logs,
dated screenshot. **Android must run the catalog Three.js version**, not the older 0.182.0
proof — the version gap in §1 is closed here or the row stays OPEN.

### Phase 3 — lifecycle and device proof

Extend PRD-045's transport to the absorbed runtime. One playtest scenario runs unchanged in
Chromium and on Android. A missing bridge, a misspelled assertion and a deliberately wrong
value must each fail on the emulator. Network assertions are reported explicitly
unsupported, never silently skipped.

### Phase 4 — native physics

QuickJS WebAssembly is not a supported path (§1.1). Compile Rapier into the runtime and
expose a host-neutral, coarse ABI under `globalThis.__THREENATIVE_NATIVE__.physics`:

```ts
simulation.step(deltaTime, inputSnapshot);
simulation.readVisibleTransforms(renderBuffer);
```

The TypeScript contract lives in the existing `@threenative/physics` package, selected by a
build condition — **no new workspace package**. No native type or per-object hot-path
setter appears in its public API; the boundary fills preallocated typed arrays in bulk.

Today `@threenative/physics` exposes concrete `RAPIER.World`, `RigidBody` and `Collider`
objects. That cannot stay the cross-platform contract without rebuilding Rapier as a large
per-object proxy. Godot-shaped public nodes stay stable; `world`, `body` and `collider`
become backend-neutral handles with an explicitly backend-specific `raw` escape hatch. Web
keeps real Rapier objects behind `raw`; native exposes opaque handles.

First proof is deliberately narrow: fixed floor at `y=-0.5`, dynamic unit cube at `y=3`,
180 steps at `1/60`, one preallocated transform buffer, `abs(cubeY - 0.5) <= 0.02`.

**Gate:** the same fail-closed device scenario asserts resting position, collision event and
collision-layer masking, and each assertion is also shown failing when deliberately broken.
Wrong gravity and a wrong expected resting height must both fail. Emulator x86_64 execution
and arm64 compile proof are separate evidence rows. Rapier version and architecture
divergence between web and native is measured, not hidden.

**Rapier is not the only WASM dependency.** The platformer template imports
`recast-navigation`. Native Rapier does not make that starter mobile-ready; native
navigation or a mobile-safe template path is a separate open gate.

### Phase 5 — iOS, remaining desktop, and release evidence

1. Build a root-linked iOS simulator app from the exact shared Three.js proof; install,
   launch, inspect unified logs, capture a nonblank screenshot through `simctl`.
2. Execute the Windows and macOS desktop lanes on real runners.
3. Simulator and emulator proof close plumbing only. Physical Metal/Vulkan driver
   behaviour, arm64 physics and phone frame rate stay OPEN until hardware exists.

### Phase 6 — CLI and distribution — **SPLIT OUT into PRD-048**

This phase turned out to contain more unbuilt surface than the five phases before it
combined, and it now lives in `PRD-048-native-distribution.md`.

**Two claims the earlier text made here were factually wrong**, and are corrected in PRD-048
§1 rather than left in place:

1. *"Distribution does not add commands; it adds a target to one."* **There is no command to
   add a target to.** The workspace ships `create-threenative` and `threenative-playtest`,
   and templates invoke `vite` directly. `CHARTER.md` §6a's four commands are an unbuilt
   intention.
2. *"the runtime packager (`scripts/package-{macos,windows,linux}.mjs` … imported in
   Phase 1)."* **Those files do not exist.** Phase 1 imported `scripts/package-app.sh` —
   macOS only, Mystral-branded, and dead.

What stays true and stays here: Phase 2's `scripts/bundle.mjs` produces the single
import-free ESM file that every native target consumes. PRD-048 is the delivery path around
that artifact, and it depends on **this** PRD's Phase 2 and Phase 5.

**PRD-047 does not move to `done/` on account of the split.** Phases 4 and 5 — native
physics and iOS/remaining-desktop evidence — are still open here.

---

## 5. Acceptance criteria

1. `pnpm typecheck && pnpm lint && pnpm test && pnpm budgets` is green on a machine with no
   CMake, NDK or Xcode.
2. `pnpm budgets` reports 6 framework packages and both LOC review-trigger measurements;
   any crossing is justified in this PRD and survives a kill-switch pass.
3. No file under `packages/runtime-native/third_party/` is tracked, and `download-deps.mjs`
   reconstructs every excluded tree from a clean checkout.
4. Runtime and framework agree on the exact catalog Three.js version, on every platform
   that claims a pass.
5. The unchanged core smoke runs 300+ frames on desktop and Android with clean logs.
6. PRD-045's three negative controls pass on Android before native physics is claimed.
7. Native physics passes its Android scenario without WebAssembly, and the deliberately
   broken variants fail.
8. iOS simulator build/launch/screenshot evidence exists; physical-driver and performance
   debt stays explicitly open until measured.
9. Conformance moves off 1/49. A pass count is reported as a fraction, never as "the
   harness passes."

**Moved to PRD-048:** the former criterion 9 — *"any scaffold claimed mobile-ready contains
neither Rapier WASM nor Recast WASM in its native bundle"* — is a distribution property and
is now PRD-048 §4 Phase 5. It is not dropped, and PRD-047 cannot be closed as "mobile ships"
on its own; it can only be closed as "the runtime runs our code."

---

## 6. Kill conditions

- The default gate cannot stay green without a C++ toolchain.
- `third_party/` has to be tracked to make a build reproducible.
- Native source exceeds 50,000 lines, or `core` needs a runtime-specific branch.
- The runtime requires a custom renderer, a Three.js fork, or a native GLTF path to hit its
  targets.
- The native physics boundary requires per-object calls in the frame hot path.
- Device playtest cannot demonstrate its three required failures.
- Mobile claims depend on QuickJS WebAssembly, or omit the iOS and physical-hardware debt.

---

## 7. Known risk this PRD accepts rather than solves

The absorbed runtime is a live fork with 19 uncommitted files, including
`src/js/quickjs_engine.cpp`, `src/runtime.cpp` and `src/platform/android_main.cpp`.
Absorption means ThreeNative maintains a C++ runtime — Dawn and V8 bumps, three
platform toolchains, and any upstream security fix, applied by hand. Nothing in this PRD
reduces that cost; §2.3's invariants only stop it from spreading into the TypeScript
framework. **This is a staffing decision, taken knowingly on 2026-08-08.**

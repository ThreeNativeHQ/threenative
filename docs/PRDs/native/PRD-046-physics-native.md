# PRD-046 — native physics

**Status: IN PROGRESS — implementation contract repaired; final archive awaits PRD-048's
clean consumer gate.** Phases 0–3 and 5 are complete; Phase 3 passed on current SHA `e38439c`
in GitHub run `31313092745`. The local artifact/install contract is complete; published
consumer distribution remains open and owned by PRD-048. Physical arm64 execution and
performance remain explicitly open. Retargeted by PRD-047 — transport and packaging revised,
correctness gates unchanged.** Three things in the original design are now historical and are marked
inline where they appear: the **JSI transport**, the separate **`@threenative/physics-native`
package**, and the **concrete-Rapier-object escape hatch**. The active design compiles Rapier
into the absorbed `packages/runtime-native` runtime and selects a host-neutral adapter from
the existing `@threenative/physics` package by build condition. **No new workspace package.**

**This PRD is the executable spec for what PRD-047 §4 Phase 4 summarizes.** Where the two
disagree, PRD-047 wins and this file is wrong — say so rather than following it.

**Scaffolding is tracked and locally proven (2026-08-08):**
`packages/runtime-native/native/physics/` (Rust `staticlib`, `rapier3d =0.30.0`),
`packages/runtime-native/src/physics/native_bindings.cpp`, and two headers are tracked. The
Rust unit controls pass, both Android ABIs cross-compile, the C++ binding is runtime-wired,
and the normal `@threenative/physics` export selects the native adapter through the
`threenative-native` condition. Android emulator evidence and Phase 0 measurements
are in `docs/verification/PRD-046.md`.

**Execution gate is now open on the Android side.** PRD-045's negative controls passed on
`emulator-5554` (`docs/verification/PRD-045.md`), which was the hard prerequisite in §0.
PRD-047's Android runtime rows are also green. Hosted iOS simulator execution passed again on
current SHA `e38439c` after the device-scenario tick-batching change, so Phase 3 is closed.

**Complexity: 11 → HIGH mode, top of the scale.** (new language/toolchain — Rust
cross-compilation +2, host-neutral native ABI +2, binary distribution +2, numerical
correctness with invisible failure modes +2, two platforms +2, cross-platform contract change
in an existing public package +1. The original 12 included a new package; that is gone.)
HIGH means an automated checkpoint after every phase and a manual checkpoint on every phase
with simulation behaviour.

**Depends on:** PRD-047 Phase 3, PRD-045 Phase 3 (the negative controls, specifically),
PRD-036 (the determinism measurement this must not oversell), PRD-040 (collision layers —
the API surface being mirrored).
**Blocks:** nothing. This is the end of the native sequence.
**Charter authority:** `CHARTER.md` §7. The charter's original wording — *"A JSI native
binding to Rapier's Rust, shipped as `@threenative/physics-native`"* — was amended by
PRD-047 Phase 0; the sentence that survives it is *"not a fallback — the only path… the
single most valuable artifact in the repo and the strongest reason ThreeNative exists at
all."* Also §9a (no new package is taken) and §10 (native LOC counts against
`nativeRuntimeLoc: 50,000`, not `frameworkLoc`).
**Area:** `OPPORTUNITY-AREAS.md` #7, and the only part of it with a 30/30 gap.

---

## 0. Why this is last, and why it must not move earlier

It is the most valuable artifact and the most dangerous one to ship unproven. Its failure
mode is not a crash — it is a *subtly wrong simulation*: a mismatched timestep, drift after
a thousand steps, tunnelling at speed, a transform buffer read one frame stale. None of
that is visible to a screenshot, a frame counter, or a human glancing at a phone.

PRD-044 §4 took a time-boxed exception to the playtest rule because rendering failures
*are* visible, and PRD-047 Phase 2 inherits it for the screenshot-gated render proof. That
exception does not extend here. **If PRD-045 has not produced its three
negative controls on device, this PRD does not start** — building it would mean asserting
correctness of an invisible system with no instrument, which is the exact shape
`AGENTS.md` opens by naming.

| Roadmap axis | Expected movement | Why |
|---|---|---|
| Ships working | **0 on the pair** | Sweeps are browser-only |
| Does what vanilla can't | **+4–6** | Nobody ships a native Rapier binding behind a Three.js API. This is the genuine 0→1 |
| Survives the platform | **+4–6** | Completes §7's promise: physics on device, not just pixels |

---

## 1. Context

**Problem:** Rapier ships as WebAssembly and WASM is not viable on the mobile JS engines —
under React Native before PRD-047, and under the absorbed runtime after it. **The host
changed and the wall did not move.**

| Engine | Host | WASM | Evidence |
|---|---|---|---|
| QuickJS | **absorbed runtime, Android** | **No** | `CMakePresets.json:82-84` sets `MYSTRAL_USE_QUICKJS=ON`; QuickJS has no WASM |
| JSC | absorbed runtime, iOS | iOS 18.4+ only, interpreter tier | WebKit `b01e7b6920`, IPInt interpreter |
| V8 | absorbed runtime, desktop | Yes | Desktop is not the problem; it can keep WASM Rapier |
| Hermes | React Native (superseded) | **No, and never** | `facebook/hermes#429`, maintainer 2023-10-04 |
| JSC Android | React Native (superseded) | **No, deliberately** | `jsc-android-buildscripts` compiles `--no-webassembly` |

Best case is *"maybe on iOS 18.4+, definitely not on Android, at interpreter speed."* Not a
foundation. v1 already compiled Rapier natively (web `0.19.3`, native `0.33`) — the trick is
proven, minus Bevy.

**Desktop is a third case and this PRD must decide it, not inherit it.** V8 has WASM, so the
desktop lane could keep the existing WASM Rapier and diverge from mobile, or run the native
build and match mobile. Phase 1 picks one and records why; an unstated choice means two
untested physics backends shipping under one API.

### Files analyzed

`packages/physics/src/**` (the API surface being mirrored), `packages/core/src/loop.ts`
(the fixed step this drives), `docs/architecture/NATIVE-RUNTIME.md` ("Both boundaries must
be coarse"), `docs/PRDs/done/PRD-036-save-load-and-deterministic-replay.md` §1.4 and its Phase 0
measurement, `docs/PRDs/done/PRD-040-physics-collision-layers.md`,
`scripts/check-budgets.ts`.

### 1.1 The determinism claim this must not inflate

PRD-036 measured Rapier `0.19.3` producing identical 9,757-byte snapshots across runs and
workers — **same machine, same runtime**. It explicitly does not support cross-browser,
cross-OS or cross-version portability, which is why its ceiling score stayed at 18/25.

A native binding is a *different Rapier version on a different architecture*. **Replay
recorded on web will not reproduce on device, and this PRD must say so in the docs it
ships.** Anything else silently converts PRD-036's honest, bounded claim into a false one.

---

## 2. Solution

A Rust static library wrapping Rapier, compiled into the absorbed runtime and exposed as a
host-neutral ABI under `globalThis.__THREENATIVE_NATIVE__.physics`, with a **bulk-transfer
API and no per-object crossing**. `NATIVE-RUNTIME.md` already specifies the shape:

```ts
simulation.step(deltaTime, inputSnapshot);
simulation.readVisibleTransforms(renderBuffer);
```

Never:

```ts
for (const entity of entities) nativePhysics.setPosition(entity.id, entity.position);
```

*"Otherwise the JS↔native crossing becomes the next bottleneck, and the binding that was
supposed to buy performance spends it back per call."*

### 2.1 The design rule that makes this host-agnostic

**This rule is why PRD-047 cost this PRD a transport and not a rewrite.** The bulk API was
written so the host could be swapped, and then the host was swapped: React Native and JSI
became the absorbed runtime and a C ABI, and §2's two method signatures did not change.

**No host type appears in the API surface** — the transport is not the contract. Phase 1
lands the API on *web*, backed by the existing WASM build, before any native code exists.
If the API cannot be served by WASM on web, it is a transport-shaped API and it is wrong.

### 2.2 The cross-platform contract change, which is the real cost

Today `@threenative/physics` exposes concrete `RAPIER.World`, `RigidBody` and `Collider`
objects. **That cannot stay the cross-platform contract**, and the original plan to keep
concrete Rapier objects on both arms is withdrawn — matching it natively would mean
rebuilding Rapier as a large per-object proxy, which §2 forbids on the hot path.

Per PRD-047 §4 Phase 4: the Godot-shaped public nodes (`RigidBody3D`, `Area3D`,
`CharacterBody3D`, `CollisionShape3D`) stay stable, while `world`, `body` and `collider`
become backend-neutral handles with an explicitly backend-specific `raw` escape hatch. Web
keeps real Rapier objects behind `raw`; native exposes opaque handles. **`raw` is
backend-specific by contract** — code that reaches through it is not portable, and the docs
must say that at the property, not only in a PRD.

Backend selection is a build condition on the existing package. There is no
`@threenative/physics-native`.

**Implementation decision (2026-08-08): choose (a) at the simulation seam.** The shared
nodes call `PhysicsSimulation.configureCharacter()` and both adapters carry controller
configuration, character state, and bulk transforms through the seam. The native ABI supports
the controller options and primitive shapes currently exposed by the shared classes; shapes
outside that ABI throw during construction. This keeps the node source unified without
silently dropping behavior.

### 2.3 Explicitly rejected

- **A different physics API for device.** `@threenative/physics`'s Godot-shaped surface
  (`RigidBody3D`, `Area3D`, `CollisionShape3D`, `moveAndSlide`) is what the model already
  knows. A second vocabulary violates `AGENTS.md` rule 4 and is what killed v1.
- **Users installing a Rust toolchain.** Prebuilt binaries or this does not ship.
- **Per-object setters**, in any form, "just for convenience." One escape hatch becomes the
  hot path.
- **Physics on a worklet/second thread** in v1 of this package. Correctness first; threading
  is a separate PRD if profiling asks for it.

---

## 3. Phases

### Phase 0 (proving phase) — does Rapier's Rust reproduce itself off the web?

**Complete 2026-08-08.** Both snapshots were 9,757 bytes; 62 bytes differed; all five final
positions were bit-identical. Both Android target libraries cross-compiled. Exact commands,
toolchain versions and scope limits are recorded in `docs/verification/PRD-046.md`.

Before any binding: cross-compile Rapier to Android `arm64-v8a` and `x86_64`, run PRD-036's
exact Phase 0 methodology — five-box stack on a floor, 300 fixed ticks, `takeSnapshot()`
byte comparison — and compare against the web `0.19.3` result already on record.

**Expected outcome is divergence**, because the versions differ. That is fine. The purpose
is to *measure and document* the divergence so §1.1's claim is quantified rather than
asserted. **A phase that cannot state the delta in bytes and in final positions has failed.**

### Phase 1 — the bulk API, on web, backed by WASM — **COMPLETE 2026-08-08**

`step(dt, input)` / `readVisibleTransforms(buffer)` land in `@threenative/physics`, served
by the existing WASM build, with the existing browser playtests proving them. The web
adapter and plugin path now exist: kinematic input is eight-float bulk records, visible
transforms are read into a reusable buffer using logical body IDs, and the public context
exposes `simulation`; backend-specific Rapier handles stay behind the web adapter.
The four-test browser suite, including the 30-second direct replay lane, is green; all three
packed templates also pass their 25 committed scenarios through the current package builds.
**Gate:** the four sealed genre proofs and the platformer physics consumer scenario pass
through the new API path. Zero web regression.

### Phase 2 — Android native binding — **COMPLETE 2026-08-08 (x86_64 emulator)**

The Rust static library, the general body/shape C ABI, the
`globalThis.__THREENATIVE_NATIVE__.physics` surface, and normal-entry backend selection in
`@threenative/physics`. `RigidBody3D`, `Area3D`, `CharacterBody3D`, collision shapes,
bulk kinematic input, visible transforms, events, groups and masks use the native host; the
Android bundle contains neither Rapier WASM nor a `WebAssembly` marker.

The device acceptance subject remains deliberately narrow: fixed floor at `y=-0.5`, dynamic
unit cube at `y=3`, 180 steps at `1/60`, one preallocated transform buffer,
`abs(cubeY - 0.5) <= 0.02`. It is created through the normal public API, not a proof-only
package subpath.

**Gate:** that cube drops onto that plane on the Android emulator and the resulting resting
position is asserted by a PRD-045 device scenario — not by a screenshot. Wrong gravity and a
wrong expected resting height must each be shown failing.

**Emulator caveat, stated plainly in the result:** the emulator runs `x86_64`. A pass proves
the ABI plumbing and the simulation logic. It proves **nothing** about `arm64` codegen or
about performance; `arm64` gets a separate compile-proof evidence row. Both stay open until
hardware exists, and the docs must not claim otherwise.

**Rapier version divergence is measured here, not hidden.** Web is `0.19.3`; the native
scaffolding pins `rapier3d =0.30.0`. That delta is §1.1's whole subject and Phase 0 has to
quantify it before this phase can interpret its own numbers.

### Phase 3 — iOS native binding — **PASS**

Same, via `xcrun simctl`. The root-linked app, simulator verifier and device transport passed
on the hosted Apple runner in run `31313092745` at `e38439c`, including normal/masked
physics and three deliberate failures. The same run exercised a packed consumer with CMake,
Xcodebuild and Rust masked from its PATH.

### Phase 4 — binary distribution — **ARTIFACT CONTRACT COMPLETE; CONSUMER PROOF OPEN**

Prebuilt static-library artifacts for each target ABI, carried by the runtime's own release
lane (PRD-047 Phase 6), not by a separate package. **Gate:** a scaffolded project on a clean
machine with no Rust toolchain installs and runs.

### Phase 5 — template, charter, gates — **COMPLETE 2026-08-08**

Starter wiring, `ROADMAP.md` Phase 3 result, and the §1.1 portability caveat written into the
published docs. **`CHARTER.md` §9a needs no package-table edit** — PRD-047 Phase 0 already
amended it and this PRD adds no package.

**The WASM problem is larger than Rapier.** The platformer template also imports
`recast-navigation`, which is WASM and therefore equally dead on QuickJS. Native physics does
not make that starter mobile-ready. Native navigation, or a mobile-safe template path, is a
separate open gate — and any scaffold this phase calls mobile-ready must contain neither
Rapier WASM nor Recast WASM in its native bundle.

---

## 4. Verification strategy

**The web arm is again the primary negative control.** Phase 1 routes existing, proven
physics through a new API. Any change in a sealed proof result means the API is wrong.

**Device proof is a PRD-045 scenario, never a screenshot.** Minimum assertions: a body's
resting position after N steps within tolerance; a collision event fires; a collision-layer
mask (PRD-040) excludes what it should. Each must be shown to **fail** when deliberately
broken, on device, before it counts as passing.

**Cross-target divergence is data, not a bug to hide.** Record web-vs-device final
positions for the same scene at every phase. A growing delta is the signal that a timestep
or an integration setting is mismatched.

---

## 5. Acceptance criteria — consumer-scoped

1. Phase 0's divergence is quantified in bytes and final positions, dated in
   `docs/verification/`.
2. A scaffolded project runs physics on the Android emulator, proven by a PRD-045 scenario
   that has been shown to fail when broken.
3. The same on the iOS simulator.
4. No Rust toolchain required to consume the package, verified on a clean machine.
5. Web arm unchanged: four sealed proofs, `pnpm test:browser`, `pnpm visuals` green with no
   baseline edited.
6. Published docs state the cross-platform replay limitation explicitly (§1.1), and the
   Rapier version delta between arms is stated as a number.
7. `pnpm budgets` green with **no new package and no hard invariant violated**. Native LOC
   stays visible against its 50,000-line review trigger, and nothing under
   `packages/runtime-native/third_party/` is tracked.
8. `arm64` and performance are recorded as **open**, not as passed.
9. No native type and no per-object hot-path setter appears in `@threenative/physics`'s
   public API; `raw` is documented as backend-specific at the property itself.
10. Any scaffold claimed mobile-ready contains neither Rapier WASM nor Recast WASM in its
    native bundle.

---

## 6. Kill conditions

### Native LOC trigger review — 2026-08-08

`pnpm budgets` reports **51,756 native lines**, 1,756 above the 50,000 review trigger. This is
not silenced or treated as a hard-gate failure. The increase is the smallest ABI completion
needed by the shared node correction: native character configuration/state records, body
transform transport, their C++/Rust validation, and the Apple-target builder plus iOS
physics-control wiring needed to make Phase 3 executable on a macOS runner. Integrated
runtime/distribution evidence added by PRD-047 and PRD-048 is also counted in the same native
total. It adds no package and tracks no `third_party/` source.

Kill-switch pass completed with the same change:

```text
pnpm --filter @threenative/runtime-native test       PASS — 16 files, 55 passed, 30 skipped
pnpm --filter @threenative/runtime-native native:physics:cross PASS — arm64 + x86_64
pnpm exec vitest run packages/physics/__tests__     PASS — 12 files, 65 tests
```

The conformance test reaches the shared adapter methods, the native runtime test suite
exercises the host bindings, and the native bundle contains no web/Rapier import. If the
next native change cannot justify its lines with the same evidence, the added surface is
deleted rather than routed around this trigger.

- The per-frame crossing cost exceeds WASM-on-web's for an equivalent scene → the binding
  spent back what it bought. Stop and re-read `NATIVE-RUNTIME.md`'s boundary rule.
- Distribution requires users to build from source → does not ship.
- PRD-045's negative controls are not green on device → this PRD does not start. See §0.
  *(Met on Android 2026-08-08 and iOS simulator 2026-08-09.)*
- The API needs a per-object setter to be usable → the design is wrong, not the rule.
- The backend-neutral handle rewrite (§2.2) breaks a sealed web proof → the contract change
  is wrong; do not edit the baseline to absorb it.
- Native physics crosses the 50,000-line review trigger without surviving a documented
  kill-switch pass, or needs a tracked `third_party/` tree → PRD-047's invariants win, not
  this PRD's scope.

## 7. Implementation checkpoint — 2026-08-09

The final public sensor contract repair is included in the closing change. Both the web and
native adapters now require `PhysicsBodyCreateOptions.sensor` to match
`CollisionShape3D.descriptor.sensor`, including explicit `false`; conflicting inputs throw
`TN_PHYSICS_SENSOR_CONFLICT` before a body is registered. The opaque native `raw` shape
contract remains unchanged.

Focused evidence: `pnpm exec vitest run packages/physics/__tests__` passed all physics tests;
`pnpm lint` passed. The root typecheck reaches every package after the required package builds;
the relevant `@threenative/physics` typecheck passes. The package `publint` substep and the
clean-machine consumer gate are owned by PRD-048. `pnpm budgets` passes through the direct
Node loader and retains the existing native LOC review trigger without a hard-invariant
violation. This record is an implementation checkpoint, not the final archive decision.

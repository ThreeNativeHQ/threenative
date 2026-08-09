# PRD-046 — `@threenative/physics-native`

**Status: NOT STARTED — GATED on PRD-044 (the app runs on device) and PRD-045 (the app can
be *proven* on device).** Both gates are hard. §0 says why the second one is not
negotiable.

**Complexity: 12 → HIGH mode, top of the scale.** (new package +2, new language/toolchain —
Rust cross-compilation +2, external ABI — JSI +2, binary distribution +2, numerical
correctness with invisible failure modes +2, two platforms +2.) HIGH means an automated
checkpoint after every phase and a manual checkpoint on every phase with simulation
behaviour.

**Depends on:** PRD-044 Phase 3, PRD-045 Phase 3 (the negative controls, specifically),
PRD-036 (the determinism measurement this must not oversell), PRD-040 (collision layers —
the API surface being mirrored).
**Blocks:** nothing. This is the end of the native sequence.
**Charter authority:** `CHARTER.md` §7 — *"A JSI native binding to Rapier's Rust, shipped
as `@threenative/physics-native`. Not a fallback — the only path… the single most valuable
artifact in the repo and the strongest reason ThreeNative exists at all."* Also §9a (the
package slot), §10 (budgets — **consumes the second slot freed by PRD-044 Phase 0**).
**Area:** `OPPORTUNITY-AREAS.md` #7, and the only part of it with a 30/30 gap.

---

## 0. Why this is last, and why it must not move earlier

It is the most valuable artifact and the most dangerous one to ship unproven. Its failure
mode is not a crash — it is a *subtly wrong simulation*: a mismatched timestep, drift after
a thousand steps, tunnelling at speed, a transform buffer read one frame stale. None of
that is visible to a screenshot, a frame counter, or a human glancing at a phone.

PRD-044 §4 takes a time-boxed exception to the playtest rule because rendering failures
*are* visible. That exception does not extend here. **If PRD-045 has not produced its three
negative controls on device, this PRD does not start** — building it would mean asserting
correctness of an invisible system with no instrument, which is the exact shape
`AGENTS.md` opens by naming.

| Roadmap axis | Expected movement | Why |
|---|---|---|
| Ships working | **0 on the pair** | Sweeps are browser-only |
| Does what vanilla can't | **+4–6** | Nobody ships a JSI Rapier binding. This is the genuine 0→1 |
| Survives the platform | **+4–6** | Completes §7's promise: physics on device, not just pixels |

---

## 1. Context

**Problem:** Rapier ships as WebAssembly and WASM is not viable across React Native's JS
engines. This is researched and settled (`CHARTER.md` §7, `NATIVE-RUNTIME.md`):

| Engine | WASM | Evidence |
|---|---|---|
| Hermes (RN default) | **No, and never** | `facebook/hermes#429`, maintainer 2023-10-04 |
| JSC iOS 18.4+ | Yes, unverified in RN | WebKit `b01e7b6920`, IPInt interpreter |
| JSC Android | **No, deliberately** | `jsc-android-buildscripts` compiles `--no-webassembly` |

Best case is *"maybe on iOS 18.4+, definitely not on Android, at interpreter speed."* Not a
foundation. v1 already compiled Rapier natively (web `0.19.3`, native `0.33`) — the trick is
proven, minus Bevy.

### Files analyzed

`packages/physics/src/**` (the API surface being mirrored), `packages/core/src/loop.ts`
(the fixed step this drives), `docs/architecture/NATIVE-RUNTIME.md` ("Both boundaries must
be coarse"), `docs/PRDs/PRD-036-save-load-and-deterministic-replay.md` §1.4 and its Phase 0
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

A Rust `cdylib` wrapping Rapier, exposed through JSI, with a **bulk-transfer API and no
per-object crossing**. `NATIVE-RUNTIME.md` already specifies the shape:

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

The bulk API is the same reason a future own-host path (`NATIVE-RUNTIME.md`, and the L2
option) costs a shell swap rather than a rewrite. **No `react-native` or JSI type appears
in the API surface** — JSI is the transport, not the contract. Phase 1 lands the API on
*web*, backed by the existing WASM build, before any native code exists. If the API cannot
be served by WASM on web, it is a JSI-shaped API and it is wrong.

### 2.2 Explicitly rejected

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

Before any binding: cross-compile Rapier to Android `arm64-v8a` and `x86_64`, run PRD-036's
exact Phase 0 methodology — five-box stack on a floor, 300 fixed ticks, `takeSnapshot()`
byte comparison — and compare against the web `0.19.3` result already on record.

**Expected outcome is divergence**, because the versions differ. That is fine. The purpose
is to *measure and document* the divergence so §1.1's claim is quantified rather than
asserted. **A phase that cannot state the delta in bytes and in final positions has failed.**

### Phase 1 — the bulk API, on web, backed by WASM

`step(dt, input)` / `readVisibleTransforms(buffer)` land in `@threenative/physics`, served
by the existing WASM build, with the existing browser playtests proving them.
**Gate:** the four sealed genre proofs and the platformer physics consumer scenario pass
through the new API path. Zero web regression.

### Phase 2 — Android JSI binding

The `cdylib`, the JSI glue, the package. **Gate:** a cube drops onto a plane on the Android
emulator and the resulting trajectory is asserted by a PRD-045 device scenario — not by a
screenshot.

**Emulator caveat, stated plainly in the result:** the emulator runs `x86_64`. A pass proves
the JSI plumbing, the ABI and the simulation logic. It proves **nothing** about `arm64`
codegen or about performance. Both stay open until hardware exists, and the docs must not
claim otherwise.

### Phase 3 — iOS JSI binding

Same, via `xcrun simctl`. Same caveat, same honesty.

### Phase 4 — binary distribution

Prebuilt `.so`/`.xcframework` artifacts on the release lane. **Gate:** a scaffolded project
on a clean machine with no Rust toolchain installs and runs.

### Phase 5 — template, charter, gates

Starter wiring, `CHARTER.md` §9a package table, `ROADMAP.md` Phase 3 result, and the §1.1
portability caveat written into the published docs.

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
6. Published docs state the cross-platform replay limitation explicitly (§1.1).
7. `pnpm budgets` green using the slot freed by PRD-044 Phase 0 — **no cap raised**.
8. `arm64` and performance are recorded as **open**, not as passed.

---

## 6. Kill conditions

- The per-frame crossing cost exceeds WASM-on-web's for an equivalent scene → the binding
  spent back what it bought. Stop and re-read `NATIVE-RUNTIME.md`'s boundary rule.
- Distribution requires users to build from source → does not ship.
- PRD-045's negative controls are not green on device → this PRD does not start. See §0.
- The API needs a per-object setter to be usable → the design is wrong, not the rule.

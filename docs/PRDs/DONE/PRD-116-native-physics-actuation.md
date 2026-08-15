# PRD-116 — A native build can move a dynamic body

**Status: DELIVERED — 2026-08-15, on the second repair lane.** The `r2` lane stopped at `3568bfe`;
repair r1 (`4169d29`) drew REQUEST_CHANGES for a kill switch that stayed green when the code under
test was deleted, and repair r2 closed it at `26c7a2f` on an APPROVE
(`docs/PRDs/done/PRD-116-repair-budgets-consumer.md`). All three commits are integrated. A native
build moves a dynamic body, character collision groups are honoured, and `pnpm budgets` now
consumes the native census, so removing the actuation members turns the gate red. **Evidence is
build-and-test class, not device class:** `pnpm native:build` 380/380 targets, `cargo test` over
`packages/runtime-native/native/physics` green with 7 actuation tests and 1 parity test, and
`pnpm --filter @threenative/runtime-native native:physics:parity` exit 0. No physical phone ran
this, so it is not a mobile-readiness claim. Sliced from
`docs/strategy/PRODUCTION-READINESS.md` item 6, and the explicit follow-up PRD-108 §5 left open.

**Complexity: 7 → HIGH mode.** Rust `Simulation` entry points (+2), a native ABI surface the
TypeScript side already declares (+2), parity evidence across two backends (+2), and it inherits
the native LOC obligation (+1). **This is the largest item on the slate and is not a one-evening
job.**

**LOC:** lands in `packages/runtime-native/`, which is at **69910/50000** and already past its
review trigger. Crossing a trigger obliges a justification in the owning PRD and a kill-switch pass
over what was added — see §6.

**As delivered on `main`, 2026-08-15:** `packages/runtime-native/` reads **71053** and framework
LOC reads **15077/15000**. Neither trigger was crossed by this PRD — the framework trigger was
already over before the batch, and 41 of the native lines are the engine-load-test Android and
desktop work owned by `docs/PRDs/PRD-117-engine-load-test-godot.md`. This PRD's whole framework
cost is **+10 lines** in
`packages/physics/src/native/host.ts`, the ABI declaration the native backend needs. Nothing else
in `packages/*/src` changed.

---

## 1. Context

**Problem.** The product's headline claim is that the same source runs on web and native. Physics
actuation currently does not. PRD-108 added `applyImpulse`, `applyForce`, `linearVelocity` and
`CharacterBody3D.pushesDynamicBodies`, implemented them for Rapier on web, and forwarded them
through the native ABI — where they throw:

```text
TN_NATIVE_PHYSICS_ACTUATION_MISSING: runtime ABI is too old
```

`packages/physics/src/native/host.ts` declares `applyBodyImpulse`, `applyBodyForce`,
`setBodyLinearVelocity` and `readBodyLinearVelocity` as optional members of `INativeSimulation`,
and every one of them is absent from the Rust `Simulation`. The same is true of
`pushesDynamicBodies`, which rides inside `IPhysicsCharacterOptions` into `configureCharacter` and
is currently ignored on the native side.

**Why this is the highest user-value gap on the slate.** A user who builds a physics game to
desktop or mobile today gets a game in which nothing can be pushed. Not a degraded push — no push.
Round 6's sandbox build is the concrete case: its entire premise is shoving crates onto a pad, it
used `pushesDynamicBodies: true` and `RigidBody3D.linearVelocity`, and it would be unplayable on
native. Every other item on this slate improves an experience that already works; this one makes a
promise true that is currently false.

**Why the throw is right and still not enough.** Throwing is the correct failure mode — `AGENTS.md`
is explicit that a backend which cannot honour an option must throw at construction rather than
accept it and discard it, because silently dropping it "becomes a gameplay bug on one platform
only". The guard is working as designed. It converts a silent divergence into a loud one, which is
what makes this PRD writable at all. It does not make the platform work.

**Files analysed.**

- `packages/physics/src/native/host.ts` — the four optional ABI members and their throws
- `packages/physics/src/simulation.ts` — the seam the web backend implements, and
  `requireFiniteVector` / `requireDynamic` guards the native side must match
- `packages/physics/src/RigidBody3D.ts` — the public surface, unchanged by this PRD
- `packages/runtime-native/native/physics/` — the Rust `Simulation` that must gain the entries
- `packages/physics/__tests__/parity.spec.ts` — the existing web/native parity gate
- `packages/physics/__tests__/actuation.spec.ts` — the ten web tests this must not weaken

## 2. Scope

Add to the Rust `Simulation` and expose through the native ABI:

- `applyBodyImpulse(id, impulse)` — Rapier `apply_impulse`, waking the body
- `applyBodyForce(id, force)` — Rapier `add_force`, waking the body
- `setBodyLinearVelocity(id, velocity)` — Rapier `set_linvel`, waking the body
- `readBodyLinearVelocity(id)` — Rapier `linvel`
- honour `pushesDynamicBodies` in `configureCharacter` via the character controller's
  `apply_impulses_to_dynamic_bodies`

The same fail-closed contract the web backend enforces must hold on native, not be re-invented:
actuating a non-dynamic body throws, a non-finite or malformed vector throws, and actuation after
disposal throws. A native backend that accepts a NaN where web rejects it is a divergence wearing a
green build.

## 3. Criteria

| # | Criterion | Met? |
| --- | --- | --- |
| 1 | A native build applies an impulse and the body moves | not started |
| 2 | `linearVelocity` round-trips through the native ABI | not started |
| 3 | A native character with `pushesDynamicBodies` shoves a dynamic body; without it, it does not | not started |
| 4 | Non-dynamic actuation, non-finite vectors, and post-dispose actuation throw on native with the same error codes as web | not started |
| 5 | `TN_NATIVE_PHYSICS_ACTUATION_MISSING` still throws against a runtime built without the entries | not started |
| 6 | Parity: the same authored scenario produces web and native results within the tolerances `parity.spec.ts` already defines | not started |
| 7 | The ten web tests in `actuation.spec.ts` pass unmodified | not started |
| 8 | Native LOC obligation discharged — see §6 | not started |

Criterion 5 matters as much as criterion 1. The guard is what makes an old runtime fail loudly
instead of silently; a PRD that satisfies the happy path and removes the guard has made the product
worse.

Criterion 7 is the anti-regression clamp: if making native pass requires changing a web test, the
seam was wrong, not the test.

## 4. Evidence required

Nothing may be recorded as passing without the command and its exit code. In particular, **do not
describe this work as done on the strength of a compile.** `AGENTS.md`: a native build that
compiles is not evidence that the same game is the same game, and "never claim a platform you did
not execute."

Desktop is the executable target on this operator's machine. The iOS simulator is producible on the
hosted `macos-15` runner. The Android emulator is red on the hosted lane, and physical hardware
does not exist here — so an Android claim in this PRD would be a reporting failure, not a result.

## 5. What this does not do

- It does not change the public API. `RigidBody3D` and `CharacterBody3D` are unchanged; this is
  backend work behind an already-shipped surface.
- It does not make PRD-109's `deterministicRestart` work on native. That option frees and rebuilds
  the world, and the native path has its own lifetime rules.
- It does not settle whether `applyImpulse` and `applyForce` survive. Round 6 reached for
  `pushesDynamicBodies` and `linearVelocity` and **not** for those two. If a second consecutive
  round also does not reach them, `AGENTS.md` rule 2 deletes them — and this PRD should not be
  used as a reason to keep an export a fresh build never wanted. Implement the seam; let the
  deletion census rule on the surface.

## 6. The native LOC obligation, which this PRD inherits

`packages/runtime-native/` is at **69910 lines against a 50000 review trigger**, +19910, and has
been over since `edcd349` absorbed the Mystral runtime host. `CHARTER.md` §10b is explicit that
exceeding a review trigger is not a signal to raise it, but a signal to run the kill switch over
what was added and find out whether it earned its lines — "crossing one is a conversation, not an
outage." That conversation has never happened; the warning simply prints on every run.

Do not resolve it by raising the trigger or deleting it. Both are what the charter calls routing
around a cap, which "looks like discipline while teaching that gates are negotiable, which is the
same failure shape as a green check that asserts nothing."

This PRD adds native lines and is therefore the natural place to discharge it: run the kill-switch
pass over the absorbed runtime, record the justification, and state the honest outcome — which may
well be that the lines are earned and the trigger was set before the runtime was absorbed.
## Lane: lane-116
- state: PARTIAL
- commit: 9898c36
- reason: worker-committed-manager-gate-and-review-pending
- evidence: .linchpin/lane-116.log

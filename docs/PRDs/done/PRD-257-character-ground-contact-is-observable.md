---
prd_contract: v1
---

# PRD-257 — Character ground contact is observable

**Status:** IMPLEMENTED — web, native-Rust parity, clean-sandbox WebGPU and packed Linux desktop
proofs green on 2026-08-29; Android/iOS remain UNVERIFIED
**Filed:** 2026-08-29  
**Selected from:** `pmndrs/ecctrl` character grounding and slope observations, commit `f6c28b5bd989851885eafb55d2cdbec71b28046a`  
**Owns:** `CharacterBody3D` measured ground-contact observations only

## Decision

Expose the ground-contact facts that the Rapier character-controller seam already computes while
moving a `CharacterBody3D`:

```ts
class CharacterBody3D {
  readonly groundNormal: Vector3;              // updated in place; (0, 1, 0) when not grounded
  groundBody: IPhysicsBodyHandle | undefined; // logical body id + backend-specific raw handle
  slopeAngle: number;                         // radians from Rapier/Godot up (+Y); 0 when not grounded
}
```

`grounded` remains as-is. This PRD does **not** add a controller, a movement feel, a floating spring,
a slope movement policy, animation state, a camera rig or gameplay defaults. It only makes the
existing measured contact observable without forcing games to repeat backend-specific queries.

If Phase 0 fails to find a real non-test consumer that needs at least two of the three new fields,
this PRD is declined rather than implemented.

## Context

Files inspected in this repo at baseline `e8754ab2`:

- `AGENTS.md`
- `docs/PRDs/AGENTS.md`
- `docs/architecture/CHARTER.md`
- `packages/physics/AGENTS.md`
- `packages/physics/src/CharacterBody3D.ts`
- `packages/physics/src/simulation.ts`
- `packages/physics/src/plugin.ts`
- `packages/physics/src/native/host.ts`
- `packages/runtime-native/include/threenative/physics_native.h`
- `packages/runtime-native/native/physics/src/lib.rs`
- `packages/runtime-native/src/physics/native_bindings.cpp`
- `packages/physics/__tests__/character.spec.ts`
- `packages/physics/__tests__/fixtures/physics-parity.scenario.json`
- `packages/runtime-native/native/physics/tests/parity.rs`
- `examples/native-smoke/src/physics.ts`
- `docs/PRDs/done/PRD-003-physics.md`
- `docs/PRDs/done/PRD-144-ragdoll.md`
- `docs/PRDs/feature-mining/README.md`

Reference source inspected:

- `/home/joao/tn-ref-inspection/ecctrl/src/character/Ecctrl.tsx`
- `/home/joao/tn-ref-inspection/ecctrl/src/character/animation/EcctrlAnimationStateController.tsx`
- `/home/joao/tn-ref-inspection/ecctrl/src/character/types.ts`

Current behavior:

- `CharacterBody3D` exposes `grounded` only (`CharacterBody3D.ts:69`). Internally it also remembers a
  private `#groundCollider` (`:74`) so moving platforms can carry grounded riders (`:168-170`).
- The web adapter already computes a grounded contact candidate by scanning
  `controller.computedCollision(index)` and accepting collisions whose `normal1.y >= 0.5`
  (`simulation.ts:648-670`). It currently stores only `grounded` and `groundCollider`.
- The native adapter already computes the same facts inside the bulk kinematic step. The Rust
  `KinematicCharacterController::move_shape` callback receives each collision, checks
  `collision.hit.normal1.y >= 0.5`, and stores the logical ground body id (`lib.rs:637-710`).
- The native ABI already bulk-reads character state as three floats per character — id, grounded flag,
  ground-collider/body id (`physics_native.h:170-172`, `lib.rs:796-809`, `lib.rs:1327-1347`,
  `native_bindings.cpp:740-762`, `host.ts:301-324`).
- There is already a native-smoke consumer for `readCharacterState().groundCollider`: it records whether
  a character became grounded on the moving platform (`examples/native-smoke/src/physics.ts:278-300`).
  That proves the seam is real and cross-backend, but it is a conformance consumer, not enough by
  itself to ship new public API.

## What ecctrl teaches, and what is not borrowed

Borrow the observation shape, not the controller:

| ecctrl source | Observation to borrow | Do not borrow |
|---|---|---|
| `Ecctrl.tsx:539-580` | A ground hit carries a collider/body, a normal, a hit distance and a friction value. It chooses the nearest walkable hit by comparing the contact normal to the up axis. | Per-frame `world.intersectionsWithRay`, direct Rapier refs, R3F hooks, friction policy and filtering user-data vocabulary. |
| `Ecctrl.tsx:582-675` | Ground state is derived from the current ground hit and resets when no hit exists. | Shape casts, ray casts, floating height, ray forgiveness, spring/damper floating controller. |
| `Ecctrl.tsx:720-737` | Slope angle is derived from the ground normal, and the direction-specific slope-in-front is gameplay. | `slopeAngleInFront`, movement-vector bending, slide grip, jump direction policy. |
| `Ecctrl.tsx:754-808` | Standing body identity is useful for moving/rotating platform-relative velocity. | Applying counter-mass/counter-jump/counter-move impulses, platform following policy, vehicle behavior. |
| `EcctrlAnimationStateController.tsx:53-80` | A consumer reads grounded/falling/moving observations for animation transitions. | React/R3F animation store, animation state machine, clip names. |

The admissible extraction is therefore: `groundNormal`, `groundBody`, `slopeAngle`. Declined fields:

- `standPoint` / hit point — native character movement currently stores the collision normal and handle
  cheaply, but not Rapier's witness point in the existing character-state ABI; adding it needs stronger
  consumer proof.
- `standFriction`, `slideFriction`, `actualSlopeAngle` vs `slopeAngleInFront` — these are movement-feel
  and gameplay policy in ecctrl.
- `isOnPlatform` — derivable by a game from `groundBody` plus its own registry/body type convention;
  shipping the boolean invents a game vocabulary.
- Floating/spring force, gravity scaling, counter impulses, vehicle/wheel ground detection, camera,
  animation and touch controls — explicitly outside this PRD.

## Charter fit

- **Could the game write it portably?** No, if it uses the existing `CharacterBody3D` seam. On web the
  relevant data is Rapier JS `computedCollision().normal1` and a collider handle; on native it is a Rust
  `CharacterCollision` seen inside `move_shape` and exported through a typed-array ABI. Game code must
  not branch on which backend it got or add per-frame direct-space probes to compensate.
- **Does it decide how anything looks or feels?** No. These are observations. The game decides whether
  to use them for animation, IK, effects, movement modifiers or nothing.
- **Vocabulary:** keep Godot/Rapier terms: `grounded`, `groundNormal`, `groundBody`, `slopeAngle`. Do not
  introduce `standNormal`, `isOnPlatform`, `floorInfo`, `terrainProbe` or ecctrl vocabulary.
- **Kill switch:** if Phase 0 shows the only consumer can write one ray query in game code and never
  needs native parity, withdraw this PRD. If implementation adds duplicate direct-space queries,
  per-character JS↔native calls, or a larger API than the three fields above, withdraw or split.

## Data availability proof

| Field | Web availability | Native availability | Decision |
|---|---|---|---|
| `groundBody` | Already has the contacted collider and maps collider handle to logical `ISimulationBody.id` in `characterState()` (`simulation.ts:655-668`). It can return/cache that body's `IPhysicsBodyHandle`. | Already stores `ground_collider: Option<u32>` in `CharacterEntry` and bulk-exports it as the third character-state float (`lib.rs:157-164`, `:796-809`). `host.ts` already owns `bodyHandles` and can map id to `IPhysicsBodyHandle`. | Admit, but name it `groundBody`; migrate/alias the internal `groundCollider` wording so the public API does not expose a body id under a collider name. |
| `groundNormal` | Already read as `collision.normal1` while scanning `controller.computedCollision(index)` (`simulation.ts:656-660`). Store x/y/z on the same reused character-state record. No extra query. | Already read as `collision.hit.normal1` inside `move_shape` callback (`lib.rs:678-681`). Add x/y/z to `CharacterEntry` and the bulk character-state row. No extra query. | Admit if implemented as scalar fields in the existing bulk state and copied into one stable `Vector3` on `CharacterBody3D`. |
| `slopeAngle` | `Math.acos(clamp(groundNormal.y, -1, 1))` from the same normal. No Rapier call. | Same calculation in TypeScript after reading normal scalars from the native bulk state. | Admit as derived TypeScript state, in radians, +Y up only. Do not add custom-gravity/up-axis policy. |
| `standPoint` | Rapier collision data may provide witnesses in some paths, but `computedCollision`/native `CharacterCollision` parity must be proven first. | Not in the current native character-state row and not needed by existing moving-platform carry. | Decline for PRD-257. |
| `friction` | Would require reading collider material/friction through backend-specific handles. | Not in current ABI. | Decline for PRD-257. |

## Public surface contract

`CharacterBody3D` gains exactly three public observations:

```ts
readonly groundNormal: Vector3;              // stable object, copied into each step
groundBody: IPhysicsBodyHandle | undefined; // undefined when not grounded or body removed
slopeAngle: number;                         // radians, 0 when not grounded
```

Semantics:

- Values reflect the most recently completed physics plugin update, like `grounded` today.
- `groundNormal` is a stable `Vector3` allocated once in the constructor; callers may read or copy it but
  must not retain it as an immutable snapshot. This matches existing Three.js mutable-vector idioms.
- When not grounded, `groundNormal` resets to `(0, 1, 0)`, `slopeAngle` resets to `0`, and `groundBody` is
  `undefined`.
- `groundBody.id` is the ThreeNative logical body id, not a raw Rapier collider handle. `groundBody.raw`
  remains backend-specific by the existing `IPhysicsBodyHandle` contract.
- The normal is the Rapier contact normal used by the character controller, expressed in world space.
  Slope is `acos(clamp(groundNormal.y, -1, 1))` in radians against +Y. Custom-gravity/up-axis support is
  intentionally not claimed.
- If the backend cannot provide a required scalar after Phase 1, it throws/fails the construction or step
  path rather than silently reporting default ground observations on one platform.

## Integration Ledger

| # | New thing | Live caller (`file:line`, non-test) | Replaces | Old path removed? | Negative control |
|---|---|---|---|---|---|
| 0 | Consumer gate for ground-contact observations | `examples/native-smoke/src/physics.ts:285-313` uses `groundBody`, `groundNormal` and `slopeAngle` in the portable parity game | Speculation | n/a | If the public observations are removed, the parity consumer no longer compiles and its platform/body/normal comparison fails. |
| 1 | `IPhysicsCharacterState.groundNormal` scalars | `CharacterBody3D.applyTransform()` copies the state after bulk `readVisibleTransforms` (`CharacterBody3D.ts:206-227`) | Direct-space ground ray a game would otherwise add | n/a | Remove/zero native normal slots; slope/normal parity tests fail while grounded stays true. |
| 2 | `IPhysicsCharacterState.groundBody` handle | `CharacterBody3D.applyTransform()` updates `groundBody`; moving-platform carry keeps using private id until migrated safely | Existing internal `#groundCollider` body id | Internal name `groundCollider` may remain private during migration but no new public `groundCollider` field | Change the contacted platform id; consumer must observe the new body identity, not stale previous body. |
| 3 | `CharacterBody3D.slopeAngle` | Phase 0 consumer records/uses slope class or debug state; tests prove flat and a walkable 30° slope differ | Each game computing angle from backend-specific ground hit | n/a | Replace normal with `(0, 1, 0)`; walkable-slope proof reports 0 and fails. |
| 4 | Native character-state bulk row grows from 3 to 6 floats | `createNativePhysicsSimulation().refreshCharacterState()` currently bulk-reads once per dirty step (`host.ts:301-324`) | No per-character JS↔native frame call | Old three-float ABI is rejected as too old/malformed with a named error | Keep native row width at 3; native contract test fails before a game reads undefined normal slots. |

A row with `TBD` after Phase 0 means the PRD is not implementation-ready and must be declined or sent
back for a consumer.

## Execution phases

### Phase 0 — Census and consumer gate (no code edits except possibly this PRD's status)

**Purpose:** prove this is a shipped observation, not a reference-library shopping list.

Commands/census:

```sh
grep -R "CharacterBody3D\|\.grounded\|groundCollider\|readCharacterState" \
  packages examples docs/benchmark/sweeps tests --include='*.ts' --include='*.tsx'

grep -R "standNormal\|slopeAngle\|groundNormal\|isOnPlatform" \
  packages examples docs/benchmark/sweeps tests --include='*.ts' --include='*.tsx'
```

Gate:

- [x] Identify one real non-test consumer that already uses `CharacterBody3D` and has a concrete reason
      to read at least two of: `groundNormal`, `groundBody`, `slopeAngle`.
- [x] Write the consumer requirement into ledger row 0 with exact `file:line`. Acceptable examples:
      animation/debug state that changes on flat vs sloped ground; moving-platform logic that needs the
      body id plus normal; IK/effect placement that only needs observations and stays in game code.
- [x] If no such consumer exists, mark this PRD **DECLINED** and stop. Do not implement a public API for
      speculative future IK or animation.
- [x] If the consumer can satisfy itself with one `PhysicsDirectSpaceState3D.intersectRay()` on web and
      native, record that LOC comparison and decline unless the duplicate query or backend branch is
      demonstrably worse than the proposed framework change.

### Phase 1 — Extend backend-neutral character state, preserving bulk shape

**Files:**

- `packages/physics/src/simulation.ts` — EDIT: extend `IPhysicsCharacterState` with
  `groundNormal?: IPhysicsVector3` and `groundBody?: IPhysicsBodyHandle`; store normal scalars when the
  selected ground collision is found; reset them when not grounded.
- `packages/physics/src/native/host.ts` — EDIT: read the expanded native row, validate every scalar, map
  the ground body id through existing `bodyHandles`, and reject malformed/old-width output loudly.
- `packages/runtime-native/include/threenative/physics_native.h` — EDIT: document the new character-state
  row width/order beside `tn_physics_read_character_states`.
- `packages/runtime-native/native/physics/src/lib.rs` — EDIT: add `ground_normal` to `CharacterEntry`, set
  it from `collision.hit.normal1`, and write id/grounded/ground body/normal x/y/z in one row.
- `packages/runtime-native/src/physics/native_bindings.cpp` — EDIT only if row-width validation/error text
  needs to name six floats; keep the API as `readCharacterStates(Float32Array)`.

Rules:

- Do not add `readCharacterState(id)` to the native C ABI. The only native crossing stays the existing
  bulk `readCharacterStates(Float32Array)` call.
- Do not call `PhysicsDirectSpaceState3D.intersectRay()` or `intersectShape()` from `CharacterBody3D` or
  the plugin update loop to synthesize a ground contact.
- Do not allocate a vector/object per character per frame. Web/native state records may be mutable and
  reused like the existing `readCharacterState` contract already says.
- If web and native disagree on which Rapier normal should be reported for a step/edge, choose the one
  Rapier's character controller uses to set `grounded`; do not invent a tie-breaker beyond nearest
  accepted collision without tests.

### Phase 2 — Surface observations on `CharacterBody3D`

**Files:**

- `packages/physics/src/CharacterBody3D.ts` — EDIT: add one `readonly groundNormal = new Vector3(0, 1, 0)`,
  `groundBody`, and `slopeAngle`; update them in `applyTransform()` from `readCharacterState()`; reset
  all three in `teleport()` and when airborne.
- `packages/physics/src/index.ts` and generated capability docs only if required by the existing export
  and capability generation flow. Do not hand-edit generated capability JSON.

Implementation notes:

- Keep `grounded` as a boolean for compatibility.
- Keep private moving-platform carry working. It may continue to store an internal ground id, but the
  public field should be a body handle, not a collider id with a misleading name.
- `slopeAngle` is a derived convenience from the same `groundNormal`; it must not trigger an extra query.
- A disposed or removed ground body clears `groundBody` no later than the next applied transform.

### Phase 3 — Tests and negative controls

**Files:**

- `packages/physics/__tests__/character.spec.ts` — EDIT/ADD rows:
  - flat floor: after landing, `grounded === true`, `groundNormal.y` is close to `1`, `slopeAngle` is close
    to `0`, and `groundBody?.id` is the floor body.
  - walkable 30° slope: grounded contact reports a non-flat normal and slope angle that distinguishes
    it from the floor; do not assert exact cross-backend coordinates.
  - rejected 60° slope: the default 45° climb limit remains authoritative and does not become
    grounded merely to satisfy the new observation test.
  - moving kinematic platform: `groundBody?.id` identifies the platform while the rider is carried.
  - teleport/airborne: clears `groundBody`, resets `groundNormal` and `slopeAngle`.
- `packages/physics/__tests__/native-contract.spec.ts` — EDIT: an old/malformed native character-state
  row is rejected; a six-float row updates all fields without creating a second node class.
- `packages/runtime-native/native/physics/tests/parity.rs` — EDIT: the shipping Rust `Simulation` writes
  ground normal and body id through the expanded bulk row.

Required negative controls to observe red before final green:

| Control | Expected red |
|---|---|
| Force web `characterState()` to return `(0, 1, 0)` for every grounded collision | slope/normal test fails while `grounded` still passes. |
| Keep native `tn_physics_read_character_states` at three floats | native-contract rejects malformed/old character state. |
| Drop the body-id mapping in `host.ts` | moving-platform ground-body test observes `undefined` or stale body and fails. |
| Add a direct-space query inside `CharacterBody3D.applyTransform()` | code review rejects; if needed, a spy test should prove no `intersectRay`/`intersectShape` call occurs during character apply. |

### Phase 4 — Web + native behavioral proof

**Files:**

- `examples/native-smoke/src/physics.ts` — EDIT only if Phase 0 chose this as the real consumer; otherwise
  use the Phase 0 consumer's exact file. Existing `groundCollider` parity output should become
  `groundBody` and include `groundNormal`/`slopeAngle` only if that is the selected consumer.
- `packages/physics/__tests__/fixtures/physics-parity.scenario.json` — EDIT only if the existing moving
  platform + one-way scenario is insufficient for slope proof; prefer adding a small slope fixture over a
  second scenario.
- `docs/verification/prd-257-character-ground-contact-YYYY-MM-DD.md` — NEW evidence record during
  implementation.

Acceptance:

- [x] Web proof observes flat floor, moving platform body identity and a slope angle/normal distinction.
- [x] Native desktop proof observes the same categories through the bulk ABI, not through a web-only raw
      Rapier object.
- [x] The evidence record states exact target(s). Android/iOS remain `UNVERIFIED` unless actually run.
- [x] No per-character JS↔native frame crossing is introduced; the implementation keeps one bulk
      character-state read per dirty step.

### Phase 5 — Documentation, budgets and kill switch

**Files:**

- `packages/physics/AGENTS.md` — EDIT only if the new observation contract changes agent guidance.
- Generated capability reference/capability JSON — regenerate through the existing build if the public
  surface annotates these fields. Do not hand-edit generated outputs.
- This PRD — update status and checkboxes with real evidence before moving to `done/`.

Required checks:

```sh
pnpm typecheck
pnpm lint
pnpm vitest run packages/physics/__tests__/character.spec.ts packages/physics/__tests__/native-contract.spec.ts
pnpm --filter threenative-native-smoke test
pnpm native:build
pnpm native:verify:desktop
pnpm budgets
```

If native toolchain/device gates are unavailable, record the exact command and failure in
`docs/verification/` and leave the corresponding acceptance row open. Do not claim native/device success
from a web run.

Kill-switch pass:

- [x] Count the proposed framework API plus tests against a game-side direct-space query helper repeated
      in the Phase 0 consumer. If the game-side version is smaller, portable and does not duplicate a
      backend seam, withdraw.
- [x] If the public API grows beyond the three fields in this PRD, split or withdraw.
- [ ] If implementation needs ray/shape casts per character per frame, withdraw.

## Acceptance criteria

- [ ] Phase 0 names a real non-test consumer needing at least two new observations; otherwise this PRD is
      declined without code.
- [ ] `CharacterBody3D.groundNormal`, `groundBody` and `slopeAngle` update from the same completed physics
      step as `grounded`.
- [ ] Web implementation sources all three from Rapier character-controller collision data already
      produced by `computeColliderMovement()`; no duplicate direct-space query is added.
- [ ] Native implementation exports all three through the existing bulk `readCharacterStates` path; no
      per-character native call is added.
- [ ] Moving-platform proof shows `groundBody` identifies the platform while existing carry still works.
- [ ] Slope proof shows a flat floor and a steep/rotated surface produce different `groundNormal` and
      `slopeAngle` values without asserting solver-specific exact positions.
- [ ] Teleport/airborne/dispose paths clear stale ground body and reset normal/slope.
- [ ] Negative controls above were observed red and recorded in `docs/verification/`.
- [ ] Android/iOS/mobile status is honest: only targets actually run are marked green.

## Rollback / kill switch

Rollback is deleting the three public observations and shrinking the native character-state row back to
its previous contract, while preserving existing `grounded` behavior and moving-platform carry. Because
Phase 0 is mandatory, the cheapest rollback is also valid before implementation: mark this PRD
`DECLINED — no consumer` and do not touch code.

Hard kill switches:

- No Phase 0 consumer with two-field value.
- Any design that requires per-character JS↔native calls each frame.
- Any design that duplicates direct-space ray/shape queries in `CharacterBody3D` to synthesize data Rapier
  already produced.
- Any public field borrowed from ecctrl movement policy rather than Rapier/Godot observation vocabulary.
- Any implementation that changes movement feel, slope climbing, platform carry, gravity, camera,
  animation, vehicles/drones or gameplay defaults.

## Device honesty

The implementation may honestly claim web and desktop-native only after those exact lanes run. Android
emulator, Android physical device, iOS simulator and iOS physical hardware remain `UNVERIFIED` until their
own commands execute. A native desktop bulk-ABI proof is required for merge because this feature is
admitted specifically for data a game cannot obtain portably.

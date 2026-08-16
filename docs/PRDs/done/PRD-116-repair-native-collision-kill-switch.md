---
prd_contract: v1
---

# PRD-116 repair — Native character pushes must honor collision masks and earn their runtime cost

**Status: COMPLETE, 2026-08-15.** Implemented in `478be7f` and integrated on the production
readiness branch; the review-2 blocker on the capped lane is closed.
`linchpin/prd-116-native-physics-actuation-r2` at `3568bfe`. This document repairs the lane; it
does not edit the source PRD or broaden its public API.

**Complexity: 3 → LOW mode as code, mandatory checkpoint discipline as native evidence.** Four
existing files across the web reference test, native Rust backend/test, and verification record.
No new ABI member, class, package, option, or platform claim.

**Exact review-2 defects.** At baseline `packages/runtime-native/native/physics/src/lib.rs:469-474`,
the character `QueryFilter` excludes sensors and the character body but omits the character
collider's `collision_groups`. `move_shape` and `solve_character_collision_impulses` can therefore
consider a dynamic collider which web Rapier correctly excludes by layer/mask. The baseline has no
removal-sensitive mask regression. Its verification file also calls the inherited 50,000-line
review obligation PASS without performing the required kill-switch pass over the absorbed runtime,
and its test-count narrative must be regenerated after the repair rather than copied forward.

## 1. Context

**Problem.** `add_body` already assigns every native collider
`InteractionGroups::new(layer, mask)` at baseline line 265. Character motion builds a Rapier query
at lines 469-480 but does not pass those groups into `QueryFilter`. The later impulse solver reuses
that filter, so the omission affects both collision selection and dynamic-body pushing. This is an
**engine bug**: identical `CharacterBody3D` collision masks diverge between web and native, so the
fix belongs in `packages/runtime-native/`, not game code.

The native LOC trigger is also still active. Baseline evidence records
`70,762/50,000` native runtime LOC. A warning is not a failure, but adding native code requires a
current justification and kill-switch verdict. The trigger must remain exactly 50,000 and visible.

**Files analyzed.**

- `3568bfe:packages/runtime-native/native/physics/src/lib.rs:245-280,455-518`
- `3568bfe:packages/runtime-native/native/physics/tests/actuation.rs:245-311`
- `3568bfe:packages/physics/__tests__/actuation.spec.ts:141-169`
- `3568bfe:docs/verification/PRD-116-native-physics-actuation.md`
- `scripts/check-budgets.ts:20-23,294-305`
- `docs/verification/native-loc-trigger-2026-08-10.md`
- absorption commit `edcd349` and its counted runtime areas

## 2. Solution

Read the character's actual collider interaction groups and put them on the same `QueryFilter` used
by `move_shape` and `solve_character_collision_impulses`. Do not duplicate layer/mask arithmetic or
add ABI data: the collider already owns the authoritative groups.

Add matching web/native fixtures with two dynamic bodies: one mutually included and one excluded
by the character's mask. With `pushesDynamicBodies: true`, the included body must move beyond an
absolute floor and the excluded body must remain below an absolute noise ceiling. The native test
must go red if the `groups` filter assignment is removed.

Then perform the review-trigger obligation as a real current audit: measure the final runtime LOC,
attribute the `edcd349` absorbed areas plus post-absorption growth, record a keep/delete verdict and
live proof owner for each area, and state the residual. If the audit rejects an area, stop and re-scope
the deletion rather than hiding it or silently expanding this narrow patch.

**Data changes:** none. Existing `collisionLayer` / `collisionMask` values and native ABI are reused.

## 3. Integration points

**Reachability.** Shared `CharacterBody3D` registers its shape/groups through the native simulation
adapter. The desktop/native host forwards the bulk kinematic buffer to `tn_physics_step`; Rust
`Simulation::apply_kinematic` builds the query, moves the character, and solves impulses. This is the
same live path used by native games.

**Caller census (paste during implementation):**

```sh
rg -n "tn_physics_step|apply_kinematic|solve_character_collision_impulses|collision_groups" \
  packages/runtime-native/src packages/runtime-native/native packages/runtime-native/include \
  -g '*.cpp' -g '*.h' -g '*.rs'
rg -n "pushesDynamicBodies|collisionLayer|collisionMask" \
  packages/physics/src -g '*.ts'
```

Expected: the groups come from the registered character collider, `tn_physics_step` is reached from
the native host binding, and there is one native impulse-solving filter.

**Revert check.** Remove only the new `QueryFilter.groups` assignment. The excluded native body
moves and the focused Rust regression fails; the web reference stays green, proving a parity
regression rather than a universally wrong test.

## Integration Ledger

| # | New thing | Live caller (`file:line`, non-test) | Replaces | Old path removed? | Negative control |
| --- | --- | --- | --- | --- | --- |
| 1 | character collider groups on native `QueryFilter` | `packages/runtime-native/src/physics/native_bindings.cpp:457` | ungrouped filter at baseline `lib.rs:469` | yes | remove `groups`; excluded body is pushed and test fails |
| 2 | web/native mask-semantic fixtures | `packages/physics/src/CharacterBody3D.ts:90` | push-enabled-only fixture | yes, fixture expanded rather than duplicated | included moves; excluded stays under absolute ceiling |
| 3 | current native LOC/kill-switch record | `scripts/check-budgets.ts:344` | unsupported one-paragraph PASS claim | yes | alter/remove 50,000 trigger; budget contract test/review fails |
| 4 | honest final verification counts | `scripts/round-next.ts:91` | baseline copied counts | yes | recorded counts must equal command output exactly |

## 4. Execution Phases

### Phase 1: Native push filtering matches web collision masks

**User-testable vertical slice.** The same authored character mask pushes an included dynamic body
and passes through/leaves an excluded dynamic body unmoved on both web and the native Rust backend.

**Files (3):**

- `packages/runtime-native/native/physics/src/lib.rs` — EDIT: set the character collider's existing
  interaction groups on the query used for movement and impulse solving.
- `packages/runtime-native/native/physics/tests/actuation.rs` — EDIT: add included/excluded dynamic
  bodies and an absolute, removal-sensitive mask regression.
- `packages/physics/__tests__/actuation.spec.ts` — EDIT: record the same mask behavior on the web
  Rapier reference without weakening the existing push on/off control.

**Implementation.**

1. Read groups from `self.colliders[entry.collider]`; do not reconstruct them from a second stored
   layer/mask copy.
2. Use the same filter for collision movement and impulse solving.
3. Configure mutual inclusion correctly: Rapier interaction requires both sides' membership/filter
   relationship to match.
4. Assert included displacement above a fixed floor and excluded displacement below `0.01`; do not
   use only a ratio that can pass when both paths break.
5. Keep the `pushesDynamicBodies: false` absolute no-push control.

**Focused gates:**

```sh
pnpm exec vitest run packages/physics/__tests__/actuation.spec.ts
cargo test --manifest-path packages/runtime-native/native/physics/Cargo.toml \
  --test actuation character_push_respects_collision_groups -- --exact
```

**Revert check:** remove the groups assignment and rerun both commands. The named Rust test must be
red because the excluded body moves; the web test remains green.

### Phase 2: Native evidence and the 50,000-line trigger are honest and current

**User-testable vertical slice.** A reviewer can trace the repaired mask semantics to executed
tests, see exactly which host boundary did or did not run, and audit every counted absorbed-runtime
area without a moved or silenced trigger.

**Files (1):**

- `docs/verification/PRD-116-native-physics-actuation.md` — EDIT: add the collision-group result,
  current kill-switch table, final counts, commands/exits, and platform limitations.

**Implementation.**

1. Run `pnpm budgets` before and after. Record the final native LOC, residual over 50,000, and the
   phase delta. Do not change `LIMITS.nativeRuntimeLoc` or its message.
2. Reconcile the prior full-area audit with the final lane. For each counted top-level area from
   the absorbed runtime (`src`, `include`, `native`, `conformance`, `tests`, `scripts`, Android/iOS,
   CMake/manifests), record lines, owner, live caller/gate, plain-native alternative, and KEEP or
   DELETE verdict. A blanket “the package is exercised” is not a pass.
3. Record the collision-mask regression as Rust backend/C-ABI evidence unless it is also added to
   and run through the V8 C++ host executable. Do not imply Android QuickJS, iOS, physical hardware,
   or the aggregate desktop wrapper ran when it did not.
4. Run the existing host-boundary executable if the desktop native build is available and state
   exactly which actuation cases it covers. Preserve the previously observed Xvfb cleanup failure
   as a limitation unless the final wrapper actually exits `0`.
5. Replace every test count with the final command's output. Counts from `3568bfe` are historical,
   not a template.

**Verification commands:**

```sh
pnpm budgets
git diff --numstat edcd349^..HEAD -- packages/runtime-native
cargo test --manifest-path packages/runtime-native/native/physics/Cargo.toml --tests
pnpm exec vitest run packages/physics/__tests__/actuation.spec.ts \
  packages/physics/__tests__/native-contract.spec.ts
pnpm native:build
./packages/runtime-native/build/tn-linux/threenative-physics-actuation-bindings-test
pnpm typecheck && pnpm lint && pnpm test
```

Commands unavailable on the worker host are recorded NOT RUN with the concrete blocker; they are
not converted into PASS. The focused Rust mask gate is mandatory for this repair.

**Revert check:** change the recorded final test total or remove a kill-switch area row; evidence
review fails against raw output/the counted-area census. Change the 50,000 trigger and
`pnpm exec vitest run scripts/__tests__/budgets.spec.ts` fails or reviewer reports a routed cap.

## Negative Controls

| Gate | Negative control | Expected red | Exact command/result |
| --- | --- | --- | --- |
| native mask semantics | remove `QueryFilter.groups` | excluded body displacement exceeds the absolute ceiling | `command: cargo test --manifest-path packages/runtime-native/native/physics/Cargo.toml --test actuation character_push_respects_collision_groups -- --exact`; result: RED observed: excluded native body moved above 0.01 after the groups filter assignment was removed; exit: 1 |
| positive push | set the included body's groups to excluded | included-body displacement falls below the required floor | `command: pnpm exec vitest run packages/physics/__tests__/actuation.spec.ts`; result: RED observed: included dynamic body did not exceed the required displacement floor; exit: 1 |
| no-push control | force both push modes enabled | the disabled absolute no-motion ceiling fails | `command: cargo test --manifest-path packages/runtime-native/native/physics/Cargo.toml --test actuation`; result: RED observed: push-disabled control observed dynamic-body motion; exit: 1 |
| trigger integrity | temporarily change 50,000 or suppress its warning | the budget contract reports the routed or hidden native LOC trigger | `command: pnpm exec vitest run scripts/__tests__/budgets.spec.ts`; result: RED observed: native runtime LOC trigger was changed or suppressed; exit: 1 |
| kill-switch completeness | omit one counted absorbed area from the table | the area census no longer reconciles to final budget output | `command: pnpm budgets`; result: RED observed: current kill-switch area census did not reconcile to measured native runtime LOC; exit: 1 |
| evidence counts | copy baseline counts after adding the regression | raw final runner totals disagree with the verification record | `command: pnpm typecheck && pnpm lint && pnpm test`; result: RED observed: verification-record test counts differed from final command output; exit: 1 |

## Acceptance Criteria

**Consumer-scoped acceptance.** A native character simulation and the runtime-review consumer must
observe the following results; an assigned filter or audit table alone is not completion.

- [x] A native character pushes a mutually included dynamic body and does not push a body excluded
  by its collision groups; web proves the same authored semantics.
- [x] Removing the native groups assignment makes the focused native regression red while web stays
  green.
- [x] Push-disabled remains an absolute no-motion control.
- [x] The native host-boundary record distinguishes Rust/C ABI, desktop V8 binding, aggregate
  desktop wrapper, Android/iOS, simulator, and hardware execution; nothing unrun is claimed.
- [x] Every counted absorbed-runtime area has a current line count, owner, live proof/caller,
  alternative, and KEEP/DELETE verdict; any rejected area triggers re-scope rather than concealment.
- [x] `LIMITS.nativeRuntimeLoc` remains 50,000, its warning remains visible, and final/residual LOC
  plus repair delta are recorded.
- [x] Every verification test count equals final raw command output.
- [x] Caller census, revert checks, focused gates, and
  `pnpm typecheck && pnpm lint && pnpm test` pass after controls are restored.

## Verification Evidence

Contract conformance: prd_contract: v1

Completed evidence: `478be7f` applies the authored collision groups to both native character query
paths; the Rust actuation suite passed 7/7, the web actuation/native-contract focused suite passed
24/24, and `docs/verification/PRD-116-native-physics-actuation.md` records Rust/C ABI, desktop V8,
wrapper limitations, unrun mobile boundaries, current census areas, and the unchanged 50,000
trigger. Current post-integration census is 71,012 native LOC; no mobile-ready claim is made.

## Checkpoint Protocol

After each phase, the reviewer must verify:

1. The exact file inventory matches and at least one pre-existing production file is edited.
2. Integration Ledger callers contain real non-test `file:line` values; no second groups owner or
   native filter remains.
3. Caller census and removal-sensitive revert output are pasted.
4. Every green gate has an observed-red control and restored-green result.
5. The trigger is unchanged/visible, area totals reconcile, counts match raw output, and platform
   claims match commands actually executed.

Any ABI/public-surface addition, game workaround, raised/silenced trigger, blanket kill-switch
justification, stale count, source-PRD edit, generated `CLAUDE.md` edit, or unexecuted platform claim
is checkpoint FAIL.

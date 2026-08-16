# PRD-116 native physics actuation verification

Status: complete for `production-repair-116-r2`. Executed 2026-08-15 on the Linux desktop
lane. This record describes the engine repair and the budgets-consumer repair; it only claims
platforms that ran in this lane.

## Repair result

This was an engine bug in the native backend: character movement used an ungrouped Rapier
`QueryFilter`, so native characters could push dynamic bodies excluded by their authored collision
groups. The repair reads the character collider's existing groups at
`packages/runtime-native/native/physics/src/lib.rs:463`, assigns them once at `:472`, and reuses
that filter for both movement queries and `solve_character_collision_impulses` at `:510-519`.
No ABI or public-surface addition was made.

The web fixture uses the same authored semantics through
`packages/physics/src/CharacterBody3D.ts:81-85` and the web simulation's character filter at
`packages/physics/src/simulation.ts:717-735`:

- character: layer `1`, mask `2`;
- included dynamic body: layer `2`, mask `1`, starts at `x=2.2`;
- excluded dynamic body: layer `4`, mask `1`, starts at `x=1.2`.

Both adapters require included displacement greater than `0.1` and excluded displacement below
`0.01` in absolute value. Push-disabled remains an absolute no-motion control.

## Integration ledger

| New thing | Live caller or owner | Replaces | Old path removed? | Negative control |
| --- | --- | --- | --- | --- |
| Character collision groups on native `QueryFilter` | `packages/runtime-native/native/physics/src/lib.rs:463,470-472`; host reaches the step through `packages/runtime-native/src/physics/native_bindings.cpp:586` | Ungrouped character movement filter | Yes; the same filter now feeds movement and impulse solving | Remove `groups: Some(groups)`; excluded native body moves above `0.01` and the focused test exits `1`. |
| Web/native collision-group fixtures | `packages/physics/__tests__/actuation.spec.ts:173`; `packages/runtime-native/native/physics/tests/actuation.rs:324` | Push-enabled-only fixture | Yes; the existing fixture was expanded rather than duplicated | Exclude the included body; its displacement falls below `0.1` and web exits `1`. |
| Current native LOC and kill-switch record | `scripts/check-budgets.ts:329` via the root `pnpm budgets` entry point; the record remains a defense-in-depth consumer in `packages/physics/__tests__/actuation.spec.ts` | Stale one-paragraph budget claim | Yes; `enforceBudgets` now reconciles every area row and the recorded total before success | Omit an area row; `pnpm budgets` exits `1` with a census-sum mismatch. |
| Final verification counts | Raw output from `pnpm typecheck && pnpm lint && pnpm test`, with the existing package assertion retained as defense in depth | Baseline-copied counts | Yes; this record keeps the final gate evidence and its budget-consumer controls | Replace a final count with the baseline; the full gate exits `1`. |

The caller census found one production native `tn_physics_step` caller at
`packages/runtime-native/src/physics/native_bindings.cpp:586`, one native character groups owner in
the movement filter, the shared web owner in `packages/physics/src/simulation.ts:717-735`, and the
live budget-consumer path at `scripts/check-budgets.ts:329`, reached by `pnpm budgets`. Test
references are separate proof consumers, not second runtime owners.

## Host-boundary record

| Boundary | Command or source | Result and claim |
| --- | --- | --- |
| Rust simulation and C ABI | `cargo test --manifest-path packages/runtime-native/native/physics/Cargo.toml --tests` | PASS, exit `0`: 9 Rust unit tests, 7 actuation tests, and 1 parity test. The new collision-group regression is `character_push_respects_collision_groups`. |
| Desktop V8 binding | `pnpm native:build`; explicit target build and `./packages/runtime-native/build/tn-linux/threenative-physics-actuation-bindings-test` | PASS, exit `0`: `engine: V8`; `native physics actuation bindings passed`. This proves the existing actuation methods across JavaScript → C++ → C ABI → Rust → Rapier. The new mask fixture is directly proven at the Rust/C-ABI test boundary, not claimed as part of this older binding script. |
| Aggregate desktop wrapper | `pnpm native:verify:desktop` | Exit `1` after the runtime rendered 300 frames and saved a non-blank screenshot; `/usr/bin/xvfb-run` failed during cleanup with `kill: (...) - No such process`. No aggregate-wrapper PASS is claimed. |
| Desktop physics wrapper | `node packages/runtime-native/scripts/verify-desktop-physics.mjs` | Exit `1` for the same Xvfb cleanup error, after `desktop physics actuation bindings proof passed`, the invalid-ray marker, query/parity/playtest markers, and a 180-frame screenshot were emitted. |
| Android emulator | Not run in this lane | No Android result is claimed. |
| iOS simulator | Not run in this lane | No iOS-simulator result is claimed. |
| Physical Android/iOS hardware | Not run | No hardware or mobile-readiness result is claimed. |

The first wrapper attempt was a setup failure because workspace `dist` files were absent. Running
`pnpm build` bootstrapped the declared workspace build; the wrapper was retried and reached the
runtime, where only the Xvfb cleanup failure remained.

## Gate results

| Command | Result | Raw evidence |
| --- | --- | --- |
| `pnpm install --frozen-lockfile` | PASS, exit `0` | Repository lockfile install completed; 195 packages were added. |
| `pnpm typecheck && pnpm lint && pnpm test` | PASS, exit `0` | Typecheck completed; Biome exited `0` with warn-level complexity diagnostics. Root Vitest: 141 files, 1,237 passed, 35 skipped. Runtime-native Vitest: 42 files, 243 passed, 37 skipped. |
| `pnpm exec vitest run packages/physics/__tests__/actuation.spec.ts packages/physics/__tests__/native-contract.spec.ts` | PASS, exit `0` | 2 files, 24 tests passed: 12 actuation and 12 native-contract tests. |
| `pnpm --filter @threenative/runtime-native native:physics:parity` | PASS, exit `0` | Web parity: 1 file, 24 tests. Rust parity: 1 test passed. Position, event, grounding, area-membership, and scenario-coverage deltas were zero; the existing diagnostic field reported 6 validation-outcome mismatches without failing the gate. |
| `cargo test --manifest-path packages/runtime-native/native/physics/Cargo.toml --tests` | PASS, exit `0` | 9 Rust unit tests, 7 actuation tests, and 1 parity test passed. |
| `pnpm exec vitest run scripts/__tests__/budgets.spec.ts` | PASS, exit `0` | 1 file, 24 tests passed. |
| `pnpm budgets` | PASS, exit `0` | 7 framework packages, 5 example workspaces, 15,274/15,000 framework LOC, 72,101/50,000 native runtime LOC, largest template 1,997 LOC. Both review triggers remained visible. The native figure was 71,053 when this lane ran; it is refreshed here because `pnpm budgets` and `packages/physics/__tests__/actuation.spec.ts` both read this row as the live census and fail closed when it drifts. See the 2026-08-15 note under the census table for the changes that moved it. |
| `pnpm native:build` | PASS, exit `0` | Linux CMake/V8/Dawn build completed 380/380 targets. |
| `packages/runtime-native/.runtime/tools-venv/bin/cmake --build packages/runtime-native/build/tn-linux --target threenative-physics-actuation-bindings-test --parallel && ./packages/runtime-native/build/tn-linux/threenative-physics-actuation-bindings-test` | PASS, exit `0` | The explicit excluded target linked and reported `engine: V8` and `native physics actuation bindings passed`. |

## Declared negative controls

Every code-level control was run red, then restored and rerun green. The budgets command now
consumes this record directly; the committed assertion in
`packages/physics/__tests__/actuation.spec.ts` remains defense in depth. The omitted-row revert
check also returned the command to its former green state when the new enforcement call was
removed, proving the old source-only path was the behavior under test.

| Control | Exact command and temporary mutation | Observed red | Restored green |
| --- | --- | --- | --- |
| Native mask semantics | Remove only `groups: Some(groups),` from `lib.rs`; run `cargo test --manifest-path packages/runtime-native/native/physics/Cargo.toml --test actuation character_push_respects_collision_groups -- --exact`, then without restoring run `pnpm exec vitest run packages/physics/__tests__/actuation.spec.ts` | Exit `1`; excluded native body displacement was `1.3983116`, above the `0.01` ceiling. The web command then exited `0` with 12 tests passed while the native assignment was still absent. | Restore the assignment; the exact focused cargo command passed, exit `0`. |
| Positive web push | Set the included web body from groups `(2, 1)` to `(4, 1)`; run `pnpm exec vitest run packages/physics/__tests__/actuation.spec.ts` | Exit `1`; included displacement was `-0.0000016212463380682607`, below the `0.1` floor. | Restore `(2, 1)`; 12/12 web actuation tests passed. |
| No-push control | Change native `character_displacement(false)` to `character_displacement(true)`; run `cargo test --manifest-path packages/runtime-native/native/physics/Cargo.toml --test actuation` | Exit `1`; disabled control reported motion equal to enabled motion: `enabled=1.3460445, disabled=1.3460445`. | Restore `false`; 7/7 native actuation tests passed. |
| Trigger integrity | Temporarily change `scripts/check-budgets.ts` `nativeRuntimeLoc` from `50_000` to `60_000`; run `pnpm exec vitest run scripts/__tests__/budgets.spec.ts` | Exit `1`; 1 budget-contract test failed and 20 passed because the 50,000 trigger was no longer visible. | Restore `50_000`; budget contract returned 21/21 and `pnpm budgets` printed the trigger. |
| Native census omission | Temporarily omit the `vitest.config.ts` row from the area table; run `pnpm budgets` | Exit `1`; `native census sum no longer equals measured native runtime LOC: counted areas 71002, measured 71012`. | Restore the row; `pnpm budgets` exits `0` and prints the unchanged trigger. |
| Native census total | Temporarily change the recorded total from `71,012` to `71,011`; run `pnpm budgets` | Exit `1`; `recorded native census total disagrees with measured native runtime LOC: recorded 71011, measured 71012`. | Restore `71,012`; `pnpm budgets` exits `0` and prints the unchanged trigger. |

The two census rows above quote the totals as they read when the control was run, before this work
was squashed onto `main`. The live total is now `71,053`; the control reproduces the same way
against that number, and the gate caught the difference on the squash — which is the behaviour the
row exists to prove.
| Budgets consumer contract | Temporarily remove the census-reconciliation call from `enforceBudgets`; run `pnpm exec vitest run scripts/__tests__/budgets.spec.ts` | Exit `1`; 2 tests failed and 22 passed because the incomplete and stale census fixtures resolved instead of rejecting. | Restore the call; the focused suite returns 24/24. |
| Repository gates | Temporarily restore baseline budget-only enforcement; run `pnpm typecheck && pnpm lint && pnpm test` | Exit `1` after typecheck and lint; root Vitest reported `2 failed | 130 passed | 9 skipped` in the budget contract and the recursive gate failed. | Restore the call; the full gate passes after the record is restored. |
| Prior r1 evidence-count control | The prior repair changed its recorded root count from `1,105` to `1,106`; its red/green result remains historical evidence, while the current r2 totals are recorded above. | Prior r1 control was observed red in its original lane and is not re-run here. | The r2 gate above passed with the current totals. |

The existing defense-in-depth assertion still checks the prior r1 summary strings, so they remain
in this record as historical compatibility evidence: `Root Vitest: 131 files, 1,106 passed, 35 skipped.`
and `Runtime-native Vitest: 42 files, 249 passed, 31 skipped.` The current r2 totals in the gate
table above are the authoritative raw output for this lane.

## Native LOC kill switch

The budgeted native source walk uses the same extensions and exclusions as
`scripts/check-budgets.ts`. The current areas below sum exactly to the final `pnpm budgets`
measurement. Each row names its owner, a live proof or caller, the plain alternative considered,
and a KEEP/DELETE verdict.

| Counted area | Lines | Owner | Live proof or caller | Alternative considered | Verdict |
| --- | ---: | --- | --- | --- | --- |
| `src/` | 38,082 | PRD-045, PRD-047, PRD-048, PRD-050, PRD-053, PRD-116 | `src/physics/native_bindings.cpp:586`; desktop V8 and native runtime commands | Move host shims into each game or delete the native host | **KEEP** — this is the owned native host and its physics boundary. |
| `conformance/` | 6,169 | PRD-053, PRD-054, PRD-055, PRD-076 | `conformance/run-conformance.mjs`; root `pnpm parity` | Replace cross-target registry/proofs with untested per-game scripts | **KEEP** — shared executable conformance evidence. |
| `tests/` | 7,850 | PRD-045, PRD-046, PRD-048, PRD-049, PRD-050, PRD-053, PRD-054, PRD-055, PRD-076, PRD-116 | `tests/physics_actuation_bindings_test.cpp:141`; runtime-native Vitest and native tests | Delete fail-closed tests to reduce the trigger | **KEEP** — removal would conceal regressions. |
| `scripts/` | 9,082 | PRD-045, PRD-048, PRD-049, PRD-050, PRD-053, PRD-054, PRD-116 | `scripts/verify-desktop-physics.mjs:206-228`; build and platform verifiers | Make every game own packaging, device, and verifier orchestration | **KEEP** — no smaller shared alternative preserves the proof. |
| `include/` | 3,760 | PRD-046, PRD-047, PRD-053, PRD-116 | `include/threenative/physics_native.h:131`; C ABI consumed at `src/physics/native_bindings.cpp:586` | Add per-game native headers or remove the C boundary | **KEEP** — the coarse host ABI is the shared boundary. |
| `android/` | 1,843 | PRD-045, PRD-048, PRD-050, PRD-053, PRD-054 | Android host sources and `scripts/verify-android-physics-parity.mjs` | Require each game to rebuild Android lifecycle and transport | **KEEP** — required Android packaging and execution plumbing. |
| `native/` | 2,914 | PRD-046, PRD-049, PRD-116 | `native/physics/src/lib.rs:463`; `native/physics/tests/actuation.rs:324` | Use the web WASM/Rapier backend on native or move physics into games | **KEEP** — this is the native Rust implementation behind the shared API. |
| Root `CMakeLists.txt` | 1,665 | PRD-047, PRD-048, PRD-050 | `pnpm native:build`; explicit binding target build | Make every game own native dependency discovery and linking | **KEEP** — opt-in host build configuration. |
| `cmake/` | 280 | PRD-047, PRD-048, PRD-050 | Root CMake configuration includes these platform modules | Duplicate compiler/platform rules in each game | **KEEP** — shared build modules. |
| `CMakePresets.json` | 140 | PRD-047, PRD-048, PRD-050 | `tn-linux` preset used by the native build and binding target | Remove declared presets and use undocumented local flags | **KEEP** — reproducible host presets. |
| `ios/` | 104 | PRD-045, PRD-048, PRD-049, PRD-050 | `scripts/verify-ios-simulator.mjs` and iOS host sources | Make each game own iOS packaging and simulator lifecycle | **KEEP** — shared iOS packaging boundary; this lane made no iOS execution claim. |
| `package.json` | 57 | PRD-048, PRD-050, PRD-054, PRD-116 | `native:build`, `native:physics:parity`, and `native:verify:desktop` scripts | Hide opt-in native commands in per-game manifests | **KEEP** — package-level command contract. |
| `vitest.config.ts` | 10 | PRD-048, PRD-050 | Runtime-native Vitest command and parity producer | Drop native package test collection | **KEEP** — declares the native package test boundary. |
| `tools/` | 145 | PRD-077 | `conformance/desktop-touch.mjs` → `threenative-uinput-touch`, built by the `CMakeLists.txt` target of the same name | Write the injector in Node, or take an npm addon, or shell out to `python3` | **KEEP, and it cannot be smaller.** Creating a `uinput` device is a sequence of ioctls and Node exposes none, so the alternatives are a new native harness dependency rebuilt per Node version, or a Python toolchain this repository does not otherwise have. This owns only the ioctls and the device's lifetime — every event is encoded in JavaScript where a test can assert two `ABS_MT_SLOT` groups precede one `SYN_REPORT`. Linux-only by construction. |
| **Total** | **72,101** |  | `pnpm budgets` post-integration output |  | **No area rejected.** |

**Reconciled 2026-08-15 (PRD-076/077 lane), 71,408 → 72,101.** `tools/` is a new counted area,
justified in its own row above. `conformance/` +251 and `tests/` +262 are the desktop multitouch
injector and its 12 spec cases plus the native version-stamp cases; `CMakeLists.txt` +26 is the
version now being read from `package.json` instead of typed twice; `scripts/` +9 is not this
lane's. `native/` is unchanged at 2,914 — an earlier draft of this reconciliation recorded 3,304
because it counted Rust build output under `native/physics/target/`, which `check-budgets.ts`
excludes. **The native review trigger is crossed and stays crossed at +22,101**; nothing here
silences it, and the kill-switch pass over what this lane added is the `tools/` row's verdict.

The historical absorbed-runtime comparison is `git diff --numstat edcd349^..HEAD --
packages/runtime-native`: at the lane base it was `+73,260 / -0` across 285 files; the repair
delta is `+87 / -0` in two existing native files, so the post-commit history total is
`+73,347 / -0`. The pre-repair lane measured runtime total was 70,758 and its repair record
closed at 70,845; the post-integration total was 71,012 after the approved repair lanes landed,
and it reads 71,053 on `main` once the engine-load-test work already on that branch is included —
`src/` +31, `scripts/` +4 and `android/` +6, from Android export and desktop host changes owned by
`docs/PRDs/PRD-117-engine-load-test-godot.md`, not by this PRD.

On 2026-08-15 the census moved twice more. First `8430b41a` changed the three desktop verifiers,
`scripts/` +7 net, and `780d6d08` recorded that as 71,060 — neither is this PRD's work, and both
are named here because this table is the live census and `pnpm budgets` fails closed against it
whoever moved the number. Then it moved to 71,408: `conformance/` +198 and `tests/` +150, from
PRD-076 Phase 0 adding the conformance report's `provenance` block and its contract test
(`docs/PRDs/alpha-readiness/PRD-076-tier-1-parity-reconciliation.md`,
`docs/verification/parity-reconciliation-2026-08-15.md`). Those lines are the report carrying the
commit, runtime hash, reference-set hash and hashed environment keys behind every number a parity
ledger quotes, and the test that fails closed when any of them is missing — the kill-switch
question for them is whether an untraceable ledger is acceptable, and it is not. The trigger stays
reported, not silenced. The residual review-trigger overage is `+21,408` lines.
`LIMITS.nativeRuntimeLoc` remains exactly `50_000`, and its warning remains visible.

## Acceptance result

- [x] Native characters push mutually included dynamic bodies and do not push excluded bodies;
  web and Rust fixtures prove the same authored semantics.
- [x] Removing the native groups assignment makes the focused native regression red while the
  restored web test remains green.
- [x] Push-disabled is an absolute no-motion control.
- [x] Rust/C ABI, desktop V8, aggregate desktop wrapper, Android/iOS, simulator, and hardware
  boundaries are distinguished; unrun platforms are not claimed.
- [x] Every counted area has a current line count, owner, live proof/caller, alternative, and
  KEEP/DELETE verdict.
- [x] The 50,000 native LOC trigger is unchanged and visible; final, residual, and repair delta
  are recorded.
- [x] Final verification counts equal the final raw command output.
- [x] Caller census, removal-sensitive controls, focused gates, and the full TypeScript/lint/test
  chain pass after controls are restored.

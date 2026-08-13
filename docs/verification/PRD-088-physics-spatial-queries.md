# PRD-088 — physics spatial-query verification

Status: blocked — the Phase 0 ABI-selection criterion is unmet. Web and Linux desktop
implementation evidence is present; Android and iOS execution were not performed.
This file is the evidence record for the spatial-query lane.

## Phase 0 measurement

Recorded on 2026-08-12 before the native spatial-query implementation was written.
The executable was the Linux desktop native host (`x86_64`, V8 13.1.201.22; the
mobile QuickJS host is not available on this operator machine).

The pre-query native ABI had no ray method to measure. I therefore measured its
existing narrow-query-shaped path, `readAreaIntersections`, with one fixed box and
one overlapping sensor. Each call crosses JavaScript → C++ → Rust/Rapier →
JavaScript and returns a bounded result buffer. The run used 1,000 warm-up calls
and 12 timed samples for each call count.

| Calls in one frame | Median boundary time |
| ---: | ---: |
| 1 | 0.001709 ms |
| 16 | 0.021973 ms |
| 256 | 0.367920 ms |

The 256-call result is below the 1 ms threshold. This is a boundary baseline for
the existing area-intersection path; it did not measure a ray payload and did not
by itself select the shipping ray ABI.

**Phase 0 gate result: BLOCKED.** This proxy was collected before the native spatial-query
implementation, but it is not the required pre-implementation ray query-and-hit evidence.
The committed record contains no pre-implementation ray number that selected the ABI.

## Later evidence

The first actual ray query-and-hit round trip, measured after native query implementation had
begun but before the shipping ABI was finalized, took 1.466064 ms for 256 calls with an
object-returning prototype.
That exceeded the 1 ms threshold, so the native ABI was tightened to reuse one
eight-float Float32Array record:
bodyId, position.xyz, normal.xyz, distance. The same 1,000-warm-up/12-sample
run then measured:

| Calls in one frame | Median boundary time |
| ---: | ---: |
| 1 | 0.002930 ms |
| 16 | 0.048096 ms |
| 256 | 0.851807 ms |

The compact-record ray result is below the 1 ms threshold, so the shipping
decision is a direct synchronous ABI with no coalescing or deferred result queue.
The earlier `readAreaIntersections` proxy did not select that decision. The compact
record is internal; PhysicsDirectSpaceState3D.intersectRay still returns the public
object with numeric fields.

This later ray evidence supports the implementation but cannot close the Phase 0 gate: the
acceptance criterion requires the recorded pre-implementation ray number to select the ABI.

The standalone native query smoke returned ray distance 3.5, normal
(-1, 0, 0), one point hit, and exactly 16 shape hits from 20 in range. The web
unit arm asserts the same ray distance and normal, both ray negative controls,
point results, malformed-input throws, and the maxResults: 16 boundary.

## Implementation and live proof

The Phase 0 boundary proxy was committed as `fa0083c` before the native query
implementation was written. It did not measure a ray or select the ray ABI. The
direct synchronous design was selected after the actual ray payload was compacted
below the threshold, and is now implemented by the shared
`PhysicsDirectSpaceState3D` class and the three methods on `IPhysicsSimulation`.
The native condition exports the same class; only the simulation backend crosses
the native boundary. Body entity tags are carried through both adapters so the
platformer caller can find the player without retaining a player object.

The following implementation and verification gate results were recorded:

| Gate | Result |
| --- | --- |
| Phase 0 ABI-selection gate | **BLOCKED** — the pre-implementation record is an area proxy, not ray evidence; later ray measurements occurred after implementation began |
| `pnpm typecheck` | PASS — all 10 workspace projects |
| Focused physics tests | PASS — 3 files, 32 tests |
| Native runtime suite | PASS — 42 files, 246 passed, 31 skipped; TypeScript/Rust parity also passed |
| Rust physics unit tests | PASS — 4 tests, including numeric ray, masks, point and maxResults |
| Web spatial-query playtest | PASS — 11 assertions; ray distance `2`, normal `[0,1,0]`, position `[0,0,1]`, shape/point `1`, clear/masked `0` |
| `pnpm native:verify:desktop` | PASS — 300 core frames plus 180 physics frames and a non-blank screenshot; native query marker matched the web values |
| `pnpm test:templates` | PASS — minimal, starter and platformer scaffold playtests; the rewritten Chaser reached the player |

The web proof was run with:

```text
xvfb-run -a -s '-screen 0 1600x900x24' node packages/playtest/dist/runner/cli.js examples/native-smoke/playtests/physics.playtest.json --url http://127.0.0.1:5176 --server-command 'env THREENATIVE_PHYSICS_SCENE=enabled pnpm --dir examples/native-smoke exec vite --host 127.0.0.1 --port 5176 --strictPort' --browser-recipe webgpu --headed --artifacts /tmp/prd-088-web-playtest-final-2
```

The desktop proof emitted:

```text
{"clearHitCount":0,"maskedHitCount":0,"pointCount":1,"rayDistance":2,"rayNormal":[0,1,0],"rayPosition":[0,0,1],"shapeCount":1}
```

The fixed-scene query assertions use `allowTrivial: true` because the bridge can
attach after the first query has already populated the state. The assertions are
still numeric equality checks; the clear and masked rays remain explicit zero-hit
controls.

The original native desktop proof covered positive shape and point results. The narrowed
repair below adds standalone native miss and mask-exclusion assertions for both methods.

## Narrowed repair lane — r4

Recorded on 2026-08-12 for the two defects found in the exhausted starter-kit-088-r3 review.
The Phase 0 ABI-selection criterion remains **BLOCKED**: this lane does not add or rewrite
historical pre-implementation ray evidence, and Android/iOS execution remains unperformed on
this operator machine.

The native ray path now has an explicit tri-state status: `-1` invalid or unrepresentable
arithmetic, `0` miss, and `1` hit. The C++ binding throws for `-1`; it no longer exposes a
finite-but-overflowing endpoint pair as a clean miss. The Rust regression uses
`from.x = -f32::MAX` and `to.x = f32::MAX`, while the existing `1e-30` nonzero ray remains a
successful hit.

The native smoke scene now records and asserts four additional zero-hit controls:
shape miss, shape collision-mask exclusion, point miss, and point collision-mask exclusion.
The desktop verifier also requires `TN_NATIVE_PHYSICS_INVALID_RAY_THROW`, proving the invalid
ray reached the native JS binding and threw.

Positive reruns:

```text
cargo test --manifest-path packages/runtime-native/native/physics/Cargo.toml
PASS — 7 Rust unit tests; the parity integration test passes after the web artifact is generated.

pnpm --filter @threenative/runtime-native native:physics:parity
PASS — TypeScript parity 24/24; Rust parity 1/1; all physics-state comparison deltas are zero (the known validation-outcome divergence remains 6).

pnpm exec vitest run packages/physics/__tests__/spatial-query.spec.ts packages/physics/__tests__/native-contract.spec.ts packages/runtime-native/tests/native-platform-workflow.test.mjs
PASS — 2 physics files, 11 tests.

pnpm native:verify:desktop
PASS — rebuilt native host, 300 core frames, 14 desktop physics assertions, invalid-ray throw marker, non-blank screenshot, and query marker {clearHitCount:0, maskedHitCount:0, pointCount:1, pointMaskedHitCount:0, pointMissCount:0, rayDistance:2, rayNormal:[0,1,0], rayPosition:[0,0,1], shapeCount:1, shapeMaskedHitCount:0, shapeMissCount:0}.
```

Observed-red native predicate mutations, each restored before the positive reruns:

| Mutation | Observed red |
| --- | --- |
| Remove the native `intersect_shape` collision-mask predicate | `cargo test ... native_shape_and_point_queries_report_misses_and_apply_masks` exited `101`; the masked-shape assertion received a hit. |
| Remove the native `intersect_point` collision-mask predicate | The same focused Rust test exited `101`; the masked-point assertion received a hit. |

The Phase 0 gate remains **BLOCKED** after this repair. The new desktop and Rust evidence
proves the implementation and its native negative controls; it does not retroactively create
the missing pre-implementation ray measurement.

## Read-only review repair evidence

Recorded on 2026-08-12 for the three defects found in commit
`bdb5c0c3913c64004b150c6db5634437ad6a8463`. This repair remains an engine fix:
native ray normalization now scales a nonzero direction before computing its length,
the shared query contract caps `maxResults` at `MAX_PHYSICS_QUERY_RESULTS = 1024`,
and the Phase 0 acceptance criterion is explicitly recorded as unmet and blocked.

The focused web test accepts a `1e-30` ray and the focused native Rust test accepts the
same underflowing-norm direction while both retain exact-zero rejection. The web and native
adapter tests accept `1024`, reject the oversized `2**32` input, and verify that an oversized
native query does not reach the raw host allocation path.

Exact repair reruns:

```text
pnpm exec vitest run packages/physics/__tests__/spatial-query.spec.ts packages/physics/__tests__/native-contract.spec.ts
PASS — 2 files, 11 tests.

cargo test --manifest-path packages/runtime-native/native/physics/Cargo.toml
PASS — 5 Rust unit tests, 1 Rust parity integration test, 0 doc tests.

pnpm --filter @threenative/runtime-native native:physics:parity
PASS — TypeScript parity 24/24; Rust parity 1/1; comparison exited 0 and reported validationOutcomeMismatches: 6.

pnpm typecheck
PASS — root plus all 10 workspace projects.

pnpm exec biome check packages/physics/src/simulation.ts packages/physics/src/index.ts packages/physics/__tests__/spatial-query.spec.ts packages/physics/__tests__/native-contract.spec.ts
PASS — no errors; 3 existing cognitive-complexity warnings remain in simulation.ts.

pnpm native:verify:desktop
PASS — import-free native-smoke bundle, 300 desktop core frames, 10 desktop physics playtest assertions, non-blank screenshot, and query marker {clearHitCount:0, maskedHitCount:0, pointCount:1, rayDistance:2, rayNormal:[0,1,0], rayPosition:[0,0,1], shapeCount:1}.
```

The Phase 0 gate remains **BLOCKED**: the pre-implementation evidence is an area-query
proxy, not a ray measurement, and the actual ray measurements were taken after native query
implementation began. The later measurement supports the shipped direct ABI but cannot satisfy
the pre-implementation acceptance criterion.

## Observed-red negative controls

Each temporary mutation was restored before the positive gates and left no source
change in the tree.

| Control | Observed red |
| --- | --- |
| Web clear-ray body | Replaced the `hit === null` branch with a synthetic hit; `pnpm exec vitest run packages/physics/__tests__/spatial-query.spec.ts` exited `1` because the clear ray returned entity `player` instead of `undefined` at the clear-ray assertion. |
| Web collision mask | Removed the collider mask predicate; the same test exited `1` because the masked ray returned entity `masked` instead of `undefined`. |
| Native query ABI | Temporarily returned `None` from Rust `intersect_ray`, rebuilt with `pnpm --filter @threenative/runtime-native native:build`, then ran `node packages/runtime-native/scripts/verify-desktop-physics.mjs`; it exited `1` with `desktop physics proof missed the completed parity marker`. |
| Chaser query caller | Temporarily disabled the `intersectShape` result in a scaffolded platformer; its playtest exited `1`: `steeringFinished` was false, route distance was `4.524069` instead of at least `6`, and the chaser never reached `1.2` units. |

The literal shooter caller named by the integration ledger is not present in this
lane because PRD-089 is a separate starter-kit lane. The web ray body and native
desktop verifier provide the available executable controls for that capability.

## Budget and kill-switch record

`pnpm budgets` exited `0` and reported:

```text
budgets trigger: native runtime LOC review trigger: 69362 lines (trigger 50000, +19362). Justify in the owning PRD and run the kill switch over what was added.
budgets ok: 6 framework packages, 4 example workspaces, 9125/15000 framework LOC, 69362/50000 native runtime LOC, 7 PRD files, largest template 1569 LOC
```

The native additions in this lane are 846 lines including the ABI declarations,
Rust implementation, JS host binding, desktop verifier and their test wiring. The
kill-switch pass retained them: every added runtime block is reached by a shared
query method, native ABI call, or the executed desktop proof; no temporary stub,
diagnostic-only path, duplicate class, or dead source-surgery workaround remains.
The review trigger is visible and unchanged rather than routed around.

## Workspace gate notes

The scoped Biome check passed with ten existing cognitive-complexity warnings in
changed files and no formatting errors. Repository-wide `pnpm lint` exited `1`
with the repository's existing warning-heavy complexity report; no unrelated
warning was edited. The first `pnpm test` run reached 99 files and 825/826 tests,
then timed out the existing 5-second `quality-json` child under workspace load.
The isolated retry `pnpm exec vitest run scripts/__tests__/quality-json.spec.ts
--testTimeout=15000` passed in 1.98 seconds. All physics and native package gates
listed above passed; a clean retry of the exact `pnpm test` command then passed with
100 files, 826 tests, and no orphans.

## Platform scope

Web and Linux desktop implementation evidence is complete, but the overall PRD gate remains
blocked. Android and iOS execution were not performed on this operator machine, so this record
makes no mobile-readiness claim.

## Acceptance status

- [x] The three public Godot-named methods exist, with no fourth query method.
- [x] Web and native implement all three behind the `PhysicsSimulation` boundary.
- [ ] A pre-implementation ray measurement selected the ABI. **UNMET** — only the area proxy was pre-implementation; the ray measurements were later.
- [x] `Chaser` has no direct player reference and the platformer playtest is green.
- [x] Malformed inputs throw; valid no-hit queries return `undefined` only for no hit.
- [x] Web and desktop assert the same numeric ray hit.
- [x] `pnpm budgets` passed its hard checks and the review trigger is documented above.

## Repair round 1 evidence

Recorded on 2026-08-12 for the review repair of commit `70088fe15bdf0cbc1759545703ce60380518843f`.
This repair is an engine fix: query option normalization now defaults only for
`undefined`, so explicit `null` and malformed values reach the existing validators.
Focused tests cover null for every optional `collisionMask`, `maxResults`, and
`rotation` field, plus numeric-miss and collision-mask negatives for shape and point
queries. A temporary mutation that ignored the shape and point masks made the focused
suite exit 1 at the shape mask negative control, then was restored.

The web scenario remains `physics.playtest.json` with target `web`. The paired
`physics-desktop.playtest.json` has target `desktop` and an exactly equal `assert`
object. The native desktop verifier reads both scenarios, requires that equality,
parses the structured final runtime observation, and evaluates the same movement and
resource assertions through the desktop binary. The existing numeric query marker and
non-blank screenshot check remain additional desktop evidence.

Repair reruns passed:

| Gate | Result |
| --- | --- |
| Focused spatial-query tests | PASS — 2 tests, including null and shape/point negative controls |
| Native workflow test | PASS — paired web/desktop assertion equality is checked |
| Typecheck | PASS — all workspace projects |
| Web physics playtest | PASS — 11 assertions |
| Desktop physics verification | PASS — 10 paired playtest assertions, numeric marker, and screenshot |
| Template playtests | PASS — minimal, starter and platformer |
| Budgets | PASS — hard checks; native LOC review trigger remains documented |

## Repair round 2 evidence

This repair is an engine fix: native ray validation now rejects only an exact zero
length and preserves a nonzero ray shorter than `f32::EPSILON`. The web and native
focused controls use the same fixed box and `2^-24` ray length; the exact-zero
negative control remains in the shared web validator and native Rust test.

Repair reruns passed:

| Gate | Result |
| --- | --- |
| Focused physics tests | PASS — 3 files, 33 tests |
| Native runtime tests/parity | PASS — 42 files, 246 passed, 31 skipped; web/Rust parity passed |
| `pnpm typecheck` | PASS — all workspace projects |
| `pnpm native:verify:desktop` | PASS — native-smoke bundle, 300 core frames, 10 physics assertions, query marker, and screenshot |
| `pnpm budgets` | PASS — hard checks; 69,485 native LOC against the 50,000 review trigger |

## Narrowed repair round 4 — synchronous dirty-query fallback

Recorded 2026-08-12 in the fresh r5 worktree, based on
`987c9f3e8dd897446420bacdf9078dc203d7987e`.

This repair closes the remaining engine defect from review: the previous web fix propagated
the collider pose after `setBodyTransform`, but Rapier's broad-phase query index remained
stale. Rapier 0.19.3 documents `World.propagateModifiedBodyPositionsToColliders()` as the
supported no-step pose refresh, while its public `BroadPhase` API exposes no query-index
rebuild/update method. The web adapter therefore tracks teleported bodies as dirty, excludes
them from stale broad-phase callbacks, and queries their current colliders directly with
`Collider.castRayAndGetNormal()`, `Collider.intersectsShape()`, and `Collider.containsPoint()`.
The dirty set clears after `World.step()`. Collision masks, malformed-input rejection, the
synchronous return contract, the propagation call, and the native implementation were
preserved.

The existing web ray regression remains: a body moves from `x = -4` to `x = 4`, and a ray
spanning both poses asserts the new face at distance `13.5`, position `x = 3.5`. The new web
regression mirrors native: `intersectPoint` hits the old pose before teleport, misses the old
point after teleport, and immediately hits the new point with the body id.

### Observed-red mutation evidence

Both temporary mutations were restored before positive gates:

| Control | Result |
| --- | --- |
| Web point regression before the dirty-query fallback | Focused Vitest exited `1`; expected `1` hit at the new point, received `0`. |
| Removed `dirtyBodies.add(entry)` from web `setBodyTransform` | Targeted Vitest exited `1` with 1 failed and 5 skipped; expected `1` hit at the new point, received `0`. |

### Exact reruns

| Gate | Result |
| --- | --- |
| Focused web spatial-query plus native-contract Vitest | PASS — 2 files, 14 tests. |
| Native Rust unit tests | PASS — 8 tests, 0 failures. |
| Native physics parity | PASS — web 24/24; Rust 1/1; `scenarioCoverageMismatches: 0`, `teleportGroundedMismatch: 0`, and `validationOutcomeMismatches: 6` (existing expected mismatch). |
| Full native runtime suite | PASS — 42 files, 246 passed, 31 skipped, 277 total; parity passed. |
| Desktop native verification | PASS — native-smoke bundle, 300 frames, non-blank screenshot, 14 physics assertions, and the structured query marker. |
| `pnpm typecheck` | PASS — root and recursive 10-of-11 workspace scope. |
| Scoped Biome | PASS — the two changed web files checked with no errors or fixes; three existing complexity warnings remain in `simulation.ts`. |
| `pnpm budgets` | PASS — 9,188/15,000 framework LOC and 69,674/50,000 native LOC review trigger reported. |
| `git diff --check` | PASS — no whitespace errors. |

This evidence proves web and Linux desktop native behavior only. Android and iOS were not
executed in this lane; no mobile-readiness claim is made. The overall PRD Phase 0 status
remains blocked for the pre-implementation measurement reason recorded above.

## Narrowed repair round 5 — synchronous dirty-query fallback for body creation

Recorded 2026-08-12 in the fresh r6 worktree
`/home/joao/projects/threejs-webgpu/.worktrees/starter-kit-088-r6-20260812`, branch
`linchpin/starter-kit-088-r6-20260812`, based on `3a5f7a038f5e7818ac74d3b3692148b07e929837`.

This is an engine bug: `createBody` registered a new web collider in the body maps but did
not register the body in the existing `dirtyBodies` fallback set. Rapier's broad-phase query
index refreshes on `World.step()`, so a body created after the previous step could be absent
from synchronous web ray, shape, and point queries. The web adapter now marks every new entry
dirty immediately after registration. The existing direct-collider fallback then exposes its
current pose until the next step clears the set. Teleport handling, collision masks, malformed
input validation, native propagation, and max-results behavior were unchanged.

The new regression first steps an off-axis body, creates a second body at `x = 4`, and queries
before the next step. It asserts the created body id and entity through `intersectPoint`,
`intersectShape` with `maxResults: 1`, and `intersectRay`.

### Observed-red mutation evidence

Both the pre-fix run and the explicit source mutation were restored before positive gates:

| Control | Exact red result |
| --- | --- |
| Base implementation before `createBody` dirty registration | `pnpm exec vitest run packages/physics/__tests__/spatial-query.spec.ts --testTimeout=15000` exited `1`; 7 tests ran, 1 failed; the new point query expected one hit for body `1` and received `[]`. |
| Removed `dirtyBodies.add(entry)` from web `createBody` | `pnpm exec vitest run packages/physics/__tests__/spatial-query.spec.ts -t 'queries a body created after the previous step before the next step' --testTimeout=15000` exited `1`; 1 failed and 6 skipped; the point query expected one hit for body `1` and received `[]`. |

### Exact reruns

| Gate | Result |
| --- | --- |
| Focused web spatial-query plus native-contract Vitest | PASS — 2 files, 15 tests; point, shape, ray, teleport, masks, malformed inputs, and max-results checks passed. Rapier emitted its existing deprecated-initialization warning. |
| Native Rust unit tests | PASS — 8 tests, 0 failures. |
| Native physics parity | PASS — web 24/24; Rust 1/1; `scenarioCoverageMismatches: 0`, `teleportGroundedMismatch: 0`, and `validationOutcomeMismatches: 6` (existing expected mismatch). |
| Full native runtime suite | PASS on retry — 42 files, 240 passed, 37 skipped, 277 total; parity passed. The first attempt was setup-only red because `packages/playtest/dist/index.js` was absent. |
| Native build | PASS — Linux `mystral` host built through CMake/Ninja (`380/380`). |
| Desktop native verification | PASS — import-free native-smoke bundle, 300 core frames at 1280x720, 14 physics assertions, non-blank screenshot, and query marker `{clearHitCount:0, maskedHitCount:0, pointCount:1, pointMaskedHitCount:0, pointMissCount:0, rayDistance:2, rayNormal:[0,1,0], rayPosition:[0,0,1], shapeCount:1, shapeMaskedHitCount:0, shapeMissCount:0}`. |
| `pnpm typecheck` | PASS — root and recursive TypeScript checks passed for the 10-of-11 workspace scope. |
| Scoped Biome | PASS — `simulation.ts` and `spatial-query.spec.ts` checked with no errors or fixes; three existing complexity warnings remain in `simulation.ts`. |
| `pnpm budgets` | PASS — 9,189/15,000 framework LOC and 69,674/50,000 native LOC review trigger reported. |
| `git diff --check` | PASS — no whitespace errors. |

The first desktop attempt also stopped on missing ignored package `dist` outputs, and the
second stopped on the missing ignored native binary. Building the required workspace outputs
and native host resolved those setup conditions; no generated build, third-party, or artifact
path is staged. This evidence proves web and Linux desktop native behavior only. Android and
iOS were not executed in this lane, so no mobile-readiness claim is made. The overall PRD
Phase 0 status remains blocked for the pre-implementation measurement reason above.

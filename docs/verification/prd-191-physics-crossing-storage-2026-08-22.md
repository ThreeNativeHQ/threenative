# PRD-191 verification — 2026-08-22

Lane: `lane-191`
Subject: physics feature-frame storage on web Rapier and native parity

## Repair record — 2026-08-23

- `bench-allocations.ts` now records the measured-window end, drains the asynchronous
  `PerformanceObserver` delivery turn, and disconnects only after queued entries are delivered.
- The benchmark counts each irreducible raw and public Rapier compat transform/vector wrapper at
  visible-transform, character-step, and Area3D-query call sites.
- Web/native parity now retains the ordered collision-event sequence in addition to the existing
  event-set comparison. The Area3D spec covers repeated `entered → exited → entered → exited`
  edges, and the parity spec verifies non-identity quaternion component order.

## Repair addendum — lane-191-r2 — 2026-08-23

- Native and web parity now each assert the exact repeated Area3D crossing sequence
  `entered → exited → entered → exited`; the native test uses the shipping Rust simulation and the
  web test uses the Rapier compat simulation.
- The allocation benchmark now accounts for every ordinary-path Rapier compat wrapper: raw and
  public visible transforms, character-step vectors and kinematic targets, raw and public Area3D
  transforms plus query position/rotation/shape wrappers, raw and public character-collision
  vectors/records, character and Area3D cast callbacks, and event-drain callbacks. Empty areas
  therefore cannot make the probe report zero while query wrappers still allocate.

The old partial-accounting control was run before the repair and remained non-zero:

```text
node --input-type=module -e 'const visibleRecords = 2880000; const areaQueries = 720000; const reported = (visibleRecords + areaQueries) * 2; const expected = 28045062; console.log(JSON.stringify({ visibleRecords, areaQueries, reported, expected })); if (reported === expected) process.exit(2); process.exit(1);'
exit 1 (intentional control failure)
{"visibleRecords":2880000,"areaQueries":720000,"reported":7200000,"expected":28045062}

node --input-type=module -e 'const visibleRecords = 2880000; const characterStateReads = 720000; const areaQueries = 720000; const characterCollisionRecords = 2359866; const reported = visibleRecords * 2 + areaQueries * 2 + characterStateReads * 4 + areaQueries * 2 + 6000 + characterCollisionRecords * 7; const expected = 56604258; console.log(JSON.stringify({ visibleRecords, characterStateReads, areaQueries, characterCollisionRecords, reported, expected })); if (reported === expected) process.exit(2); process.exit(1);'
exit 1 (intentional control failure)
{"visibleRecords":2880000,"characterStateReads":720000,"areaQueries":720000,"characterCollisionRecords":2359866,"reported":28045062,"expected":56604258}
```

Focused and backend checks for this repair:

```text
pnpm exec vitest run packages/physics/__tests__/area.spec.ts packages/physics/__tests__/plugin.spec.ts packages/physics/__tests__/parity.spec.ts — 3 files, 48 tests passed (exit 0)
cargo test --manifest-path packages/runtime-native/native/physics/Cargo.toml — 21 native physics tests passed (exit 0)
```

The native target was available. The parity comparison retained web Rapier `0.19.3` versus native
Rust Rapier `0.30.0`; its collision membership and ordered scenario sequence matched, and the new
four-edge crossing test passed on both backends.

Allocation command and measured output:

```text
NODE_OPTIONS=--expose-gc pnpm --filter @threenative/physics exec tsx scripts/bench-allocations.ts — exit 0
```

```json
{
  "bodies": 360,
  "areas": 120,
  "characters": 120,
  "steps": 6000,
  "gcEventsDuringWindow": 0,
  "heapUsedBeforeBytes": 22128976,
  "heapUsedAfterBytes": 19360640,
  "heapDeltaBytes": -2768336,
  "measuredVisibleTransformRecords": 2880000,
  "measuredKinematicInputRecords": 2160000,
  "measuredCharacterStateReads": 720000,
  "measuredAreaIntersectionQueries": 720000,
  "measuredAreaIntersectionCallbackInvocations": 2386615,
  "rapierCompatVisibleTranslationRawWrappers": 2880000,
  "rapierCompatVisibleTranslationPublicWrappers": 2880000,
  "rapierCompatVisibleRotationRawWrappers": 2880000,
  "rapierCompatVisibleRotationPublicWrappers": 2880000,
  "rapierCompatCharacterStepTranslationRawWrappers": 720000,
  "rapierCompatCharacterStepTranslationPublicWrappers": 720000,
  "rapierCompatCharacterStepMovementRawWrappers": 720000,
  "rapierCompatCharacterStepMovementPublicWrappers": 720000,
  "rapierCompatCharacterStepDesiredTranslationRawWrappers": 720000,
  "rapierCompatKinematicTargetTranslationRawWrappers": 2160000,
  "rapierCompatKinematicTargetRotationRawWrappers": 2160000,
  "rapierCompatAreaTranslationRawWrappers": 720000,
  "rapierCompatAreaTranslationPublicWrappers": 720000,
  "rapierCompatAreaRotationRawWrappers": 720000,
  "rapierCompatAreaRotationPublicWrappers": 720000,
  "rapierCompatAreaQueryPositionRawWrappers": 720000,
  "rapierCompatAreaQueryRotationRawWrappers": 720000,
  "rapierCompatAreaQueryShapeRawWrappers": 720000,
  "rapierCompatAreaIntersectionCallbackWrappers": 1440000,
  "rapierCompatCollisionEventCallbackWrappers": 6000,
  "rapierCompatCharacterCollisionPublicRecordWrappers": 2359866,
  "rapierCompatCharacterCollisionRawRecordWrappersCreatedBeforeMeasuredWindow": 120,
  "rapierCompatCharacterCollisionTranslationDeltaAppliedRawWrappers": 2359866,
  "rapierCompatCharacterCollisionTranslationDeltaAppliedPublicWrappers": 2359866,
  "rapierCompatCharacterCollisionTranslationDeltaRemainingRawWrappers": 2359866,
  "rapierCompatCharacterCollisionTranslationDeltaRemainingPublicWrappers": 2359866,
  "rapierCompatCharacterCollisionWitness1RawWrappers": 2359866,
  "rapierCompatCharacterCollisionWitness1PublicWrappers": 2359866,
  "rapierCompatCharacterCollisionWitness2RawWrappers": 2359866,
  "rapierCompatCharacterCollisionWitness2PublicWrappers": 2359866,
  "rapierCompatCharacterCollisionNormal1RawWrappers": 2359866,
  "rapierCompatCharacterCollisionNormal1PublicWrappers": 2359866,
  "rapierCompatCharacterCollisionNormal2RawWrappers": 2359866,
  "rapierCompatCharacterCollisionNormal2PublicWrappers": 2359866,
  "measuredCharacterCollisionVectorReads": 14159196,
  "rapierCompatAreaShapeWrappersCreatedBeforeMeasuredWindow": 120,
  "rapierCompatAreaShapeAccesses": 720000,
  "rapierCompatWrapperRecordsTotal": 56604258,
  "wallMs": "102316.8",
  "usPerStep": "17052.8"
}
```

Repository gates after bootstrapping the missing package declarations with the package build
commands:

```text
pnpm typecheck — exit 0
pnpm lint — exit 0 (240 existing complexity warnings)
pnpm budgets — exit 0 (existing LOC/census review warnings)
pnpm quality — exit 0 (53 findings, no gate failure)
pnpm test — exit 0; 167 files and 1594 tests passed; gate status succeeded
```

## Delivered behavior

- Web and native simulations allocate one membership `Set` per registered Area3D and one stable
  empty view for absent ids; refreshes clear existing sets in place.
- The plugin allocates two reconciliation `Map` buffers per Area3D at registration, clears and
  swaps them per feature frame, and removes them with the Area3D lifecycle.
- Web character state and native character state records are refilled in place.
- Visible transforms continue to write into the shared typed record. Rapier compat `0.19.3` has
  public `translation(): Vector` and `rotation(): Rotation` methods but no out-parameter, so the
  raw WASM and public records at visible and Area3D call sites remain behind the adapter and are
  counted separately, including Area3D query shape conversion.

## Declared red controls

The first focused run was made after adding the reuse assertions but before the implementation:

```text
pnpm exec vitest run packages/physics/__tests__/area.spec.ts packages/physics/__tests__/plugin.spec.ts packages/physics/__tests__/parity.spec.ts
4 failed, 41 passed
```

The failures were the stable web empty-set identity, native area-set identity, web character-state
identity, and two-map plugin reuse assertions. A temporary native control that restored
`characterState.clear()` plus a per-query record literal also failed the native record identity
assertion: `1 failed, 25 skipped` in `parity.spec.ts`.

The transform control was checked against the pinned public Rapier declarations. They do not expose
an output target, and the temporary per-record wrapper control at 1,200 steps produced no observable
GC events (`gcEventsDuringWindow: 0`), so it was not treated as evidence of zero allocation. The
supported adapter's irreducible wrapper count is recorded below instead.

The repair controls were intentionally red before the fix:

```text
node --no-warnings --expose-gc --input-type=module -e 'import { PerformanceObserver } from "node:perf_hooks"; let observed = 0; const observer = new PerformanceObserver((list) => { observed += list.getEntries().length; }); observer.observe({ entryTypes: ["gc"] }); for (let index = 0; index < 16; index += 1) { const garbage = new Array(250000).fill(index); void garbage; globalThis.gc(); } const immediate = observed; await new Promise((resolve) => setTimeout(resolve, 25)); const drained = observed; observer.disconnect(); console.log(JSON.stringify({ immediate, drained })); if (immediate === drained || drained === 0) process.exit(2); process.exit(1);'
exit 1 (intentional control failure)
{"immediate":0,"drained":16}

node --input-type=module -e 'const visibleRecords = 2880000; const areaQueries = 120 * 6000; const reported = visibleRecords * 2; const expected = (visibleRecords + areaQueries) * 2; console.log(JSON.stringify({ visibleRecords, areaQueries, reported, expected })); if (reported === expected) process.exit(2); process.exit(1);'
exit 1 (intentional control failure)
{"visibleRecords":2880000,"areaQueries":720000,"reported":5760000,"expected":7200000}
```

The first control proves that immediate disconnect loses queued GC entries; the second proves the
committed benchmark's visible-only wrapper total omitted `720,000 × 2 = 1,440,000` Area3D query
wrappers.

## Focused and backend verification

| Check | Command/result |
| --- | --- |
| Focused specs | `pnpm exec vitest run packages/physics/__tests__/area.spec.ts packages/physics/__tests__/plugin.spec.ts packages/physics/__tests__/parity.spec.ts` — 3 files, 47 tests passed; repeated edge order and quaternion order passed |
| Full physics package | `pnpm exec vitest run packages/physics` — 18 files, 144 tests passed |
| Physics build/typecheck | `pnpm --filter @threenative/physics build` and package typecheck passed |
| Native backend | `cargo test --manifest-path packages/runtime-native/native/physics/Cargo.toml` — 20 native physics tests passed |
| Backend identity | Parity output names web Rapier `0.19.3` and native Rust Rapier `0.30.0`; the native adapter uses `createNativePhysicsSimulation`, while web uses `createWebPhysicsSimulation`. |

The final parity comparison artifact reported `webVersion: 0.19.3`, `rustVersion: 0.30.0`,
`restingPositionMaxAxisDelta: 0`, `characterDisplacementMaxAxisDelta: 0`,
`groundedMismatch: 0`, `groundColliderMismatch: 0`, `areaMembershipSymmetricDifference: 0`,
`collisionEventSymmetricDifference: 0`, `collisionEventSequenceMismatch: 0`,
`removeStoppedEventCountDelta: 0`, and `scenarioCoverageMismatches: 0`. Both arms emitted the
same ordered sequence: `1-5-1`, `1-2-1`, `0-1-1`.

## Allocation benchmark

Command required by the PRD:

```text
NODE_OPTIONS=--expose-gc pnpm --filter @threenative/physics exec tsx scripts/bench-allocations.ts
```

The benchmark contains 120 active/empty areas, 120 characters, and 120 kinematic/dynamic pairs.
The drained zero-GC result is not a claim that Rapier allocates zero. The complete measured wrapper
breakdown and JSON output are recorded in the lane-191-r2 addendum above; its auditable total is
`56,604,258`, including raw/public transform and collision vectors plus one raw shape wrapper per
measured Area3D query.

## Repository gates

- `pnpm typecheck` passed (exit 0).
- `pnpm lint` passed (exit 0); it reported 240 existing complexity warnings and no repair-file
  diagnostic.
- `pnpm test` passed (exit 0): 166 test files passed, 1 skipped; 1,590 tests passed, 3 skipped.

## Playtests

- Browser WebGPU command: `node packages/playtest/dist/runner/cli.js
  examples/native-smoke/playtests/physics.playtest.json --url http://127.0.0.1:5175
  --browser-recipe webgpu`. It reached the WebGPU scene and all physics assertions passed,
  including Area3D membership, enter/exit snapshots, grounding, and movement. The CLI returned
  exit 1 only for the known headless Linux Chromium `OperationError: Instance dropped in
  popErrorScope` console/page diagnostic (2 console/runtime diagnostics); the bounded error leaves
  the physics assertion results passing.
- Desktop native: `node packages/runtime-native/scripts/verify-desktop-physics.mjs` passed the
  actuation bindings proof, the desktop Area3D physics playtest with 14 assertions, and the native
  spatial-query proof.

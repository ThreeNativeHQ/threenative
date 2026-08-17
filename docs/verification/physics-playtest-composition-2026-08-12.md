# Physics playtest composition — 2026-08-12

Status: executed locally against repository commit `f9978b3` plus the PRD-081 working tree.
The generated platformer proves web behavior. Native evidence is limited to TypeScript ABI
contracts and the shipping Rust simulation; no desktop, Android, or iOS host was executed.

## Result

`rapier()` now contributes `runtime.physics` through a generic core observation registry and
emits the existing `{ label, snapshot, tick }` series. The generated platformer asserted a
real dynamic `RigidBody3D` crate after 240 fixed ticks and reported one sleeping body, zero
omitted bodies, and zero diagnostics. No generated bridge code was added.

The original Phase 0 blast radius was incomplete. Scenario labels existed only in the
playtest runners, and native physics had no truthful sleep-state read. Execution therefore
also changed the protocol/runners and added one bulk `[bodyId, sleeping]` ABI across the web
simulation, TypeScript native adapter, C ABI, C++ binding, and Rust simulation.

## Positive gates

| Gate | Result | Evidence |
| --- | --- | --- |
| `pnpm typecheck` | pass | root and all package typechecks exited 0 |
| `pnpm lint` | pass | exited 0 with 179 warn-level complexity diagnostics; two formatting errors were fixed, including one pre-existing native CPU profile test format |
| `pnpm test` | pass | exited 0; the root Vitest run reported 100 files and 835 tests passed, package builds/publint passed, native parity ran |
| `pnpm test:templates` | pass | minimal, starter, and platformer scaffolded playtests passed; `settled.crate` reported `sleeping: 1`, `omittedBodies: 0` |
| `pnpm budgets` | pass | 8,827/15,000 framework LOC; native remains above its review trigger at 68,631/50,000 LOC |
| `cargo test --manifest-path packages/runtime-native/native/physics/Cargo.toml` | pass | 4 Rust unit tests and 1 shipping parity test passed |
| producer/writer census and `git diff --check` | pass | `runtime.physics` has one producer in physics; `physicsDebugSeries` has a physics writer; no whitespace errors |

The native addition is 115 Rust/C++ lines plus a three-line header declaration. Its kill-switch
pass kept one coarse bulk typed-array call shared by all bodies; replacing it with per-object
calls would violate the native boundary, while omitting it would make native `settled`
semantics untruthful. The existing native LOC trigger was reported and not silenced.

## Negative controls observed red

| Control | Command/result |
| --- | --- |
| remove `rapier()` from a packaged platformer | headed `threenative-playtest --scenario playtests/physics.playtest.json ...` exited 2 with `TN_PLAYTEST_CAPABILITY_MISSING: runtime.physics` |
| freeze the contributed tick source | focused `playtest-capability.spec.ts` exited 1: expected ticks 1 then 2, received 1 then 1 |
| remove `omittedBodies` from the producer | focused overflow test exited 1: expected `{ bodyLimit: 100, omittedBodies: 1, totalBodies: 101 }` |
| hardcode `runtime.physics` in core | focused core boundary test exited 1 because the capability appeared without a contributor |
| ignore overflow during `settled` evaluation | focused runner test exited 1 because a partial 101-body snapshot falsely passed |

Every mutation was restored before the positive gates. The packaged positive control used the
same headed WebGPU recipe as `pnpm test:templates` and exited 0. Two earlier manual invocations
without `--headed` exited 1 with Chromium WebGPU buffer-allocation page errors; they were an
incorrect local recipe, not accepted evidence.

## Boundary and residual risk

Core already contained generic `rapier` version metadata for deterministic replay before this
PRD, so the proposal's absolute “no reference to Rapier” acceptance sentence was false at its
baseline. The executed boundary is narrower and testable: this change adds no physics term,
type, capability, or dependency to core; only the physics plugin names `runtime.physics`.

The producer retains at most 100 bodies and 100 labelled samples. Body overflow is explicit
and now makes `settled` fail closed; exceeding the labelled-sample bound throws. Disposed
bodies and areas purge retained contacts. Native sleep truth is covered by web/native contract
tests and Rust parity, but native host execution remains unverified and no device readiness is
claimed.

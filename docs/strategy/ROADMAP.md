# Roadmap

**Status:** proposal, 2026-08-02. **Charter authority:** `CHARTER.md` §7, §12.

Phases are gated, not scheduled. A phase does not start because the previous one ran
out of tasks; it starts because the previous one's gate passed.

## Phase 0 — shipped

Six PRDs merged, verified in `docs/verification/`:

| PRD | Delivered | Package |
|---|---|---|
| 001 | pnpm workspace, catalog, Biome, budgets script | — |
| 002 | Loop, scenes, `Ctx`, input, assets, renderer bootstrap, state store | `core` |
| 003 | `RigidBody3D`, `Area3D`, `CharacterBody3D`, `CollisionShape3D`, `rapier()` plugin | `physics` |
| 004 | `create-threenative`, `minimal` + `starter` templates, React UI | `create-threenative`, `ui` |
| 005 | Deterministic LOC classifier, sealed prompt, blind scoring protocol | — |
| 006 | `ctx.entities` registry, `DebugOverlay`, dev-only global | `core`, `ui` |

**Not shipped and load-bearing:** the mobile spikes. `CHARTER.md` §7 resolves the
*research* question (WASM Rapier is not viable; build the JSI binding) but neither
spike has run.

## Phase 1 — prove the runtime

**Gate to start:** nothing. This is the current phase.

1. **0a — rendering on device (~1 day).** Spinning cube via `three/webgpu` under
   `react-native-webgpu` on a physical phone. Answers whether Three.js's WebGPU path
   survives outside a browser at all (`document`, `HTMLCanvasElement`, `Image`, `fetch`,
   `TextDecoder`, `requestAnimationFrame` are all assumed by three and absent in RN).
2. **0b — physics on device (~1–2 weeks).** `@threenative/physics-native`: JSI binding
   to Rapier's Rust, enough to drop a cube on a plane.
3. **Resolve the benchmark.** `docs/benchmark/RESULTS-2026-08-02.md` is VOID. The next
   valid result must keep the sealed prompt hash and complete all six repeats.
4. **Four reference-game sweep subjects** from one codebase: `platformer`,
   `topdown-action`, `endless-runner`, and `exploration`. The first two have archived
   baseline sweeps; PRD-018 now has round-2 ledgers and archives for all four subjects.
   Each must survive the device matrix below before this item is complete.

**Device matrix, per reference game:** web · iOS · low-end Android · mid Android ·
high-end Android. Background/resume · rotation policy · audio interruption · touch ·
gamepad · device loss · memory after repeated level loads · React UI under load ·
asset-load failure · 30/60/120 Hz.

**Gate to exit:** `CHARTER.md` §12 criteria 1, 2 and 4 — Phase 0 runs on a phone, the
Abyss port is ≤400 lines and does not look worse than vanilla, framework source under
15,000 LOC.

**If 0a fails:** ThreeNative is a web framework and §7's mobile promise is deleted.
**If 0b fails:** mobile ships without physics, or not at all.

## Phase 2 — SDK, CLI and the migration funnel

**Gate to start:** Phase 1 exit gate green.

- Four CLI commands and no more: `dev`, `build`, `test`, `ship` (§10).
- Compatibility report as `test --doctor`, not a fifth command (CONFLICTS #2).
  Detects: DOM-only APIs, `ShaderMaterial`/raw GLSL, WebGL-only post passes, asset
  paths that break under Metro, oversized textures, draw-call counts, duplicate meshes
  and materials, missing disposal, unsupported loaders, version skew.
- Three excellent templates. Templates matter more than packages — they define what
  "good by default" means, and per `CHARTER.md` §9b **the scaffold is the documentation.**

**Gate to exit:** an existing third-party Three.js game runs `test --doctor`, follows
the report, and boots on a phone.

## Phase 3 — local Studio

**Gate to start:** `CHARTER.md` §12 criterion 3 — one game played by a stranger for five
minutes, with a transcript. v1 never did this once.

Grows out of what exists rather than replacing it: entity inspector (from
`Registry.snapshot()`), live profiler, AI patch history with rollback, scenario
recorder/replay (from `@threenative/playtest`), device launcher, local build management.

Users keep their own coding agent. There is no chat product to own yet.

## Phase 4 — Cloud

**Gate to start:** Phase 3 in daily use by design partners.

Hosted builds · signing · shareable previews · physical-device tests · store submission ·
crash and performance analytics · team collaboration. Orchestrate Expo/EAS first; do not
build a build farm.

## Phase 5 — creator experience

**Gate to start:** AI changes are reliably validated by the runtime — i.e. the numbers in
[METRICS.md](METRICS.md) for "patches that typecheck and pass their declared scenario"
are good enough that a non-developer is not stranded by a red run.

Game-brief wizard · genre templates · guided changes · visual scene editing · asset search ·
plain-language playtest results · one-click release prep. All built on the same tools the
agent interface already uses.

## Not on the roadmap

A foundation model · a Blender replacement · visual scripting · a multiplayer backend ·
console export · an open plugin marketplace · a second renderer with feature parity · a
universal app-store game player · blank-prompt generation without templates · support for
every Three.js example and add-on.

Each of those can absorb the entire company.

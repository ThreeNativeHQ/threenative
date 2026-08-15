# ThreeNative production readiness and the vanilla Three.js crossover

## Executive verdict

ThreeNative should not optimize for beating vanilla Three.js at producing the first toy in ten minutes. Vanilla has almost no imposed structure and should win that comparison.

ThreeNative wins when a game becomes real: physics, lifecycle, restart, persistence, multiple input methods, performance budgets, platform portability, asset processing, regression detection, and months of change. The product promise is therefore:

> Vanilla Three.js minimizes time to the first toy. ThreeNative minimizes time to a maintainable, performant, verified, cross-platform game.

That promise is credible, but not yet proven strongly enough to call ThreeNative a clear winner. The runtime structure, physics integration, templates, and playtest model are promising. The current blockers are golden-path reliability, fail-closed verification, demonstrated native parity, production performance evidence, and the gap between technically complete templates and player-facing quality.

This document defines what should improve before ThreeNative can make a production-level claim.

## Evidence from the Verdant Siege sandbox run

The run used an isolated sandbox, generated the shooter template, converted it into a first-person valley-defense game, built it, exercised gameplay, and captured a headed WebGPU frame.

What worked:

- The template provided a coherent game loop, input map, entities, state bridge, physics bodies and queries, waves, death, respawn, restart, and playtest events.
- `CharacterBody3D`, collision layers, direct-space physics queries, scheduled work, and observable game state removed real plumbing.
- Ordinary Three.js remained available for game-owned rendering: weapon geometry, targets, trees, mountains, materials, lighting, sky, and post-processing.
- Canonical TypeScript checking passed.
- Direct Vite production build passed.
- Generated behavioural scenarios exercised real death, respawn, lives, and game-over transitions.
- The final headed WebGPU capture rendered cleanly with no console or page errors.

What failed or created avoidable friction:

- `pnpm sandbox --help` did not provide a usable help path.
- The sandbox flow did not expose the shooter template cleanly; the generated scaffold command had to be edited.
- `threenative build --target web` failed with `TN_CONFIG_TRANSPILER_MISSING` even though Vite was installed and direct `vite build` succeeded.
- WebGPU capture was sensitive to exact Chromium arguments; one plausible SwiftShader argument produced a white canvas and repeated `popErrorScope` errors.
- A generated playtest returned `pass: true` while reporting 18 console errors and 18 runtime diagnostics. Even when environmental, unexplained runtime errors must not coexist with a green result.
- The shooter template was a strong behavioural fixture but not initially a credible FPS: elevated camera, visible player body, no foreground weapon, a friendly entity obstructing the spawn view, duplicated HUD presentation, and generic arena visuals.
- The run did not build or play a native target, so native portability remains unproven here.
- The run did not compare a separately executed vanilla implementation, so any vanilla comparison remains a counterfactual.

## Definition of production-ready

ThreeNative is production-ready when a competent team can ship and maintain a representative game without routinely escaping the framework, debugging the framework's own golden path, or accepting evidence weaker than the product claims.

The bar is not “the demo runs.” The bar is:

1. A fresh project can be created, developed, tested, and built on supported targets using documented commands.
2. Runtime, network, console, visual-capture, and behavioural failures fail closed by default.
3. The same gameplay contract is continuously exercised across web and native targets.
4. Lifecycle, disposal, restart, scheduled work, physics, and state remain deterministic under repeated transitions.
5. Performance budgets are measurable and regressions are attributed.
6. Asset acquisition, licensing, compilation, optimization, and runtime loading form one reproducible path.
7. Templates demonstrate player-facing quality as well as framework coverage.
8. Escape hatches are explicit, observable, and rare; ordinary Three.js remains the correct tool for game-owned rendering.

## P0 — make the foundation trustworthy

### 1. Make the golden path unbreakable

Required user journey:

```text
create -> dev -> test -> build web -> build desktop/native -> package
```

Required improvements:

- Make `--help` reliable for every public CLI command.
- Expose template and genre selection directly; never require editing generated shell scripts.
- Ensure project-resolved build dependencies are discovered consistently.
- Test all published commands from a clean temporary directory using packed packages, not workspace resolution.
- Emit actionable errors: failed prerequisite, searched locations, corrective command, and relevant documentation link.
- Keep generated instructions synchronized with templates actually shipped.

Acceptance gate:

- Every supported template completes the full golden path from clean packed artifacts in CI.
- No manifest edits, workspace symlinks, unpublished paths, or undocumented environment variables are required.
- A failed command identifies the failing layer instead of requiring source inspection.

### 2. Make verification fail closed

Verification is potentially ThreeNative's strongest advantage and therefore must be stricter than ordinary test tooling.

Required improvements:

- Any unexplained page error, console error, network failure, runtime diagnostic, unhandled rejection, or GPU validation error fails the scenario by default.
- Allow-listing must be explicit, narrow, versioned, and included in the report.
- Separate capture failure from render failure. A white or black WebGPU screenshot is not automatically a game failure, but it is never valid visual evidence.
- Store browser arguments, GPU adapter information, renderer kind, target, viewport, and capture method with every visual artifact.
- Require behavioural assertions and representative visual evidence when both gameplay and presentation are in scope.
- Make diagnostics assertions non-trivial: `18 errors` can never produce a green diagnostics row without an explicit expected-error contract.

Acceptance gate:

- Seeded negative fixtures prove that each diagnostic category turns a run red.
- The harness catches a deliberately introduced restart leak, stale scheduler callback, physics mismatch, network failure, and visual-capture failure.
- Reports cannot display contradictory `pass: true` and unexplained error counts.

### 3. Prove lifecycle and restart determinism

Required improvements:

- Define ownership and disposal contracts for scenes, entities, physics bodies, schedules, event subscriptions, audio voices, renderer resources, and UI bridges.
- Exercise repeated scene entry/exit, restart, death/respawn, pause/resume, hot reload, and application background/foreground cycles.
- Compare deterministic traces across repeated runs and supported targets.
- Detect leaked bodies, entities, callbacks, GPU resources, and listeners.

Acceptance gate:

- A long restart soak has stable entity/body/schedule/resource counts and identical seeded gameplay traces within explicitly documented tolerances.

## P1 — prove the reasons to choose ThreeNative

### 4. Demonstrate native parity continuously

A native build that compiles is not enough. The same game must remain the same game.

Required improvements:

- Run representative gameplay scenarios on web, desktop native, and at least one mobile target.
- Compare state transitions, collision outcomes, random traces, input semantics, asset availability, and representative frames.
- Document target-specific capability differences rather than hiding them behind nominal API compatibility.
- Make browser-only globals and `.raw` escape hatches visible in portability reports.

Acceptance gate:

- At least three non-trivial reference games complete equivalent gameplay scenarios across supported targets with no platform-specific gameplay branches unless explicitly justified.

### 5. Make performance advantages visible and enforceable

“Performance for free” must be a measurable product feature, not positioning.

Required improvements:

- Provide frame-time, CPU, GPU, draw-call, triangle, allocation, physics-step, and asset-memory instrumentation.
- Support performance budgets in playtests with warm-up rules and percentile reporting.
- Attribute regressions to systems and content where possible.
- Make batching, pooling, instancing, LOD, culling, texture compression, and native decode benefits observable.
- Publish representative web/native comparisons using identical scenes and gameplay traces.

Acceptance gate:

- Reference games have explicit device-tier budgets and fail CI on statistically meaningful regressions.
- Each automatic optimization demonstrates measured benefit and documents its escape hatch and failure mode.

### 6. Turn the asset MCP into a complete production pipeline

Asset search alone is not enough. The winning workflow is search to licensed, optimized, portable runtime asset.

Required improvements:

- Search, inspect source files, download, verify license, record attribution, compile, compress, generate LODs, preview, and import through one reproducible flow.
- Produce deterministic asset manifests with source, license, transformations, hashes, target variants, and attribution obligations.
- Validate assets against target budgets before runtime.
- Make missing native decoders and unsupported formats fail during build, not on device.

Acceptance gate:

- A fresh game can add a licensed model, texture set, animation, and audio asset through the documented MCP flow and build all supported targets without manual manifest surgery.

### 7. Make templates credible games, not only coverage fixtures

Each template must satisfy two independent bars:

- Technical: lifecycle, input, physics, state, restart, portability, proof.
- Player-facing: camera, controls, hierarchy, feedback, HUD, audio, visual coherence, and game feel.

Required improvements:

- Capture idle, active gameplay, success/failure, and narrow-viewport states for every template.
- Run blind visual review against a fixed rubric.
- Ensure genre names match player expectations. A shooter template should feel like a shooter before customization.
- Keep deterministic instrumentation without allowing debug fixtures to dominate the initial composition.
- Treat opening frame quality as a release gate, not decorative polish.

Acceptance gate:

- Every template is recognizably playable from its first frame, passes behavioural scenarios, and has no obvious camera obstruction, clipping, duplicate HUD, unreadable feedback, or placeholder presentation presented as finished quality.

## P2 — make the framework cheaper than accumulated engine code

### 8. Reduce ceremony through progressive disclosure

- Preserve simple defaults for common games.
- Introduce advanced contexts, platform differences, custom renderer access, and low-level physics only when needed.
- Define one obvious owner for loop, input, state, lifecycle, and disposal.
- Document escape hatches as supported boundaries, not shameful secrets.
- Do not wrap ordinary Three.js rendering merely to increase framework usage.
- Detect dead wrappers, duplicated state buses, parallel loops, and browser-only dependencies in audits.

### 9. Provide production operations, not only runtime primitives

Prioritize capabilities that become expensive after a prototype:

- Versioned save data and migrations
- Suspend/resume and mobile lifecycle correctness
- Controller, touch, keyboard, and accessibility input semantics
- Crash/error reports with gameplay and performance context
- Asset/version provenance in builds
- Reproducible release packaging
- Compatibility policy and upgrade tooling

Networking, ECS variants, visual scripting, and additional rendering wrappers should not outrank the golden path, verification correctness, native parity, or performance evidence unless a reference game proves they are the current bottleneck.

## The vanilla crossover benchmark

Do not compare only time to first frame. Execute both arms from clean directories and apply the same sequence of changes:

1. Produce the first playable game.
2. Add physics and multiple entity types.
3. Add death, restart, persistence, and another scene.
4. Add controller and mobile input.
5. Introduce and detect a seeded regression.
6. Increase world/entity/asset scale.
7. Build web and native targets.
8. Make a late architectural change.
9. Ship and reproduce a release artifact.

Measure at each step:

- Elapsed implementation and debugging time
- User-authored LOC and dependencies
- Platform-specific branches and escape hatches
- Defects introduced, detected automatically, and discovered manually
- Frame-time percentiles, memory, load time, and build size
- Restart/disposal stability
- Visual quality across representative states
- Evidence quality and reproducibility
- Time required for the next change, not only the initial build

A clear win means ThreeNative may trail at step one but overtakes vanilla as real-game requirements arrive, then keeps the lead without sacrificing visual freedom or forcing framework escapes.

## Release gates for the “clear winner” claim

Do not claim that ThreeNative is clearly better for production games until all are true:

- The packed-package golden path is green for every supported template and target.
- Verification fails closed and negative fixtures prove it.
- Representative games demonstrate behavioural and visual parity across web and native.
- Performance budgets and regression attribution run continuously.
- The asset MCP completes a licensed, optimized, target-valid import flow.
- Templates pass both technical and player-facing quality gates.
- At least one executed vanilla crossover benchmark shows where and why ThreeNative takes the lead.
- A substantial game survives repeated feature changes, restarts, upgrades, and release packaging without framework-owned instability.

## Recommended execution order

1. Stop expanding surface area long enough to fix CLI/build reliability and contradictory verification results.
2. Establish clean-package CI matrices and negative verification fixtures.
3. Select three reference games and prove web/native gameplay parity.
4. Add enforced performance budgets and lifecycle leak detection.
5. Complete the asset MCP-to-runtime pipeline.
6. Raise template presentation and game-feel quality.
7. Execute the staged vanilla crossover benchmark and publish the evidence, including losses.

## Non-goals

- Do not optimize for winning a ten-minute toy benchmark.
- Do not claim visual superiority merely because the framework hosts Three.js rendering.
- Do not reward abstraction count or imports.
- Do not hide unsupported native behaviour behind successful compilation.
- Do not allow green reports with unexplained diagnostics.
- Do not add framework wrappers where ordinary Three.js is already the simpler, portable, game-owned solution.

The product becomes a clear winner when developers stop thinking about these systems because ThreeNative handles them correctly—and the evidence proves it—while they retain the freedom and familiarity of Three.js for the game itself.

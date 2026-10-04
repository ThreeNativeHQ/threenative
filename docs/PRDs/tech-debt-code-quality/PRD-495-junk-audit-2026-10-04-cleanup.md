---
prd_contract: v1
---

# PRD-495 — junk-audit 2026-10-04: every finding dispositioned

**Status:** PARTIAL — all three phases executed; one box open because `pnpm test` is red on a shared box (exact cause below)
**Complexity:** 5 → MEDIUM (3 for 11+ implementation files, +2 for touching two independent
build boundaries — the scaffolder's pinned scaffold-tree hashes and the runtime-native
CMake/Android source sets; every item is a deletion, a comment fix or a doc pointer, so risk
is mechanical).
**Owner:** João
**Depends on:** none
**Task:** branch `chore/junk-cleanup-2026-10-04`, worktree `.worktrees/junk-cleanup`, base
`origin/develop` at `f24f6243e`. The audit input `junk-audit-2026-10-04.md` stays untracked.

## Context

`junk-audit-2026-10-04.md` (90 findings, five appendices, read-only arms) claims ~575 lines in
`packages/core`, ~480 in physics/ui/playtest/assets, 1,635 safe-now tracked lines in
`runtime-native` + small packages, ~379 in templates/examples and ~2 MB + ~2,900 lines in
docs/scripts. It reaches no published npm tarball; the cost is clone weight, agent friction
in generated templates, and misleading surface.

This PRD dispositions **all 90** findings — deleting what is provably dead, and recording why
the rest stay. Nothing here changes behaviour: every executed item is a zero-reader deletion,
a stale comment, or a doc pointer, and no gameplay/render value moves.

## Solution

Execute every finding whose only tracked references are its own definition or a comment that
contradicts the code — the **73 changes** listed under `### Executed` below, counted from the diff
itself. Retain the rest with a named reason (`### Retained`, one row per group; several rows cover
more than one numbered audit finding, so they carry no count). Defer the duplicate-helper refactors
that touch live code for a ~21-line net win, leaving them to
[PRD-208](./PRD-208-tier-four-hygiene-sweep.md), which already owns single-sourcing debt.

## Acceptance Criteria

- [x] AC-1 [local]: `packages/core` reports zero unused-local and zero unused-parameter diagnostics. The 24-diagnostic baseline is the audit input's measurement, not one re-taken here. proof: `cd packages/core && ../../node_modules/.bin/tsc --noEmit --noUnusedLocals --noUnusedParameters -p tsconfig.json` — Evidence: exit 0, empty output.
- [ ] AC-2 [local]: every removed engine/template/example symbol has no remaining tracked reader, proven by the workspace typecheck and unit suite over the changed snapshot. proof:  `pnpm typecheck && pnpm lint && pnpm test` — Evidence: typecheck 0, lint 0; `pnpm test` exit 1 on five scaffolder-spec **timeouts** under a shared-box load of 55–70/24 cores, the same specs green alone (4 files / 93 tests, exit 0, 205s). Open until one clean `pnpm test` is recorded.
- [x] AC-3 [local]: the scaffolder still ships every template its contract specs name, with the pinned scaffold-tree hashes restamped for exactly the templates that changed (10 of 13; `platformer`, `snow`, `starter` unchanged). proof:  `pnpm --filter @threenative/create-threenative test` — Evidence: green in the workspace suite; the four affected specs alone: 4 files / 93 tests, exit 0, 205s.
- [x] AC-4 [local]: the runtime-native contract and source-list gates stay green after the never-packaged Android sample JS and the orphan Metal shader go. proof:  `pnpm --filter @threenative/runtime-native test` — Evidence: exit 0 — 134 files / 1548 tests passed, 62 skipped; Rust physics parity 21 + 2; publint clean. Required a compiled host first (`pnpm native:build` exit 0); every pre-build failure was an `is not built` assertion, and no C++ source or JS-engine file this PRD touches appears in any of them.
- [x] AC-5 [local]: documentation links and primary-doc command names stay resolvable after the stale round-ledger pointers are corrected. proof:  `pnpm check:docs && pnpm exec vitest run scripts/__tests__/check-doc-links.spec.ts scripts/__tests__/primary-docs.spec.ts` — Evidence: `pnpm check:docs` exit 0 — "Checked 2323 relative documentation links across 1216 Markdown files"; both specs pass inside the green `scripts/__tests__` lane (143 files / 1944 tests, exit 0).
- [x] AC-6 [local]: `examples/abyss-framework` no longer dirties the tree with a committed build report. proof: `pnpm --filter abyss-framework build` then `git check-ignore -v examples/abyss-framework/dist.build-report.json` — Evidence: build exit 0 (it rewrites the report on disk), `git check-ignore` reports `.gitignore:8:*.build-report.json`, and `git status --porcelain examples/abyss-framework` after the build lists only this lane's three staged deletions.

## Verification notes

- The native host was built locally to run AC-4 (`packages/runtime-native/build/` and `.runtime/`
  are gitignored build output, ~10 min for the deps + compile). Nothing tracked changed for it.
- The four scaffolder specs in the open box above are the only red in this lane, and they are red
  on wall-clock, not on an assertion.

## Blocked on

- Owner calls on six decide-first items — `packages/core/scripts/vsm-proof/` (466 lines), the
  `runtime-native` native-glTF C++ island (622 lines), `conformance/scenes/shared/spectral-ocean.js`
  (217 lines), the `castDistance` shim in `world-cells.ts` (PRD-458 ties it to an external
  consumer), the four orphan docs, and the ~18.5 GB untracked disk. Unblocked by João — until he
  rules, each stays under the 2026-10-04 working assumption recorded in `## Decisions`.
- `examples/native-smoke`'s uncalled `parseHttpsUrl` is a game-layer defect, not junk; wiring it
  changes example behaviour, so it is reported, not fixed here. Unblocked by a decision to fix it.

## Integration Ledger

Integration: unchanged — no consumer path, CLI form, render stage, capability-manifest entry or
scenario changes. Deleted symbols have zero tracked readers; the one consumer-visible effect is
that generated projects stop shipping template files nothing imports. The scaffolder's
`PRD_201_PARENT_SCAFFOLD_HASHES` is the only pinned expectation that must move, and it moves to
the new measured bytes of the templates this PRD touches.

## Decisions

- 2026-10-04 (**working assumption, pending owner reply — not an owner decision**): retain every
  decide-first item and all untracked disk; keep tested interfaces even when only a spec reads them;
  keep `parseHttpsUrl`'s validation and report the defect instead of adding a runtime change here.
  João was never asked to choose this default. It is the conservative reading of the audit and each
  retained item is reversible on its own, so the sweep proceeds on it instead of stalling; the items
  it covers stay listed in `## Verification notes

- The native host was built locally to run AC-4 (`packages/runtime-native/build/` and `.runtime/`
  are gitignored build output, ~10 min for the deps + compile). Nothing tracked changed for it.
- The four scaffolder specs in the open box above are the only red in this lane, and they are red
  on wall-clock, not on an assertion.

## Blocked on` until the owner rules on them.
- 2026-10-04 (this PRD): a published barrel re-export (`assets` `WRAP_REPEAT`,
  `WRAP_MIRRORED_REPEAT`) is a public contract, not dead code, even with no in-repo reader.
- 2026-10-04 (this PRD): `stamp:template-loading` stays: the audit called it a duplicate entry
  point, but the function it wraps is called from nothing else, so deleting it removes a capability.
- 2026-10-04 (this PRD): `core/__tests__/seed.spec.ts` stays: it is the only assertion that a
  different seed diverges, which the 1,000-draw equality test cannot see.
- 2026-10-04 (this PRD): the two playtest compat facades (`src/assertions.ts`,
  `src/evaluators/helpers.ts`) are still imported by 10 modules, so they are live re-export
  surfaces, not dead files; collapsing them is a refactor with a ~35-line win, not junk removal.
- 2026-10-04 (review correction, parent): audit finding 29 (`examples/quarry/src/game.ts`, the
  unreferenced `QuarryScene` class-expression name) is **not** executed. The first pass inlined it;
  parent review reverted that, because `Constructor.name` is what scene diagnostics print and a class
  name that names its scene is diagnostic value, while dropping one identifier cleans up nothing.
  The finding moves to `### Retained`.

## Disposition — every finding

### Executed (73 changes, counted from the diff)

| Area | Deleted | Count |
| --- | --- | --- |
| core (A) | `IBackendDataLike`, `IRenderObjectContext` (pipeline-census); `#presentsUnreadable` and its two writes (frame-budget); `#groundSpeedOf` (animation); `#random` and its two writes (softbody); `members` (geometry-capture); `#renderer` with its write/clear, `attachRenderer`'s parameter now `_renderer` (gpu-scene-bvh); `colorValueOf` (projection-uniform); `BATCHED_PREVIOUS_MATRICES_PROPERTY` (render/batched-velocity); `WebGLRendererContract` (renderer); `ObserverConstructor` (ui-hit-regions); `Spans`' `forEach` id parameter → `_id` (playtest) and `#attribute`'s `id` parameter (profiling/Spans); `evictGeometryMembers`' `workspace` parameter (projection-plan); `#sharedFor`/`#disableFar`/`#restoreFar` `cell` parameters (world-gpu-scene); unused imports `IAssetLoader`, `zenithTransmittance`, `nodeObject`, `float`, `vec4`, `Box3`, `Matrix3`; an unused loop index over `regions.entries()` (world-tiles); 2 `eslint-disable-next-line no-console` in a Biome repo (`__tests__/world-tiles-cost.spec.ts`); the false "engine-server.mjs is gitignored" comment (mcp/blender.mjs) | 24 |
| physics / ui / playtest / assets (B) | `packages/physics/scripts/bench-allocations.ts`, `renderChainAssertionIsMeaningful` (playtest evaluators), `MIN_QUALITY` and `MAX_QUALITY` (assets audio-pcm), the `allowedXvfbRunMentions` entry naming the deleted analysis script (playtest `__tests__/display-advice.spec.ts`) | 5 |
| runtime-native + small (C) | `android/.../assets/scripts/{gltf-viewer,glb-parser}.js` (Gradle replaces the asset source set), `src/raytracing/shaders/raytracing.metal` (`metal_rt.mm` embeds its own copy and no CMake rule names it), 3 module-only `export` keywords across `raw-unreal/{bulk-source-model,raw-mesh}.ts` | 4 |
| templates (D) | the shooter's `SCALE_EXPECTATIONS`/`SizeCheck`/`SizeAxis`/`DOOR_HEIGHT` scale-audit table and its false `tools/scale-audit.mjs` pointer, `swallowtail`, `hoardingGeometry`, `pointOnTrack`, `curbBlock`, `vanFootprint`, `halfWithMirrors`, `RainIntent` (+ its `VISIBILITY_INTENT` import), `LOS_INTERVAL_SECONDS`+`losStagger` and their false comments, `_repair`, `padAt`, `aimBasis`, `MUZZLE_HEIGHT`, `scratchAxisY`, `TRACK_LAYER`, `clearProgress`, the unused `unwatch` binding, `rain/tools/verify-noise-volume.mjs`, the file `minimal/src/scenes/Boot.ts` | 20 |
| examples (D) | `abyss-framework/src/entities/{Crate,Player}.ts`, the committed `abyss-framework/dist.build-report.json` (+ `*.build-report.json` in `.gitignore`), `reparentHome` (native-cpu-load-test), `ROUTE_WARMUP_FRAMES`, `ROUTE_LENGTH_METRES`, `RouteMark` (quarry), `FIRE_SPRITE_TEXTURE` (vfx-gallery) | 9 |
| docs / scripts (E) | `docs/product/{ThreeNative_Lean_Product_Playbook_Report,ThreeNative_Product_Playbook}.pdf`, the duplicate `plans/technical-debt-audit-2026-08-20.md`, `analyze-prd-exp-002.mjs`, `analyze-prd-075-render-advisor.mjs`, `ICitationScan` (evidence-citations), `GATE_HEARTBEAT_INTERVAL_MS` and `writeGateStatus` (gate-status), `RoundDisposition` (round-ledger), `RealismEffectsExport`/`RealismEffectsPlatform` (realism-effects-coverage), 2 stale round-ledger pointers in `docs/README.md` | 11 |

### Retained

| Finding | Reason |
| --- | --- |
| A1 `packages/core/scripts/vsm-proof/` | owner call; it is the proof harness for a live feature and a publish gate asserts it stays unpublished |
| A3 `core/__tests__/seed.spec.ts` | not a duplicate after all: `random.spec.ts` proves a repeat seed matches, only this file proves a *different* seed diverges, which a seeded RNG ignoring its seed would pass |
| A9 `IMPOSTOR_SURFACE_PARALLAX` | a tested interface, not dead code |
| A24 `castDistance` shim | PRD-458 keeps it until the external `machinefall` consumer drops it |
| A25 19 export-only-for-tests symbols | each is read by a spec; un-exporting them is an interface change, not a deletion |
| B4 `WRAP_REPEAT`/`WRAP_MIRRORED_REPEAT` | published barrel re-exports of the `assets` package |
| B5 `playtest/src/assertions.ts`, B6 `evaluators/helpers.ts` | live compat facades, still imported by 10 modules |
| C1 `packages/*.tgz`, C2 native-glTF island, C4 `spectral-ocean.js` | owner decision (see `## Verification notes

- The native host was built locally to run AC-4 (`packages/runtime-native/build/` and `.runtime/`
  are gitignored build output, ~10 min for the deps + compile). Nothing tracked changed for it.
- The four scaffolder specs in the open box above are the only red in this lane, and they are red
  on wall-clock, not on an assertion.

## Blocked on`) |
| D7 `parseHttpsUrl` | a real defect in an example: keep the validation, report the missing call |
| D29 `QuarryScene` class-expression name | restored on parent review: `Constructor.name` reaches scene diagnostics, so the name is diagnostic surface, not dead weight |
| E6–E9 four orphan docs | only the inbound link is provably missing; the content is a deliberate record |
| E16–E22 untracked disk (`packages/*.tgz`, `release-native/`, `artifacts/`, `.linchpin/`, `notify.log`, `site/`, `test-results/`) | this lane deletes no local disk; untracked and gitignored, no repo effect |
| E23 `stamp:template-loading` | not unreachable junk, and not deleted: `restampTemplateLoadingCopies` has no other caller in the tree, so this entry point is the only way to apply a canonical `loading.ts` change to the tracked templates — the exact role its sibling `stamp:template-render.ts` plays for shared render sources, and that sibling is itself a contract-tested input (`scripts/__tests__/ci-template-selection.spec.ts`). The audit's premise ("manual-only duplicate entry point") holds only if the function it wraps is reachable some other way; it is not |

### Deferred (4)

`isRecord` ×3, `isObject` ×3, `now()` ×5 and `fail()` ×2 in `packages/core/src` are duplication,
not dead code: every copy has live callers, so collapsing them rewrites live modules for ~21
net lines. PRD-208 owns that single-sourcing debt; `isRecord` ×6 in `scripts/` is already its item.

## Execution Phases

#### Phase 1: engine layer

**Status:** DONE — both boxes green.
**Files:** `packages/core/{src,__tests__,mcp}`, `packages/physics/scripts`, `packages/playtest/{src,__tests__}`, `packages/assets/src`, `packages/raw-unreal/src`, `packages/runtime-native/{android,src}`
**Implementation:** remove the compiler-proven unused declarations and their now-unused
arguments; delete the never-packaged Android sample JS and the orphan Metal shader; drop three
module-only `export` keywords; fix the one stale comment.
**Verification:** AC-1, AC-2, AC-4 — `tsc --noUnusedLocals --noUnusedParameters` on core, then
`pnpm --filter @threenative/runtime-native test` and the workspace gates.
- [x] `packages/core` unused-local and unused-parameter diagnostics reach 0. The 24-diagnostic baseline is the audit input's own measurement (`junk-audit-2026-10-04.md:7`), not re-measured here. proof: `cd packages/core && ../../node_modules/.bin/tsc --noEmit --noUnusedLocals --noUnusedParameters -p tsconfig.json` — Evidence: exit 0, no output at all.
- [x] runtime-native source-list and contract gates stay green without the Android sample JS and the orphan shader. proof: `pnpm --filter @threenative/runtime-native test` — Evidence: exit 0 — 134 files / 1548 tests passed, 62 skipped; Rust physics parity 21 + 2 passed; publint clean. Reaching it needed the compiled host the failures name: `pnpm native:build` exit 0, then `cmake --build build/tn-linux --target threenative-canvas2d-dirty-test threenative-crash-handler-policy-test threenative-timestamp-query-test threenative-rg11b10-renderable-test`, plus the on-demand `tn-linux-quickjs` arm (`cmake --preset tn-linux -B build/tn-linux-quickjs -DMYSTRAL_USE_QUICKJS=ON -DMYSTRAL_USE_V8=OFF`) and its two test targets. Before those builds every one of the failures was an `is not built` assertion on a missing executable; none touched C++ sources or the JS engine, and none referenced a file this PRD deletes.

#### Phase 2: game layer (templates and examples)

**Status:** DONE except the workspace-gate box, which is open on timeouts alone (see below).
**Files:** `packages/create-threenative/templates/{shooter,sailing,racing,rain,action-rpg,rts,tower-defense,runner,puzzle,minimal}`, `examples/{abyss-framework,quarry,native-cpu-load-test,vfx-gallery}`
**Implementation:** delete each zero-reader helper with its doc comment, drop the false
`LOS_INTERVAL_SECONDS`/`losStagger` comments, delete `minimal/src/scenes/Boot.ts`, remove
`abyss-framework/dist.build-report.json` and gitignore it, and restamp
`PRD_201_PARENT_SCAFFOLD_HASHES` for exactly the templates whose bytes moved (10 of 13;
`platformer`, `snow` and `starter` keep their values).
**Verification:** AC-2, AC-3, AC-6 — the scaffolder contract specs, the workspace gates, and the
example build.
- [x] The scaffolder's template contract specs pass with the hashes restamped for the 10 changed templates. proof: `pnpm --filter @threenative/create-threenative test` — Evidence: green inside the workspace suite; the four scaffolder specs the restamp touches (`scaffold`, `template-assets-compile-1`, `template-assets-compile-2`, `template`) re-run on their own: 4 files / 93 tests, exit 0, 205s.
- [ ] The workspace typecheck, lint and unit suite stay green over the deleted helpers. proof: `pnpm typecheck && pnpm lint && pnpm test` — Evidence: `pnpm typecheck` exit 0; `pnpm lint` exit 0 (1074 warnings); `pnpm test` **exit 1** — its `package-test` phase is wholly green (runtime-native 134 files / 1548 tests + Rust parity 21 + 2 + publint, every other package green) and its unit phase is 7932 passed / 13 skipped / **5 failed**, all five `Test timed out` (60s, 60s, 60s, 180s, 180s) in `template-assets-compile-1`, `template-assets-compile-2` and `template.spec.ts`. These are the three heaviest specs in the repo (each scaffolds, installs and builds every template) and this box is shared with other agents' worktrees — load average 55–70 on 24 cores during the run. Run alone, the same four files are green: 4 files / 93 tests, exit 0, 205s. Left unticked because the gate as written ran red; nothing in it is a behavioural failure and nothing here can be re-run quieter.
- [x] `examples/abyss-framework` no longer dirties the tree on build. proof: `pnpm --filter abyss-framework build` then `git check-ignore -v examples/abyss-framework/dist.build-report.json` — Evidence: build exit 0 and rewrites the report; `git check-ignore` → `.gitignore:8:*.build-report.json`; `git status --porcelain examples/abyss-framework` after the build lists only this lane's three staged deletions.

#### Phase 3: repo surface (docs and scripts)

**Status:** DONE — deleted and re-pointed; both boxes green.
**Files:** `docs/product/*.pdf`, `plans/technical-debt-audit-2026-08-20.md`, `docs/README.md`, `scripts/{analyze-prd-exp-002,analyze-prd-075-render-advisor}.mjs`, `scripts/{gate-status,evidence-citations,round-ledger,realism-effects-coverage}.ts`, `packages/playtest/__tests__/display-advice.spec.ts`
**Implementation:** delete the unreferenced PDFs, the duplicate audit and the two unreachable
analysis scripts; drop the five dead exports; correct the two stale round-ledger pointers.
`scripts/stamp-template-loading.ts` and its `package.json` entry point are **kept** — see the E23
row under `### Retained` and the 2026-10-04 decision: the wrapped function has no other caller, so
removing the entry point removes the capability rather than a duplicate of it.
**Verification:** AC-2, AC-5 — the docs lane plus the script specs.
- [x] Doc links and primary-doc command names stay resolvable after the pointer fix and the deletions. proof: `pnpm check:docs && pnpm exec vitest run scripts/__tests__/check-doc-links.spec.ts scripts/__tests__/primary-docs.spec.ts` — Evidence: `pnpm check:docs` exit 0, "Checked 2323 relative documentation links across 1216 Markdown files"; the two named specs pass inside the `scripts/__tests__` run below.
- [x] The scripts lane stays green after the two analysis scripts and five dead exports go. proof: `pnpm exec vitest run scripts/__tests__` — Evidence: 143 files, 1944 tests, exit 0 (142 files green in the lane run + `fluid-collision-view.spec.ts`, which failed there only because it was run concurrently with the suite's own `build` phase and `@threenative/core/dist` was mid-rewrite; re-run alone, exit 0, 1 test).
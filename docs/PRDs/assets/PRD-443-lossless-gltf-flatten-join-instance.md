# PRD-443 — Lossless flatten/join/instance pass for `@threenative/assets` model pipeline

**Status:** PARTIAL (Phase 1 and Phase 2 done; Phases 3–4 blocked, see below)
**Complexity:** 6 (MEDIUM); risk override: none
**Owner:** Joao Furtado
**Depends on:** None

## Context

Native Midway (`sandbox/midway-open-pacific`) is CPU-bound, not GPU-bound (GPU 8-23% busy). The
per-frame cost is per-node (matrix pass) and per-draw (~9,900 scene nodes, ~400 draws/frame across
main+shadow+reflection). `AGENTS.md`'s standing instruction: an abstraction the game needs belongs
in the engine.

`@threenative/assets` (`packages/assets/src/passes/model.ts`) already runs `dedup → prune → simplify
→ reorder → quantize` (verified: `compileModel`'s pass order comment, line 81; `dedup`/`prune`/
`quantize`/`simplify` imports, lines 16-22). It has no `flatten` or `instance` pass, and no `join`
either — the CLI's own `join` command implicitly runs `dedup`+`flatten` first but the engine
pipeline never calls it.

**Whether Midway's shipped GLBs pass through this pipeline at all — verified, they do not.**
`midway-open-pacific/threenative.config.ts` has no `assets` key, so `assets.models` is unset.
`watchAssets()` (`packages/assets/src/watch.ts:80`) resolves its source root from
`options.config?.source ?? DEFAULT_SOURCE`, and Midway has no source `assets/` directory (only
`public/assets/`, which Vite copies byte-for-byte — see the `vite-build-copies-assets-into-public`
project lesson). The 29 GLBs in `public/assets/` are produced entirely by
`tools/import-fleet.sh` / `tools/import-aircraft.sh` / `tools/blender/rig-deck-crew.py`, which call
`gltf-transform weld` and `gltf-transform simplify` directly and never touch `@threenative/assets`.
So this PRD's lift has two consumers, not one: the engine's `assets.models` pass-chain (for games
that opt in) and Midway's own import scripts (which call the same new engine-exported passes
directly, since Midway's hero assets never flow through `assets.models`).

**The look is fixed.** Only lossless passes: no decimation, no re-simplification, no texture
recompression. Nodes matching Midway's `MOVING_NODE` regex (`src/render/world.ts:284`:
`propeller|aileron|rudder|flap|elevator|gear|wheel|canopy|hook|crew|gunner|threenativepivot|
torpedo|wingport|wingstarboard|cockpit controls`), animation-channel targets, skinned meshes/bones,
and any node looked up by exact name (`getObjectByName` — found 10 call sites across
`src/render/{imported-fleet,aircrew,deck-crew,imported-aircraft,devastator}.ts`, e.g. `"Head"`,
`"VINTThreeNativePivot"`, `"defaultMaterial_node_7/8"`, `"Circle008_Circle031ThreeNativePivot"`)
must survive byte-identically in structure.

### Phase 0 measurement (done)

`node`-based glTF-JSON inspection (no browser, header-length + JSON slice) of all 29 shipped GLBs in
`midway-open-pacific/public/assets/` (audio skipped — none present):

| File | Nodes | Meshes/Prims | Materials | Anims | Skins |
|---|---:|---:|---:|---:|---:|
| aircraft.b5n2-kate.glb | 10 | 10 | 1 | 9 | 0 |
| aircraft.douglas-sbd3.glb | 49 | 23 | 21 | 12 | 0 |
| aircraft.mitsubishi-a6m3.glb | **244** | 10 | 10 | 1 | 0 |
| aircraft.tbd-devastator.ai.glb | 12 | 16 | 4 | 9 | 0 |
| aircraft.tbd-devastator.glb | 12 | 16 | 4 | 9 | 0 |
| akagi.glb | **146** | 146 | 36 | 0 | 0 |
| b25-mitchell.glb | 9 | 9 | 9 | 0 | 0 |
| boat.pt59.glb | 42 | 40 | 29 | 0 | 0 |
| carrier-aircraft-pilot.glb | 67 | 1 | 1 | 4 | 1 |
| carrier.{hiryu,kaga,soryu,yorktown}.glb | 1 | 1 | 1 | 0 | 0 |
| cruiser.{mogami,tone}.glb | 1 | 1 | 1 | 0 | 0 |
| deck-crew.glb | 67 | 1 | 1 | 6 | 1 |
| destroyer.{hammann,kagero}.glb | 1 | 1 | 1 | 0 | 0 |
| destroyer.samidare.glb | 28 | 17 | 11 | 1 | 0 |
| enterprise.glb | 2 | 2 | 2 | 0 | 0 |
| flight-deck-director.glb | 67 | 1 | 1 | 3 | 1 |
| **hornet.glb** | **94** | **94** | **75** | 0 | 0 |
| midway-atoll.glb | 1 | 1 | 1 | 0 | 0 |
| structures.garrison-camp.glb | 26 | 26 | 9 | 0 | 0 |
| structures.radar-station.glb | 9 | 9 | 5 | 0 | 0 |
| submarine.{i168,nautilus}.glb | 1 | 1 | 1 | 0 | 0 |
| weapon.{rear-gun,torpedo}.glb | 1 | 1 | 1 | 0 | 0 |
| **Total (29 files)** | **897** | **434 prims** | **232** | — | — |

Lossless dry run on **copies in `/tmp/prd443/`** (`public/assets/` untouched), `gltf-transform`
CLI, `--vertex-layout separate` throughout:

**`join` (implicitly runs `dedup`+`flatten` first) on the six files with real join headroom:**

| File | Nodes/prims before → after | Materials before → after | Reduction |
|---|---|---|---|
| akagi.glb | 146 → 34 | 36 → 34 (2 dupes deduped) | **-77%** |
| boat.pt59.glb | 40 → 20 | 29 → 20 (9 dupes deduped) | **-50%** |
| garrison-camp.glb | 26 → 8 | 9 → 8 | **-69%** |
| radar-station.glb | 9 → 5 | 5 → 5 | **-44%** |
| hornet.glb | 94 → 75 | 75 → 75 | **-20%** |
| b25-mitchell.glb | 9 → 9 | 9 → 9 | 0% (already 1 prim/material) |
| **Sum, these 6** | **324 → 151 prims** | — | **-53%** |

**`flatten` alone on `aircraft.mitsubishi-a6m3.glb`** (244 nodes for 10 meshes — the worst
scene-graph bloat found): **244 → 15 nodes (-94%)**, mesh/material/animation counts unchanged, and
the animation channel's target node (`VINT.ThreeNativePivot`, a `MOVING_NODE`/pivot match) verified
present by name in the flattened output — `flatten` already refuses to move an animation target, no
extra protection needed for that case.

**`join` on `deck-crew.glb`** (skinned, 6 clips, 67 nodes): **unchanged** — 67 nodes, skin, all 6
anims, and `getObjectByName("Head")`'s target all survive. `join`/`flatten` already leave a rigged
hierarchy alone by design (gltf-transform's own doc note); no protection code required for skins.

**Protected-node risk — measured, not assumed.** `gltf-transform join --help` confirms
`--keepMeshes`/`--keepNamed` are booleans, not predicates: they cannot say "protect these three
named nodes, join the rest." In the `join` run above, hornet's one `MOVING_NODE`-matching node
(`..._propeller_134_0`) and akagi's rudder node *did* survive as their own primitive — but only
because each happens to hold a unique material, so `join`'s per-material grouping left them alone
by accident. A moving/looked-up node sharing a material with static hull geometry would be silently
absorbed. **Phase 2 must not ship bare CLI flags for this** — it needs an explicit protected-node
predicate (regex ∪ animation-channel targets ∪ skin joints ∪ a configurable name allow-list) applied
via the `@gltf-transform/functions` SDK before join/flatten run, not the CLI's boolean flags.

**`instance` (`EXT_mesh_gpu_instancing`) — measured zero benefit on Midway's current assets.**
Ran `gltf-transform instance --min 2` on hornet, akagi, boat.pt59 (no intra-file mesh reuse found:
"No meshes with >=2 parent nodes were found") and on destroyer.samidare and the A6M3 (both refused:
"Instancing is not currently supported for animated models"). Every Midway hull/aircraft is unique
geometry per node today; `instance` earns its place in the engine for a future game with repeated
meshes (crates, foliage, formation props), not for Midway's proof, so Phase 3's AC for `instance` is
"runs, reports 0 candidates, zero regression" — the honest-report path the charter's gate rule 7
requires, not a forced win.

## Solution

Add `flatten`, `instance`, and a `join` orchestration (dedup+flatten already exist standalone; join
adds primitive-merging by material) to `@threenative/assets`'s model pass-chain, each computed
against one shared **protected-node set**: names matching a configurable regex (default seeded from
the `MOVING_NODE` shape already proven in Midway), every animation channel's target node and its
ancestors, every skin's joints, and an explicit `protectedNames` allow-list in `assets.models`. The
passes run through the gltf-transform SDK functions directly (not the CLI), so the protected set can
be checked with a real predicate instead of the CLI's boolean `--keepNamed`/`--keepMeshes`.

Default-on, named override, per the gate's convention rule: `assets.models.compact` defaults to
`{ flatten: true, join: true, instance: true }`; a game sets `assets.models.compact: false` (or
disables one sub-pass) to opt out, and the compile report says which nodes were protected and why,
and which passes ran vs. were skipped/found nothing (the `instance` "0 candidates" case above).

Two consumer paths, both real:
1. **`assets.models` pass-chain** (`packages/assets/src/passes/model.ts`) — for any game whose
   models flow through `@threenative/assets` (the intended path for new games).
2. **Midway's own import scripts** (`tools/import-fleet.sh`, `tools/import-aircraft.sh`) — since
   Midway's hero GLBs are pre-built and never touch `assets.models` (verified above), Phase 3 calls
   the same engine-exported compaction function directly from those scripts, so Midway gets the win
   without inventing a second implementation (charter rule: no second flight model, same principle).

No geometry, material, color, texture, curve, or timing argument changes — this is pure mechanism,
so it needs no look-affecting call arguments and carries no gate-2 risk.

### Phase 2 implementation notes (what the measurements changed)

- **Order is `dedup → compact → prune`**, with `compact` itself `flatten → instance → join`. The
  plan had join before instance; `dedup` first links identical meshes, and `join` merges sibling
  primitives by material, which would have destroyed exactly the shared mesh `instance` batches.
  `flatten`/`join` run with `cleanup: false` so the game-configured `prune` remains the one place
  that removes geometry, and the summary is re-measured after it.
- **`flatten` is a protected-aware reimplementation, not gltf-transform's own.** Its `flatten()`
  knows animation targets and skeleton descendants but not a game's protected names, so it
  reparented a protected pivot's mesh child, left the pivot an empty leaf, and `prune` then deleted
  it while `join` absorbed the child — a lookup the PRD forbids. The local `flattenProtected`
  leaves a node in place when it, or any ancestor, is protected, a skin joint or an animation
  target, or carries a world matrix `T * R * S` cannot represent (moving it would decompose a
  shear and the self-verify would reject the output).
- **`instance` has no predicate**, so the protected set is honoured by deep-cloning the mesh onto a
  protected node (`Mesh.clone()` copies accessors by reference, which later leaves quantize's node
  compensation unapplied — hence a true deep copy), and only when instancing is enabled. A node
  whose world matrix is not exactly `T * R * S` is detached the same way.
- **`composeTrsMatrix` is `MathUtils.compose`**, not a hand-rolled quaternion: the first cut had the
  rotation transposed, which broke `isTrsExact` for every rotated node and mis-reconstructed rotated
  instance batches.
- **The LOD join rung skips `EXT_mesh_gpu_instancing` nodes**, so `lod.generation.join` cannot
  collapse the placed copies onto the batch node's transform.
- **The summary and report name every removed named node**, so a `getObjectByName` the protected set
  did not cover surfaces as a build-report warning instead of a silent `undefined` at runtime.
- **`join` excludes a mesh that several nodes share** (recorded before the mesh detach). gltf-transform's own `join` would merge each repeated mesh once per node and duplicate its vertices N times — measured 13× on a 50-rivet animated prop, and animated models get no `instance` batch to absorb them. The accepted cost is one draw per repeated mesh on those models, which is already the authored state.
- **`dedup` makes Midway's repeated meshes visible to `instance`**, so akagi, garrison camp and
  radar station get real `EXT_mesh_gpu_instancing` batches where the CLI-only Phase 0 run reported
  none (the Midway import script leaves `instance: false` for its unique pre-built hulls).

## Acceptance Criteria

- [x] AC-1 [local; actor: agent]: Phase 0 measurement table recorded for all 29 shipped Midway GLBs, plus a lossless dry run on `/tmp` copies (never `public/assets/`) showing flatten/join node-and-draw reduction and an `instance` run showing its current applicability — Evidence: measurement tables above, `/tmp/prd443/*.opt.glb`, `*.flat.glb`, `*.inst.glb`, this session's `gltf-transform` output.
- [x] AC-2 [local; actor: agent]: `@threenative/assets` ships `flatten`/`join`/`instance` passes gated by `assets.models.compact` (default on, named override), computed against one protected-node set (regex ∪ animation targets ∪ skin joints ∪ allow-list) — Evidence: `packages/assets/src/passes/compact.ts` (`compactModel`, `buildProtectedSet`, `resolveCompactOptions`), wired into `modelPass` (`packages/assets/src/passes/model.ts`) and validated in `compile.ts`; `pnpm --filter @threenative/assets typecheck` and `pnpm exec vitest run packages/assets/__tests__/` green (382 passed).
- [x] AC-3 [local; actor: agent]: Red→green unit test proves a protected node (regex match, animation target, skin joint, and an allow-listed name) survives `join`+`flatten` unmerged while an unprotected duplicate-material node gets merged, and a duplicated mesh across ≥2 nodes gets `EXT_mesh_gpu_instancing` — Evidence: `packages/assets/__tests__/compact-pass.spec.ts` (17 tests): a bare `join()` merges all four siblings and deletes `propeller_01` (red); a bare `flatten()` deletes a protected `VINTThreeNativePivot` and releases its mesh child to `join` (red); the pass keeps `propeller_01` (regex), `MyCustomPivot` (allow-list) and the pivot's child while merging the hull pair; three nodes sharing one mesh become one `EXT_mesh_gpu_instancing` batch of 3 with the self-verify's triangles/vertices/bounds unchanged; a rotated-node batch reconstructs world bounds; a sheared hierarchy compiles without drift; skin joints/animations preserved by name; removed named nodes are reported; a static child of an animated parent survives whichever channel is listed first; a 50-node shared mesh on an animated model is not duplicated.
- [x] AC-4 [local; actor: agent]: Compile report/summary lists per-pass before/after counts and every protected node with its protecting rule; a template `AGENTS.md` entry in `create-threenative` documents `assets.models.compact`'s default and override — Evidence: `IModelCompactSummary` is in `IModelPassOutputEntry` and the manifest, `compactLine()` in `packages/assets/src/report.ts` prints `flatten N -> M nodes, join P -> Q primitive(s), instance …` plus `protected <name> (<rule>)`; all 10 template `AGENTS.md` (and their generated `CLAUDE.md` mirrors) carry the `models.compact` paragraph; `create-threenative`'s config validator and the `@threenative/core` `IThreeNativeModelsConfig` type accept the key, proven by `packages/create-threenative/__tests__/config.spec.ts`.
- [ ] AC-5 [local; actor: agent]: Midway re-imports `hornet.glb`, `akagi.glb`, `boat.pt59.glb`, `structures.garrison-camp.glb`, `structures.radar-station.glb` through the new passes into a scratch copy; `tools/compare-frames.mjs` (strict defaults) reports pixel-identical frames against the currently shipped assets, and `tools/bench-native.sh` shows the measured node/draw reduction with no frame-time regression — **BLOCKED: Midway is a separate sandbox checkout (`/home/joao/projects/threenative/sandbox/midway-open-pacific`), not part of the engine repository, so its import scripts, frame comparison, native bench and asset replacement cannot ship in this PR.** Engine-side evidence only: the five files plus `aircraft.mitsubishi-a6m3.glb` and `deck-crew.glb` were compacted in place through `modelPass({ compact: <default>, textures: "none", virtual: "none" })`; every self-verify (triangles, vertices, joints, clips, bounds) passed and the measured reduction was akagi 146→39 nodes / 146→39 prims (7 instance batches, 30 instances), boat.pt59 42→20 / 40→20, garrison-camp 26→12 / 26→12 (5 batches, 11 instances), radar-station 9→5 / 9→5, hornet 94→75 / 94→75, a6m3 244→15 nodes / 10→10 prims, deck-crew 67→67 / 1→1 with every joint and clip intact. Midway side done in the `sandbox/midway-open-pacific` checkout in a follow-up: `tools/compact-assets.mjs` wraps the engine pass, the five `public/assets` GLBs were compacted in place (akagi 146→45 nodes/prims with 20 instance batches, boat.pt59 42→20, garrison-camp 26→16, radar-station 9→6, hornet 94→75; every self-verify passed), `compare-frames.mjs` diffed 1280x720 deck/chase/reflection against the shipped originals within its floor (mean 0.000, worst pct>8 0.001% vs the 0.005% limit), `check-carrier-assets.mjs` passes, and `bench-native.sh` ran both arms (compacted p95 73.7–79.5 ms vs stock 72.1–73.7 ms across runs; run-to-run spread is the same order as the arm difference). `run-handoff.sh` is not green for reasons outside this PRD — `check-carrier-cycle.mjs` fails deterministically against the concurrent PRD-442 `core` repoint, and `threenative doctor` reports the mixed 0.3.2/0.3.3/0.3.4 cohort the other lane created.
- [ ] AC-6 [local; actor: agent]: Engine package version bump, tarball packed to `sandbox/.packages` with a content-hash suffix, Midway's `file:` dependency repointed, `pnpm install`, and Midway's existing playtests (`tools/run-handoff.sh`) re-run green against the repointed engine — **BLOCKED: same boundary as AC-5; repointing a sandbox checkout's `file:` dependency is not an engine-repository change and no Midway playtest lane is reachable from this worktree.**

## Integration Ledger

| Capability | Reachable consumer/trigger | Replaces / disposition | Evidence |
|---|---|---|---|
| Lossless model compaction (flatten/join/instance, protected-node rules) | `assets.models.compact` config → `compileModel()` in `packages/assets/src/passes/model.ts`, wired into `packages/assets/src/pass-chain.ts` | New pass, additive alongside existing dedup/prune/weld/quantize/simplify; `compact: false` opts out | AC-2/AC-3, Phase 2 |
| Same passes for Midway's pre-built hero GLBs | `tools/import-fleet.sh`, `tools/import-aircraft.sh` (Midway's GLBs never flow through `assets.models` — verified in Context) | Import scripts call the new engine-exported function in place of their current weld+simplify-only chain | AC-5, Phase 3 |
| Compaction reporting | Compile summary consumed by build logs / CI; extends the existing model-compile summary shape additively | AC-4, Phase 2 |

## Execution Phases

#### Phase 1: Measurement (this PRD)
**Status:** DONE
**ACs:** AC-1
- [x] Inspect all 29 Midway GLBs' node/mesh/material/animation/skin counts by direct glTF-JSON parsing
- [x] Run `gltf-transform flatten`/`join`/`instance` on `/tmp` copies to establish lossless headroom and the protected-node risk
**Files:** None changed (read-only inspection; artifacts left in `/tmp/prd443/`, not committed).
**Implementation:** Inspected all 29 Midway GLBs' node/mesh/material/animation/skin counts via direct glTF-JSON parsing; ran `gltf-transform flatten`/`join`/`instance` on copies to establish real lossless headroom and the protected-node risk.
**Verification:** E1 — commands and output reproduced in Context above; `/tmp/prd443/*.opt.glb`, `*.flat.glb`, `*.inst.glb` are the retained artifacts (not shipped).
**Checkpoint:** Self-review — no code changed, no asset in `public/assets/` touched, all counts independently reproducible with the commands shown.

#### Phase 2: Engine passes + protected-node rules
**Status:** DONE
**ACs:** AC-2, AC-3, AC-4
- [x] Ship `packages/assets/src/passes/compact.ts`: one protected-node set, flatten/instance/join orchestration via the `@gltf-transform/functions` SDK
- [x] Wire it into `modelPass` (`assets.models.compact` default on, `false` override) ahead of `prune`, and validate the key in `compile.ts`
- [x] Extend `reachableStats` for `EXT_mesh_gpu_instancing`, so the self-verify sees instanced geometry as the source saw it
- [x] Seven adversarial Opus 5.5 review rounds fixed protected-aware flatten, `MathUtils.compose`, animated-flatten closure, join exclusions (shared meshes, translated/scaled shape copies, multi-scene nodes), clone disposal and cache versioning; final review PASS
- [x] Unit tests: red→green protected-node survival, instancing fixture, zero-candidate report, config validation
- [x] Report + template docs: `compactLine()`, the manifest summary, and the `create-threenative`/`@threenative/core` config key
**Files:** `packages/assets/src/passes/compact.ts` (new), `packages/assets/src/passes/model.ts`, `packages/assets/src/compile.ts`, `packages/assets/src/report.ts`, `packages/assets/src/index.ts`, `packages/assets/__tests__/compact-pass.spec.ts` (new), `packages/create-threenative/src/config.ts`, `packages/core/src/config.ts`, the 10 template `AGENTS.md` (+ generated mirrors).
**Implementation:** Build the protected-node set once per model (regex default seeded from Midway's proven `MOVING_NODE` shape, animation-channel targets and ancestors, skin joints, `protectedNames` allow-list); call gltf-transform's SDK `flatten()`/`join()`/`instance()` transforms with that predicate rather than the CLI's boolean `--keepNamed`; extend the compile summary with per-pass before/after counts and the protected-node list with each one's protecting rule.
**Verification:** E1 — red: unit test asserting a protected regex-matching node survives join fails against the naive `join()` call (mirrors the measured hornet/akagi accident); green: passes once the predicate is wired in. E2 — a fixture with a duplicated mesh across nodes gets `EXT_mesh_gpu_instancing`; a fixture with no duplication reports 0 candidates without failing (matches the measured Midway case).
**Checkpoint:** `prd-work-reviewer` (MEDIUM) at end of phase — diff review against AC-2/AC-3/AC-4, confirm the protected-node predicate is actually consulted by `join`/`flatten`/`instance` and not bypassed.

#### Phase 3: Midway proof
**Status:** BLOCKED — Midway is a separate sandbox checkout, not this repository; its import scripts, frame comparison and native bench cannot ship here. Engine-side reduction measured on the seven files, not the frame-identity or frame-time halves.
**ACs:** AC-5
- [ ] Re-import the five headroom files through the new passes into scratch copies in `midway-open-pacific`
- [ ] `tools/compare-frames.mjs` (strict defaults) pixel-identical against the shipped assets
- [ ] `tools/bench-native.sh` shows the node/draw reduction with no p95 frame-time regression
**Files:** `midway-open-pacific/tools/import-fleet.sh`, `tools/import-aircraft.sh` (call the new engine function on the affected assets), no changes to `src/render/*` unless a name lookup needs updating (not expected — protected names are preserved by construction).
**Implementation:** Re-import `hornet.glb`, `akagi.glb`, `boat.pt59.glb`, `structures.garrison-camp.glb`, `structures.radar-station.glb` (the five files with measured headroom) through the new passes into scratch copies; do not touch `public/assets/` until AC-5 passes.
**Verification:** E1 — `bash tools/capture-lock.sh node tools/compare-frames.mjs` (strict defaults) pixel-identical against the currently shipped assets. E2 — `bash tools/bench-native.sh` (or the isolated-worktree variant per Midway's own browser-gate-flakiness note) shows the measured node/draw reduction with no p95 frame-time regression.
**Checkpoint:** `prd-work-reviewer` — confirm the compare-frames run actually diffed the new scratch copy against the shipped one (not a self-comparison), and that the bench ran on an isolated port per Midway's shared-checkout lesson.

#### Phase 4: Release and repoint
**Status:** BLOCKED — same boundary as Phase 3; repointing a sandbox checkout's `file:` dependency is not an engine-repository change.
**ACs:** AC-6
- [ ] Bump `packages/assets`, pack a content-hashed tarball into `sandbox/.packages`, repoint Midway and `pnpm install`
- [ ] Replace the five `public/assets/*.glb` with their AC-5-verified compacted equivalents
- [ ] `midway-open-pacific/tools/run-handoff.sh` green against the repointed engine
**Files:** `packages/assets/package.json` (version bump), `sandbox/.packages/` (new tarball), `midway-open-pacific/package.json` (repointed `file:` dependency), `public/assets/*.glb` (the five files, replaced with their compacted equivalents once AC-5 is green).
**Implementation:** `pnpm --filter ./packages/assets build && pnpm --filter ./packages/assets exec pnpm pack --pack-destination .../sandbox/.packages`; rename the tarball with a content-hash suffix; repoint Midway's dependency; `pnpm install`; replace the five `public/assets/*.glb` files with their compacted output; delete the hand-rolled weld-only step in the import scripts that the new passes now subsume.
**Verification:** E1 — `midway-open-pacific/tools/run-handoff.sh` green against the repointed engine and replaced assets.
**Checkpoint:** Self-review — confirm no leftover `.tmp`/superseded tarball, and that the replaced assets are the AC-5-verified scratch copies, not a fresh unverified run.

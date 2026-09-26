# PRD-443 — Lossless flatten/join/instance pass for `@threenative/assets` model pipeline

**Status:** PARTIAL (Phase 1 done)
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

## Acceptance Criteria

- [x] AC-1 [local; actor: agent]: Phase 0 measurement table recorded for all 29 shipped Midway GLBs, plus a lossless dry run on `/tmp` copies (never `public/assets/`) showing flatten/join node-and-draw reduction and an `instance` run showing its current applicability — Evidence: measurement tables above, `/tmp/prd443/*.opt.glb`, `*.flat.glb`, `*.inst.glb`, this session's `gltf-transform` output.
- [ ] AC-2 [local; actor: agent]: `@threenative/assets` ships `flatten`/`join`/`instance` passes gated by `assets.models.compact` (default on, named override), computed against one protected-node set (regex ∪ animation targets ∪ skin joints ∪ allow-list) — Evidence: pending, `pnpm test` in `packages/assets`.
- [ ] AC-3 [local; actor: agent]: Red→green unit test proves a protected node (regex match, animation target, skin joint, and an allow-listed name) survives `join`+`flatten` unmerged while an unprotected duplicate-material node gets merged, and a duplicated mesh across ≥2 nodes gets `EXT_mesh_gpu_instancing` — Evidence: pending.
- [ ] AC-4 [local; actor: agent]: Compile report/summary lists per-pass before/after counts and every protected node with its protecting rule; a template `AGENTS.md` entry in `create-threenative` documents `assets.models.compact`'s default and override — Evidence: pending.
- [ ] AC-5 [local; actor: agent]: Midway re-imports `hornet.glb`, `akagi.glb`, `boat.pt59.glb`, `structures.garrison-camp.glb`, `structures.radar-station.glb` through the new passes into a scratch copy; `tools/compare-frames.mjs` (strict defaults) reports pixel-identical frames against the currently shipped assets, and `tools/bench-native.sh` shows the measured node/draw reduction with no frame-time regression — Evidence: pending; native bench execution may be `unreachable` without attached hardware at run time and must be reported as such, not assumed passing.
- [ ] AC-6 [local; actor: agent]: Engine package version bump, tarball packed to `sandbox/.packages` with a content-hash suffix, Midway's `file:` dependency repointed, `pnpm install`, and Midway's existing playtests (`tools/run-handoff.sh`) re-run green against the repointed engine — Evidence: pending.

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
**Files:** None changed (read-only inspection; artifacts left in `/tmp/prd443/`, not committed).
**Implementation:** Inspected all 29 Midway GLBs' node/mesh/material/animation/skin counts via direct glTF-JSON parsing; ran `gltf-transform flatten`/`join`/`instance` on copies to establish real lossless headroom and the protected-node risk.
**Verification:** E1 — commands and output reproduced in Context above; `/tmp/prd443/*.opt.glb`, `*.flat.glb`, `*.inst.glb` are the retained artifacts (not shipped).
**Checkpoint:** Self-review — no code changed, no asset in `public/assets/` touched, all counts independently reproducible with the commands shown.

#### Phase 2: Engine passes + protected-node rules
**Status:** NOT STARTED
**ACs:** AC-2, AC-3, AC-4
**Files:** `packages/assets/src/passes/model.ts` (wire the new passes into the existing pass order), a new `packages/assets/src/passes/compact.ts` (or similar) implementing the protected-node predicate and flatten/join/instance orchestration via `@gltf-transform/functions`, `packages/assets/src/compile.ts` (`assets.models.compact` config validation, mirroring the existing `assets.models.simplify`/`textures` validation shape), a unit test file, the `create-threenative` template `AGENTS.md` entry.
**Implementation:** Build the protected-node set once per model (regex default seeded from Midway's proven `MOVING_NODE` shape, animation-channel targets and ancestors, skin joints, `protectedNames` allow-list); call gltf-transform's SDK `flatten()`/`join()`/`instance()` transforms with that predicate rather than the CLI's boolean `--keepNamed`; extend the compile summary with per-pass before/after counts and the protected-node list with each one's protecting rule.
**Verification:** E1 — red: unit test asserting a protected regex-matching node survives join fails against the naive `join()` call (mirrors the measured hornet/akagi accident); green: passes once the predicate is wired in. E2 — a fixture with a duplicated mesh across nodes gets `EXT_mesh_gpu_instancing`; a fixture with no duplication reports 0 candidates without failing (matches the measured Midway case).
**Checkpoint:** `prd-work-reviewer` (MEDIUM) at end of phase — diff review against AC-2/AC-3/AC-4, confirm the protected-node predicate is actually consulted by `join`/`flatten`/`instance` and not bypassed.

#### Phase 3: Midway proof
**Status:** NOT STARTED
**ACs:** AC-5
**Files:** `midway-open-pacific/tools/import-fleet.sh`, `tools/import-aircraft.sh` (call the new engine function on the affected assets), no changes to `src/render/*` unless a name lookup needs updating (not expected — protected names are preserved by construction).
**Implementation:** Re-import `hornet.glb`, `akagi.glb`, `boat.pt59.glb`, `structures.garrison-camp.glb`, `structures.radar-station.glb` (the five files with measured headroom) through the new passes into scratch copies; do not touch `public/assets/` until AC-5 passes.
**Verification:** E1 — `bash tools/capture-lock.sh node tools/compare-frames.mjs` (strict defaults) pixel-identical against the currently shipped assets. E2 — `bash tools/bench-native.sh` (or the isolated-worktree variant per Midway's own browser-gate-flakiness note) shows the measured node/draw reduction with no p95 frame-time regression.
**Checkpoint:** `prd-work-reviewer` — confirm the compare-frames run actually diffed the new scratch copy against the shipped one (not a self-comparison), and that the bench ran on an isolated port per Midway's shared-checkout lesson.

#### Phase 4: Release and repoint
**Status:** NOT STARTED
**ACs:** AC-6
**Files:** `packages/assets/package.json` (version bump), `sandbox/.packages/` (new tarball), `midway-open-pacific/package.json` (repointed `file:` dependency), `public/assets/*.glb` (the five files, replaced with their compacted equivalents once AC-5 is green).
**Implementation:** `pnpm --filter ./packages/assets build && pnpm --filter ./packages/assets exec pnpm pack --pack-destination .../sandbox/.packages`; rename the tarball with a content-hash suffix; repoint Midway's dependency; `pnpm install`; replace the five `public/assets/*.glb` files with their compacted output; delete the hand-rolled weld-only step in the import scripts that the new passes now subsume.
**Verification:** E1 — `midway-open-pacific/tools/run-handoff.sh` green against the repointed engine and replaced assets.
**Checkpoint:** Self-review — confirm no leftover `.tmp`/superseded tarball, and that the replaced assets are the AC-5-verified scratch copies, not a fresh unverified run.

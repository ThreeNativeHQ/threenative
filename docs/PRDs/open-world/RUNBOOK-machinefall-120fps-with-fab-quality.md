# Runbook: Machinefall walks at 120 fps with Fab-quality assets

**Point an agent at this file and say "run it".** It holds the goal, the order, the rules and the stop condition. Each row links the PRD that holds the actual work.
Created 2026-10-03, after #390 merged.

**Goal.** Two outcomes:
- (A) Machinefall `?scene=map-walk` **walks** at CPU and GPU p95 ≤ 8.3 ms on the RTX 2080 WebGPU adapter, with no visual loss. These are [PRD-478](PRD-478-open-world-frame-architecture.md)'s AC-1, AC-2 and AC-3.
- (B) A cold agent's Fab or Megascans game ships its assets at full quality through the default cook, with no hand-set knobs, and stays inside that frame budget.

**Stop condition.** Every row below is ticked, or sits under an owner gate that is recorded as asked.

## How to run this file

1. **Pick the next row.** Take the first unticked row in Lane A whose "after" rows are ticked. Run Lane B and Lane C rows only in a parallel session. Use the `ci-pipeline` skill's claim board, so two sessions never take the same row.
2. **One PRD, one draft PR, one worktree.**
   - Branch from `origin/develop` into `.worktrees/<prd-slug>/` (the `git-worktree` skill).
   - Open the draft PR at the first commit and label it with what `pnpm prd:progress <prd>` prints.
   - If the PRD already has an open PR, reuse it.
   - Follow the `prd-lifecycle` skill: tick each box with its proof in the same commit as the work.
3. **Do the PRD's own boxes.** The PRD is the spec, and this file only orders the work. If a PRD's phase has no boxes, `prd:progress` exits 1, so add the boxes first.
4. **Measure the same way every time** (any row marked ⏱):
   - Use the Machinefall checkout that pins current core. In a Machinefall checkout, the `apps/client` `@threenative/core` dependency must resolve to code equal to `origin/develop`; `main` was on a stale tarball on 2026-10-03.
   - Run `playtests/scenes/map-walk.playtest.json` with `--browser-recipe webgpu --headed`. Check that `adapter.info` names the NVIDIA adapter, not SwiftShader.
   - Do 3 runs each, interleaved with develop, and read the `TN_FRAME_BUDGET` walk windows through `playtest perf --file`. Add `?tnFrameSpans=1` for attribution.
   - Record the load average. If CI runners shared the host, mark the numbers noisy and rerun the closing numbers on a quiet host.
   - Update "Where we stand" below in the same PR.
5. **Visual judges on every pixel-changing row** (any row marked 👁). This is required, not optional.
   - Capture before and after on the same poses.
   - Hand **only the blind directory** to **3 fresh judge subagents**. Never use the builder, never reuse a judge, and never show judges the seal, the reveal files or another judge's verdict.
   - **World rows (🌍):**
     - `pnpm visuals:world --before <develop>/world.json --after <candidate>/world.json --out artifacts/world-gate`
     - then `pnpm visuals:world --score artifacts/world-gate --verdict c1.json --verdict c2.json --verdict c3.json`
     - The run must exit 0 (judged pass). Judges follow [WORLD-VISUAL-GATE.md](../../product/WORLD-VISUAL-GATE.md) for both same-pose frames and the fixed-walk pop series.
     - Until PRD-477 Phase 1 has shown this gate going red on a known-bad build, also run the template check below and get the owner's side-by-side review.
   - **Template-look rows (🎨):**
     - `pnpm visuals:ab --raters 3` on before and after.
     - A performance or plumbing change must show no delta beyond the bundle's own resolution (`INDETERMINATE` or better on every template).
     - A look change must score **higher** on the templates it targets, and no lower elsewhere.
   - Put the verdict line (exit code, score, resolution) on the PRD box or in the PR body. A red verdict blocks the merge. Fix the change; never re-roll the judges.
6. **Owner gates (🙋)** are things only the owner can do: a side-by-side review, pausing the CI runners, an emulator or device. Ask once with the `attention-ping` skill, record that you asked, and carry on with the next independent row.
7. **Finish a row.**
   - The PR merges green, and the PRD moves to `docs/PRDs/done/` in the finishing commit when it closes.
   - Then tick the row here, in that same PR.
   - A row naming one phase is done when that phase's boxes are ticked and merged.
   - Clean up the worktree after the merge.

## Where we stand

Last measured 2026-10-03 against `origin/develop` `4d5e07c98`: nvidia/turing, 1280×720, DPR 1, MSAA 4×, 3 runs, noisy host (CI load).

| | Walking p50 | Walking p95 | Standing p95 | Gap at p95 |
| --- | --- | --- | --- | --- |
| CPU render | 6.9 ms | **21.2 ms** | 4.5 ms | **12.9 ms** |
| GPU | 7.0 ms | 10.1 ms | 4.5 ms | 1.8 ms |

The gap is CPU while walking. The costs, as span p95s, which overlap and do not add:
- Main-pass draw submission: ~330 draws × 16–26 µs, about 7 ms every frame.
- Shadow level re-render: ~476 draws, 4–17 ms on 2–8% of frames.
- WorldCells streaming: p95 7–9 ms.
- Mid-walk pipeline compiles: spikes of 113–247 ms.
- Cull, projection and LOD: 2–3 ms.

## Lane A — the 120 fps walk (critical path)

- [ ] **A0 · Land PRD-484** (instanced LOD + selective water mirrors by default). After: nothing. 🌍👁
  - Its commits exist only on the unpushed local branch `engine-defaults-484`, plus uncommitted edits in `.worktrees/prd-484-engine-defaults`.
  - Ask the owner 🙋 whether those edits are still wanted, then rebase onto `origin/develop` and open its own draft PR. Its old plan to ride #390 is moot, because #390 merged without it.
  - Done when: its PRD is in `done/` on `develop`.
- [ ] **A1 · [PRD-389](../performance/critical/PRD-389-the-frame-budgets-instruments-do-not-lie.md): the instrument gaps the 2026-10-03 probe hit.** After: nothing.
  - A standing scene can't be measured under `runtime.fixedStep` (it yields one window).
  - The update phase reads 0.
  - `passes.main.triangles` reads 338 M.
  - Only about 15 of 300 frames carry a GPU timestamp, too few for a GPU p95.
  - Done when: each gap has a ticked box in PRD-389.
- [ ] **A2 · [PRD-477](PRD-477-worldcells-auto-on-measured-budgets.md) Phase 1: the world gate goes red, then green.** After: nothing; runs alongside A1.
  - The gate must red on an impostors-on build (#375) and green on develop. Every later 🌍 row trusts it.
  - Done when: both Phase 1 boxes are ticked.
- [ ] **A3 · PRD-478 Phase 1: measure the shadow-window work that #390 already merged.** After: A1 and A2. ⏱🌍👁🙋
  - The owner side-by-sides the camp and highway aerials against `?refShadow=1`. The first candidate failed exactly that review.
- [ ] **A4 · [PRD-494](PRD-494-the-main-pass-fits-the-draw-budget.md): the main pass fits the draw budget.** After: A3. ⏱🌍👁
  - The largest cost. Attribute the ~323 draws by source, then take the largest source off three's per-draw path, `bundles` or a merged path.
- [ ] **A5 · PRD-478 Phase 2: shadow levels draw GPU-scene keys.** After: A4. ⏱🌍👁
- [ ] **A6 · PRD-478 Phase 3: terrain merges and seams run in a worker.** After: A5. ⏱🌍👁
  - The settled terrain must be byte-identical to the inline path.
- [ ] **A7 · No pipeline compiles mid-walk:** [PRD-459](PRD-459-smooth-streaming-one-admission-budget-per-frame.md) AC-3 with [PRD-387](../performance/critical/PRD-387-shader-variants-are-prepared-off-frame-and-bounded.md). After: A6. ⏱🌍👁
- [ ] **A8 · [PRD-455](../rendering/PRD-455-temporal-reconstruction-from-dynamic-resolution.md): temporal reconstruction closes the GPU gap.** After: A7. ⏱🌍👁
- [ ] **A9 · PRD-478 acceptance.** After: A8. ⏱🌍👁
  - Done when: AC-1, AC-2 and AC-3 are ticked on a quiet host 🙋, and PRD-478 is in `done/`.
- [ ] **A10 · PRD-477 Phases 2–3 and AC-1: budgets and switches become engine decisions.** After: A9. ⏱🌍👁
- [ ] **A11 · [PRD-489](PRD-489-gpu-scene-occlusion-culling.md) Phase 1 only: the occlusion go/no-go.** After: A9. ⏱
  - If it declines, record the decision and close the PRD. If it goes ahead, its Phases 2–3 become row A12. 🌍👁

## Lane B — Fab-quality assets at that frame rate

- [ ] **B1 · [VQ-01](../assets/PRD-VQ-01-native-asset-capabilities.md): native asset capability guard.** After: nothing.
  - It already has a draft PR, #396. `assertNativeAssetsCompatible` currently rejects KTX2 and meshopt on every Android and iOS build.
- [ ] **B2 · [PRD-485](PRD-485-high-quality-assets-go-through-the-cook.md): high-quality assets go through the cook.** After: B1 for its Android box only. 🎨👁
  - fab-import-proof, lumen-hall and metahuman-lab drop their escape hatches.
- [ ] **B3 · Texture residency:** [VQ-10](../performance/PRD-VQ-10-texture-mip-residency.md) together with [PRD-454](PRD-454-worldcells-budget-real-resources.md). After: B2. ⏱🌍👁
  - Machinefall's 1024 texture cap is lifted to 2048 inside a hard GPU byte budget, with no black frames.
- [ ] **B4 · [PRD-377](../assets/PRD-377-auto-lod-is-on-by-default.md) Phase 4: AutoLOD on by default.** After: B2. ⏱🎨👁
- [ ] **B5 · [PRD-486](PRD-486-characters-get-a-lod-chain.md): characters get a LOD chain.** After: B4. ⏱🎨👁
- [ ] **B6 · [PRD-487](PRD-487-imported-materials-keep-their-detail.md): imported materials keep their detail.** After: B2. 🎨👁
  - It needs a change in the asset-mcp repo; that repo's PRs target its `main`.
- [ ] **B7 · [PRD-488](PRD-488-foliage-moves-in-the-wind.md): foliage moves in the wind.** After: B6, and A5 for its shadow box. ⏱🌍👁
- [ ] **B8 · [PRD-351](../assets/PRD-351-compression-never-looks-worse-than-a-floor.md): compression quality floor.** After: B2. 🎨👁

## Lane C — look and native parity (independent; any free session)

- [ ] **C1 · [PRD-339](../rendering/PRD-339-the-frame-sets-its-own-exposure.md): auto exposure.** 🎨👁
  - Draft PR #397 already exists. Add its phase boxes first, since `prd:progress` exits 1 without them.
- [ ] **C2 · [PRD-492](PRD-492-colour-grading-and-film-grain.md): colour grading and film grain.** 🎨👁
- [ ] **C3 · [PRD-493](PRD-493-terrain-layers-past-sixteen-textures.md): terrain layers past sixteen textures.** ⏱🌍👁
- [ ] **C4 · [PRD-491](PRD-491-water-and-atmosphere-run-native.md): water and atmosphere run native.** 👁
  - Compare native frames against web frames with the same judges.
- [ ] **C5 · [PRD-490](PRD-490-cluster-lod-wins-on-native.md): cluster LOD wins on native.** ⏱👁
- [ ] **C6 · Off-screen GI:** [PRD-245](../rendering/PRD-245-indirect-light-is-a-node-the-game-composites.md), [PRD-267](../useful-defaults/PRD-267-screen-space-gi-ships-in-the-templates.md), [PRD-268](../rendering/PRD-268-light-that-comes-from-off-screen.md), [PRD-270](../useful-defaults/PRD-270-no-lighting-node-ships-web-only.md). After: A4. ⏱🎨👁
  - All four have been PROPOSED since 2026-08-29 with 0 boxes. Merge or split them into at most 3 phases before starting.

## Housekeeping (any session; docs-only, commit straight to `develop` per AGENTS.md)

- [ ] Three PRDs share the number 339: AAA-visuals auto exposure, performance loading screen, critical compile walk. Renumber two of them and fix their links.
- [ ] Fix status drift:
  - critical [PRD-386](../performance/critical/PRD-386-gpu-driven-rendering-compute-culling-and-indirect-draws.md) and [PRD-390](../performance/critical/PRD-390-do-not-submit-what-the-render-camera-cannot-resolve.md) say NOT STARTED, but their mechanisms shipped in PRD-473 and #263;
  - PRD-269 has landed (`3630847a`);
  - [PRD-461](PRD-461-view-distance-basics.md)'s `terrain.streamRadius` blocker has landed.
- [ ] Remove the stale duplicates `meta-human/PRD-465` and the batch copy of `PRD-VQ-11`.
- [ ] Update `00-REPO-GROUNDING.md` (virtual shadow maps ship) and WORLD-STREAMING.md (virtualized geometry ships; occlusion is now PRD-489's call).
- [ ] Refresh rows G04, G05, G11, G15 and G16 in `docs/unreal-engine/ThreeNative_Unreal_Visual_Gap_Tracker.xlsx`.

## Not on this runbook, by decision

- Motion matching: gated on PRD-039's triggers.
- Large-world coordinates: only matter past 2 km.
- A Niagara-style module layer: it would own the look.
- Virtual texturing: out of scope per WORLD-STREAMING.md.
- WorldCells data layers: no consumer yet.

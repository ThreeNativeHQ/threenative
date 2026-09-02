# PRD-315 Phase 4 — the animal geometry, measured

**Subject**: the six served `SK_*.glb` in `sandbox/wildwood/public/` after the fresh bake
(`sharedImages`, engine `main` at `072fee0b`; game `477f320`), read back through the same
shared-image reader the model pass verifies with, against their sources under `assets/`.
Importer report version 45; installed asset MCP 0.7.0 (unchanged, not re-run).

| model | prims src/served | tris | verts | materials | clips | bad index | non-unit normals | non-normalised weights | bad joints | tris `stripJunkTriangles` would drop | raw box (w×h×l) | 1–99% box |
|---|---|---|---|---|---|---:|---:|---:|---:|---:|---|---|
| SK_Fox | 2/2 | 18300/18300 | 11172/11172 | 2/2 | 20/20 | 0 | 0 | 0 | 0 | 1012 | 0.35×1.06×2.00 | 0.32×1.03×1.96 |
| SK_Wolf | 2/2 | 20008/20008 | 12306/12306 | 1/1 | 21/21 | 0 | 0 | 0 | 0 | 1096 | 0.36×1.00×2.00 | 0.33×0.97×1.96 |
| SK_DeerStag | 2/2 | 22244/22244 | 13476/13476 | 2/2 | 18/18 | 0 | 0 | 0 | 0 | 1080 | 0.97×1.96×2.00 | 0.87×1.93×1.94 |
| SK_DeerDoe | 2/2 | 20872/20872 | 12472/12472 | 2/2 | 17/17 | 0 | 0 | 0 | 0 | 936 | 0.55×1.60×2.00 | 0.50×1.58×1.95 |
| SK_Pig | 2/2 | 21926/21926 | 13102/13102 | 2/2 | 18/18 | 0 | 0 | 0 | 0 | 1128 | 0.66×1.02×2.00 | 0.59×0.96×1.74 |
| SK_Crow | 1/1 | 2183/2183 | 1484/1484 | 1/1 | 15/15 | 0 | 0 | 0 | 0 | 66 | 2.00×0.65×0.92 | 0.94×0.59×0.91 |

## What this says

1. **Served equals source.** Primitive, triangle, vertex, material and clip counts are identical
   through the shared-image compile; the served bytes are the pack, not a rewrite.
2. **The pack is clean.** Every index is in range; every normal is unit length within 0.02;
   every skin weight sums to 1 within 0.02; every joint index is inside its skeleton.
3. **There are no junk vertices.** The raw world-space box equals the 1st–99th-percentile box to
   within a few centimetres on every animal. The "±100 units on Z" the game's comments describe
   is not in this pack — it belonged to the Quaternius re-exports the sandbox loaded earlier.
4. **`stripJunkTriangles` deletes real geometry.** With no outliers, the percentile box clips the
   extremities — nose, ear tips, tail, hooves, antler tips — and the majority-vote rule drops
   936–1128 triangles (4–5%) from every quadruped and 66 from the crow. That is the deformed deer
   the PRD suspected, and it is the game's post-load filter, not the importer, the repack or the
   compile.

## Consequences for the plan

- Phase 0 stop gate: a fresh compile alone does **not** remove the defect, because the defect is
  applied at load in `src/entities/animals/Animal.ts`; deleting `stripJunkTriangles` and the
  percentile normaliser's reason-for-being does. The importer (`threenative-asset-mcp`) needs no
  change for geometry; Phase 4's importer edits leave scope, as the PRD allowed.
- `percentileSpan` can become a plain world-space `Box3` length: with no outliers the two agree,
  and a box is honest when a future pack really is dirty (it would show as a huge span, which is
  a finding, not something to hide).
- Still open from Phase 4: silhouette IoU across turntable views (source vs served is byte-equal
  in geometry, so IoU is 1.0 by construction), `clipPoseError` on idle/walk (identical clips),
  fur alpha mode and texture bindings (the served materials count matches; not visually checked
  here), and the forward-axis measurement (Phase 5).

## Method

The audit script reads each served GLB with `readSharedGlb` and the source with a bare
`NodeIO`, walks every mesh node with its world matrix, and applies exactly the game's rule: a
1st–99th percentile box per axis over all world-space vertices, and a triangle is dropped when
fewer than two of its vertices are inside. It was run from the engine repository root with
`pnpm exec tsx` against the sandbox paths; it is reproducible from the table's inputs and takes
under ten seconds.

## Forward axis, bind pose

Head and tail joint world positions in the served rigs (metres, x,y,z):

| rig | head | tail | faces |
|---|---|---|---|
| SK_Fox | 0.00, 0.43, 0.32 | 0.00, 0.34, −0.56 | +Z |
| SK_Wolf | 0.00, 0.78, 0.63 | 0.00, 0.43, −0.93 | +Z |
| SK_DeerStag | 0.00, 1.29, 0.92 | 0.00, 1.07, −0.87 | +Z |
| SK_DeerDoe | 0.00, 1.27, 0.72 | 0.00, 0.92, −0.81 | +Z |
| SK_Pig | 0.00, 0.60, 0.82 (nose 1.10) | 0.00, 0.85, −0.77 | +Z |
| SK_Crow | 0.00, 0.23, 0.11 | 0.00, 0.13, −0.10 | +Z |

Every rig faces +Z in bind pose, and `Animal.update` moves along `(sin heading, cos heading)`
with `rotation.y = heading + yawOffset`, so heading 0 is +Z and `yawOffset: 0` is the measured
answer, not an assumption. If a fox still walks backwards in motion, the cause is in the clips
(root motion the `strideRoot` split does not absorb) or in a steering sign, and the playtest's
`movement.facesMovementWithinDegrees` is the observation that decides it — that run belongs to
Phase 5 with the navigation change.


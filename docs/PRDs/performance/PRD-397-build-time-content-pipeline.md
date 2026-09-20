# PRD-397 — Build-time content pipeline: atlas, material dedupe, instancing, static merge

**Status:** NOT STARTED
**Complexity:** 7
**Owner:** unassigned
**Depends on:** PRD-395 complete (the published µs/draw figure is what this PRD is priced
against). PRD-396 is **not** a dependency — they touch disjoint code and can land in either
order — but if PRD-396 has landed, its numbers are the baseline this PRD measures from.
**PR:** (open as draft before Phase 1) — label `prd:0`

## Problem

573 draws/frame (main 158, shadow 364, reflection 51) for 1.04M triangles is **~1,815
triangles per draw**. The scene is 1,561 meshes. A GPU that finishes in 1.9 ms is being fed
by a CPU that takes 16.1 ms to describe the work.

Content census:
- Carrier: **95 meshes, 76 materials, 73 distinct texture sources** — one texture per material.
- Destroyer: 2 meshes each.

A runtime per-material merge (`mergeParts`) was tried: it found **274 buckets with 213
singletons**, replaced **246 of 1,561** meshes, and **moved no frame time** (46.5 fps vs
48–51 without — inside the spread).

That result is usually read as "content doesn't matter." It is the opposite. The merge found
213 singletons because 73 distinct texture sources per carrier means *materials cannot be
deduplicated while each one owns a private texture*. A per-material merge over
one-texture-per-material content has almost nothing to merge by construction. **The atlas is
the prerequisite, and the failed experiment is the evidence for it.** Merge without atlas is
the null result we already have.

Target: **1,561 → 300–400 objects, 573 → 150–200 draws, 4–7 ms recovered, low risk** —
because every transformation happens at build time, producing generated game source and
generated texture artifacts. No runtime semantics change. Helps browser equally.

## Scope / Non-goals

**In scope**
- Build-time texture atlas packer with UV rewrite, deterministic, in `packages/<tools>`.
- Build-time material dedupe *after* atlasing, keyed on the post-atlas material signature.
- Build-time static merge across deduplicated materials, replacing `mergeParts`.
- Build-time instancing for repeated props (destroyers at 2 meshes each, aircraft, crates).
- Screenshot parity gate between pre-pipeline and post-pipeline builds.
- Regenerated midway game source and texture artifacts as the shipped output.

**Non-goals — explicitly refused here**
- **No runtime merging, atlasing or deduplication.** `mergeParts` at runtime is deleted or
  left unused, not extended. If a transformation cannot be done at build time it is not done.
- **Ranked option 5 (GPU-driven culling / indirect draws upstream in three.js) is not taken.**
  It depends on this PRD and is 2–4 ms at high effort; it gets its own PRD only after this
  one publishes the post-pipeline draw count and per-draw cost.
- **Ranked option 3 (shadow lane) is not taken.** Shadow draws fall here only as a side
  effect of fewer objects. Per-light caster culling, cascade reduction and static-light
  throttling remain unstarted; the 856 shadow-caster-exempt objects keep their exemption.
- **Ranked options 4, 6, 7** are not taken and not prepared for.
- No appearance changes shipped from `packages/`. Atlas layout decisions and merge groupings
  ship as generated game source and generated artifacts; `packages/` holds only mechanism.
- No lightmap baking, no LOD generation, no mesh decimation. Triangle count is a
  non-target — 1.04M triangles at 1.9 ms GPU is not a problem and must not be "fixed."

## Phases

### Phase 1 — Deterministic atlas packer + UV rewrite

- [ ] Files wired: `packages/<tools>/src/atlas/Packer.ts` — bin-packs source textures into
      pages, emits a page manifest and a per-source UV transform.
- [ ] Files wired: `packages/<tools>/src/atlas/RewriteUVs.ts` — applies the transform to
      geometry UVs at build time, with a declared policy for wrap/repeat sources (sources
      that tile are excluded from atlasing and reported, not silently clamped).
- [ ] Required test passing: `npm test -- atlas.deterministic` — two runs over the same
      inputs produce byte-identical pages and manifest. Result: `<command>` → `<exit code>`
- [ ] Required test passing: `npm test -- atlas.uv-roundtrip` — a sampled texel through the
      rewritten UV resolves to the same source texel within 1 texel.
      Result: `<command>` → `<exit code>`
- [ ] Required test passing: `npm test -- atlas.rejects-tiling` — a wrap-mode source is
      excluded and reported, not packed. Result: `<command>` → `<exit code>`
- [ ] Observed red: `atlas.deterministic` failed at `<sha>` due to map-iteration order;
      `<msg>`. Paste output.
- [ ] User verification: carrier atlased. Baseline **73 distinct texture sources** →
      result `<n>` atlas pages, `<n>` sources excluded as tiling.

### Phase 2 — Post-atlas material dedupe

- [ ] Files wired: `packages/<tools>/src/content/DedupeMaterials.ts` — signature over
      post-atlas material state; identical signatures collapse to one material.
- [ ] Required test passing: `npm test -- dedupe.signature-distinguishes` — two materials
      differing only in a non-atlas uniform do **not** collapse.
      Result: `<command>` → `<exit code>`
- [ ] Observed red: that test failed at `<sha>` when the signature omitted `<field>`; `<msg>`.
- [ ] User verification: carrier material count. Baseline **76 materials** → result `<n>`.
- [ ] User verification: scene-wide material count. Baseline `<record>` → result `<n>`.
- [ ] User verification: merge-bucket singleton count, as the direct comparison against the
      failed runtime experiment. Baseline **274 buckets / 213 singletons** →
      result `<n>` buckets / `<n>` singletons.
      This box is the falsification point: if singletons stay near 213 after atlasing, the
      atlas hypothesis is wrong and Phases 3–4 must be re-priced before continuing.

### Phase 3 — Static merge and instancing

- [ ] Files wired: `packages/<tools>/src/content/StaticMerge.ts` — merges static meshes
      sharing a deduplicated material, preserving per-object bounds for culling.
- [ ] Files wired: `packages/<tools>/src/content/Instancing.ts` — repeated props emitted as
      instanced draws with per-instance transforms.
- [ ] Required test passing: `npm test -- merge.preserves-bounds` — a merged group's child
      bounds still cull individually where the generator says they should.
      Result: `<command>` → `<exit code>`
- [ ] Required test passing: `npm test -- instancing.transform-parity` — instanced transforms
      match the pre-instancing per-object matrices elementwise to 1e-6.
      Result: `<command>` → `<exit code>`
- [ ] Observed red: `instancing.transform-parity` failed at `<sha>` on a mirrored-scale
      prop; `<msg>`.
- [ ] User verification: carrier mesh count. Baseline **95 meshes** → result `<n>`.
- [ ] User verification: destroyer draw count. Baseline 2 meshes each, `<n>` destroyers →
      result `<n>` draws total.

### Phase 4 — Regenerate midway, screenshot parity, measure

- [ ] Files wired: midway's generated game source and texture artifacts regenerated through
      the pipeline; the generator step is in the build, not a one-off script.
- [ ] Files wired: `tools/screenshot-parity.ts` — fixed camera set, pre- vs post-pipeline
      builds, per-pixel and SSIM comparison.
- [ ] Required test passing: `npm test -- parity.screenshots` — every camera in the fixed set
      is within the declared threshold. Result: `<command>` → `<exit code>`, worst SSIM `<n>`
- [ ] Observed red: parity failed at `<sha>` at camera `<n>` with SSIM `<n>` from an atlas
      bleed at page edges; fixed by `<n>`-texel padding. Paste output.
- [ ] User verification: scene object count. Baseline **1,561 meshes** → result `<n>`.
      Target 300–400.
- [ ] User verification: main-pass draws. Baseline **158** → result `<n>`.
- [ ] User verification: shadow-pass draws. Baseline **364** → result `<n>`.
- [ ] User verification: reflection-pass draws. Baseline **51** → result `<n>`.
- [ ] User verification: triangle count. Baseline **1.04M** → result `<n>` (must not rise
      by more than 5%; merging must not duplicate geometry).
- [ ] User verification: native desktop render-phase p50. Baseline **16.1 ms** → result `<n>`.
- [ ] User verification: native desktop frame p50. Baseline **20.2 ms** → result `<n>`.
- [ ] User verification: GPU p50. Baseline **1.57 ms** → result `<n>` (atlasing may raise
      it; anything under 8 ms is still ~2x under budget and acceptable).
- [ ] User verification: browser WebGPU render-phase p50. Baseline `<record>` → result `<n>`.
- [ ] User verification: total texture bytes shipped. Baseline `<record>` → result `<n>`
      (atlasing must not balloon download size by more than 20%).
- [ ] User verification: Android hardware render-phase p50.
      Blocker: Android hardware rows open on PR #275. Does not gate Acceptance.
- [ ] User verification: iOS hardware render-phase p50.
      Blocker: same as Android.

## Acceptance criteria

- [ ] Scene object count falls from 1,561 to ≤400.
- [ ] Total draws fall from 573 to ≤200.
- [ ] Triangle count does not rise more than 5% above 1.04M.
- [ ] Native desktop render-phase p50 improves by **≥4.0 ms** against its baseline at the
      time this PRD starts.
- [ ] Browser WebGPU render-phase p50 improves by ≥4.0 ms against its recorded baseline.
- [ ] Screenshot parity passes on every camera in the fixed set.
- [ ] Atlas output is byte-identical across two builds.
- [ ] Post-atlas merge singleton count is materially below 213 (the box in Phase 2 carries
      the number).
- [ ] GPU p50 stays under 8 ms.
- [ ] Shipped texture bytes rise by ≤20%.
- [ ] No runtime merging, atlasing or deduplication exists in the shipped path.
- [ ] Every appearance-affecting decision ships as generated game source or a generated
      artifact; `packages/` contains mechanism only.

## Verification boundary

**Proven here:** that the object and draw counts of the reference game can be cut by 4–5x
at build time with pixel parity, and how much CPU frame time that buys on native desktop
and in the browser.

**Not proven here:** that the recovered time matches PRD-395's µs/draw × draws-removed
prediction. If it does not, PRD-395's attribution is wrong somewhere and must be revisited
before ranked option 5 is priced — write that discrepancy into PRD-395's table rather than
opening a new PRD to explain it.

**Not proven here:** that this generalises to content the midway census does not describe.
The 73-textures-per-carrier shape is what makes the atlas the lever; a project already
sharing textures will see less.

**Not proven here:** anything about the shadow lane. Shadow draws fall here only in
proportion to object count. The 856 shadow-caster-exempt objects, per-light caster culling,
cascade count and static-light throttling are untouched and remain the next candidate PRD,
to be priced against the post-pipeline draw count this PRD publishes — not against the 364
baseline above.

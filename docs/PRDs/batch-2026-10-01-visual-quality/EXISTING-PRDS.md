# Existing canonical PRDs in this batch

These are **references to existing work, not duplicate specifications**. Their files, evidence, completed boxes and associated PRs stay at their canonical paths. This preserves history and in-flight branches while providing one execution entry point.

Baseline inspected: `d72778382b134ef8763f58825cb4d4fd8cc0f6e3` on `develop`. Old status prose is not authoritative over newer code. Before execution, compare the relevant implementation and tests, preserve all proved work, add only the unresolved scope and normalize missing per-phase/proof markers in the canonical document. Never turn a stale `PROPOSED` heading into a rewrite order.

| Queue | Owner | Outcome | Execution note | Dependency / coordination |
|---|---|---|---|---|
| Wave 0 | [PRD-269](https://github.com/ThreeNativeHQ/threenative/blob/develop/docs/PRDs/lighting/PRD-269-motion-vectors-or-the-temporal-filters-lie.md) | Velocity/history correctness | Source exists; reconcile old PROPOSED text with current velocity code. Qualify gaps; do not rebuild it. | Before 455, VQ-13 and temporal hair/fog consumers. |
| Wave 1 | [PRD-455](https://github.com/ThreeNativeHQ/threenative/blob/develop/docs/PRDs/unreal-like-features/PRD-455-temporal-reconstruction-from-dynamic-resolution.md) | Temporal AA and dynamic-resolution reconstruction | Reuse existing owner. Same-resolution temporal qualification is its first bounded milestone; an upstream TRAA node is not by itself an upscaler. | 269; coordinate MSAA, jitter, camera cuts and instance identity. |
| Wave 1 | [PRD-339](https://github.com/ThreeNativeHQ/threenative/blob/develop/docs/PRDs/AAA-visuals/PRD-339-the-frame-sets-its-own-exposure.md) | Auto exposure / eye adaptation | Reuse; adapt the current generated-source exposure seam, not a second tone mapper. | VQ-02 output correctness; include dark/bright transition traces. |
| Wave 1 | [PRD-460](https://github.com/ThreeNativeHQ/threenative/blob/develop/docs/PRDs/unreal-like-features/PRD-460-invisible-streaming-transitions.md) | Prop arrival and LOD crossfades | Reuse; terrain morphing already exists. Apply the remaining work to CPU and GPU-selected scatter routes. | Existing WorldCells and PR #375; coordinate temporal reactive/disocclusion behavior. |
| Wave 2 | [PRD-456](https://github.com/ThreeNativeHQ/threenative/blob/develop/docs/PRDs/unreal-like-features/PRD-456-distant-world-cell-proxies.md) | Distant cell HLOD / silhouettes | Reuse; do not confuse per-asset impostors or shadow proxies with cell HLOD. | Existing world-resource accounting; 460 handoffs. |
| Wave 2 | [PRD-457](https://github.com/ThreeNativeHQ/threenative/blob/develop/docs/PRDs/unreal-like-features/PRD-457-virtual-shadows-scale-by-measurement.md) | Shadow scheduling, sparse-page admission, local-light boundary | Reuse. Directional virtual shadows already exist; phase 3 also owns local-light work. | Coordinate VQ-06; preserve a correct cached-level fallback. |
| Wave 2 | [PRD-344](https://github.com/ThreeNativeHQ/threenative/blob/develop/docs/PRDs/AAA-visuals/PRD-344-contact-occlusion-baked-from-the-geometry-it-ships-with.md) | Cheap baked contact occlusion | Reuse; distinguish this outcome from existing lightmaps and imported AO textures. | Use current cook/mesh data; retain mobile low-tier benefit. |
| Wave 2 | [PRD-268](https://github.com/ThreeNativeHQ/threenative/blob/develop/docs/PRDs/lighting/PRD-268-light-that-comes-from-off-screen.md) | Static diffuse probes / off-screen lighting | Source exists; reconcile implementation and remaining proof before any extension. | Precondition for VQ-09; not a replacement for specular VQ-03. |
| Cross-cutting | [PRD-341](https://github.com/ThreeNativeHQ/threenative/blob/develop/docs/PRDs/AAA-visuals/PRD-341-a-frames-tone-is-a-number-and-the-number-is-a-gate.md) | Tone and luminance assertions | Reuse only missing observations/assertions. A luminance score is not an aesthetic verdict. | Useful for 339, VQ-02 and matched material tests. |
| Cross-cutting | [PRD-342](https://github.com/ThreeNativeHQ/threenative/blob/develop/docs/PRDs/AAA-visuals/PRD-342-where-the-frame-goes-pass-cost-ablation.md) | Measured post-stage ablation | Reuse rather than build another profiler. Inspect current frame/pass instrumentation first. | Useful for 455 and every optional expensive effect. |

## Canonical checkout paths

```text
docs/PRDs/lighting/PRD-269-motion-vectors-or-the-temporal-filters-lie.md
docs/PRDs/unreal-like-features/PRD-455-temporal-reconstruction-from-dynamic-resolution.md
docs/PRDs/AAA-visuals/PRD-339-the-frame-sets-its-own-exposure.md
docs/PRDs/unreal-like-features/PRD-460-invisible-streaming-transitions.md
docs/PRDs/unreal-like-features/PRD-456-distant-world-cell-proxies.md
docs/PRDs/unreal-like-features/PRD-457-virtual-shadows-scale-by-measurement.md
docs/PRDs/AAA-visuals/PRD-344-contact-occlusion-baked-from-the-geometry-it-ships-with.md
docs/PRDs/lighting/PRD-268-light-that-comes-from-off-screen.md
docs/PRDs/AAA-visuals/PRD-341-a-frames-tone-is-a-number-and-the-number-is-a-gate.md
docs/PRDs/AAA-visuals/PRD-342-where-the-frame-goes-pass-cost-ablation.md
```

## Companion work: resume, do not re-file

- [PRD-454](https://github.com/ThreeNativeHQ/threenative/blob/develop/docs/PRDs/unreal-like-features/PRD-454-worldcells-budget-real-resources.md): actual resource budgets; precondition to texture-residency extensions.
- [PRD-458](https://github.com/ThreeNativeHQ/threenative/blob/develop/docs/PRDs/unreal-like-features/PRD-458-open-worlds-hold-60-fps-by-default.md) and [open-world PRD-473](https://github.com/ThreeNativeHQ/threenative/blob/develop/docs/PRDs/unreal-like-features/PRD-473-open-worlds-hold-120-fps-gpu-driven.md): preserve merged GPU/LOD/shadow work and finish remaining visible/performance qualification, including impostor coverage/shadows. Their merged [PR #375](https://github.com/ThreeNativeHQ/threenative/pull/375) still describes open acceptance work. A merge does not establish 60/120 fps.
- [PRD-381](https://github.com/ThreeNativeHQ/threenative/blob/develop/docs/PRDs/feature-mining/PRD-381-nine-mineable-seams-in-eanpa-sky.md): VQ-03 is the bounded local-reflection child for row 5; VQ-08 covers the cloud/overhead-field outcome related to row 4. Record these child links when executing that parent's own admission work; filing a child does not mean its gate passed. Local-shadow row 8 remains coordinated through PRD-457.
- [PRD-343](https://github.com/ThreeNativeHQ/threenative/blob/develop/docs/PRDs/AAA-visuals/PRD-343-a-light-smaller-than-a-pixel-is-still-a-light.md) and [PRD-345](https://github.com/ThreeNativeHQ/threenative/blob/develop/docs/PRDs/AAA-visuals/PRD-345-a-backlit-subject-is-not-a-hole-in-the-sky.md): optional existing work for subpixel emitters and authored backlit readability. Do not implement a compulsory rim light in core.
- [Merged rain/snow PR #382](https://github.com/ThreeNativeHQ/threenative/pull/382): reuse the kits and preserved completed PRDs. Only the reported native bloom regression is added here as VQ-02. Snow rolling resistance is nonvisual physics follow-up and is not silently included in this visual batch.

The repository already has two different PRDs numbered 473. Use **full paths and titles**, not the number alone. New `VQ-01` through `VQ-15` identifiers intentionally avoid allocating more conflicting global integers.

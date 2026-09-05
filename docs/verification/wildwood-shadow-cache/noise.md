# Wildwood ground-speckle diagnosis

Captured 2026-09-05 from the deterministic spawn with no keyboard, mouse, or pointer-lock input.
Every arm used the same 22-second settle, 1280x720 CSS and drawing buffer, DPR 1,
`resolutionScale: 1` (`scaleSource: "auto"`), and the NVIDIA/Turing RTX 2080 adapter. Each run
reported zero console errors and fixed pixels. The baseline stages were ambient occlusion, bloom,
sharpen, SSGI (`ssgiQuality: "low"`), and vignette; denoise was enabled, exposure was `0.94`,
ACES tonemapping was active, and SSR/god rays were disabled.

The GTAO and SSGI toggles were browser-only route rewrites of `quality.ts`; the file on disk and
production render settings were unchanged. `TN_WORLD_ENVIRONMENT` confirmed each applied toggle.

The metric is `mean(abs(Laplacian)) / mean(luminance)` over fixed regions. Baseline-repeat / GTAO
off / SSGI off ratios were:

| Region | Baseline repeat | GTAO off | SSGI off |
| --- | ---: | ---: | ---: |
| ground-mid | 0.707 | 0.702 | 0.556 |
| ground-left | 0.762 | 0.697 | 0.612 |
| ground-right | 0.759 | 0.777 | 0.626 |
| fern-mid | 1.075 | 1.001 | 0.852 |
| canopy | 1.234 | 1.075 | 0.984 |

SSGI contributes to the rendered speckle signal: its ablation moved all five regions in the same
direction. GTAO contributes darkening and changes the foliage/canopy signal, while the pointed
ground region was at the repeat floor (≤0.009) and one ground region moved the wrong way.

This does not prove an exclusive or dominant cause. The normalized Laplacian is a contrast proxy,
not brightness-independent noise: additive lighting can lower its ratio without removing texture
frequencies. One settled frame per arm leaves shadow acne, sharpening, denoiser behavior, and
temporal/moving-camera effects unresolved; no shadow-disable arm was run.

Evidence: [receipt](../../../artifacts/wildwood-performance/noise/receipt.md), [metric JSON](../../../artifacts/wildwood-performance/noise/noise-metric.json), [baseline](../../../artifacts/wildwood-performance/noise/a-baseline.json), [repeat](../../../artifacts/wildwood-performance/noise/a2-baseline-repeat.json), [GTAO ablation](../../../artifacts/wildwood-performance/noise/b-no-gtao.json), and [SSGI ablation](../../../artifacts/wildwood-performance/noise/c-no-ssgi.json).

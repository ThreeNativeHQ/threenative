---
name: threenative-performance
description: Measure ThreeNative frame budgets and report platform evidence without guessing. Use when a frame budget, FPS floor, or platform performance claim is in question, when reading `TN_FRAME_BUDGET`, or when writing a bounded performance assertion.
---

# ThreeNative performance evidence

Refill scratch and pool objects. Static GLBs may use `assets.models.lightmap:{atlasSize,padding}`;
load through `ctx.assets.model()`, remove it to roll back, and never claim Android/iOS from a
web/desktop proof. `TN_FRAME_BUDGET` reports `fps`, `hostGap`, `update`, `render`, `overlay`, and
`residual`; the same window carries `passes`, the draw calls and triangles each render pass
(`main`, `shadow`, `reflection`) submitted, attributed to the innermost active render call so a
nested shadow or reflection pass does not read as main. `defineGame({ frameBudget: false })`
silences output, never measurement.

Unexecuted platforms stay unverified; never invent numbers. Withdraw thermally-confounded Tiers 1–3 comparisons; always report Tier 4. The bounded proof shape is
`{"performance":{"maxFrameMsP95":33,"minFps":30,"maxPhaseMsP95":{"render":12},"maxPassDrawCalls":{"shadow":400}}}` and its
fields are defined in `agent-docs/assertion-reference.md#performance`. `maxPassDrawCalls` and
`maxPassTriangles` bound one pass kind at a time; they fail closed when the run carries no
per-pass split, so keep the frame budget installed.

|Tier|Measure|Floor|Target|
|---|---|---:|---:|
|1|Starter/browser-desktop|60fps|display-refresh|
|1|Starter/browser-Android|30fps|58fps|
|1|Starter/native-desktop|60fps|display-refresh|
|1|Starter/native-Android|55fps|58fps|
|1|Starter/native-iOS|unverified|no-number|
|1|All-platform/hostGap-p95|—|≤4ms|
|1|All-platform/update-p95|—|≤2ms|
|1|All-platform/residual-p95|—|≤0.5ms|
|1|All-platform/overlay-p95|—|≤1ms|
|2|Same-device-fps-parity|.85|.95|
|2|Inverted-render-p95-parity|.80|.95|
|3|Light|55fps|58fps|
|3|Medium|30fps|58fps|
|3|Heavy|30fps|58fps|
|4|Sustained-duration|10min|10min|
|4|Final/opening-fps|.75|.90|
|4|Last-minute-heavy|25fps|50fps|
|4|Peak-battery-temperature|≤45C|≤40C|
|4|Thermal-status|≤2|≤1|
|4|Whole-device-current|—|report;not-gated|

On Android, budget roughly a 500 MiB driver floor before your own textures; a dual-use
equirectangular environment adds about 48 MiB. Fix it with `agent-docs/mobile-memory-budget.md`,
which carries the measurement conditions behind both numbers.

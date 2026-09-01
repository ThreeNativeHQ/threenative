---
name: threenative-visuals
description: Capture, inspect, and budget the player-visible look of a ThreeNative game.
---

# Budget real time for the look

`typecheck`, `lint`, tests, and playtests can all pass on grey boxes and a black screen. A
player-visible feature is done only after opening a real capture and checking silhouettes, depth,
contact shadows, rim light, motion, and the HUD. Spend roughly as much effort on presentation as
mechanics.

Use browser automation on the user's real Chrome when available; otherwise run
`npx @threenative/playtest <scenario> --browser-recipe webgpu --headed`. The recipe includes
`--enable-features=Vulkan`; without it Chromium may use SwiftShader and the runner reports
`TN_PLAYTEST_SOFTWARE_ADAPTER`. **Do not use `xvfb-run`**: its cleanup can replace the real exit
status. A black headless capture is a capture failure until proven otherwise.

For reference matching, solve lighting first: search `engine_search_capabilities` before adding
effects, read `TN_RENDER_CHAIN`, and use `agent-docs/visual-baseline.md` and
`agent-docs/capture-the-frame.md` for the per-file baseline and capture recipe.

For off-screen diffuse light, add `ProbeVolume` after static geometry/lights, bake on demand, and
sample it into a game-owned material before screen-space GI. It owns no look; moving lights need a
new bake. Keep `TN_PROBE_VOLUME`'s stale state, probe count, atlas bytes, progress, and bake cost
visible while tuning bounds, density, and `bakeBudgetMs`.

`renderer.resolutionScale: "auto"` scales only the 3D drawing buffer to hold `display.maxFps`;
never hand-author a device constant. A `(0, 1]` value pins it; invalid values fail at config load.
Both modes report `TN_FRAME_BUDGET.surface` (`resolutionScale`, `scaleSource`, sample count, and
buffer size), and `display: config.display` must reach `defineGame`. See the pixel-budget details
in `agent-docs/visual-baseline.md` and the engine's measurement skill.

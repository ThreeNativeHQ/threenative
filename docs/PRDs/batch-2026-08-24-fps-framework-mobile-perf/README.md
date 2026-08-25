# Batch — fps-framework on a physical Pixel 8: load stall, 19 FPS ceiling, heat, 2026-08-24

**Status:** NOT STARTED. One PRD (218) filed from the probe recorded in
`docs/verification/fps-framework-mobile-perf-2026-08-24.md`. Reported by the game's author as
three symptoms: low FPS on mobile (web fine), device heating, ~30 s loading screen.

## Why one PRD and not three

All three symptoms share one root: **the native main loop (SDLThread) is the only worker and it
never idles** — 12–14 s of synchronous startup work through the loading screen, then ~52 ms of
per-frame work capping the game at ~19 FPS, with no frame cap when content is cheap (idle
conformance build presented 120 FPS on a dark screen). The PRD's three workstreams split by fix,
not by symptom.

## Relationship to existing PRDs

| Existing | Relationship |
| --- | --- |
| PRD-214 (render-js owns the mobile frame) | 218 **feeds** it: the 835-candidate/`batches:0` `TN_RENDER_PROJECTION` decline is new Phase-0 input; the 27.4 s startup hitch 214 excluded as "startup-shaped" is 218's loading workstream. 218 owns nothing 214 already owns. |
| PRD-075 (loading scene separation) | 218's overlay/progress workstream lands on top; no scope overlap. |
| PRD-066 / PRD-069 / PRD-071 | Context for the frame-cost arc; no overlap. |
| PRD-213 (GPU memory accounted) | 346 MB texture upload observed during the stall is a data point for it, not owned here. |

## Outcomes

| PRD | Outcome |
| --- | --- |
| [218](./PRD-218-fps-framework-native-load-fps-heat.md) | The 12–14 s post-first-frame stall is named and either overlapped or budgeted; native loading shows real progress; presents are capped when content is cheap; the batching decline at 835 draws is re-examined against PRD-214's levers. |

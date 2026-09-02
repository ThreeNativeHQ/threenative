# PRD-315 Phase 0 — Wildwood baseline, and the first fresh measurement

**Machine**: Linux, RTX 2080, Chromium under a private Xvfb via `tools/capture-lock.sh`, headed with
the playtest WebGPU flags; adapter reported `nvidia | turing` on every run. Viewport 1280x720,
`?lowtier` (sharpen + bloom chain), Vite dev server, cold browser context per run with the HTTP
cache disabled. Tool: `sandbox/wildwood/tools/measure-startup.mjs`.

**Versions**: engine `b14b27b9` at the PRD's inspection → `50ad4285` after this session's landings;
game `146e172` → `ea7bf01`; installed asset MCP 0.7.0 with import report version 45 (the report
and the installed module disagreed at inspection time; not re-run here).

## Baseline (game `146e172`, stale `models: "none"` bake serving 4x source bytes)

| run | DCL | valley built | startup ready | first non-white frame | total MB |
|---|---:|---:|---:|---:|---:|
| 1 | 353 | 9540 | 26994 | 533 | 1113.9 |
| 2 | 327 | 21872 | 45562 | 379 | 1113.9 |
| 3 | 440 | 10483 | 28111 | 662 | 1113.9 |
| 4 | 302 | 9339 | 26975 | 555 | 1113.9 |
| 5 | 320 | 9287 | 26765 | 688 | 1113.9 |

Every asset checked was stale: `SK_Fox.glb` 4.5 MB source / 19.5 MB served, `SM_pine01.glb`
9.2 MB / 37.5 MB. `TN_STARTUP_WARMUP` timed out with `compiled: 0` at 16.5 s. The first frame was
never white: it was the page's own dark backdrop, the loading bar did not exist until `enter()`.

## Fresh (game `ea7bf01`: shared images, critical/detail tiers, loading view in `load()`)

| run | DCL | valley built | startup ready | first non-white frame | total MB | before valley MB |
|---|---:|---:|---:|---:|---:|---:|
| 1 | 368 | 2107 | 15069 | 594 | 102.4 | 102.4 |
| 2 | 58587 | 60110 | 74285 | 60606 | 163.3 | 123.7 |
| 3 | 305 | 1778 | 14964 | 588 | 142.0 | 102.4 |
| 4 | 282 | 1866 | 16064 | 580 | 142.5 | 102.9 |
| 5 | 275 | 1658 | 15352 | 567 | 143.0 | 103.4 |

Run 2 stalled 58 s before `DOMContentLoaded` in Vite's dependency re-optimisation after the
package reinstall (its largest resources are `/node_modules/.vite/deps/*`); it is reported, not
averaged away. On the other four runs the valley is built 1.7–2.1 s after navigation.

Readiness is now 13 s behind the valley: `TN_STARTUP_WARMUP:{"compiled":1,"slices":1,
"elapsedMs":11358,"timedOut":false}` — the whole-scene first-use compile finishes, and it takes
11–12 s, then the sustained-frame window. That is the next startup cost and it is the engine's
warmup, not bytes.

Playtest evidence, `playtests/startup.playtest.json` through the engine runner at `50ad4285`
(`assert.startup`, the observation landed in `9802e46b`):

```text
ok   startup.enteredMs   observed 1914 <= 2500
FAIL startup.readyMs     observed 16663 > 8000   TN_PLAYTEST_STARTUP_TOO_SLOW
ok   diagnostics         0 console errors, 0 network errors, runtime ready
ok   movement.distance   walker 6.96 m
timeline: loadStarted 826, entered 1914, compileSettled 14252, ready 16663
```

The sky HDR failure seen on the first fresh runs (`TN_SKY_HDRI_FAILED: bad initial token`) was
a hard-coded hashed output name; the game now resolves it through the manifest, and
`ctx.assets.resolve(path)` (`910a35ac`) is the engine surface for that from the next tarball.

## Stop-gate note

The PRD's Phase 0 stop gate asked whether a fresh compile alone removes the visual animal defect.
Not answered here: the animals load in the detail tier and no visual arm was captured in this
record; `stripJunkTriangles` is still in `Animal.ts`. Phase 4's measurements remain open.

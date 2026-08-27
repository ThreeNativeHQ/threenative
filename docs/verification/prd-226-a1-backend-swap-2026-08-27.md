# PRD-226 arm A1 — Dawn against wgpu-native on the same scene, 2026-08-27

**Lane:** desktop, display `:0`, `SDL_VIDEODRIVER=x11`, NVIDIA RTX 2080. Both arms at HEAD
`d17de550`, **unprofiled**, running the identical game bundle
(`~/projects/threenative/sandbox/fps-framework/.threenative/build/game.js`, mtime 2026-08-27 00:52).
Six runs, **interleaved** dawn/wgpu × 3 so shared machine load falls on both arms equally.

| Arm | Build dir | Backend | Binary sha256 (first 32) |
| --- | --- | --- | --- |
| A1-control | `packages/runtime-native/build/tn-linux` | **Dawn** | `44397cc44f98c7676b8164683a0ca351` |
| A1-treatment | `packages/runtime-native/build/tn-linux-wgpu` | **wgpu-native** | `0a1fc92c5ddad9e5e748f488d56fe46f` |

The Dawn binary is byte-identical to the one a sibling lane recorded independently at 09:31, which
also confirms the build is reproducible across a mutate-and-revert cycle.

Every run produced a non-blank 1280×720 screenshot of the real Bayview street scene; all six exited 0.

## Result — the backend is not the owner

```
                fps    frame.p50   render.p50   update.mean   hostGap.p50   load at start
dawn  run1 w1  26.56     29.35        25.31        4.08          0.69          12.81
dawn  run1 w2  31.33     30.56        26.05        4.30          0.76
wgpu  run1 w1  28.67     27.46        23.87        3.47          0.63          18.47
wgpu  run1 w2  43.22     21.74        18.65        3.03          0.52
dawn  run2 w1  46.71     13.94        12.83        1.13          2.81          18.85
dawn  run2 w2  59.67     13.05        11.67        1.44          3.56
wgpu  run2 w1  47.51     14.05        12.67        1.19          2.30          13.55
wgpu  run2 w2  59.81     13.25        11.62        1.62          3.33
dawn  run3 w1  48.31     12.95        11.90        1.08          3.40          11.55
dawn  run3 w2  59.63     13.58        12.03        1.53          3.08
wgpu  run3 w1  48.52     13.85        12.69        1.17          2.73           8.76
wgpu  run3 w2  59.77     12.95        11.40        1.52          3.69
```

Steady-state arms (runs 2–3, see the warm-up finding below), `render.p50` in ms:

| Arm | run 2 | run 3 | Median |
| --- | ---: | ---: | ---: |
| Dawn | 11.67 | 12.03 | **11.85** |
| wgpu-native | 11.62 | 11.40 | **11.51** |

**Δ = −0.34 ms (3%), in wgpu-native's favour — flat.**

**This eliminates one of PRD-226 Phase 5's three architectural outcomes.** Chrome runs Dawn; if the
Rust backend were the reason native costs ~3× what Chrome costs, swapping in Chrome's own backend on
the same scene would have shown it. It does not. wgpu-native is not the defect, and no further work
should be spent on a backend swap or an upstream wgpu fix on that hypothesis.

## Two findings the arm was not looking for

### 1. The first two runs of a block are 2× slow, and no previous protocol discarded them

`render.p50` for run 1 is **26.05 ms (Dawn)** and **18.65 ms (wgpu)**, against 11.4–12.0 ms for every
run after. Same binary, same bundle, back to back, and the effect crosses the arm boundary — it is
the *block's* first runs that are slow, not each arm's. Machine load does not explain it: Dawn run 2
started at load 18.85, higher than Dawn run 1's 12.81, and was fast.

`substeps.mean` moves with it (1.92 → 1.01) but is a **symptom, not a cause**: a slow frame needs
more physics substeps to catch up, which makes the frame slower. Reading it as a cause inverts the
loop.

The recorded protocols for every lever so far discard **window 1 within a run** ("window 1 always
lies") and then keep all three runs. On this evidence that is not enough — **the first two whole runs
of a session must be discarded as warm-up**. A three-run A/B that keeps run 1 mixes a 26 ms sample
into a 12 ms population, which is exactly the ±100% spread that made Levers A and C undecidable.

### 2. The desktop lane resolves better than believed, once warmed

Post-warm-up spread within an arm is **0.6 ms** (Dawn 11.67/12.03, wgpu 11.62/11.40), not the ±15%
the fix plan assigned to `render.p50`. Warmed, this lane resolves a ~1 ms lever. `fps` remains
useless here — both arms sit at 59.6–59.8, vsync-capped, with `frame.p50` 13 ms inside a 16.7 ms
budget — so **judge `render.p50`, never fps**, which restates F11 for the `:0` lane as well as Xvfb.

## What this does not establish

- **No cross-session comparison is made.** Today's 11.5–11.9 ms native `render.p50` cannot be set
  against the recorded 22.2 ms: a sibling lane measured the *same host revision* at half yesterday's
  per-call prices today, and the game bundle was rebuilt at 00:52 by another lane
  (`update.mean` 1.5 ms today against 4.0–4.9 in the baseline era). The scene is lighter and the
  machine is faster. Any statement of the form "native desktop improved" is unsupported.
- **No Chrome arm ran today.** The A5 arm is required before the native-against-Chrome ratio is
  restated on this bundle; the recorded 7.3–8.9 ms is from a different session and a different
  scene weight.
- **Nothing here touches the device.** The Pixel 8 measured **20.44 fps** this morning against a
  30 fps floor. That number is unaffected by this arm and remains the open problem.

## Disclosure ledger

- Machine load was 8.8–18.9 across the block — **not quiet**. The interleave is the mitigation: each
  arm took its turn under comparable load, and the loads are stamped per run above. A quiet-window
  repeat is still owed.
- A sibling lane (`prd-224-phase1-pricing-2026-08-28.md`) was active on the same machine; the load
  above is partly its builds and partly this lane's.
- Only two `TN_FRAME_BUDGET` windows landed per 900-frame run rather than three; the third does not
  flush before the screenshot exit. Windows are reported individually and never averaged.

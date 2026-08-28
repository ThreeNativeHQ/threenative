# Engine parity benchmark — one scene, built twice

**Purpose: answer "is the native runtime Godot-class?" with a number nobody can dismiss.**

The 2026-08-11 measurements could not answer it. They compared two different fox platformers: the
Godot one renders real-time shadows, denser foliage and better-graded lighting, while ours reaches
its frame rate partly by folding 2,282 objects into ~25 draws. Both differences push the result in
our favour and neither is a property of the engine. See
[runtime-perf-state.md](../verification/runtime-perf-state.md).

This file is the specification both arms implement. **An arm that cannot satisfy a row here is
reported as failing that row, never quietly adjusted.**

## The scene

Deliberately dull. Nothing here is art direction — it is a workload with knobs.

| Property | Value | Why it is pinned |
|---|---|---|
| Geometry | Box, 1×1×1, 24 vertices indexed | Identical vertex counts in both engines |
| Object count `N` | swept: 500, 1000, 2000, 4000 | The axis that decides everything |
| Moving fraction `M` | swept: 0%, 50%, 100% | **The axis that defeats a merge pass.** At 100% nothing can be folded and both engines pay per object |
| Layout | deterministic grid from a fixed seed | Same positions in both arms |
| Motion | `y += sin(t + index)` per moving object, per frame | Cheap, and forces a transform update the renderer cannot skip |
| Materials | 8 distinct instances, assigned `index % 8` | Enough to prevent a single-draw merge, few enough to stay realistic |
| Shading | one directional light with shadows + one ambient | Matched, and the thing our fox subject and the Godot subject most disagreed on |
| Shadow map | 2048×2048, single cascade | Named because a default difference here is worth more than the result |
| Camera | fixed position, fixed FOV 60°, looking at the grid centre | No camera path, so no frustum-culling luck |
| Resolution | the device panel, no scaling | A resolution difference invalidates everything |
| Present | **vsync disabled in both arms**, and each arm prints the mode it actually got | A capped run measures the panel; the first Godot pass made exactly this mistake |
| Duration | 300-frame windows, 7 windows, first discarded | The first window carries shader compilation |

## What is reported

Per arm, per `(N, M)` cell:

| Metric | Definition |
|---|---|
| `fps` | median of windows 2–7 |
| `worstFrameMs` | maximum single frame across windows 2–7 |
| `coldStartMs` | process start to first presented frame, 5 launches, p95 |
| `packageBytes` | release package, stripped, arm64 only |
| `peakRssKb` | `VmHWM` of the process |

## Rules that make it fair

1. **Both arms uncapped, both arms print their present mode.** A run whose arm reports a capped
   mode is void.
2. **Release builds on both sides.** Our 2026-08-11 figure of 152 MB was an unstripped debug APK
   compared against a Godot debug export; that comparison was meaningless in both directions.
3. **Same device, same session, alternating order**, so thermal drift hits both arms evenly.
4. **The collapse stays on.** Turning off `SceneCollapse` to look honest would be the wrong
   correction — it is part of the runtime, and the `M = 100%` column is what measures the case it
   cannot help with. Its report is recorded per cell so a reader can see what it folded.
5. **No arm gets a hand-tuned scene.** If one engine needs a workaround to hit the spec, that
   workaround is a finding and belongs in the result.

## What each outcome would mean

- **Comparable at `M = 100%`** — the strongest possible result. It would mean interpreted
  JavaScript is not the ceiling anyone assumes, and the runtime is engine-class on the workload no
  pass can rescue.
- **Comparable at `M = 0%`, behind at `M = 100%`** — the expected result, and still a real claim:
  the runtime matches for scenes dominated by static geometry, and the gap is per-object
  JavaScript, quantified in µs per object per frame.
- **Behind at every `M`** — then the honest sentence is that the runtime is fast enough for the
  games measured so far and is not Godot-class, and the value proposition drops the comparison
  entirely rather than hedging it.

**No result here changes what the framework is for.** Godot is not the competitor the charter
names; vanilla Three.js is. This benchmark exists because "will my game run on a phone" is the
question a user actually asks, and Godot is the yardstick they will reach for.

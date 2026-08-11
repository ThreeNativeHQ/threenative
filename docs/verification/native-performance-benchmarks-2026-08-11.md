# Native performance benchmarks — Pixel 8, 2026-08-11

**One phone, one afternoon, three engines running a fox platformer.** This is the file to quote
from when someone asks whether the native runtime is fast enough to be worth having. Every number
here was executed on a physical **Pixel 8** (`shiba`, serial `37251FDJH0037Z`, arm64-v8a,
Android 17). Nothing is an emulator, a simulator, or a desktop result standing in for a phone.

Read the caveats in §4 before quoting §1. Two of the three subjects are **different
implementations of the same game**, not the same scene, and that bounds what the comparison can
claim.

## 1. The headline

**The one-line read: a clear win against the browser, unresolved against Godot.** The browser arm
is the identical codebase with a different runtime beneath it, so it is the only row here that
compares an engine rather than two games.


| | ThreeNative native | The same game in Chrome | Godot 4.7.1 |
|---|---|---|---|
| Sustained frame rate | ~106 fps median, uncapped | 59.95–60.02 fps, vsync-locked | **53.7–59.5 fps, uncapped** |
| Typical frame cost | **8–9 ms** | — (capped, cost not observable) | — (capped, cost not observable) |
| Worst frame, steady state | 10–11 ms | 19.6–22.5 ms | 25.0–33.6 ms |
| Windows below 60 fps | 0 of 253 | n/a — pinned at 60 | 7 of 7 |
| Android package | 152 MB **debug, unstripped** | n/a | **34.1 MB** debug |

**This is not a fair comparison, and it must not be quoted as one.** It compares two different
games. The Godot subject renders real-time shadows, denser foliage and better-graded lighting than
ours does — it is doing more work for its number — while ours reaches its number partly by folding
2,282 objects into ~25 draws. Both effects push the table in our favour and neither is a property
of the engine.

**What the numbers do establish**, narrowly:

- Godot was re-measured with vsync **disabled** (`TN_GODOT_VSYNC:0`) after a first pass wrongly
  left it capped. ~58 fps is its genuine ceiling on its own scene, not a panel limit.
- Chrome cannot be uncapped at all: `requestAnimationFrame` is bound to the display refresh and no
  page-level setting escapes it. Its 60.0 is a ceiling; its 19.6–22.5 ms worst frames are the only
  signal of cost, and they sit at the edge of the budget.
- Our runtime sustains 60 fps on a real game with headroom to spare. Against *itself*, that is a
  measured improvement from 21.8 fps.

**The engine-versus-engine question is open** and §5 specifies the environment that would close
it.

## 2. Where the frame goes

ThreeNative native, driven with the on-screen controls, timed inside the loop:

| Component | At rest | Driven |
|---|---|---|
| Game's own update | 0.45 ms | 0.45 ms |
| `SceneCollapse` transform refresh | 1.85 ms | 2.01 ms |
| `renderer.render` | 8.5 ms | 15.0 ms → **3.6 ms** once the HUD is folded |
| Native bindings, submit, present | ~1 ms | ~1 ms |

The measurement that mattered: the scene draws ~110 objects, of which **~93 were the HUD**.
`SceneCollapse` excluded camera-parented subtrees by construction, so a HUD every game has was
never folded. Folding it took 76 overlay meshes to 11 draws, `renderer.render` from 15.0 ms to
3.6 ms, and the game from 57 fps to 170 fps with the HUD hidden entirely.

**Per-draw cost on this device is roughly 118 µs of interpreted JavaScript.** That figure, not the
engine, is what bounds a Three.js scene on a phone — and it is why the framework's answer is to
remove draws rather than to swap the interpreter.

## 3. Startup

| | Before this work | After |
|---|---|---|
| Launch → first frame | 2,877 ms | **1,051–1,520 ms** |
| Worst single frame | 3,474 ms | **1,199 ms** |
| p99 frame during startup | 118 ms | **83 ms** |
| `SceneCollapse` bake | 3,608 ms in one frame | **~1,450 ms spread across frames** |
| What the player sees | a map assembling in pieces, then a freeze | a progress bar, then the finished world |

Cold start breaks down as 8.0% JavaScript parse and compile against **86.8% first rendered
frame** — which is why precompiled bytecode was priced and rejected, and why the fix was to stop
drawing during startup at all. Geometry that is hidden is never drawn, so the shaders for the
thousands of meshes the collapse is about to merge away are never compiled.

Godot's own first window on this phone reported a 150 ms worst frame, which is its comparable
startup cost.

## 4. What bounds every number above

Stated plainly, because these are the reasons not to over-claim:

1. **The two fox games are different codebases.** `~/projects/fox-native` is 2,282 meshes of
   procedural Three.js; `~/projects/godot-foxgame` is ~2,900 lines of GDScript building its own
   world. Similar art direction, similar scale, **not the same scene**. Both are pictured in
   `visuals/native-benchmarks-2026-08-11/`, and the Godot subject is arguably the heavier of the
   two — it renders shadows and denser foliage. A controlled comparison needs one scene
   specification built twice.
2. **Chrome and Godot were vsync-locked; ThreeNative was not.** The native runs used
   `mailbox` present, so ~106 fps is a real uncapped rate, while 60.0 is a ceiling. The
   comparable quantity is worst-frame cost, which is why §1 leads with it.
3. **The package sizes are not comparable.** 152 MB is an unstripped debug APK; the stripped
   arm64 runtime alone is 18.4 MB with 9.5 MB of SDL3 beside it. **No release build has been
   measured**, so the honest statement is that Godot ships 34 MB and our release size is unknown.
4. **The frame rate is bought by a pass, not by the interpreter.** ThreeNative reaches ~106 fps
   because `SceneCollapse` turns 2,282 objects into ~25 draws. A scene whose objects genuinely all
   move independently cannot be folded, and would fall back to ~118 µs per draw of interpreted
   JavaScript — where Godot's C++ scene tree would win. **That shape is untested and it is the
   one that decides whether the runtime is Godot-class in general.**
5. **One device, one afternoon, one thermal state.** No repetition across battery levels or
   ambient temperature.

## 5. The test that would settle it

The comparison this record cannot make: **N independently moving cubes, swept at 500 / 1,000 /
2,000 / 4,000, built to one specification in both engines.** Everything moves, so no merge can
rescue either side, and it measures the engine floor rather than the quality of a pass. Same
phone, same four numbers: sustained fps uncapped, cold start, release package size, peak RSS.

Until that runs, the claim this file supports is the narrow one: **on a real game of a few
thousand meshes, the native runtime holds 60 fps with headroom where a browser and Godot both sit
on the cap.**

## 6. Reproduce

```sh
# ThreeNative native, cold start breakdown, five launches, fails closed
node packages/runtime-native/scripts/measure-cold-start.mjs \
  --device 37251FDJH0037Z --launches 5 --optimization -O2 \
  --report packages/runtime-native/artifacts/android/cold-start/fox-native-O2.json
```

Frame rate comes from `TN_FRAME_HITCH` (native, per-launch distribution) and
`TN_FOX_NATIVE_FRAME_RATE` (per-window fps and worst frame) in logcat. The Godot arm was exported
with `godot --headless --export-debug Android`, with a temporary autoload printing
`TN_GODOT_FRAME_RATE`; that probe and its export preset were removed from
`~/projects/godot-foxgame` afterwards, so reproducing it means adding them back. The browser arm
served the fox web build over `adb reverse` and read the game's own frame-rate marker.

Related: [native-gameplay-frame-rate-2026-08-11.md](native-gameplay-frame-rate-2026-08-11.md) for
the HUD finding, [cold-start-and-hitches-2026-08-11.md](cold-start-and-hitches-2026-08-11.md) for
the startup instrument and what it retired.

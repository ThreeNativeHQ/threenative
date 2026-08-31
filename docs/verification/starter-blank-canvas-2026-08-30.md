# Starter scaffold renders a black canvas on a real GPU — 2026-08-30

**Status: OPEN, reproduced twice, not diagnosed.** Filed from the session that was unblocking CI;
this is not that lane's subject and is recorded here so it is not lost.

## What was observed

`pnpm tsx scripts/verify-one-template.ts starter` on this machine, run twice against `e22139c5`:
**12 of 21 scenarios report `TN_CAPTURE_BLANK`**, with an identical failure set both times.

| Result | Scenario | Diagnostics |
| --- | --- | --- |
| FAIL | `starter-jump-buffer`, `starter-coyote-and-buffer`, `starter-forward`, `starter-hot-reload-subject`, `starter-area-monitoring`, `starter-deferred-motion-odometer`, `pause`, `play`, `starter-react-restart` | `TN_CAPTURE_BLANK` |
| FAIL | `starter-look`, `starter-models`, `survives`, `starter-textures` | `TN_CAPTURE_BLANK` + `TN_PLAYTEST_ASSERTION_NOT_EVALUATED` on their `visual.*` rows |
| FAIL | `starter-zoom-wheel` | `TN_PLAYTEST_BRIDGE_MISSING` — separate, and seen before |
| PASS | `starter-assets`, `starter-cloth-flag`, `starter-game-over`, `starter-goal`, `starter-respawn`, `seed`, `starter-zoom-pinch` | |

## The capture is not blank — the 3D canvas is

`after.png` from `05-playtests-forward.playtest.json` is attached as
[`starter-blank-canvas-2026-08-30.png`](./starter-blank-canvas-2026-08-30.png). The React HUD
renders correctly — SCORE, LIVES, the POSITION bar, the control legend, the pause and restart
buttons — and everything behind it is black except one faint blue band. **The DOM is right and the
canvas is empty**, which is the signature of the frame never reaching the composited screenshot,
not of a scenario driving the game wrong.

## RESOLVED DIAGNOSIS, same day — it is the loading screen, not the renderer

**Everything below this section was written before the cause was found, and two of its conclusions
are wrong. They are kept because the ruling-out is still valid evidence.**

The black frame **is the starter's own loading screen**, photographed before the game finished
loading. The tell was in the screenshot the whole time: the faint blue band across the middle is the
loading bar, at exactly `loading.bar.anchorY: 0.72` — 518 px down a 720 px frame. The React HUD is
DOM and draws regardless, which is why it looked like "correct DOM, empty canvas".

### The measurements that settle it

A probe against the same scaffold, same commit, **under a private Xvfb**, waiting 6 s after the
canvas appears:

| Capture path | Result |
| --- | --- |
| `page.screenshot` | **1280x720, 515,630 bytes, the full scene** — [screenshot](./starter-blank-canvas-2026-08-30-scene-under-xvfb.png) |
| `canvas.toDataURL("image/png")` | **1280x720, 833,820 bytes, the full scene** |

So under Xvfb, on this machine, with the real NVIDIA adapter, **both capture paths render the scene
correctly**. The only difference between a blank capture and a good one is *how long the run
waited*.

Two things this retracts:

1. **The private-Xvfb default (`bbf0813c`) did not cause this.** An earlier reading of "Xvfb blank,
   host display pass" looked decisive and was a coincidence: the host-display run came second,
   against a warm vite server whose module graph was already compiled, so its assets were ready
   before the capture. The variable is load time, not the display.
2. **It is not a render regression, and not the post chain.** Forcing the mobile preset — bloom and
   sharpen only, no SSGI, SSR or denoise — produced a **byte-identical** black frame. `prd278-followup`'s
   99.10% nonblank measurement still stands.

### The actual defect, and where it belongs

**The runner photographs whatever is on screen when the scenario ends, including a loading screen,
and reports it as the game's frame.** That is the same family as `starter-seed`: an outcome that
depends on how long boot took. It is an engine bug, in `packages/playtest`, not a game bug.

`ctx.startup.phase` (`"collapsing"` | `"ready"`, `packages/core/src/game.ts`) is already the exact
signal, and the starter's loading screen already closes on it. What is missing is that the bridge
does not report it and the runner does not wait for it.

**The fix:** publish startup readiness through the playtest bridge, and have the runner wait for it —
bounded — before taking the after-capture, failing closed with a named code if it never arrives
rather than photographing the loading screen. `warmupFrames` is the wrong lever: counting frames is
the race, not the cure.

Until that lands, a scenario that must see the game can hold longer, but no scenario should have to.

### Which commit — bisected to `739f2436`, and both named suspects are innocent

`fdafd9ba..e22139c5` bisected with one scenario (`forward`), one scaffold per commit built from
that commit's own tarballs, every run under a private Xvfb on the NVIDIA `turing` adapter. The
check was the PNG, not the exit code.

| Commit | | Frame |
| --- | --- | --- |
| `fdafd9ba` | the measured-green baseline | renders |
| `ee63eea9` | **`worldEnvironment.ts` + visual pipeline — suspect, innocent** | renders |
| `7a664b02` | | renders |
| `9ec91dee` | **parent of the culprit** | renders |
| `739f2436` | **`feat(starter): boot into the game, delete the main menu screen`** | **loading screen** |
| `e7365299` | | loading screen |
| `e69c737f` | **virtual geometry on by default — suspect, innocent** | loading screen |
| `e22139c5` | the commit this file was filed against | loading screen |

The two commits this file nominated are both on the renders-fine side or downstream of the flip:
`ee63eea9` renders, and `e69c737f` only inherits an already-black frame. `b43b3f87` is not even in
the range — it precedes `fdafd9ba`. **Nothing about what the frame is made of changed.**

`739f2436`'s entire render-relevant diff is `start: "menu"` → `start: "play"`. That is the whole
mechanism: the menu scene used to absorb startup load in wall-clock time, so `Play` was entered
already-ready and its loading screen closed almost immediately. Booting straight into `Play` moved
that wait inside the scenario, where a fixed-step runner burns 300 ticks in a fraction of the time
the load takes. **The runner bug was always there; deleting the menu removed the cushion hiding it.**

The same-commit control, which is what makes it the loading screen rather than a render regression —
identical scaffold, identical build, only `warmupFrames` 10 → 600:

| `739f2436`, `warmupFrames: 10` | `739f2436`, `warmupFrames: 600` |
| --- | --- |
| [loading screen](./starter-blank-canvas-2026-08-30.png) | [the game](./starter-blank-canvas-739f2436-warmed.png) |

Re-run at `e22139c5` the same way: blank at 10, the full scene at 600. So `739f2436` is still the
live cause at the tip of the range, with nothing else piled on top.

This does not make `739f2436` the thing to revert — booting into the game is right, and the defect
it exposed is the runner's. It names where the cushion went.

---

## What has been ruled out

1. **Not a software rasteriser.** `capture.json` reports `{"architecture": "turing", "vendor":
   "nvidia"}`, `rendererKind: "webgpu"`, `captureMethod: "page.screenshot"`. No SwiftShader.
2. **Not the display strategy.** The run reports
   `{"captureDisplay":{"display":":1","screen":"1600x900x24","strategy":"private-xvfb"}}`, and the
   adapter above is the real GPU under exactly that Xvfb. The private-Xvfb default landed in
   `bbf0813c`, and the template gate already ran under `sh scripts/xvfb.sh` before it.
3. **Not the unpatched `three`.** The scaffold's store carries
   `three@0.185.1_patch_hash=ca1794e24af5fdb37e27fd9d609dd502860e321e79b544e3811c64fc0115f36c`,
   the exact hash [prd278-followup-2026-08-30](./prd278-followup-2026-08-30.md) records for the
   WebGPU-instance retention fix. That patch is present.
4. **Not a chain that refused to build.** The page logs
   `TN_RENDER_CHAIN:{"applied":{"dropped":[],"requested":["ssgi","ssr","sharpen","bloom"],
   "source":"pinned","stages":["ssgi","ssr","sharpen","bloom"],"tier":"high", …}}` and
   `TN_WORLD_ENVIRONMENT` reporting `bloom`, `sharpen`, `ssgi` and `ssr` all `applied: true`. The
   chain believes it ran. There are **no console errors**.

## Why this matters more than a red lane

[prd278-followup-2026-08-30](./prd278-followup-2026-08-30.md) records the opposite result on the
same hardware after `fdafd9ba`: *"the screenshot was 99.10% nonblank"* on headed Chromium with the
NVIDIA RTX 2080. So this is a regression against a measured green, somewhere between `fdafd9ba` and
`e22139c5` — a window that contains the `WorldEnvironment` port into the starter (`b43b3f87`,
`ee63eea9`) and virtual geometry on by default (`e69c737f`). *(Bisected since: it is `739f2436`,
and neither nominated suspect is involved — see "Which commit" above.)*

**CI cannot see it.** `golden-path` runs `scripts/non-visual-scenarios.mjs`, which kept 13 scenarios
and left 8 to "the lanes with hardware"; `visuals` was `skipped` in every run of this batch. A
scaffolded starter can therefore render nothing and every gate stays green.

## The next probe, and what not to do

~~Bisect `fdafd9ba..e22139c5`~~ — **done**, see "Which commit" above: `739f2436`, and the two
commits nominated here were both measured innocent. What is left is the fix named in the resolved
diagnosis: publish `ctx.startup.phase` through the playtest bridge and have the runner wait on it,
bounded, before the after-capture.

Do **not** conclude from a passing `pnpm test` or a green `golden-path` that this is fixed: neither
looks at these frames. The check is the PNG.

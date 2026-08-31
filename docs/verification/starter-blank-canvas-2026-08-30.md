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
`ee63eea9`) and virtual geometry on by default (`e69c737f`).

**CI cannot see it.** `golden-path` runs `scripts/non-visual-scenarios.mjs`, which kept 13 scenarios
and left 8 to "the lanes with hardware"; `visuals` was `skipped` in every run of this batch. A
scaffolded starter can therefore render nothing and every gate stays green.

## The next probe, and what not to do

Bisect `fdafd9ba..e22139c5` with one scenario — `forward` is the cheapest — in a throwaway scaffold,
as [prd278-followup-2026-08-30](./prd278-followup-2026-08-30.md) did with `/tmp/wn-starter2`. The
two commits worth testing first are `b43b3f87` (WorldEnvironment into the starter) and `e69c737f`
(virtual geometry on by default), because both change what the frame is made of.

Do **not** conclude from a passing `pnpm test` or a green `golden-path` that this is fixed: neither
looks at these frames. The check is the PNG.

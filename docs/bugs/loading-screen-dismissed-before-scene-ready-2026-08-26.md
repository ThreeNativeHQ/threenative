# Loading screen is dismissed before the scene is ready — 2026-08-26

**Status: fixed** by commit b6d3a9bf (fix(core): keep loading screen until scene is ready); the fix
was audited and re-proven on the desktop native lane on 2026-08-27, see [Proof](#proof) below.
Reported by the owner while reviewing PRD-222 desktop measurements; reproduced on the desktop
native host.

## What happens

The native host presents the game, the loading screen goes away, and the game then stalls for
several seconds before running normally. The player is handed a visibly frozen first few seconds.

The frame counter is already advancing during that stall, so the frames are being presented — the
scene simply is not ready to run at the rate it will settle to.

## Why it matters beyond the player experience

It silently corrupts performance measurement. Any whole-run average includes the stall:

| Session | First 200 frames | Steady-state frame time (900−200 differenced) |
| --- | ---: | ---: |
| A | 15.2 s (76 ms/frame) | 20.9 ms (47.9 fps) |
| B | 5.2 s (26 ms/frame) | 33.5 ms (29.9 fps) |

The startup block is **not reproducible between sessions — a 3× swing on the same binary and the
same scene**. A whole-run average inherits that swing, which is how a withdrawn 4.1× parity figure
was produced in
[the PRD-222 reassessment](../verification/prd-222-reassessment-2026-08-26.md). Every PRD-222 arm
must discard the startup block explicitly, as the frame-226 window already does; no arm may quote a
whole-run average.

## What is not yet known

Which work owns the stall. Candidates, none confirmed: shader/pipeline construction continuing after
the first present (the steady-state CPU profile shows `build`, `setup`, `analyze`, `generate`,
`createProgram` and `createImageBitmap` dominating before frame 226 and vanishing after it), asset
decode, or the first-frame deoptimization transient (466 of 588 `--trace-deopt` events fall in
frames 50–99).

## Fix direction

The loading screen must stay up until the scene is actually ready to run, rather than until the
first frame presents. That requires a readiness signal that accounts for whatever the stall turns
out to own — most likely "all pipelines compiled and first N frames within budget" rather than
"first present issued".

## Reproduce

```sh
cd <game>/.threenative/build
DISPLAY=:0 SDL_VIDEODRIVER=x11 <engine>/packages/runtime-native/build/tn-linux-wgpu/mystral \
  run game.js --screenshot /tmp/n.png --frames 200
# compare against --frames 900; difference the wall times to separate startup from steady state
```

## Proof

`pnpm native:verify:loading`, desktop native host (tn-linux, V8 + Dawn), 2026-08-27,
artifact `packages/runtime-native/artifacts/desktop-loading-2026-08-27T05-53-19-615Z/`. The game's
renderer is fixture-patched so `compileAsync()` holds for 3 000 ms; the gate must hold the loading
screen across that span and dismiss only after it settles.

```
TN_LOADING_PROOF_OVERLAY_VISIBLE
TN_LOADING_PROOF_COMPILE_START
TN_COLD_START:{"segment":"first_frame","atMs":131.245}
TN_PRESENTS_TICK:{"frames":60,...,"capHz":60}
TN_LOADING_PROOF_COMPILE_END:{"elapsedMs":2904,"outcome":"native-stall-fixture"}
[log] TN_STARTUP_WARMUP:{"compiled":1,"slices":1,"elapsedMs":2905,"unsupported":false,"abandoned":0,"timedOut":false}
TN_LOADING_PROOF_DISMISSED
```

Screenshots: overlay present at both stall samples (4 096 magenta pixels), absent at settle
(0 pixels); 60 presents ticked during the stall — the loop never stopped presenting. Readiness
resolved from the compile settling plus the sustained in-budget frame window; the compile was not
abandoned and the 15 s budget was not approached.

**Lane caveat:** desktop Dawn resolves `compileAsync()`. On Android wgpu-native, where the promise
historically never settles, the same gate is bounded by `STARTUP_COMPILE_BUDGET_MS` (15 s) rather
than proven cheap; a device-lane measurement is still owed before quoting an Android launch cost.

**Verification trap hit while proving this:** the first two reruns were red with instant dismissal
and no warm-up markers at all. The game bundle had baked a pre-fix `@threenative/core/dist`
(stale-build trap). Rebuilding core (`pnpm --filter @threenative/core build`) before
`native:verify:loading` cleared it; the failures were not a code regression.

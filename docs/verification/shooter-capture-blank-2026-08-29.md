# The shooter input capture was photographing the loading screen — 2026-08-29

`packages/playtest/__tests__/generated-shooter-input.spec.ts` had been red on `main` long enough to
be treated as a standing capture-lane fact. It is not a capture-lane fact. The scenario was taking
its screenshot before the game had finished loading, and the blank-capture guard was correctly
refusing the frame.

## The red, reproduced

```console
$ pnpm exec vitest run packages/playtest/__tests__/generated-shooter-input.spec.ts
positive-run diagnostics: [{"code":"TN_CAPTURE_BLANK","message":"Visual capture 'input-look-right.png' was blank: bright pixel ratio 0.04470 is below 0.05.", ...}]
 × should turn, aim, and fire the generated shooter
Tests  1 failed | 2 passed (3)
EXIT=1
```

It is deterministic, not a flake: the same `0.04470` appears on an isolated re-run and on a run with
every unrelated change stashed at `07dfaf63`.

## What the frame actually contained

The spec deletes its scaffold, so the run was reproduced against a kept scaffold with the same
hardware WebGPU arguments. Measuring the two captures of that run with `inspectFrame`:

| Capture | distinctColors | brightPixelRatio | luminanceStdDev |
| --- | --- | --- | --- |
| `input-look-right.png` (mid-scenario) | 1112 | **0.04470** | 0.045 |
| `after.png` (final) | 58573 | 0.740 | 0.168 |

The final frame is a fully rendered arena. The failing one is the template's loading surface with
the DOM HUD drawn over it — HUD text, health and lives bars, the control legend, and a single thin
progress bar across the middle. Nothing of the 3D scene is in it.

**This was never art direction.** The shooter palette is dark, but its sky (`0x263449`) has
luminance `0.198`, four times the guard's `0.05` bright threshold; a rendered arena cannot produce a
`0.0447` bright ratio. A control run that fell back to SwiftShader rendered the same step at
`brightPixelRatio: 1` — the software path is slower to reach the input steps, so it had finished
loading by the time the shot was taken, which is why the failure looked hardware-specific.

## The cause

`warmupFrames` was `10`. Every other template scenario that takes a screenshot uses 30, 40 or 60 —
`shooter/playtests/per-item`, `minimal/playtests/play` and `action-rpg/playtests/performance` all
use 60. Ten frames does not cover the template's asset load, so the scenario walked its input steps
against a game that was still on its loading screen and photographed it.

**Layer: game, not engine.** The guard did exactly its job — it refused a frame that showed no game.
Raising a threshold or exempting the shooter would have taught the guard to accept loading screens
as render evidence in every project that scaffolds from a template.

## The green

`packages/create-threenative/templates/shooter/playtests/input-control.playtest.json`,
`warmupFrames` `10` → `60`:

```console
$ pnpm exec vitest run packages/playtest/__tests__/generated-shooter-input.spec.ts
 ✓ should turn, aim, and fire the generated shooter  7761ms
 ✓ negative control: removing right-button delivery leaves the input state unchanged  6199ms
Tests  3 passed (3)
EXIT=0
```

The capture at that step is now `distinctColors: 69108`, `brightPixelRatio: 0.8116`,
`luminanceStdDev: 0.1966` — sixteen times the guard's floor, so the margin is not marginal. A
warmup of `120` produces byte-identical statistics, which says the scene is fully loaded and
deterministic well before 60 rather than arriving just in time.

**Revert check:** set `warmupFrames` back to `10` → `TN_CAPTURE_BLANK` at `0.04470` returns. That is
the mutation, and it is the failure pasted at the top of this record.

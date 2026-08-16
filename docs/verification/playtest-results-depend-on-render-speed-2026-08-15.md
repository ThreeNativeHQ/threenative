# Playtest results depend on how fast the machine renders — 2026-08-15

A/B evidence that the action-rpg template's combat scenario passes or fails according to the
GPU under it, with no change to the game, the scenario, or the harness.

## The experiment

One scaffolded `action-rpg` project, `/tmp/threenative-golden-path-fxtc9O/action-rpg`. One
committed scenario, `playtests/combat.playtest.json`. Two runs, differing by a single Chromium
flag:

| Arm | Browser arguments | Result | `player.health` |
| --- | --- | --- | --- |
| software | `--ozone-platform=x11 --enable-unsafe-webgpu --disable-gpu-sandbox --ignore-gpu-blocklist` | **pass** | 100 → 90 |
| real GPU | the same, plus `--enable-features=Vulkan` | **fail** | 100 → 95 |

The failing row:

```
TN_PLAYTEST_COMPONENT_ASSERTION_FAILED
Component 'health' on entity 'player' did not satisfy the assertion.
Expected {"changed":true,"component":"health","entity":"player","equals":90}, observed before=100 after=95
```

`packages/create-threenative/templates/action-rpg/src/entities/Enemy.ts:104` deals
`this.boss ? 10 : 5`, and the attack reloads on `#attackTimer -= dt` with a 1.5 s cooldown at
`:101-104`. So 90 is two regular hits and 95 is one. The faster arm lands fewer.

## What it means

The scenario is not measuring the game. It is measuring how long the run took in wall-clock,
because the number of enemy attack cycles that elapse inside the scripted step window depends on
real elapsed time rather than on the frames the harness pumped. A slow renderer gives the enemy
its second attack; a fast one does not.

That contradicts the rule the harness is built on — scenario steps count frames, not
milliseconds, and the harness drives the fixed-step clock instead of racing it. Something is
still advancing the simulation on wall-clock alongside the deterministic pumping, so the same
scenario against the same build returns different answers on different machines.

This is not a defect in the Vulkan flag. Serving WebGPU from the GPU rather than from
SwiftShader is the correct behaviour and is what makes any visual or timing result meaningful.
The flag only revealed a dependency that was always there, and that had been silently
calibrated into a committed scenario.

## Why it matters beyond this template

Every playtest in this repository is affected in principle. Any scenario whose assertions depend
on a time-driven game system — attack cooldowns, spawn timers, patrol cadence, anything on a
`-= dt` accumulator — can pass on one machine and fail on another, and neither result is more
correct than the other. It also means results recorded before 2026-08-15 were taken on a
software renderer, whatever the machine's GPU.

## What this note does not claim

- Not a claim about which value is right. Whether the scenario should expect one hit or two is a
  design question about the template, not something this A/B answers.
- Not a claim that the game loop is wrong everywhere. The mechanism was inferred from the timing
  difference; the exact path by which wall-clock time reaches `Enemy.update`'s `dt` under a
  harness-driven run has not been traced to a line, and should be before anything is changed.
- Not a reason to relax the assertion. Asserting a range instead of a value would hide the
  dependency rather than remove it, and the harness would go on reporting a machine's speed as
  though it were a game's behaviour.

## The fix this argues for

Trace how `dt` reaches game systems during a harness-driven run and make it come only from the
frames the harness pumped. A scenario that says `holdTicks: 30` should produce exactly the same
simulation on every machine. Until that holds, `pnpm verify:golden-path` is red on any host whose
GPU is fast enough, and the action-rpg combat scenario is the first place it shows.

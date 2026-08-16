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

## An attempted fix, and why it was reverted — 2026-08-15

The framework already carries the remedy: `playtest({ holdUntilAttached: true })` holds the loop
until a runner calls `describe()`, and its own doc comment describes this exact race. **No shipped
template opts in** — all seven install `playtest()` bare, so every template races its own boot.

The obvious fix is to make it the default whenever a runner is actually present: the runner sets a
global in `addInitScript` before any game code evaluates, and `playtest()` holds when it sees that
global. That keeps `pnpm dev` unaffected, since no runner means no hold.

It was implemented, unit-tested, proven removal-sensitive, and **reverted**, because
`pnpm verify:golden-path` then failed with `TN_PLAYTEST_CAPABILITY_MISSING` where it had not
before. Holding that early means `describe()` answers before the game has finished registering its
runtime observations, so the description the runner reads is missing capabilities the scenario
requires. The option's own documentation warns about the ordering — "a provider used with this
option must be ordered before `playtest()`" — and that constraint is exactly why it ships opt-in
rather than on.

So the remedy exists but cannot simply be defaulted on. Making the boot deterministic needs either
the hold to begin after capability registration rather than before it, or the capability
contributions to be collected before the hold. That is a design change in the plugin's setup
ordering, not a flag, and it should be made deliberately rather than as a side effect of chasing a
red gate.

Recorded so the next attempt starts from the failure rather than repeating it.

## The fix that worked, and what it left behind — 2026-08-15

`holdUntilAttached` could not simply be defaulted on because it blocked inside the playtest
plugin's own `setup`, which runs **before** the start scene enters. Entity-derived capabilities are
registered by the scene, so a runner reading `describe()` during that hold saw a description
missing them: `TN_PLAYTEST_CAPABILITY_MISSING`. That is why the option shipped opt-in.

The repair moves the wait. `IGamePluginRuntime` gained an optional `holdStart`, and `defineGame`
awaits the registered gates after `#enterScene` and before `gameLoop.start()` — the last point at
which everything is registered and nothing has stepped. The playtest plugin hands its gate over
instead of blocking, and falls back to the old inline await when a runtime does not offer
`holdStart`, so existing embedders are unaffected. The hold then engages by default whenever a
runner announces itself with `__THREENATIVE_PLAYTEST_RUNNER_EXPECTED__`, set by the runner's
`addInitScript` before any game code evaluates; a `pnpm dev` session sets nothing and never waits.

The capability failure is gone from `pnpm verify:golden-path`.

**What it did not do is change the number, and that is the interesting part.** Before the repair
the same action-rpg build gave player health **90 on SwiftShader and 95 on a real GPU**. After it,
the real GPU still gives 95. If the boot is no longer racing, 95 is the deterministic result and
**90 was the artefact** — a value calibrated against a software renderer slow enough to let the
enemy land a second attack before the scripted steps began.

That is inference, not proof: it has not been re-run on SwiftShader with the hold active, which is
the measurement that would settle it. Changing a committed expectation to match observed output on
inference alone is the move this repository exists to prevent, so `combat.playtest.json` is left at
90 and the gate stays red on it.

**The next step is one run, not a decision:** the same scenario, same build, software renderer, with
the hold engaged. If it reads 95, the constant is wrong and can be changed on evidence. If it reads
90, the boot race is not the whole cause and the fix above is incomplete.

That run was attempted and did not produce an answer. Rather than pay for a full
`pnpm verify:golden-path` to get a scaffold, the current `@threenative/core` and
`@threenative/playtest` builds were copied into an older scaffold left behind by a previous gate
run. It failed `TN_PLAYTEST_CAPABILITY_MISSING` — an error the full gate does **not** produce on a
freshly scaffolded project, so it is an artefact of that scaffold's template being several
revisions old, not a property of the fix. No conclusion is drawn from it.

The measurement therefore still needs a scaffold generated from the current templates. That is one
`pnpm verify:golden-path` away, and it is the only thing standing between this finding and a
decision about the committed expectation.

The code landed inside commit `22123b79`, whose subject describes unrelated work — a concurrent
session committed a dirty shared tree. The change is intact; this note is where its reasoning
lives.

## The settling run, and the inference it disproved — 2026-08-15

Run on a scaffold generated from the current templates by `scaffold()` from
`scripts/verify-golden-path.ts`, so the harness is the same one the gate builds. One project, one
committed scenario, the `holdStart` fix active in both arms, differing only by a Chromium flag:

| Renderer | `player.health` | Result |
| --- | --- | --- |
| software (no `--enable-features=Vulkan`) | **90** | **pass** |
| real GPU (`--enable-features=Vulkan`) | **95** | fail |

**This disproves the inference recorded above.** That section reasoned that with the boot no longer
racing, 95 was the deterministic answer and the committed 90 was an artefact of a slow renderer.
The software arm reproduces 90 and passes. So 90 is not an artefact of anything — it is what this
build does on that renderer — and the render-speed dependency survives the `holdStart` repair.

The repair was still worth making: it removed `TN_PLAYTEST_CAPABILITY_MISSING` and it moves the
hold to a defensible place. It simply is not the whole cause. Something after the handshake still
advances the simulation at a rate the renderer influences, and the boot window was only part of it.

**What this nearly cost.** The previous section came within one edit of recommending
`combat.playtest.json` be changed from 90 to 95 "on evidence". Doing so would have broken an arm
that passes in order to make an arm that fails pass, and the repository would have carried a
committed expectation that no renderer here actually produces reproducibly. The inference was
confident, documented, and wrong, and the only thing that caught it was running the experiment it
described rather than acting on it.

The GPU arm also emitted `TN_CAPTURE_BLANK` alongside the assertion failure — a second symptom on
that path, not investigated here.

**Where PRD-112 actually stands:** the gate is red for a real, reproducible reason. The scenario is
correct for one renderer and wrong for the other, and neither is the renderer's fault — the game's
simulation should not be able to tell them apart. That is the defect, it is unfixed, and it is not
a constant that wants editing.

### One hypothesis narrowed, mechanism still unidentified

The failing scenario is `action-rpg-combat-and-line-of-sight`, and a stable 90 against a stable 95
with no timing jitter suggested the difference might not be a clock at all — that line-of-sight
might read renderer state such as culling or projected size, which would differ between a software
rasteriser and a GPU.

It does not. `templates/action-rpg/src/entities/Enemy.ts:81-86` resolves sight with
`directSpaceState(ctx.physics).intersectRay(...)` against the physics world, and range with a shape
query. Both are Rapier, both are deterministic given the same steps, and neither consults the
renderer. That hypothesis is dead.

So the mechanism remains unidentified, and this note deliberately stops here rather than offering a
third guess. What is established: the dependency is real, reproducible in both directions, survives
the `holdStart` repair, and is not line-of-sight reading render state. What is not established is
where the two renderers diverge. The next person should instrument the tick count and the enemy's
`#attackTimer` across both arms rather than reason about it — this document has now been wrong once
by reasoning and right once by measuring.

# PRD-294 — a software rasteriser should not be asked to run the high-tier chain

**Status: PROPOSED, filed 2026-08-30 at `5d2d0ca9`.** Split out of the CI stabilisation work
because it is a preset decision and a mechanism decision wearing one coat, and only one of them is
the framework's to make.

## The observation

Every scenario on the GPU-less CI lane — the one the workflow marks `TN_PLAYTEST_ALLOW_SOFTWARE: "1"`
(`.github/workflows/ci.yml:165`) — prints this from a scaffolded starter:

```json
TN_RENDER_CHAIN:{"applied":{"dropped":[],"requested":["ssgi","ssr","sharpen","bloom"],
  "source":"pinned","stages":["ssgi","ssr","sharpen","bloom"],"tier":"high",
  "velocity":{"provisioned":false,"required":false,"source":null}}}
```

**Screen-space global illumination and screen-space reflections, at tier `high`, `dropped: []`, on a
CPU rasteriser.** Nothing declined, nothing degraded. The chain did exactly what it was asked; the
asking is the problem.

## What it costs, measured

On a forced SwiftShader adapter (vendor confirmed `google`, not the machine's RTX 2080), one starter
scenario, same page and same build, with only the playtest startup wait differing:

| Startup wait | exit | wall clock |
| --- | ---: | ---: |
| waits for readiness | 0 | 61.8 s |
| waits for readiness | 0 | 55.8 s |
| no wait (previous behaviour) | 1 | 4.6 s |
| no wait (previous behaviour) | 1 | 5.0 s |

The fast runs fail — that is the run photographing the loading screen rather than the game, which is
the defect the wait exists to fix. So the correct behaviour costs about **55 seconds per scenario**
on that lane, and `TN_STARTUP_WARMUP` attributes only 6.4 s of it to compilation. The rest is the
game never reaching a sustained in-budget frame, because a CPU rasteriser running SSGI and SSR at
720p never will.

The consequence lands on `golden-path`: seven templates through the non-visual scenario set, order of
ninety page loads, each paying that. Its `timeout-minutes: 30` was set when a page load cost seconds.

## Two decisions, and only one of them is ours

**1. Which tier the templates ask for — the game's decision, and it is a look decision.**
`packages/core/src/render/chain.ts:250` reads `options.request?.tier ?? "high"`, and the templates
send no tier, so every scaffolded game pins `high` and reports `source: "pinned"`. The chain already
supports `tier: "auto"`, which starts at `high` and steps down against `targetFps` over
`dwellWindows`. Whether a template *ships* `auto` changes how the game looks on a weak machine, so by
the charter it belongs in the generated `src/render/` source and to the game's author — not here.

**2. Whether `auto` should know about the adapter — the framework's decision, and it is mechanism.**
Today `auto` adapts on measured frame budget alone. It therefore learns that a software rasteriser is
slow only by being slow at it, for several seconds, every run. The renderer already knows it has a
software adapter: the playtest runner names it out loud rather than silently accepting SwiftShader,
and `softwareAdapterName` is in the capability manifest. A first-frame tier floor for a known
software adapter decides nothing about how the game looks on real hardware, which is what keeps it on
the mechanism side of the line.

## What Done looks like

1. `auto` consults the adapter, not only the clock: a known software adapter starts at a tier it can
   sustain instead of discovering it. The rule is reported, so a run says it started low because the
   adapter is software rather than appearing to have chosen it.
2. A template that ships `auto` still gets `high` on real hardware. Pin that with a test — the
   failure mode of this change is quietly capping every player's frame.
3. Whether the templates request `auto` at all is answered by the owner, in the templates, as a look
   decision. This PRD does not decide it and must not be read as having decided it.
4. `golden-path`'s budget is re-derived from the measurement after (1) lands, not guessed. If it is
   still tight then, raising it is honest; raising it now would only be paying for SSGI on a CPU.

## What not to do

Do not fix this by deleting stages from the chain on the CI lane. `golden-path` exists to prove a
stranger can scaffold, install, build and play — a lane that quietly runs a different render chain
from the one the stranger gets is not proving that any more.

Related: [PRD-293](../tech-debt-code-quality/PRD-293-gameplay-and-compute-agree-about-startup.md),
which is the other half of the same session's startup work.

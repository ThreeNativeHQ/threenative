# PRD-278 — the render chain ships in all seven templates, 2026-08-30

Executed against `81698466` and `81f27f74` on this machine (Linux, NVIDIA RTX 2080, browser
WebGPU under a private Xvfb at 1600x900; the visual gate captures headed at 1280x720). Every
command below was run; anything not listed here was not executed.

## What shipped

The six templates that carried a 14–45 line `postprocessing.ts` — ACES, an exposure constant and
one bloom — now ship the same `worldEnvironment.ts` the starter received in `b43b3f87`, with a
desktop/mobile preset pair per template. All seven copies of the file are byte-identical
(`md5sum` across `templates/*/src/render/worldEnvironment.ts`); every appearance value lives in
each template's own `postprocessing.ts`.

| template | exposure | bloom (strength/radius/threshold) | ssgiRadius | ssrMaxDistance | shadow extent it was derived from |
| --- | --- | --- | --- | --- | --- |
| action-rpg | 1.08 | 0.72 / 0.42 / 0.18 | 16 | 40 | 24 |
| defense | 1.15 | 0.42 / 0.5 / 0.2 | 18 | 44 | 26 |
| minimal | 1.15 | 0.5 / 0.5 / 0.2 | 8 | 20 | 12 |
| platformer | 1.15 | 0.45 / 0.5 / 0.2 | 16 | 40 | 24 |
| racing | 1.18 | 0.35 / 0.5 / 0.2 | 30 | 75 | 45 |
| shooter | 1.12 | 0.75 / 0.48 / 0.2 | 14 | 34 | 20 |
| starter | 1.15 | 0.7 / 0.5 / 0.2 | 12 | 30 | 18 (unchanged) |

Each bloom triple is that template's previous value, kept: a shared file that hardcoded 0.5/0.2
would have retuned six games silently. `ssgiRadius` is about two thirds of the shadow extent
`lighting.ts` lights, and `ssrMaxDistance` about 1.7x it — `SSRNode` defaults `maxDistance` to
**one world unit**, which on any of these scenes reads as "reflections are on and do nothing".

Three changes were needed in the shared file, so all seven carry them:

1. **A `baseColour` seam.** `minimal` composes aerial perspective onto the scene pass before any
   stage and the chain builds that pass itself. The game now supplies a function that receives the
   pass and returns the base colour. Where a base colour is composed and every stage is off, the
   chain installs nothing for an empty stage list, so that one path installs through
   `setOutputNode` directly rather than dropping the game's composition on the floor.
2. **`bloomRadius` and `bloomThreshold` as arguments** (above).
3. **`TN_WORLD_ENVIRONMENT`**, printed every run, naming all seven stages as applied or refused
   with a reason that is never blank — including the run where every stage is off, which is
   exactly when a reader needs to know GI is off by choice rather than because a node no-op'd.

## The engine bug this found, and its red

`renderChain` assertions could never pass. Added to `minimal`'s `play` scenario, the first run
reported:

```
{"scenarioSummary":{"diagnostics":["TN_PLAYTEST_RENDER_CHAIN_UNOBSERVABLE"],"failed":["renderChain.tier"],"frames":660,"pass":false,"scenario":"play"}}
"message": "Render-chain tier was not observed because the TN_RENDER_CHAIN marker was absent."
```

— in a report whose own `console` observation contained the marker:

```
TN_RENDER_CHAIN:{"applied":{"dropped":[],"requested":["ssgi","ssr","sharpen","bloom"],"source":"pinned","stages":["ssgi","ssr","sharpen","bloom"],"tier":"high",…}}
```

Cause: the report lived in a module-scoped `WeakMap` in `packages/core/src/render/chain.ts`, and
`tsup` emits `dist/playtest.js` as its own entry carrying its own copy of that module — the bridge
that reads the report is never the copy that wrote it. Unit red, from two imports across
`vi.resetModules()` (the same pair of copies):

```
AssertionError: expected undefined to be 'high'
 ❯ packages/core/__tests__/render-chain.spec.ts:223
```

Fixed by publishing the report on the renderer under `Symbol.for("threenative.renderChain.report")`
— one key across every copy of the module. Green: 11/11 in that spec, and `minimal`'s `play`
scenario then passed `renderChain.tier: "high"` through a headed WebGPU browser. Reverting to the
`WeakMap` fails the new spec and nothing else. Landed as `81f27f74`.

## Gates run

| gate | result |
| --- | --- |
| `pnpm exec vitest run packages/create-threenative/__tests__/template.spec.ts` | 31/31, including a pristine-scaffold `tsc` of all seven templates and the instruction-word budget (absorbed in existing headroom; no cap moved) |
| `pnpm exec vitest run packages/create-threenative/__tests__/scaffold.spec.ts` | 40/40; all seven parent tree hashes recomputed |
| `pnpm exec vitest run packages/core/__tests__/render-chain.spec.ts` | 11/11 |
| `pnpm lint` | 0 errors (491 pre-existing complexity warnings; one unrelated format error in another lane's uncommitted `scripts/__tests__/xvfb.spec.ts`) |
| `TN_TEMPLATE_ONLY=starter pnpm test:templates` | 21/21 scenarios, exit 0 |
| `pnpm test:templates` (six templates, before `2042b33d`) | action-rpg, defense, minimal, platformer, racing, shooter all "scaffolded playtests passed" |
| `pnpm test:templates` (after the re-measurement below) | action-rpg passes; the run stops at `defense-survive-ten-waves`, which is not this work — see "Two reds that are not this work" |
| `pnpm visuals` | all seven frames captured and inspected; the gate then fails on `TN_VISUAL_SCORE_FLOOR: action-rpg scored 3` — a **stale committed score from 2026-08-21**, not this run's frames |

`TN_TEMPLATE_ONLY` was added to `scripts/verify-template-playtests.ts` for that filtered run; unset,
every template runs, which is what CI does.

## Budgets that moved, with the numbers that moved them

| scenario | field | was | observed | now |
| --- | --- | --- | --- | --- |
| `minimal/play` | maxDrawCalls | 20 | 39 | 48 |
| `starter/play` | maxDrawCalls | 53 | 130 | 160 |
| `starter/play` | maxTriangles | 4403 | 8167 | 9800 |

The starter's two were already stale before this work: its chain landed in `b43b3f87` and the
seven-template gate aborts at the first failing template, so the starter was never reached. Frame
time did not move against its ceiling — `starter/play` measures **22.2 ms p95 against 33**.

## Re-measured after the runner learned to wait — 2026-08-30, later

`2042b33d` published startup readiness to the playtest bridge, so the runner now samples the world
instead of a simulation frozen behind a loading layer. Every number above that came from a
performance assertion was therefore taken behind that layer and was **too low**: `action-rpg`'s
scenario reported **4 draw calls** where its running scene issues **144**. Each template was
re-measured on its own, one gate run each:

| template | draws observed | draws now | triangles observed | triangles now | frame p95 |
| --- | ---: | ---: | ---: | ---: | ---: |
| action-rpg | 144 | 180 | 1,823 | 2,300 | 10.7 ms |
| defense | 114 | 145 | 3,583 | 4,500 | 17.1 ms |
| platformer | 160 | 200 | 6,127 | 7,700 | 15.0 ms |
| racing | 154 | 195 | 3,847 | 4,800 | 12.9 ms |
| shooter | 236 | 295 | 2,007 | 2,500 | 13.0 ms |
| starter | 130 | 160 | 8,167 | 9,800 | 22.2 ms |
| minimal | 39 | 48 | 1,178 | 1,223 | **34.2 → see below** |

Every ceiling is 33 ms and only one template reached it. **`minimal` ships without the SSGI
gather**: with it, `play` measured **34.2 ms p95 against 33**; without it the scenario passes. Its
sky, sun colour and depth haze are a volumetric `Atmosphere` that already owns most of the frame,
and the file states that and says what to read after turning the gather back on. The ceiling did
not move — a cap raised to fit the work is a cap routed around.

## Two reds that are not this work

Before `2042b33d`, a full seven-template run had `action-rpg`, `defense`, `minimal`, `platformer`,
`racing` and `shooter` all reporting "scaffolded playtests passed". After it, two scenarios fail on
gameplay timing rather than on rendering:

- `defense-survive-ten-waves` — `leaks` is **1** against an asserted **0**, while `status: WON`,
  `wave: 10` and `defeated >= 10` all pass. The route is won; one attacker crossed.
- `platformer-avoidance` and `platformer-chase` — `movement.pathLength` **4.37** and **2.61**
  against an asserted minimum of **6**.

Both are the phase-shift the batch-2026-08-29 follow-up already names: a scenario that starts at a
different point in a moving game's cycle grades a different game. The observation window moved when
the runner started waiting for readiness; the render chain does not move an entity. They are left
for the lane that changed the meter, with the before/after runs above as the evidence.

## Captured frames, looked at

`pnpm visuals`, 1280x720, headed WebGPU. Every template renders its scene; `action-rpg` shows
visible SSR floor reflections of the lit figures and SSGI bounce on the dungeon walls, `racing`
shows the AO term darkening the frame edges, `minimal` keeps its aerial perspective through the
`baseColour` seam.

| template | brightPixelRatio | distinctColors | luminanceStdDev |
| --- | --- | --- | --- |
| action-rpg | 0.423 | 17,720 | 0.096 |
| defense | 1.000 | 7,595 | 0.116 |
| minimal | 0.996 | 19,455 | 0.213 |
| platformer | 1.000 | 35,047 | 0.158 |
| racing | 1.000 | 38,170 | 0.215 |
| shooter | 0.500 | 41,459 | 0.128 |
| starter | 0.505 | 17,986 | 0.069 |

**A contended capture is not a blank frame.** An earlier run of both gates, with other work on the
same GPU, reported `TN_CAPTURE_BLANK: starter: bright pixel ratio 0.04807` on the visual gate and
on eleven starter scenarios. Captured directly at the same viewport with nothing else running, the
same scene measures **0.660** at two seconds and at fifteen, and the frame is a fully lit night
scene. On a clean re-run the visual gate measured **0.505** for the starter and captured all seven.
The blank diagnostic was contention, and it is recorded here so the next reader does not spend the
afternoon this one did.

## Not verified

- **Native.** No `--target desktop` or device run. AC9 of PRD-278 is open: the chain refuses any
  non-WebGPU renderer by name, and that refusal has been observed on browser only.
- **Mobile.** The mobile preset is inference from a desktop capture. That is
  [PRD-287](../PRDs/useful-defaults/PRD-287-the-default-look-holds-the-phones-budget.md), unstarted.
- **First-frame cost.** The chain's pipelines compile on first render;
  `packages/core/src/warmup.ts` does not walk `RenderPipeline.outputNode`. Unmeasured here — that is
  [PRD-288](../PRDs/useful-defaults/PRD-288-the-first-frame-is-not-the-compile-bill.md).
- **The blind score.** `docs/verification/visuals/scores.json` is a model's read of frames from
  2026-08-21 and predates every capture above. Its own provenance note asks for a human pass, and
  re-scoring my own work with a model would not be that pass.
- **`pnpm test` (root suite)** was not run to completion in this session.

---

# AC9 — native, 2026-09-04

**The gap this closes.** The §"Not verified" note above reads *"No `--target desktop` or device
run. AC9 of PRD-278 is open: the chain refuses any non-WebGPU renderer by name, and that refusal
has been observed on browser only."* Row 1 of
[`docs/PRDs/quickwins-2026-09-04/README.md`](../PRDs/quickwins-2026-09-04/README.md) is that run.

**Host.** Built from source in the lane worktree rather than taken from the machine's existing
build, which was linked 2026-09-03 and predates `befc1094` — a commit that touches
`packages/runtime-native/src`. A stale binary reads as evidence about a host nobody is shipping.

```
[403/403] Linking CXX executable mystral-tools
packages/runtime-native/build/tn-linux/mystral   127,481,312 bytes, 2026-09-04 18:01
```

Passed to the scaffold's desktop packaging through `THREENATIVE_RUNTIME_BINARY`, which
`packages/create-threenative/src/build.ts:420` honours ahead of the prebuilt a scaffold would
otherwise download.

**What was run.** `scripts/verify-one-template-desktop.ts` — a sibling of the existing
`verify-one-template.ts`, which runs the browser lane — scaffolds one template from locally packed
tarballs and runs its `test:native` script: `pnpm build:desktop` then
`threenative-playtest --target desktop --executable dist-native/<name>`.

`sailing` is the template, because it is the one whose `test:native` already drives a real
`--target desktop` playtest rather than the starter screenshot gate. Its
`native-playtests/survives.playtest.json` gains the assertion AC9 asks for, so the chain is
proved on native by the template's own lane on every later run rather than once by hand:

```json
"renderChain": { "tier": "high", "stages": { "includes": ["bloom"] } }
```

`bloom` is the one stage `sailing`'s `high` preset turns on; SSGI, SSR, sharpen and denoise are
off at every tier in that template by choice, and asserting them would assert the look rather than
the chain.

**Result — the stages apply on native.**

```
$ THREENATIVE_RUNTIME_BINARY=$PWD/packages/runtime-native/build/tn-linux/mystral \
    pnpm tsx scripts/verify-one-template-desktop.ts sailing

  "assertionResults": [
    { "id": "renderChain.tier",            "pass": true, "details": { "expected": "high",     "observed": "high" } },
    { "id": "renderChain.stages.includes", "pass": true, "details": { "expected": ["bloom"],  "observed": ["bloom"] } },
    { "id": "diagnostics",                 "pass": true },
    { "id": "movement.distance",           "pass": true, "details": { "distance": 3.65, "minimum": 0.5 } }
  ],
  "pass": true,
  "runtime": "native",
  "scenario": "native-sailing-smoke",
  "target": "desktop",
  "url": "/tmp/threenative-sailing-desktop-LoFAXz/sailing/dist-native/sailing"

sailing: native playtests passed at /tmp/threenative-sailing-desktop-LoFAXz/sailing
exit 0
```

`runtime: "native"` and an executable `url` are what make this a native observation rather than a
browser one. The chain reported the tier it resolved and the stage it applied; it did not report
the WebGL refusal, which is exactly what AC9 asked to be distinguished.

**What this run does not show.** One template and one stage. The chain's *refusal* path on a
non-WebGPU native renderer is still unobserved — the desktop host is WebGPU, so there is no
non-WebGPU native renderer here to refuse. AC9 asked that the stages apply on desktop rather than
reporting the refusal, and that is what was measured; a native WebGL refusal would need a renderer
this repository does not ship.

**Found in passing, and filed rather than fixed here.** The same report carries a passing
`diagnostics` row with `"noNetworkErrors": true` and `"networkErrors": 0` on a desktop lane whose
network observation is hardwired empty — a green computed from evidence the target cannot produce.
That is PRD-265 §1, executed as row 4 of the same batch.

<!-- Generated mirror of AGENTS.md. Do not edit; edit AGENTS.md. -->

# AGENTS.md — @threenative/playtest

Read `/AGENTS.md` first. This file covers the operator CLI and what is different about changing
the harness.

## Running a scenario

```sh
pnpm --filter @threenative/playtest build          # the CLI is built, not checked in
node packages/playtest/dist/runner/cli.js init     # writes playtests/smoke.playtest.json
node packages/playtest/dist/runner/cli.js playtests/smoke.playtest.json \
  --url http://127.0.0.1:5173 --server-command "pnpm --filter abyss-framework dev" \
  --browser-recipe webgpu
```

Exit `0` passed, `1` assertions failed, `2` never reached assertions, `69` when a command's
external decoder is absent so nothing was inspected, and `75` when the capture lock queue timed
out — the last two are explicitly **not** test failures, and `75` prints the holder and queue
depth. `--server-command` needs a workspace that has a `dev` script — an example or a scaffolded
project; there is no root `pnpm dev`. `--browser-recipe webgpu` supplies the current Chromium WebGPU
flags including `--enable-features=Vulkan`, without which Chromium silently serves WebGPU from
SwiftShader and reports healthy-looking limits from a CPU rasteriser; `--browser-arg` is the escape
hatch, and a run that does not name its adapter is not evidence. **On Linux the runner provisions a
private Xvfb for every pixel-producing run, whether or not a display exists** (stripping Wayland env
itself), so a scenario never opens windows over whatever the operator is doing — a sweep that
borrows `:0` makes the machine unusable for as long as it runs. Set `TN_PLAYTEST_HOST_DISPLAY=1` to
paint on the session's own display instead; opt in when the run needs the session's real GPU adapter
(heavy TSL post chains have been seen falling back to SwiftShader under Xvfb) or when a human wants
to watch it. Do **not** reach for `--headless` to keep windows off a screen: headless Chromium
cannot capture WebGPU here, so it changes what you measure. The runner takes a capture lock only
when it detects competing runners — or always with `CAPTURE_LOCK=1`; lock state is printed to stderr
either way. `sh scripts/xvfb.sh` remains as an optional compatibility wrapper — never `xvfb-run`,
whose exit status is its own failing cleanup kill rather than the command's.

In a scaffolded project the same CLI is `npx @threenative/playtest`, and `diagnostics`, console,
network, screenshot and trace assertions work against any URL. The framework template installs the
bridge with `playtest()` in `defineGame`; a plain Three.js project uses `installThreePlaytestBridge`
from `@threenative/playtest/three`. Semantic assertions (`movement`, `camera`, `visibility`) against
a project with neither bridge fail `TN_PLAYTEST_BRIDGE_MISSING` — that is the harness being right.
Install the bridge or narrow the scenario; never delete the assertion to get green.

## The rule that outranks everything else in this package

**A check that cannot run must fail, never skip.**

v1's harness had 19 validators that returned `undefined` on a wrong-typed value and 13
`.filter()` calls that dropped them silently. One misspelled assertion type meant the
scenario ran with zero assertions and **reported green**. That is the single most dangerous
failure mode in an agent loop, because the agent optimizes against the report.

Concretely, when you touch this package:

- A malformed assertion **throws at load** (`invalidScenario(...)`). Never dropped, coerced,
  or defaulted.
- Never add a `.filter()` that removes an assertion, an observation, or a step.
- A missing entity, an absent resource, an empty effect log, or a scenario with no assertions
  is a **failure**, not a pass.
- A run reports `pass` only when at least one assertion was evaluated against an observation
  that actually arrived.
- New assertion types need a test proving the wrong-typed case fails. `__tests__/` already
  holds the shape: `vacuous-assertion.spec.ts`, `silent-drop.spec.ts`,
  `evidence-required.spec.ts`. Add to those rather than starting a new pattern.

## One scenario, four targets

`--target browser|android|desktop|ios` runs the same scenario file against a browser, an Android
device or emulator, a native desktop executable, and an iOS simulator or device
(`runner/androidRunner.ts`, `runner/desktopRunner.ts`, `runner/iosRunner.ts`,
`runner/deviceTransport.ts`). Desktop requires `--executable`; the runner owns a temporary local
mailbox and passes its root to the native host through `TN_PLAYTEST_MAILBOX_ROOT`. Keep it that way:
an assertion that only
means something on one target is a fork of the harness.

A device target that cannot be reached fails `TN_PLAYTEST_DEVICE_FAILED`; it never degrades
to a browser run. Where a target genuinely lacks an observer — device transport has no CDP
network observer — the assertion **errors and names the working target**, it does not skip.
The negative-control scenarios in `examples/native-smoke/playtests/` (`-misspelled`,
`-wrong-value`) prove the device path still fails closed; run them when you change transport
or observation code.

## `perf` — read the frame meters without opening a log

`threenative-playtest perf` parses `TN_FRAME_BUDGET` and `TN_HOST_GAP` out of one source —
`--file <log>`, `--executable <bin>` with repeatable `--host-arg`, or `--logcat <serial>` — and
reports fps, frame/render/hostGap p50/p95 per window plus the host-gap segments. It exists
because every number in the Android-fps hunt was read from these markers by hand; the parser
(`runner/perf.ts`) is that hand-read, encoded.

Protocol rules are built in, not optional: **window 1 is discarded as startup** (it always
lies), `--require-windows` (default 2) counts *steady* windows and a run with fewer exits **2**
— not enough evidence, never an empty pass — and a marker line whose JSON cannot be parsed
**throws** (`TN_PERF_MARKER_MALFORMED`) rather than silently vanishing. Optional bounds
`--max-frame-p95 <ms>` / `--min-fps <fps>` fail with exit **1** on any steady-window violation;
without bounds the command reports and exits 0. The host's `Present mode:` line is captured
when the host logs one. `--text` renders the human-readable table; default output is JSON.

Desktop spawn under a headless session rides the same Xvfb rule as any pixel run:
`sh scripts/xvfb.sh threenative-playtest perf --executable … --host-arg run --host-arg game.js …`.
The command never launches a browser — the browser lane already bounds performance through
`assert.performance` — and it never tunes anything; it is a meter reader.

## `audio` — look at the sound, because nobody listens in CI

`threenative-playtest audio --expect <manifest.json>` decodes every clip a game declares and
reports band energy, peak, DC, silence and loop-seam continuity, writing one spectrogram PNG per
clip. No browser, no display, no capture lock: inspecting audio reads files, and taking the capture
queue for it would block the machine's pixel work for nothing.

It exists because **every check that does not involve listening passes on audio that is wrong**.
The file exists, it is served 200, it decodes, no page error, it is inside the byte budget — and the
clip is a hum where a chime should be. That shipped here: a discovery cue with 80% of its energy in
100-500 Hz and 1% above 2 kHz, on the one sound a player waits to hear. So did fifteen footsteps
with up to 45% of their energy below 100 Hz, which is a thud, not a boot on stone. Both are
unmistakable in a band profile and a spectrogram, and invisible in a size, a duration or a green
`loaded` marker.

**The game declares the expectations, because the inspector cannot know them.** Nothing here knows
that a forest bed should be broadband and a discovery chime should be bright. The manifest is the
game saying so:

```json
{ "version": 1, "clips": [
  { "path": "public/audio/forest-bed.ogg", "loop": true,
    "bands": { "sub": { "max": 3 }, "high": { "min": 20 }, "air": { "min": 20 } } },
  { "path": "public/audio/landmark-found.ogg", "loop": false,
    "bands": { "low": { "max": 25 }, "high": { "min": 25 } } }
] }
```

Bands are `sub` (<100 Hz), `low` (100-500), `mid` (500-2k), `high` (2k-8k) and `air` (>8k),
contiguous to Nyquist, reported as percentages of summed magnitude from Hann-windowed
non-overlapping frames over the whole signal. They are comparable to each other and to what a game
declares, not to another tool's numbers.

Fails closed, on this package's own rule: an unknown key, a band nobody measures, a bound that can
never hold, a `seamMaxRatio` on a clip whose `loop` is false, a duplicate path, or an empty clip
list all **throw** rather than skip. `loop` is required rather than defaulted, because it is the one
fact that decides whether the seam is checked. `--dir <dir>` additionally fails when any audio file
under it is undeclared — otherwise the gate is only as good as the manifest and a clip added later
is a clip nothing checks.

**Two measurement rules, both learned by getting them wrong.**

*Decode at the file's own rate.* A seam measured on a resampled decode measures the resampler: its
FIR window runs off the end of the data at the first and last output sample and is zero-padded, so
the edge samples are the only wrong ones in the file — exactly where a seam test looks. On one real
set that inflated the reported step three to sevenfold and reordered which clip looked worst. The
command never passes `-ar` to ffmpeg.

*Judge the wrap against the steps beside it.* A click is a step that is anomalous **where it
happens**. A sparse clip is mostly quiet, so a whole-clip percentile flatters its seam; a dense one
is mostly loud, so the same percentile condemns a join nobody could hear. The reference is the
99th-percentile sample step within 50 ms either side, and the default ceiling is 1.5x rather than
1.0x — a flawless wrap that lands on the signal's steepest point *is* the largest step in its
neighbourhood and measures exactly 1.0.

Exit `0` when every check passed, `1` when one failed, `2` when it could not run (a malformed or
unreadable manifest), and `69` when ffmpeg is absent. That last code is the point: **"I could not
check" and "I checked and it is fine" must never be the same answer**, so CI can treat 69 as a skip
and still treat 1 as a defect.

`--text` prints `✓`/`!`/`✗` lines with a `fix:` on anything that is not ok; default output is JSON.
The numbers are the gate and the picture is what a person or an agent looks at when the gate fires,
so every spectrogram written is named in both. Verdicts, parsing and analysis live in
`runner/audio.ts` and are unit-tested against synthesised signals in `__tests__/audio.spec.ts`;
`runner/audioRun.ts` only drives ffmpeg.

## Startup time is an observation

The runtime stamps its startup milestones on its own clock — `loadStartedMs`, `enteredMs`,
`compileSettledMs`, `readyMs`, in milliseconds since navigation — and publishes them as
`observations.startup.timeline`. Scenarios bound them with `assert.startup`: `maxEnteredMs`,
`maxCompileSettledMs`, `maxReadyMs`. A milestone the run never reached fails closed
(`TN_PLAYTEST_STARTUP_UNOBSERVABLE`); one past its ceiling fails
`TN_PLAYTEST_STARTUP_TOO_SLOW` with the measured value. Before this, startup was a console
anecdote read off `TN_STARTUP_WARMUP` after the fact.

## Device thermal, power and battery

Every `--target android` run measures the phone around itself and reports it as
`observations.deviceMetrics` — battery temperature and level, Android thermal status, charging
state, current draw, and Pixel's per-rail ODPM power breakdown. It is sampled before `prepare()`
(the only moment a pre-launch baseline is still readable, since `prepare` clears logcat), every
five seconds during the run, and once after the last bridge sample.

The point is **comparability**. On 2026-08-24 two cold-launch runs read 44 s to first frame
against a 14.7 s baseline and the difference was blamed on a code change; the device had reached
43.2 °C at thermal status 2 while the baseline ran at 38.2 °C at status 0. A run is flagged
`thermallyConfounded` with named reasons — `hot-start` (≥ 40 °C), `throttled-start`,
`thermal-status-rose`, `charging`, `incomplete` — and a flagged run's numbers are still reported
in full. The verdict withdraws the claim of comparability, never the measurement.

Scenarios assert on it with `deviceMetrics`: `notThermallyConfounded`, `maxTemperatureRiseC`,
`maxThermalStatus`. On browser, desktop or iOS the assertion fails
`TN_PLAYTEST_UNSUPPORTED_ON_TARGET` and names android — it never skips. A reading the device does
not expose (per-rail power off Pixel hardware, `current_now` where the sysfs node is absent)
reports `{ available: false, reason }`; **nothing here ever reports an unmeasured zero**.

Ask *before* spending a run: `doctor --device <serial>` reports the phone's battery temperature,
thermal status, charge level and charging state next to the machine checks. It warns — a hot
phone is a run that will not be comparable, not a broken machine — and only fails on a device
that is unreachable or a probe that cannot be parsed.

```sh
node packages/playtest/dist/runner/cli.js doctor --device <serial> --text
```

Parsers and verdict live in `runner/deviceMetrics.ts` and are unit-tested against captured device
output in `__tests__/fixtures/device-metrics/`. Add real captures there rather than inventing a
`dumpsys` format. Both the observation lane and `doctor --device` only report; the gate that
*refuses* a hot or charging device before a benchmark is
`packages/runtime-native/scripts/device-preflight.mjs`, and they share the same battery floor so
an operator is never told two different stories.

## The room, and the feet

Two things the harness measured and nothing could read.

`doctor --url` used to end its report with *not observed: lights, materials and textures* and
*not observed: camera framing*. An agent looking at a black or washed-out frame therefore had
nothing between "the bridge answered" and a screenshot, which is the one instrument that cannot
say **why**. The bridge now reports the room as `observations.scene` — lights with their colours
and intensities, materials counted per distinct material by constructor name, fog with its own
near/far or density, the background, the camera's position, forward, fov and clip planes, and the
scene's world extent. Counts and names only: it decides nothing about how anything looks, and a
value the scene does not carry is absent rather than zero. The walk is capped
(`SCENE_WALK_OBJECT_CAP`, `SCENE_LIGHT_CAP`) and a scene past either reports `truncated: true`,
so a floor is never read as a total.

`doctor --url` reads it back as three lines — `lighting`, `materials`, `camera` — and names the
ways a frame dies while every other number stays healthy: **lit materials with no visible light**,
a **fog far plane in front of the scene it is fogging**, and a **camera far plane that clips it**.
The second is round 9's lost visual column, where a radius-90 sky dome sat behind `Fog(bottom, 18,
80)` and rendered as one flat wash; no gate could see it.

`AnimationPlayer.stride` has measured the *feet meet the floor* convention since it shipped — what
the clip carries against what the body covered — and it never crossed the bridge either, so a game
that set `strideSync: false` had turned the measurement off as far as any proof was concerned.
It now rides in `gameplay.animation.<entity>.stride`, and `assert.animation[]` bounds it:

- `maxFootSlide` — ceiling on `|feet − ground| / ground`. The feet move at the rate the clip is
  *actually playing*, which is the measured `rate` only when `synced`; an overridden clip keeps
  its authored rate. Reading `rate` unconditionally scored an overridden run at zero slide —
  the exact case the bound exists to catch, found by the locomotion scenario, not by a unit test.
- `strideSynced` — require the convention applied (`true`) or deliberately overridden (`false`).

Both fail closed, and each failure names which kind: `TN_PLAYTEST_STRIDE_UNOBSERVED` when the
producer reported no stride, reported half of one, or the body covered no ground to compare
against; `TN_PLAYTEST_STRIDE_NOT_SYNCED`; `TN_PLAYTEST_FOOT_SLIDE` with both speeds and the
ceiling. A game that does not measure stride has not measured zero slide.

A scenario bounds the same numbers with `assert.scene`, so the check outlives whoever ran
`doctor` once:

- `minVisibleLights` — floor on lights the renderer will actually see. An invisible light is no
  light.
- `litMaterialsAreLit` — fail when lit materials are mounted and nothing lights them. A scene of
  `MeshBasicMaterial` needs no light and is not failed for having none.
- `fogClearsScene` — fail when a linear fog goes opaque in front of the scene's furthest corner.
- `cameraClearsScene` — fail when the camera's far plane cuts the world it is pointed at.

A run with no scene observation fails once as `scene.observed`
(`TN_PLAYTEST_SCENE_UNOBSERVED`) rather than failing each bound against nothing, and an
`assert.scene` that sets no bound throws at load. An unmeasurable comparison — no world extent,
no far plane — fails; it never counts as cleared.

Advertised as the `scene.observe` capability. A capability the runner's registry does not define
is rejected (`TN_PLAYTEST_BRIDGE_CAPABILITY_UNKNOWN`), so a new observation channel is registered
in `src/capabilities.ts` in the same change that starts advertising it.

## Scenario-controlled spawn & aim

The scenario `setup` block carries a placement vocabulary so capturing a vantage frame is
one scenario, not a patch-run-revert ceremony:

- `setup.spawn { x, z }` (+ optional `y`) overrides the SUBJECT player start's position.
  An absent `y` preserves the game's own height (eye or ground line); it is never silently
  defaulted to zero. Requires `subject`.
- `setup.aim { yaw, pitch }` overrides the SUBJECT player start's aim; both angles are
  radians, Three.js convention (forward is -Z at yaw 0, pitch positive up). Requires
  `subject`.
- `setup.place[]` entries `{ entity, at: {x,y,z}, facing?: {yaw} | lookAt?: {x,y,z}, frozen?: boolean }`
  put named entities at explicit transforms. `frozen` sets `PLAYTEST_FROZEN_MARKER`
  (`__threenativeFrozen`) on the entity's userData — data the game reads to suppress
  physics motion, never a runner-side teleport loop.

Presence semantics are explicit and fail closed: an unknown entity id, an entity missing
from the registry at apply time, or a target coincident with the subject is a NAMED error
(`TN_PLAYTEST_SETUP_UNAPPLIED`), never a silent skip. One entity may be placed by only one
of `setup.entities` / `setup.place`.

Steps can also carry `{ kind: "aimAt", target: { x, z } | { entity }, pitch?, waitTicks?, screenshot?, label? }`.
The runner samples the subject's current position, computes yaw/pitch toward the target,
and applies them through the setup channel as quaternion data — no CDP mouse events and no
OS-focus dependency. An `aimAt` step cannot also deliver input (`press`, pointers) or
ignored holds (`holdTicks`/`holdFrames`); follow it with a `waitTicks` step to hold the pose.

Every requested override rides into the run report as `setup.requested` next to what
applied (`setup.applied`). A run whose placement cannot apply fails with the reason named —
an overridden spawn must be visible in diagnostics, never green-with-silence. The game keeps
its own spawn constants; scenarios override them for determinism, through this one channel.
The template-teaching copy of this vocabulary ships via the create-threenative shared
fragment when games adopt it; until then this section is the harness contract.

## Determinism

Scenario steps count fixed-step ticks, not milliseconds — use `holdTicks`, `waitTicks`. The
deprecated `holdFrames` and `waitFrames` aliases remain accepted for compatibility and are
treated as ticks when the bridge exposes `runtime.fixedStep`; `warmupFrames` remains a genuine
requestAnimationFrame warmup. Never introduce a wall-clock sleep or a millisecond-based step
into scenario semantics.

**Ticks are not the clock a launch runs on.** A run advances ticks as fast as the machine allows,
so a whole scenario can complete during a launch that has not finished — and everything the
application gates on startup (compute dispatch, the first world present) then never happens inside
the run. `starter-look` read `flagSteps` 0 before and 0 after because the cloth had never been
dispatched; twelve starter scenarios photographed the loading screen and reported
`TN_CAPTURE_BLANK`. Both depended only on how long boot took.

So after `warmupFrames` and before the baseline observation, the runner waits for the application
to say its world is safe to observe: a bridge that advertises **`runtime.startup`** reports
`{ phase, progress }` from `ready()` (core's `playtest()` plugin publishes `ctx.startup`), and the
runner holds — pumping frames on browser, ticks on device — until `phase` is `"ready"`. Bounded by
`PLAYTEST_STARTUP_READY_TIMEOUT_MS`; a game that never gets there fails
`TN_PLAYTEST_STARTUP_NOT_READY` rather than being observed mid-load. An application that reports no
startup at all — a plain Three.js page — is never waited on, and advertising the capability without
reporting it is malformed and throws.

Readiness means two things, and a GPU-less lane is only owed one of them. Core reaches `"ready"`
after first-use compilation settles **and** a sustained in-budget frame window — the second is a
player-experience gate, and a CPU rasteriser never meets it, so it can only expire. When the
operator declares a software adapter (`--allow-software` / `TN_PLAYTEST_ALLOW_SOFTWARE=1`) that
lane has already conceded it is not measuring the player's experience, so the wait resolves on
**compile settlement** instead. Measured on a real SwiftShader adapter: 56–62s per scenario before,
31–33s after.

Compile settlement is never skipped — it is the part that makes a run observe the game rather than
the loading screen. The relaxation is keyed *only* off that declaration, never off a timeout, an
adapter guess, or a game that does not report `compileSettled` (which fails closed rather than
being inferred). Every report carries `startup.rule`, `"sustained-frames"` or `"compile-settled"`,
so a software-lane pass is never read as a smoothness measurement.

Never fix a boot race by lengthening a wait. Padding changes which runs get lucky; the tick counts
were already identical in the runs that disagreed.

## This is salvaged code

Lifted from `threejs-to-bevy` and deliberately standalone: it runs against **plain Three.js
with zero ThreeNative dependencies**, and that independence is a product decision, not an
accident. `three` and `playwright` are optional peers. Do not add a `@threenative/core`
dependency.

It is also excluded from the framework LOC budget and from `biome.json`, so its style differs
from the rest of the repo. Match the file you are editing, not the root convention.

## Test layout, and a trap

Vitest at the root only collects `packages/**/__tests__/**/*.spec.ts`. The co-located
`src/**/*.test.ts` files here are **not** run by `pnpm test`. Put anything that must gate CI
in `__tests__/`, or run the co-located ones explicitly and say that you did.

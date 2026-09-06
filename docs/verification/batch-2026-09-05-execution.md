# September 5 delivery batch — execution ledger

Status: in progress. No delivery PRD is accepted yet.

Engine worktree: `.worktrees/batch-2026-09-05`, branch `batch-2026-09-05`, base
`75639f2a`. The base includes five pre-existing local main commits beyond fetched remote main;
they are not batch implementation. Original staged PRD files in the primary checkout are preserved.

## Ownership and dependencies

| Deliverable | Owner/model | Write ownership | Acceptance / dependency | Status |
| --- | --- | --- | --- | --- |
| 360 phase 1 | Opus medium | Native scheduler shim, installer, scheduler tests | Real host held-presentation red/green; qualified Bayview launch | Investigating |
| 361 caller census | Luna max | Local census artifact only | Real Wildwood/HQ callers, current instructions and smallest shared composition | Investigating |
| 362 phase 1 policy | Opus medium | Starter quality.ts, template-quality.spec.ts | GPU overload with cheap CPU, hysteresis, overrides, mutation red | Implementing |
| Integration, evidence, phase checkpoints, delivery | Codex | Shared interfaces, PRDs, verification docs | Full criteria from all three PRDs, local gates, review, CI, merge | In progress |

The phone belongs exclusively to 360 until its runs finish. 362 phone runs follow it.
Independent checkpoint reviews must precede phase acceptance. Policy units alone do not
prove starter integration, and a synthetic host scene does not prove Bayview's launch budget.

## Executed setup

`git fetch origin main` succeeded. Worktree root passed
`git check-ignore .worktrees/batch-2026-09-05`. Installed worktree manager created the lane.
`pnpm install --frozen-lockfile` exited 0: `Done in 3.6s using pnpm v10.25.0`.

`adb devices -l` returned:

```text
192.168.1.192:5555 device product:shiba model:Pixel_8 device:shiba transport_id:6
```

This proves connectivity only, not thermal qualification or any performance criterion.

Task prompts, raw tool output and transient worker results are retained locally under
`artifacts/batch-2026-09-05/`. Durable phase evidence will be copied here; performance findings
belong in `runtime-perf-state.md`.

## Required acceptance still open

1. 360: three baseline/candidate cold launches; median playable ≤8 seconds; pump gaps ≤250 ms;
   loading and bounded failure; real browser/Android movement; host and game mutation controls.
2. 361: shared preparation adopted by Wildwood and HQ, private copies deleted, aggregate LOC
   smaller, skin-aware independent clones, load-time clip errors, browser/native proof and discovery.
3. 362: real starter automatic/pinned behavior, fresh GPU or named presentation fallback,
   lifecycle/resource proof, qualified 120-second browser/native phone runs and tier captures,
   ≥30/55 FPS in every retained reporting window and overload/recovery mutation proof.
4. Every phase: final caller anchors, independent checkpoint, parent updates, red/green output.
5. Combined delivery: typecheck, lint, test, affected playtests, required CI/review, squash merge,
   remote-main confirmation, clean worktree cleanup. No gate is claimed before execution.

## GPU timestamp freshness prerequisite (in progress)

Layer: engine observation, because only the renderer can identify the backend's successful
query frames. `renderer.gpuFrameAge()` reads Three's `backend.getTimestampFrames("render")`
and `info.frame`; `game.ts` supplies it to the existing `FrameBudget` report as `gpuAgeFrames`.
Unknown/invalid frame identity reports absence, never a fabricated fresh sample.
No visual policy moved into core. No native gate or full phase acceptance is claimed.

Observed red, `pnpm exec vitest run packages/core/__tests__/renderer.spec.ts`:

```text
Expected: 2
Received: undefined
Test Files  1 failed (1)
Tests  1 failed | 18 passed (19)
```

Observed game-flow red and mutation: remove
`readGpuAgeFrames: () => renderer.gpuFrameAge?.()` from `game.ts`. The existing
`game-frame-budget-surface.spec.ts` fails because the emitted frame report lacks
`gpuAgeFrames: 2`:

```text
Test Files  1 failed (1)
Tests  1 failed | 2 passed (3)
```

Green command (also rerun after restoring the mutation):

```sh
pnpm exec vitest run packages/core/__tests__/renderer.spec.ts packages/core/__tests__/game-frame-budget-surface.spec.ts packages/core/__tests__/frame-budget.spec.ts packages/core/__tests__/frame-budget-surface.spec.ts packages/core/__tests__/gpu-timestamp-resolve-cadence.spec.ts
```

```text
Test Files  5 passed (5)
Tests  47 passed (47)
```

Full typecheck/lint/test, native proof, and adaptive policy integration remain unrun.

## Worker backend interruption

All three Opus CLI handles terminated with exit 1 and JSON `is_error: true`:
`You've hit your session limit · resets 7pm (America/Vancouver)`.
Startup and quality model usage identifies `claude-opus-5`; the character attempt has no model
usage and made no implementation. No permission denials were reported. No replacement model
was selected; the coordinator requested routing direction and continued independent integration.

Resume IDs: startup `a52b6eac-939e-44cd-b584-35fea96d297f`, quality
`24156c84-44cd-4dd4-8802-d404d0b96aaa`, character
`c4092074-2620-4b2b-8653-f9831fbcd99c`.

Startup left one raw device capture; it is not an accepted baseline because installed build
identity and first accepted movement were not recorded in the artifact. Quality left an
uncommitted red test draft, without implementation; review must replace its incorrect assumption
that identical GPU floats imply staleness, and its cross-test formatter variable dependency.

Character census completed: Wildwood Animal and HQ Worker/Visitor independently clone, normalize
and create AnimationPlayer. Coordinator created the companion sandbox worktree at
`/home/joao/projects/threenative/sandbox/.worktrees/batch-2026-09-05`, base `5cc0304`, preserving
the primary sandbox's unrelated dirty files. No consumer migration has occurred yet.

## Follow-up verification

`pnpm build` exited 0. `pnpm typecheck` initially failed with missing workspace declarations
in the fresh worktree; after the build, the same command exited 0. Logs:
`artifacts/batch-2026-09-05/build-prerequisites.log` and `typecheck.log`.

Independent Luna review confirmed the age math and deletion sensitivity. Its initial concern
that `info.frame` stays zero was retracted after inspecting Three's unconditional
`Renderer.init()` → `Animation.start()` path; no manual counter increment was added.
Added checks for missing frame identity and a renderer with no timestamp backend. Browser/native
execution of the new age observation is still required.

The quality test draft now uses `gpuAgeFrames`, not equality of GPU durations, and no longer
shares a formatter through a cross-test variable. Its observed red is `11 failed | 15 passed (26)`:
the policy exports do not exist yet. This is explicitly unfinished work, not a passing gate.

An exploratory **existing desktop host** probe bundled the installed Three `yieldToMain` and
held all requested animation frames. It executed real host timers/yields and exited 0:

```text
TN_HELD_YIELD:{"yields":32,"timer":true,"frames":0,"scheduler":"function"}
```

Host: primary checkout `packages/runtime-native/build/tn-linux/mystral`, SHA-256
`92fc51519ef420c934615f772a496d66823ab09373caed14b588d3aeee9de48a`.
Probe bundle SHA-256 `04e0a955de9e5451e165aceedf465e24dd4db7fc0ac6060003ccf09c444ea619`.
Command: that executable `run artifacts/batch-2026-09-05/host-yield-probe.js --no-sdl`
under `timeout 10`, from the engine batch worktree. Raw log is `host-yield-probe.log`.
This demonstrates the historical shim failure is not universal in current desktop binaries.
It does not exercise compilation completion, establish the binary's source commit, prove Android,
or meet PRD-360 phase 1. The installed Android build identity still needs resolving.

## Real-renderer age probe (continuation)

Previous turn classification: progress (implementation plus observed red/green and prerequisite
gates). Current source state was re-read before this probe; Opus routing remains pending and no
substitute implementation worker was selected.

Bundled the current `createRenderer` source with a cube scene, rendered 30 callbacks, resolved
GPU timestamps through callback 19, and compared ages at callbacks 20 and 30. Bundle SHA-256:
`ed3cb044deaf40a228bc8324c79378b57a057b09b348f24c77d62f644d3ed593`.
Local source: `artifacts/batch-2026-09-05/gpu-age-native.mjs`.

Browser command: `sh scripts/xvfb.sh node --import tsx artifacts/batch-2026-09-05/gpu-age-browser.mjs`.
The probe serves its bundle over localhost and uses the shipped `WEBGPU_BROWSER_ARGS` with a
headed Chromium under private Xvfb. Exit 0, actual output:

```json
{"message":"TN_GPU_AGE_PROOF:{\"pass\":true,\"firstAge\":1,\"age\":11,\"gpuMs\":0.025824,\"kind\":\"webgpu\"}","adapter":{"vendor":"nvidia","architecture":"turing","description":""}}
```

Existing desktop host command:
`sh scripts/xvfb.sh timeout 20 /home/joao/projects/threenative/threenative-engine/packages/runtime-native/build/tn-linux/mystral run artifacts/batch-2026-09-05/gpu-age-native.js --headless --width 64 --height 64`.
The host hash remains the one above; its source commit is not established. Actual output:

```text
[WebGPU] Adapter: NVIDIA GeForce RTX 2080
[log] TN_GPU_AGE_PROOF:{"pass":true,"firstAge":1,"age":11,"kind":"webgpu"}
```

Native limitations: the probe emitted its expected age but the host did not exit after renderer
disposal, so `timeout` returned 124. `gpuMs` was absent in that final native observation. This is
an observed native age result, not a passed native gate, playable-world proof, or PRD acceptance.
Earlier `--no-sdl` attempts exited 1: the first mixed a 64×64 depth target with a 1280×720 host
surface; matching dimensions removed that validation error but the binary still segfaulted.
The hidden-window run avoided that crash. No production change was made to work around it.

`node packages/playtest/dist/runner/cli.js doctor --text` exited 0, finding Node, Playwright,
Chromium, Xvfb and ADB. It reported xcrun unavailable on this Linux machine. Raw diagnostics and
all three host outputs remain under the local task artifact directory.

## Starter integration and live callback proof

The generated policy is in `src/render/adaptiveQuality.ts` (under the template's 200-line
module limit). `game.ts` connects completed frame windows, and `Play` supplies configured FPS
and actual startup readiness. The quality entity exposes decisions; scene exit disposes its
controller. Integer counters and window identifiers are validated. Template instructions now
name the policy and `pnpm sync:agents` exited 0.

A tarball-installed starter was built at the companion sandbox worktree's
`starter-quality-20260905`; production build exited 0. Its `quality-live.playtest.json` waits
900 **presented** warmup frames, asserts `quality.window >= 1`, and drives the player using
ArrowUp. The first attempt incorrectly used 900 simulation ticks, which yielded only three
rendered scenario frames and failed the missing-window assertion. That was a scenario error,
not evidence against the callback.

The corrected run exited 0 and reported quality window 3, two metres of player movement,
`meter=presented`, and `fallback=gpu-stale` (GPU ages 7, 6, 5 across the three windows).
The policy correctly ignored a compiling window, then a startup window, then counted one
steady overload. It had not yet reached its two-window tier transition. This proves live
wiring and input, not adaptive performance acceptance. Raw output is in
`artifacts/batch-2026-09-05/quality-live-json-red.log` (the anticipated failure did not occur;
the file name is historical, and its actual verdict is pass).

Negative control: remove only `frameBudget.onWindow`, rebuild, and rerun the same scenario.
Exit 1, actual output:

```text
TN_PLAYTEST_COMPONENT_ASSERTION_FAILED
observed before=undefined after=undefined
```

Raw output: `quality-live-no-callback-red.log`. The restored final-code run remains pending.
Every browser run used the game's `tools/capture-lock.sh`, which delegates lock ownership to
`CAPTURE_LOCK=1` in the shipped runner, and its private Xvfb. No visible desktop was borrowed.
The source snapshot also reported an existing rock-worker `buildImplicitSurface is not defined`
error through the rock entity's debug fields; diagnostics did not turn that entity state into
a console error. This remains an observed limitation, not a clean whole-game claim.

Resource regression: actual Bloom nodes and their input RTT were created without a GPU stub
for those objects. Before the fix, disposal spies expected one call and observed zero.
`world-environment-lifetime.spec.ts` now passes: the generated bloom stage disposes the effect,
its newly allocated input target and input material. The caller's input is not owned.
Logs: `bloom-lifetime-red.log` / `bloom-lifetime-green.log`. ScenePass disposal is covered by
the controller lifecycle test. Full repeated GPU-resource bounds are still unverified.

Restored callback plus JSON-safe decisions and Bloom disposal: production build exit 0,
scenario exit 0. The paired verdicts, exact scenario, adapter receipt and opened screenshot are
retained in [quality-live proof](batch-2026-09-05-quality-live/proof.json).
[Capture receipt](batch-2026-09-05-quality-live/capture.json) names NVIDIA/Turing WebGPU with
hardware timestamp-query support. The [opened screenshot](batch-2026-09-05-quality-live/after.png) shows the coastal scene, player, flag and HUD;
no blank-frame claim is inferred from a test exit alone.

Root lint exited 0 (597 warnings). Root typechecking caught widened fallback string typing
missed by the package-only check; the worker added an explicit decision-field type, and the
root `tsc --noEmit -p tsconfig.json` check passed. Full workspace typecheck is running.
`pnpm test` first stopped at six pre-existing documentation links to ignored Wildwood artifacts
absent from this worktree. All six originals exist in the primary checkout; copied those exact
files locally and reran the complete gate. No substitute evidence or unrelated tracked edit.

Sequential `pnpm typecheck` exited 0. The overlapping attempt was invalid operational ordering:
`pnpm test` rebuilt physics and briefly removed declarations while typecheck read them.
Site's isolated test command also exited 0 (4 suites, 20 tests). The full suite's earlier site
failure named a missing file inside its temporary SSR cache; the suite process ended 143 and
left a stale gate status. `pnpm gate:doctor` was run. Full-suite green remains unclaimed.

The existing-host age probe was retried with its documented `--frames 40 --screenshot` mode,
which should terminate after capture. It emitted an age increase, but reported zero presents
and `[Screenshot] No rendered frame available yet`; the process still reached timeout.
Stop this probe lane: the doubtful assumption is that the synthetic 64x64 offscreen canvas
is a presentable native host surface. Further native proof must use the real game bootstrap
and the native playtest transport; more screenshot flags cannot establish that contract.

The exact callback mutation [scenario](batch-2026-09-05-quality-live/scenario.playtest.json) is retained with that proof.

## Integrated starter proof and remaining gates

The generated texture scopes now dispose newly created RTT targets and materials for outline,
Kuwahara and watercolor, while leaving external inputs owned by their caller. Malformed owned
resources throw. The actual-node regression observed zero disposals before the fix; the focused
looks suite passed 29 tests afterward. An invalid infinite window identifier also no longer
poisons subsequent quality observations: the regression failed with high instead of medium,
then the quality/lifetime suites passed 33 tests. Local raw logs are
`texture-scope-red.log`, `texture-scope-green.log`, `texture-scope-malformed-red.log`,
`texture-scope-malformed-green.log` and `quality-window-id-green.log` under the task artifacts.

The production worker failure above is fixed in commit `69fec69f`. Serializing a helper alone
lost its free identifier after minification; serializing the existing self-contained factory
preserves its bindings. The minified bundle regression first threw
`ReferenceError: buildImplicitSurface is not defined`; worker/looks suites then passed 30 tests.
The browser scenario `quality-refinement-live.playtest.json` now observes the quality window,
movement and ridge preview-to-refined transition together, with no diagnostics (exit 0).
Raw output: `quality-refinement-browser-final.log`.

The same tarball-installed starter was packaged with `THREENATIVE_RUNTIME_BINARY` pointing at
the existing desktop host (SHA-256
`92fc51519ef420c934615f772a496d66823ab09373caed14b588d3aeee9de48a`).
Its source commit is not established. Native packaging and the desktop scenario exited 0.
The native scenario must move before waiting: movement requests the refinement. Its earlier
wait-only version correctly failed at preview/generation zero. Headless execution used
`scripts/xvfb.sh` and `SDL_AUDIODRIVER=dummy`; no audio claim is made. Raw output:
`starter-native-playtest-final.log`, with artifacts in the game's `artifacts/native-quality-final`.

A separate 1,500-frame run of the real packaged starter exited 0 and produced an opened,
nonblank [native scene screenshot](batch-2026-09-05-quality-live/native.png). Completed windows reported
`gpuAgeFrames=1`, GPU milliseconds 11.99, 1.25, 1.25 and 0.72, and `meter=gpu fallback=none`.
The first two windows were excluded for compilation/startup. The remaining windows held high
quality; they did not exercise a transition. Concurrent build/test load makes the observed
18–19 FPS unsuitable for performance acceptance. Neither this result nor desktop movement
substitutes for the required physical Android runs or repeated-transition resource bounds.
Raw output: `starter-native-adaptive.log`.

Root JavaScript integration reported 4,292 passed, four failed and seven skipped. Failures were
the new adapter receipt's indexed duplicate, a static callback-call contract and two instruction
line limits. The receipt now carries actual subject provenance, the callback uses an explicit
arrow call, and the instructions fit both source and generated mirror limits. Targeted rerun:
three passed, 47 skipped (`contract-gates-repaired.log`). Full workspace testing also exposed
missing compiled native test prerequisites; source-built V8 and QuickJS fixtures now pass all
five focused executions. Their hashes and build exits are retained locally in
`native-build-prereq/`. Full-suite green is still pending; no failed run is relabeled green.

PRD-361's current-caller census found only eight directly replaceable executable lines, or
eleven including HQ's separate clip-name guard. Wildwood's 70-line triangle filter decides
species-specific appearance and remains game-owned. The existing LOC scorer counts formatted
physical source, including public types and imports; executable deletion alone cannot establish
a net saving. No new wrapper was added to manufacture acceptance. A scope question is pending
while independent startup and quality verification continue.

Final refreshed starter scaffold check exited 0; root typechecking completed without errors and
lint exited 0 (598 warnings). Logs: `final-repaired-scaffold.log`,
`final-repaired-typecheck.log`, `final-repaired-lint.log`. The next full test run reached
4,295 passed, one failed and seven skipped: the transport-only browser diagnostic test lost
its page before evaluation. Its expected runtime diagnostic was therefore not evaluated.
This run is a failed gate (`native-prereqs-full-test.log`), not a source regression diagnosis.

## Startup incumbent and device preflight

The existing native scheduler also permits actual Three.js `compileAsync` completion while
rAF callbacks are intercepted and held. A local probe uses `globalThis.canvas`, the real host
surface, then performs 32 calls to upstream `yieldToMain`, a timer and a cube pipeline compile.
Only after reporting does it restore the native frame callback and draw. Actual output:

```text
TN_HELD_COMPILE:{"pass":true,"yields":32,"timer":true,"requestedFrames":1,"error":null}
```

Deleting `globalThis.scheduler` before the same probe leaves the first upstream yield awaiting
its intercepted frame callback. The 15-second watchdog reports:

```text
TN_HELD_COMPILE:{"pass":false,"yields":0,"timer":true,"requestedFrames":2,"error":"deadline"}
```

The initial probe incorrectly asserted zero *requested* frames; renderer initialization requests
a callback even though none is delivered. The corrected assertion observes completion while
callbacks remain held. Both host processes reached their external timeouts (exit 124), so these
are paired semantic observations, not clean process-exit gates. Post-release surface markers
prove actual drawing; no synthetic canvas is used. Raw probe source and outputs:
`host-compile-probe.mjs`, `host-compile-probe-no-scheduler.mjs`,
`host-compile-probe-green.log`, `host-compile-probe-red.log` in the task artifacts.
This establishes an already-working desktop incumbent; it does not justify inventing an
installer repair or claim that Android's launch budget passed.

The next physical-device doctor probe exited 0: Pixel 8 online, thermal status 0, battery
35.7 °C, skin 36.2 °C, discharging. Battery was 44%, below the measurement lane's 50% minimum.
Charging and subsequent unplugging were requested; no qualified performance run was started.
Raw output: `device-doctor-current.txt`.

Independent Luna checkpoint inspected the live timing path, generated policy and controller:
no bounded code defect found. It verified pinned observations, fresh/stale/absent GPU handling,
and replacement only on changed decisions. It explicitly withheld phase-2 Android performance
and real GPU resource-transition approval. This review accepts the implemented wiring and unit
evidence only; it does not close either PRD phase's remaining acceptance requirements.

## Committed implementation gate

At `6b46480d`, `pnpm test` exited 0 with the original browser fixture and an otherwise idle GPU
lane. Actual summaries: root JavaScript 392 suites passed, two skipped; 4,296 tests passed,
seven skipped. Native package 101 suites passed; 716 tests passed, 39 skipped; its additional
suite passed 29 tests. Site passed four suites/20 tests. Raw output and exit record:
`quality-committed-full-test.log`, `quality-committed-full-test.exit` (0).

The proposed WebGL fixture bypass was rejected as an unsupported fix: both the bypass and the
original fixture passed the isolated control. The fixture was restored byte-for-byte before the
full green run. No transport assertion was weakened. Prior page-closure failures remain observed
transients whose cause is not established.

`pnpm budgets` passed evidence size/duplication checks, then required regeneration of the
screenshot retention index for the new capture. After regeneration it advanced to a stale native
coverage source digest. No digest was manually refreshed and no native coverage execution is
claimed. Raw outputs: `quality-committed-budgets.log`,
`quality-committed-budgets-restored.log`.

## Real GPU resource replacement control

The [resource lifetime proof](batch-2026-09-05-quality-live/resource-lifetime/README.md) runs
the actual renderer and starter postprocessing with synthetic quality windows, separately from
the live-game callback proof. Both high→medium→low→medium→high cycles rendered real draws.
High/medium held 26 textures and 25 draw calls; low held 16 textures and 16 draw calls. Bloom
was present and no stage was dropped. NVIDIA/Turing WebGPU run exited 0.

An esbuild transform removed only the first `disposeGraph?.()` in the real controller's
`apply()`; final controller disposal remained. The unchanged assertions then failed (exit 1):
high-start textures grew from 26 in cycle one to 34 in cycle two, eventually reaching 42.
Restoring the normal bundle returned exit 0. The
[receipt](batch-2026-09-05-quality-live/resource-lifetime/receipt.json) retains counts, exits,
hardware and source hashes; the linked directory retains the probe and mutation commands.
This establishes browser resource bounds for the exercised cycles, not measured overload,
native resource bounds, pinned-tier game capture or physical Android performance acceptance.

The inherited native coverage mismatch was traced to 305 tracked inputs, with no ignored or
untracked inputs and no native-source difference from `75639f2a`. Actual regeneration with
`CMAKE_BUILD_PARALLEL_LEVEL=4 pnpm --filter @threenative/runtime-native native:coverage`
exited 0 and executed 33 native contract targets. It covered 8,555 of 20,804 lines (41.12%);
physics bindings and video recorder targets remain explicitly excluded by their build options.
The generated [coverage report](native-coverage-2026-08-28.md) now has source digest
`83865e15852f4a8cd0f09f5c6362a3e6fdef12020e9866b5ace680b08d93a9d2`.
Raw output: `native-coverage-refresh.log`; exit record: `native-coverage-refresh.exit` (0).

`pnpm census` regenerated three stale native census cells (123,269 → 123,512 lines).
`pnpm budgets` then exited 0 (`quality-final-budgets-census.log`). The evidence scripts were
formatted and their imports organized by Biome; retained source hashes were refreshed afterward.

The shipped `pnpm test:templates` gate selects eight templates; it omits platformer and starter
as already booted. Seven passed. Defense failed at frame p95 41.4 ms (limit 33) and two attacker
leaks, with clean runtime/console/network diagnostics and nonblank NVIDIA/Turing WebGPU output.
`TN_TEMPLATE_ONLY=defense pnpm test:templates` then exited 0: all seven defense scenarios and
its real-frame smoke passed unchanged. These failures are not reproduced in isolation and are
not attributed to the cleanup patch. Logs: `quality-template-playtests.log`,
`quality-template-defense-isolated.log`. The serialized whole-gate rerun then exited 0: all eight
selected templates passed without source or threshold changes. Raw output and exit record:
`quality-template-playtests-serialized.log`, `quality-template-playtests-serialized.exit` (0).
The evidence formatting lint also exited 0 (`quality-evidence-restored-lint.log`; 598 warnings).

Concurrent sandbox cleanup removed `prd329-bayview-20260905`. Its path is absent from tracked
history; the surviving `fps-framework` is the known 240-FPS/0.44-scale arm, not the installed
120-FPS/0.55-scale subject. It was not silently substituted. The task's sandbox worktree and
starter remain intact. A source-choice question is pending. The installed `base.apk` was pulled
read-only into local `device/installed-baseline/`: 193,653,330 bytes, SHA-256
`007e1dc247b58cc13126f44c52cff97f230934bcc2f305c83e35805bcba9077e`, matching the recorded subject.
No app data was copied and no launch, stop or install was performed. The later battery check was
40%, still below the 50% measurement threshold.

## Measured-load browser calibration — not an acceptance pass

A build-only Vite fixture used the real starter and real FrameBudget observations. It pinned
resolution scale to 1, reported every 30 frames, and temporarily set high/medium Kuwahara radius
9 at full resolution. The normal policy, 60-FPS target, overload/recovery windows and cooldown
were unchanged. A fixture hook restored the original presets after observing low. No synthetic
GPU measurements were injected. Local driver: `build-starter-quality-load.mjs`; normal build
exited 0 with one match for each of its three declared source transforms.

At 2560×1440 on NVIDIA/Turing, the headed WebGPU run observed high→medium→low and two fresh GPU
overload windows, but did not recover within 120 seconds (exit 1). Movement distances at the
three tiers were 2.00, 4.14 and 4.26 metres, with no browser errors. The low capture was opened
and showed the rendered world and player. Low GPU cost dropped, but samples commonly remained
six or more renderer frames old, so the policy disclosed its presented-frame fallback.
Receipt: `quality-load-normal-compositor-control/receipt.json`.

Adding the shipped performance-browser flags removed compositor pacing but produced hundreds
of frames of GPU sample age; the unchanged fresh-overload assertion failed (exit 1). Receipt:
`quality-load-normal-uncapped-control/receipt.json`. Neither run proves recovery. A harness
review also found that `bridge.advance()` leaves the loop in fixed-step mode; those runs prove
bounded input steps rather than continued live updates. The harness now uses a real one-second
key hold, but that correction has not yet produced a qualified run.

The third control, normally paced headless Chromium, selected Google/SwiftShader and failed the
hardware assertion before collecting windows (exit 1). Receipt: `quality-load-normal/receipt.json`.
Browser retries stopped after these three attempts. The doubtful assumption is that this
Xvfb/browser configuration provides sufficiently fresh GPU observations for the recovery proof;
no production freshness threshold or acceptance assertion was relaxed. Doctor exited 0 and found
Node, Playwright, Chromium and Xvfb; iOS tooling was absent. Pinned and policy-deletion controls
have not run because a qualified normal baseline is still missing.

Independent harness review found additional acceptance gaps: recovery did not require a fresh
post-hook GPU/headroom decision, initial windows could satisfy overload without startup filtering,
and saved captures had no visibility/bounds assertion. The failed runs remain calibration only;
these missing checks are being tightened before reuse. The scenario file supplied bridge
capability requirements, not an executed scenario. Build-only pinned/deletion transforms exist
in the driver, but neither variant has been built or run. A later read-only phone battery check
reported 31%, discharging, 33.1°C; no measurement launch was attempted.

A read-only runner lookup found no shipped browser recipe combining hardware WebGPU with bounded
submission cadence. `webgpu` supplies the Vulkan hardware flags; performance scenarios append
uncapped-frame/vsync flags. Web `display.maxFps` sets the resolution-scaling target, not a loop
cap. No new browser flag or production timing mechanism was introduced to make this proof pass.


## Native resource lifetime positive control

The unchanged retained probe ran on the desktop V8/Dawn host, Vulkan/NVIDIA RTX 2080, using
`globalThis.canvas`. The initial normal-mode command produced one passing marker but required
termination because `--frames` only bounds screenshot mode. The corrected screenshot-mode
command exited 0 and logged `Screenshot saved`, `Rendered 180 frames in 33604ms`, and
`TN_PRESENTS:100`. `TN_STARTUP_CAPTURE_READY:0` is retained: no readiness flag was fabricated.
The shutdown capture is not native visual acceptance evidence.

An independent marker assertion passed: exactly one result, two five-sample cycles, positive
integer texture/draw counters, bloom present and no dropped stages. Both cycles held textures
26/26/16/26/26 and draw calls 25/25/16/25/25. The
[native receipt](batch-2026-09-05-quality-live/resource-lifetime/native-receipt.json) records the
host and bundle hashes; raw log: `quality-resource-lifecycle-native-screenshot.log`.
Inputs are explicitly synthetic. This proves the exercised native resource transitions, not
measured-load recovery, phone performance or full PRD acceptance. The native mutation control
then ran: both host commands exited 0, while the unchanged result verifier exited 1 for the
mutation (`texture count grew on repeat at high-start: 26 -> 34`, later reaching 42) and 0 after
restoration (`PASS: two native cycles, positive counters, no growth or dropped stages`).
Only the first replacement disposal was removed; final cleanup remained. The original default
browser-named bundle was rebuilt afterward and its hash matches the original native bundle.

The browser harness audit fixes passed `node --check` only. Its current artifact SHA-256 is
`4bd55cc7d49f15dec50ae2d95ac6c838a1130b89e62ce59b0beac8bcbb62592b`; no further browser run was made.

After retaining the native proof, `pnpm lint` exited 0 (598 warnings). The first evidence budget
run required the generated retention index to be refreshed; after running its generator,
`pnpm budgets` exited 0. Raw logs: `quality-native-evidence-lint.log`,
`quality-native-evidence-budgets.log`, `quality-native-evidence-budgets-restored.log`.
No production source changed during these evidence additions.

## Held-presentation compilation — clean bounded host evidence

The finalized [positive source](batch-2026-09-05-held-compile.mjs) and
[scheduler-deletion source](batch-2026-09-05-held-compile-negative.mjs) were rebuilt and executed
on desktop V8/Dawn, NVIDIA RTX 2080/Vulkan. Both host commands exited 0. Positive reported
`pass:true, yields:32, timer:true, requestedFrames:1, error:null`; deletion reported
`pass:false, yields:0, timer:true, requestedFrames:2, error:"deadline"`. The same
[semantic verifier](batch-2026-09-05-verify-held-compile.py) exited 1 on deletion and 0 on positive:

```text
RuntimeError: held compilation failed: {'pass': False, 'yields': 0, 'timer': True, 'requestedFrames': 2, 'error': 'deadline'}
PASS: 32 yields, timer progress, and compilation completed while presentation was held
```

The [receipt](batch-2026-09-05-held-compile-receipt.json) retains actual source/bundle/host hashes,
process/verifier exits and presentation counts. The first pre-retention positive wrapper lost
its exit record because zsh rejected `status` as a variable name; the corrected recorded runs
supersede it. Final retained sources were formatted by Biome; the deletion uses
`Reflect.deleteProperty` and the finalized pair was executed again. No startup-readiness flag
was fabricated (`TN_STARTUP_CAPTURE_READY:0`). The probe makes 32 explicit calls to upstream
`yieldToMain` before compiling one cube: it does not prove a saturated Bayview compile walk,
maximum event-pump gap, first accepted movement, or the eight-second phone target. No installer
bug or production scheduler fix is claimed.

Reproduce from this worktree root (use distinct negative bundle/log/capture paths for the
`batch-2026-09-05-held-compile-negative.mjs` input):

```sh
pnpm --filter create-threenative exec esbuild ../../docs/verification/batch-2026-09-05-held-compile.mjs --bundle --format=iife --platform=browser --target=es2022 --outfile=../../artifacts/batch-2026-09-05/held-compile-retained-positive.js
LLVM_PROFILE_FILE=artifacts/batch-2026-09-05/held-compile-retained-positive-%p.profraw SDL_AUDIODRIVER=dummy timeout --kill-after=5s 60s sh scripts/xvfb.sh packages/runtime-native/build/tn-linux-coverage/mystral run artifacts/batch-2026-09-05/held-compile-retained-positive.js --screenshot artifacts/batch-2026-09-05/held-compile-retained-positive.png --frames 3 > artifacts/batch-2026-09-05/held-compile-retained-positive.log 2>&1
python3 docs/verification/batch-2026-09-05-verify-held-compile.py artifacts/batch-2026-09-05/held-compile-retained-positive.log
```

PRD-362 now names its final callers and unresolved phase-file-count variance; parent PRD-287
records the starter's partial proof without closing phone/all-template criteria. The single
performance record now contains the unsuccessful measured-load calibration and its limitations.
A fresh phone check reported 29%, discharging, 29.6°C; the Android measurement lane remains
unqualified. Source choice, PRD-361's LOC decision, and Opus routing remain pending.

The retained held-frame proof passed `pnpm lint` (598 warnings) and `pnpm budgets`, both exit 0,
after generating the retention index. Logs: `held-proof-lint.log`, `held-proof-budgets.log`.
A read-only `git fetch origin` succeeded. The original local base `75639f2a` still contains five
commits absent from `origin/main`; remote main has no newer commit than that base. These inherited
commits (`08e22968`, `b7336980`, `eb1149dd`, `e76b0354`, `75639f2a`) require base reconciliation
before a task-only PR. No primary branch was changed and nothing was pushed.

## Native measured-load fixture — build ready, handshake not accepted

The owned Release/V8 host built without coverage instrumentation (exit 0), SHA-256
`53fe0026923da727583dac8c746e6c64b6f070410a4300803f03e48e58c29f70`.
The native stress fixture reuses the Vite transform factory and real frame-budget callback;
it ends the expensive preset interval when the measured controller first selects low.
The final package build exited 0 with exact transform reports. Both temporary game configs
were restored byte-for-byte. The package includes its UI directory and embeds a 2560×1440
window. Build wrapper, receipts, executable hashes and logs are local artifacts under
`artifacts/batch-2026-09-05/` (`build-starter-quality-native.py` and
`quality-load-native-normal-receipt.json`). No production source changed in this fixture work.

Three native harness attempts failed, all exit 1, before load acceptance:

1. Copying only the executable omitted its sibling UI bundle. The runtime reported
   `TN_UI_BUNDLE_MISSING`; requested CLI dimensions were also overridden by embedded config.
   Evidence: `quality-load-native-missing-ui-control/`.
2. The complete package reached the semantic bridge, but the reused web scenario required
   unavailable `browser.network`. Evidence: `quality-load-native-web-capability-control/`.
3. Removing its network assertion still left the handshake requiring `browser.network`.
   Evidence: `quality-load-native-normal-proof/`; its receipt has `pass:false` and no console
   errors. Retries stopped. The doubtful assumption is that this web scenario is a suitable
   native handshake after removing only that assertion. That receipt was later superseded in
   place by the rerun below and is no longer retained.

The harness now counts distinct GPU windows, checks all observed buffer dimensions, requires
five fresh high-tier headroom windows for recovery, and captures output after owned-process
shutdown. Those strengthened checks have not passed a measured-load run. No pinned or
negative measured-load variant was executed. Project `doctor --text` exited 0 and reported
Linux prerequisites available; iOS tooling is absent. This does not close any platform gate.

The read-only PR base audit confirms `origin/main..75639f2a` contains five inherited commits;
task commits are `87475676^..06d62253`. Scaffold hashes and the retention index overlap both
ranges. Inherited rendering patches may affect runtime evidence and require explicit dependency
resolution and retesting before a task-only PR. No rebase, push or primary-checkout edit occurred.

The read-only handshake diagnosis resolved the failed assumption: omitted `noNetworkErrors`
is enabled by `requiredPlaytestCapabilities`; deleting it cannot remove `browser.network`.
The reused diagnostics and visibility assertion families are web-only. A future native harness
must use native-supported resource/component preflight and retain explicit console, runtime,
visibility, and screenshot checks. No fourth native attempt was made in this continuation.

Opus became available after its scheduled reset. A focused read-only review completed with
`is_error:false`, model `claude-opus-5`, and no permission denials; its local result is
`opus-quality-review-result.json`. It identified a real fallback-noise defect. The new healthy
60 Hz regression feeds absent GPU timing and actual 16.7 ms presentation intervals; it failed:
`AssertionError: expected 'medium' to be 'high'` (`quality-vsync-red.log`, exit 1).
Other review findings remain subject to triage; a review allegation is not accepted defect proof.

The fallback fix adds validated `presentationTolerance` (default 0.05) and reports
`overloadBudgetMs`; only presentation timing receives tolerance. Fresh GPU costs still compare
against the configured FPS budget. The focused suite passed `35/35` tests (exit 0), including
healthy fallback, genuine fallback overload, fresh GPU overload, strict override and invalid
options. Vsync-bound fallback alone still cannot prove 20% recovery headroom. Starter instructions
and their generated mirror now state that limitation. The observed starter scaffold hash changed
to `6830a101ea3fc6ce4a5a65acb7038bae5c85b16a1d69f4494de1909bd0108f84`.

The updated sandbox production build exited 0. The existing live-window scenario exited 0
with `pass:true`, no diagnostics, approximately two metres of movement and the new threshold
in the quality entity. The [proof](batch-2026-09-05-quality-live/presentation-tolerance/proof.json),
[byte-identical NVIDIA/WebGPU adapter configuration](generated-shooter-input-2026-08-21/web/capture.json),
and [opened capture](batch-2026-09-05-quality-live/presentation-tolerance/after.png) retain that
integration check. The capture shows the island, player, flag and HUD. This does not establish
healthy-vsync behavior on hardware, measured recovery, or phone acceptance; the regression is
unit evidence. An initial sync command ran from the game directory and failed before copying;
the subsequent correct source sync and `quality-vsync-game-build-final.log` are authoritative.

Opus reviewed the focused delta and reported no new correctness defect. The 5% allowance is
an unmeasured policy choice, not a measured hardware jitter percentile; PRD-362 now states this.
It intentionally treats a sustained presentation interval within that band as steady. Recovery
still needs measured 20% headroom. The review's counter-reset and malformed-config concerns
were triaged as deliberate consecutive-valid hysteresis and fail-closed behavior; mixed-meter
counting remains an unproven concern, not a reproduced defect. Distinct initial and observed
log sources identify boot selection and later policy decisions. Broad acceptance remains open.

Final fallback-fix gates: `pnpm typecheck` exited 0; `pnpm lint` exited 0 (599 warnings).
The first full test command failed on the newly duplicated adapter receipt, not on the old
`reveal.json` group named as the largest existing duplicate. Referencing the byte-identical
tracked receipt restored `evidence-budget.spec.ts` to 12/12 passed. The complete rerun of
`pnpm test` exited 0: 392 Vitest suites passed, two skipped; 4,299 tests passed, seven skipped.
`pnpm budgets` also exited 0 after deduplication. Logs use the `quality-vsync-` prefix;
`quality-vsync-test-final.log` and `quality-vsync-budgets-dedup.log` are the passing full runs.
The code and live proof were committed as `1b2f72ce`. No source changed during the final suite.
The phone's latest read-only battery check was 43%, discharging, 34.8°C; it remains below the
50% measurement gate. PRDs 360/361/362 remain unaccepted; nothing was pushed or merged.

## Task-only PR base reconciliation — 2026-09-05

The delivery branch is `batch-2026-09-05-pr`, cut from freshly fetched `origin/main`
`356cbe9f`. The previous lane branch `batch-2026-09-05` is preserved at `2ba32f5e`; only
`git diff --binary 75639f2a..2ba32f5e` was applied onto the clean base, so the five inherited
local-main commits — including their Three.js material/cache patch — are **excluded** from this
PR. `pnpm install --frozen-lockfile` exited 0 against `patches/three@0.185.1.patch` as committed
on `origin/main` (`b44584acc972bf58bd7d17244a843160`), so every gate below ran on origin's
dependency patch, not the inherited one. `pnpm build` exited 0 and left `capabilities.json`
byte-identical, so no public surface moved.

Two files conflicted and were resolved rather than overwritten:

1. `packages/create-threenative/__tests__/scaffold.spec.ts` keeps origin's hash table and its
   comment history, keeps this lane's two added generated paths (`src/render/adaptiveQuality.ts`,
   `src/render/textureLifetime.ts`), and drops the inherited lane's `eb1149dd` provenance note.
   Red: the spec failed with all ten hashes mismatched (`scaffold-red.log`, exit 1, 1 failed |
   54 passed). The `Received` block was transcribed verbatim; green: exit 0, 55/55
   (`scaffold-green.log`). The measurement tree was this isolated single-lane worktree with the
   working tree equal to its index, which is what the spec's clean-checkout rule requires.
2. `docs/benchmark/SCREENSHOT-RETENTION.md` is generated. Its conflict was resolved to origin's
   rows and then regenerated by `scripts/generate-retention-index.ts` after the evidence files
   were staged; no row was hand-authored. `docs/verification` now reports 581 tracked files,
   49,262,845 bytes, 24 uncited.

`docs/verification/native-coverage-2026-08-28.md` and `native-runtime-census-2026-08-16.md` were
**restored to origin's committed records**. This PR changes no `packages/runtime-native` source,
so the applied versions described the inherited commits' conformance and test trees instead of
this base. `pnpm budgets` named it: `native coverage report is stale: source digest changed`
(exit 1, `budgets-1.log`). After the restore, `pnpm budgets` exited 0 (`budgets-2.log`); no
digest was hand-edited or recomputed.

Fresh gates on this base, in this worktree, logged under
`artifacts/batch-2026-09-05/opus-pr-logs/`:

| Gate | Exit | Result |
| --- | ---: | --- |
| `pnpm typecheck` | 0 | all packages and examples |
| `pnpm lint` | 0 | 599 warnings, 1,975 files checked |
| `pnpm test` | 0 | root suite 391 files passed, 2 skipped; 4,291 tests passed, 7 skipped |
| `pnpm budgets` | 0 | after the census/coverage restore |
| `pnpm exec tsx scripts/generate-retention-index.ts --check` | 0 | index fresh |
| `pnpm sync:agents --check` | 0 | 19 CLAUDE.md mirrors in sync |

The earlier typecheck/lint/test/budgets and the hardware browser scenario in this ledger were run
**before** this base cleanup and are not claimed as final-base platform verification. The
2026-09-05 native measured-load runs were taken on the pre-cleanup tree and are retained as
lane evidence only under `artifacts/batch-2026-09-05/`; `2fcc4c37…` and `b45f632c…` below are the
pre-cleanup executables, recorded for continuity because those receipts were since overwritten.
The same three proofs were rerun against the reconciled PR base, and the rerun evidence is
committed immutably at [`docs/verification/prd-362-native-load-2026-09-05/`](prd-362-native-load-2026-09-05/README.md):
`normal` exit 0, tier sequence `high,medium,low,medium,high`, executable `79cda4ba…`;
`pinned` exit 0, executable `f78bbb68…`; `negative` intended exit 1, executable `ccd0f21e…`;
runner `86ad1b39…` in all three receipts, `[WebGPU] Adapter: NVIDIA GeForce RTX 2080`,
`[WebGPU] Backend: Vulkan`, zero console and teardown errors. Packaged fixtures under
`artifacts/batch-2026-09-05/*-package/` are build outputs, not source checkouts.

Nothing in this reconciliation closes a platform gate. The phone was not launched: its last
read-only check was 37% battery, discharging, 34.5 °C, below the 50% measurement gate. PRD-360's
startup target, PRD-361's shared character preparation, and PRD-362's device acceptance all
remain open, and no delivery PRD is accepted.

## Pump-silence observer integration — 2026-09-05

Final review of the uncommitted pump-observer work found and fixed two issues: non-positive
inter-entry gaps (backwards clock step) could move the maximum/retained list, and the endpoint
FNV-1a iterated `char` bytes (sign-dependent). The endpoint fix was retained; the standalone
injected-clock C++ contract was removed to bring the observer back within the Phase 1 five-file
cap. Proof: vitest pump 11/11,
pump pass, evaluator 32/32, collector flow (real host + mailbox, mocked adb only) correlated with
hash match; current desktop probe correctly rejects (`firstPumpAtMs≈410ms` exceeds 250 ms).
Integrated host `50144dc9…` supersedes `b5af03ff…` and `6f5263e0…`. Executed proof sources retained
byte-identically under `docs/verification/prd-360-startup-2026-09-05/`. Full Android end-to-end
remains unexecuted; no phase accepted.

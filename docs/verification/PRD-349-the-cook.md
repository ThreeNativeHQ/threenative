# PRD-349 — cook execution evidence

Execution in `.worktrees/prd-349-cook-default`, branched from
`assets/prd-349-352-execution` at `6685739e`. In progress; no completion claim.

## Compiler and template checkpoint, 2026-09-04

- Shared images default on in parser, sequential pass and worker; explicit false reports embedded
  image bytes retained. No `sharedImages === true` gates remain in asset sources.
- Automatic compression retains a source image when its encoded container would grow, at unchanged
  dimensions. Explicit codec overrides still win. New cache keys invalidate earlier encodes.
- Exclusion globs validate through both config layers, filter sources, print excluded bytes and
  remove prior compiler-owned primary outputs. Exclusion cleanup checks output-root containment.
- Budget defaults: 64,000,000 uncooked bytes, no total ceiling. Mobile decoder limitations exempt
  uncooked bytes. Measurements read emitted files, deduplicate shared outputs, inspect GLB data,
  and distinguish automatic no-growth fallback from an explicit compression opt-out.
- Every template omits cook opt-outs and documents defaults/overrides; scaffold hashes updated.

Observed red/green:

| Gate | Red | Green |
| --- | --- | --- |
| Shared images without config, sequential and worker | missing `public/shared/images` | both produce shared images |
| Tiny source image | embedded 436 > 150; standalone 542 > 150 bytes | original 150-byte source retained |
| Exclusions | `TN_ASSETS_CONFIG_UNKNOWN_KEY: assets.exclude` | 4 tests pass, including stale primary output removal |
| Config-loader exclusion seam | `assets.exclude is not recognised` | real loader → compiler passes |
| Template opt-outs | starter and sailing fail, 8 others pass | all 10 pass |
| Scaffold pin | old hashes fail | repinned hash passes |
| Budget | unknown `assets.budget`; deleting only `assertBudget` makes rejecting test resolve | 21 budget tests pass |
| Every template budget reachability | planted raw PNG fails 1-byte uncooked ceiling | 31 template tests pass with default budget and expected rejection |
| Imported model health with shared images | `Cannot resolve external images with binaryToJSON()` | real FBX compile, cache hit and triangle ceiling control pass |
| Image-only shared GLB writer | rejects zero external binary buffers | existing extension-required health test passes |

Combined verification executed:

```text
pnpm exec vitest run packages/assets/__tests__ \
  packages/create-threenative/__tests__/config.spec.ts \
  packages/create-threenative/__tests__/template-assets-compile.spec.ts
Test Files 31 passed | 1 skipped (32)
Tests 382 passed | 1 skipped (383)
Duration 35.13s
```

The later per-template budget probe adds ten tests: template suite 31 passed, 3.50s.
Empty/fully cooked templates cannot legitimately fail a 1-byte uncooked ceiling; each negative
control therefore plants an eligible raw PNG, rather than claiming an empty build exceeds it.

The README's empty-chain trap is stale on this branch: `activePassSpecs.length > 0` already guards
pool creation. A new subprocess regression runs the real compiler with audio/models/textures
disabled and verifies zero passes, concurrency 1, and normal exit. Both worker lifetime tests pass.

## Wildwood baseline and automatic-resolution investigation

Sandbox initial HEAD: `d535f51`, separate repository. Existing dirty game files were preserved.
Manifest-resolved emitted files: 165 entries, **2,003,433,565 bytes**. Largest entry is
`fab/2dd7964c-a601-4264-a53d-465dcae1644c-ue/Materials/UnrealMaterialLibrary.glb`,
**710,461,408 bytes**. PRD's 1,910/677 figures are MiB rounded, not decimal MB.

The initial capture could not build: installed core lacked `addInSlices` and `loadAll`. A
content-hashed current core tarball repaired that package mismatch without changing the cook.
The first 15-second screenshot was still the loading screen and was rejected as visual evidence.
A later capture rendered the forest but auto resolution reached 0.52 (666×374 stretched to
1280×720), with a `depthStencil.format` async-pipeline error. NVIDIA/Turing adapter was verified.

A temporary full-resolution capture control was restored to `resolutionScale: "auto"` after the
owner clarified that the automatic behavior itself must work. The control's full-resolution
frame time was about 42 ms; the 0.52-scale capture remained around 41 ms. These runs motivate
investigation, not a claim that GPU cost is known.

Found an engine measurement bug: detached `resolveTimestampsAsync` calls lose Three's `this`.
Changing the test stub to a real receiver-dependent method produces:

```text
resolveTimestampsAsync ran 0 times across 30 frames
expected 0 to be greater than or equal to 56
```

Calling it with the renderer receiver restores both render and compute queries. Timestamp and
frame-surface suites: **4 passed**. A real capture reports NVIDIA/Turing and render timestamps
around 8–10 ms. These are individual resolved render samples, not whole-window GPU percentiles.
An exploratory render-plus-compute sum was withdrawn: Three retains the last compute timestamp
when there is no new dispatch, so summing the two may combine unrelated frames.

The empty-page control on the same private display reports 180 RAF intervals, median 16.7 ms,
59.13 FPS. OS focus names the control window. Xvfb reports 0 Hz, so this validates a roughly
60 Hz browser callback lane, **not a physical display rate or presented-game FPS**.

The enriched pipeline stack locates the missing depth format inside Three's `compileAsync`,
after auto resolution resizes its render target. Warm-up had timed out after about five seconds,
but its asynchronous compilation continued. The renderer now tracks pending compiles, defers
automatic scale changes until they settle, and the game loop does not feed those compile windows
to the scaler. Rendering and timing reports continue.

```text
red renderer lifetime: expected resolutionScale 1 / width 320, received 0.61 / width 195
red game/controller mutation: expected scale 1, received 0.23 after pending compile
green: Test Files 4 passed (4), Tests 26 passed (26), Duration 443ms
pnpm --filter @threenative/core typecheck: exit 0
pnpm --filter @threenative/core build: exit 0
```

Installed content-hashed core `e5b0be2d730c` in Wildwood. The same 60-second hardware capture
(`artifacts/look/prd349-compile-resize.png`) exits 0, has no console/pipeline errors, and stays
1280×720 at scale 1 with **scaleSource auto**. The source config remains `"auto"`. Before this
repair, the same run reached 781×439 at scale 0.61 and exited 1 with the depth-format error.
This proves the compile/resize overlap repair on browser; it is not full performance or native
proof. Long-running compilation and the remaining host gap are being traced with the engine CLI.

## Reusable browser trace diagnostics

The temporary Wildwood-only presentation control and `createRenderPipelineAsync` wrapper were
removed from `tools/look.mjs`; the existing engine `trace` command now owns both. Before loading
game code it intercepts an empty page on the target origin, samples 180 rAF intervals, and reads
`adapter.info`. It preserves WebGPU behavior while enriching a missing `depthStencil.format`
attempt with the authored call-site stack. Missing or malformed presentation observations,
unacknowledged software adapters, and any invalid depth pipeline fail closed. An unavailable
adapter remains explicit without invalidating a CPU-only or plain WebGL trace.

Red/green regression records are `/tmp/prd349-playtest-trace-red.json` and
`/tmp/prd349-playtest-trace-green.json`. The red mutation disabled the two new fail-closed branches;
both targeted tests failed. Restored implementation plus optional compile-state reporting:
**37 focused tests passed**. Package typecheck,
declaration build and publint pass.

Actual browser fixture command:

```text
node packages/playtest/dist/runner/cli.js trace \
  --url http://127.0.0.1:4987/app.html --seconds 2 --settle 1 \
  --no-wait --no-input --allow-virtual-display --allow-software \
  --out /tmp/threenative-trace-control.json --text
```

It identified NVIDIA/Turing hardware and measured the empty-page rAF control at p50 16.7 ms,
p95 16.8 ms across 180 intervals. Those callbacks prove only the browser presentation lane was
advancing; they are **not** a physical refresh measurement or steady game-performance evidence.
The private-Xvfb game frame rate remained suppressed. The static fixture supplied no CPU profile
samples, so the command correctly exited 1 with `TN_TRACE_NO_SAMPLES` rather than passing.

The first Wildwood trace then exposed an existing parser defect, not absent profiler data. Its
214 MB raw file (`/tmp/prd349-wildwood.trace.json`) contains 3,739 `ProfileChunk` events. Chromium
emits the matching `Profile` event on the renderer main thread but delivers chunks on the
`v8:ProfEvntProc` thread; both share process id and profile id. The old accumulator keyed chunks by
delivery thread and therefore reported no samples. A captured-shape regression failed with an
empty function list, then passed after correlation changed to `pid + profile id`. The original run
overlapped another test suite and remains invalid as performance evidence regardless of parsing.

A fresh two-second current-Chromium fixture trace then exited 0 with 4,674 events and named
`requestAnimationFrame` plus `frame app.html:200`; raw evidence is
`/tmp/prd349-trace-parser-proof.json`. CPU packaging overlapped and the display was private Xvfb,
so this proves function collection only—none of its timing or utilization values are performance
evidence. The perf log reader also carries an optional measured `surface.compiling`: text prints
`compile pending` or `compile idle` only when present, and older markers do not fabricate false.

## Integration follow-up

Compiler recovery review found three defects: total budgets omitted Basis sidecars, a failed cook
could leave outputs without ownership for a later exclusion, and stale-output cleanup published
its receipt too early. The focused regression went from **3 failed / 31 passed** to **35 passed**.
A pending ownership journal now preserves retry ownership; stale paths are all checked before
deletion and the successful receipt is published after cleanup. A sidecar fixture reports total
584,944 bytes (82 primary + 57,529 JS + 527,333 WASM), uncooked zero. Missing-source cleanup
removes owned outputs and the manifest while retaining user files. Full assets suite:
**285 passed, 1 skipped**, 35.16 seconds; assets typecheck exits 0. Logs:
`/tmp/prd349-compiler-recovery-red.log`, `/tmp/prd349-compiler-recovery-final.log`,
`/tmp/prd349-assets-full-final.log`.

Renderer review added pending platform-resize, partial compile-window (including pinned mode),
and disposal regressions. Red observations included scale 0.61 for a window partly spent compiling,
immediate platform resize, and three compile calls despite disposal during the first call. The
renderer now defers platform resize too, stops scheduling compilation after disposal, and reports
whether compilation overlapped a measurement window. Four focused integration suites:
**36 passed**, 448 ms; core typecheck exits 0. The new review changes have not yet been reinstalled
in Wildwood or rerun on native. Logs: `/tmp/prd349-review-core-red.log`,
`/tmp/prd349-core-integration-focused.log`, `/tmp/prd349-core-integration-typecheck.log`.

The real Wildwood raw-cook negative control rejects **1,989,899,165 uncooked bytes** against the
64,000,000-byte default. Its config now excludes two unused `UnrealMaterialLibrary.glb` authoring
files, reporting **720,464,828 excluded bytes**, and otherwise uses cook defaults. The default cook
then fails on a 4096×4096 normal PNG: the current KTX2 encoder limits an input to 12,582,912 texels,
below this image's 16,777,216. No resolution reduction was applied. This remains under diagnosis;
there is no successful full cooked-build claim. Logs: `/tmp/prd349-wildwood-budget-red2.log`,
`/tmp/prd349-wildwood-cooked-web.log`.

## Quarry target evidence

Quarry was committed and pushed to the examples repository as `70ee6bf`; licensed source GLBs
remain local and ignored, while source and screenshots are published. It has six source GLBs (three rocks, three cliffs),
two texture-set combinations / three unique images and no assets config block. Web compilation
emits 3,984,176 manifest bytes. Browser playtest: **8/8 assertions passed**, 25.35 metres travelled,
all six props visited, all six textured and normal-mapped, no errors, NVIDIA/Turing adapter.
Desktop packaging and native playtest pass: **8/8 assertions**, 25.31 metres, six props visited.
The desktop scenario omits the browser-only CDP network assertion; it is not the identical
unmodified assertion set. Native screenshot: `quarry/artifacts/playtest/quarry-start-desktop.png`.

Android packaging produces an APK and 29,888,252 manifest bytes; no connected Android device was
available, so execution is **unverified**. iOS asset compilation/bundling produces the same byte
count, but packaging rejects Linux because it requires darwin-arm64: **not an iOS package pass**.
A temporary excluded 200,000,000-byte input reports its omission and writes no output.
Logs: `/tmp/prd349-quarry-web.log`, `/tmp/prd349-quarry-desktop.log`,
`/tmp/prd349-quarry-android-green.log`, `/tmp/prd349-quarry-ios.log`,
`/tmp/prd349-quarry-exclusion.log`, `/tmp/prd349-quarry-desktop-playtest-native.log`.

## Outstanding completion evidence

Wildwood cooked load-set size, no-resize proof, before/after appearance, all sandbox playtests,
final-source distribution/native evidence, reviewer checkpoints and final PRD archive remain
open. Quarry source and appearance proof are published; LOC and full engine gates have passed
at the checkpoints below, and must be refreshed after later source changes.

Latest integration checkpoint: content-hashed core `ffc61e8bc50e` is installed in Quarry. Both
browser and desktop pass the **same checked-in scenario** (the source scenario no longer requests
the browser-only network observation): distances 25.3756 and 25.3488 metres, respectively, no
diagnostics. Both builds and Quarry typecheck exit zero. Browser adapter is NVIDIA/Turing. These
are behavioral proofs, not performance measurements. Native execution reuses the existing host
binary; its C++ source is unchanged by this work and no fresh host build is claimed. Logs:
`/tmp/prd349-quarry-latest-browser.log`, `/tmp/prd349-quarry-latest-desktop-playtest.log`,
`/tmp/prd349-quarry-latest-desktop-build.log`.

Quarry raw/cooked appearance control uses identical source, camera, scenario and current core.
The raw control calls `compileAssets({config:{models:"none",textures:"none"}})` before Vite;
the cooked control runs the ordinary web build with the still-absent assets config block. Both
pass 8/8 assertions without diagnostics. Opened both first-step captures; the rendered props,
normal-map detail, silhouettes and colors are visually indistinguishable at 1280×720. The model
compiler reports zero resized images. This does not substitute for Wildwood's separate visual
requirement. Source and paired frames are checkpointed as sandbox `e5285c9`:
`quarry/artifacts/prd349-raw/quarry-start.png` and
`quarry/artifacts/prd349-cooked/quarry-start.png`. Logs:
`/tmp/prd349-quarry-{raw,cooked}-control-{build,playtest}.log`.

`pnpm budgets` exits zero (`/tmp/prd349-budgets.log`), with existing non-fatal aggregate LOC review
triggers. `pnpm tsx scripts/count-loc.ts --check` exits zero (`/tmp/prd349-loc.log`); that frozen
benchmark check is not a new encoder-specific LOC comparison. The latest official `pnpm test`
passes native package tests (708 passed / 39 skipped), its 29 physics-parity checks and 16 Rust
tests, then finishes root Vitest with 4,092 passed / 2 failed / 6 skipped. The two failures exposed
native-preflight fixtures whose planted stale manifests are now correctly cleaned. Repair must
retain real `build()` reachability using actual compressed source inputs, not merely invoke a
guard directly. Full suite still needs a green rerun after those repairs and the 4K encoder fix.

## 4K encoder integration

The shipped `ktx2-encoder@0.6.0` rejects a 4096² source in both its JavaScript guard and Basis v2.5
WASM32 wrapper. The package now carries a private LDR adapter and a reproducibly rebuilt version
of the same Basis source with its conservative LDR ceiling raised from 12 to 16 Mi texels. No
downscale, codec-policy change, supercompression default change or new runtime dependency is
introduced. The original npm encoder dependency is removed; the Apache license, MIT-derived
adapter attribution, source commit, container digest and artifact hashes ship with the package.

Observed red: `/tmp/prd349-ktx2-4k-red.log`, original encoder rejects 16,777,216 source texels.
Default-path green: `/tmp/prd349-assets-4k-green.log`, conditional real 4K test **1 passed**,
14 unrelated tests deselected; output remains **4096×4096**, **13 mip levels**, **UASTC**, KTX2
supercompression scheme **0**. The high-entropy fixture encodes in 171.344 seconds, source
57,402,213 bytes to 22,370,128 bytes. This test is explicitly executed, not inferred from its
conditional presence in the default suite.

Existing-size parity: `/tmp/prd349-ktx2-1024-parity.log` compares the old and new encoders with
the actual caller policy (`needSupercompression:false`). ETC1S output is byte-identical at
156,962 bytes; UASTC normal output is byte-identical at 1,398,560 bytes. The pinned-source rebuild
reproduces both generated JS and WASM hashes in 22 seconds
(`/tmp/prd349-basis-rebuild-proof.log`). Package build/typecheck, 36 focused tests and packed
WASM/license inspection pass. Root integration build, typecheck and lint also pass
(`/tmp/prd349-freeze-{build,typecheck,lint}.log`); the source checkpoint and final distribution
refresh remain pending.

Wildwood's observed runtime acquisitions resolve **76 unique manifest entries**, totaling
**299,463,735 bytes** before cooking. This is the measured current baseline, rather than the
PRD's older rounded load-set estimate. Rows were resolved through the active manifest and statted
on disk, not guessed from source filenames. The exact 76 path/output/byte rows are preserved in
`docs/verification/PRD-349-wildwood-runtime-baseline.json` before the cooked manifest replaces
the baseline; later load-set accounting must resolve these paths through the new manifest and
deduplicate its shared outputs, rather than summing only the primary GLBs.

## Integration checkpoint and remaining odd-size defect

The sequential `pnpm build`, `pnpm typecheck`, `pnpm lint`, `pnpm test` checkpoint exits zero.
Root Vitest output: `Test Files 381 passed | 2 skipped (383)` and
`Tests 4104 passed | 7 skipped (4111)`; suite temporary-directory count stays at one.
Logs: `/tmp/prd349-checkpoint-{build,typecheck,lint,test}.log`. This checkpoint includes the
compile counter that catches a compile beginning and ending between animation frames, and the
RenderChain guard that ignores compilation-contaminated budget windows. Focused red:
`/tmp/prd349-between-frame-red.log`; green: `/tmp/prd349-compile-adaptation-green.log`.
These are behavioral proofs, not a post-compilation performance claim.

The latest core tarball SHA256 is
`c0b4c8aeccdc1de4b91031437e5d3dcbe8aa19e42859237c17dfd2c5e8911fbb`, including the
between-frame compile counter and RenderChain guard. Installed in Quarry, typecheck and both
web/desktop builds exit zero. The same checked-in scenario passes 8/8 on browser and desktop:
25.3140 and 25.3694 metres respectively, six textured/normal-mapped props visited, zero
diagnostics. Browser identifies NVIDIA/Turing. Opened both start captures: real textured quarry
props and the walkable floor render on both targets. This targeted runtime checkpoint still uses
the earlier asset package, so it is not final all-package distribution proof. Logs:
`/tmp/prd349-quarry-core-count-{install,typecheck,web-build,desktop-build,browser,desktop}.log`;
captures: `quarry/artifacts/prd349-core-count-{browser,desktop}/quarry-start.png` in the sandbox.
Quarry dependency updates and both targets' start/end frames are committed and pushed as
`ThreeNativeHQ/examples` commit `831f296`; no licensed source models are included.

Wildwood's next intermediate cook gets past the 4K encoder limit but exits one on an 11×10 PNG:
`TN_ASSETS_TEXTURE_BLOCK_SIZE` (`/tmp/prd349-wildwood-encoder-cook.log`). This is an engine
default-policy defect, not permission to resize the asset or pin a game override. The scoped
repair retains automatic unaligned textures unchanged, names `block-size`, preserves explicit
codec refusals and charges the retained bytes to the uncooked budget. Both standalone and
embedded-image paths now have byte/dimension and override regression coverage. Opus reported
the intended initial red (6 failed / 60 passed), then 167 passed / 1 skipped across its scoped
checks, plus assets typecheck and Biome exit zero. The opt-in 4K case is the skip, not new 4K
evidence. The preceding full-engine checkpoint predates this repair.

The bounded diagnosis and implementation ran through installed Claude Code with medium effort.
Both JSON results record `claude-opus-5`, success and no permission denials. The implementation
used explicit file ownership; integration, distribution refresh and acceptance remain with the
main agent. One additional non-fatal cognitive-complexity warning remains in the texture pass
(17 against the configured 15); no lint suppression or limit increase was added.

Main integration review caught a missing consumer: embedded-image reasons reached the manifest
but not the printed model report. Observed red: `report.spec.ts` 1 failed / 6 passed, expected
`embedded texture prop.glb#decal: compression skipped: block-size` absent; the real-compile
report assertion also failed. Added the report's per-image lines and checked fresh/cache-hit
output. Main rerun: **67 passed / 1 skipped**, four specs, exit zero
(`/tmp/prd349-unaligned-integration-green.log`). Red logs:
`/tmp/prd349-embedded-report-{red,integration-red}.log`.

Template instructions and generated capability docs describe the automatic alignment fallback.
The previous scaffold pins fail with 53 passed / 1 hash mismatch after regeneration
(`/tmp/prd349-unaligned-generated-scaffold-red.log`); all ten pins are updated together from
that observed result, with a dated explanation. The full engine gate is rerunning after the
reporting repair; final distribution refresh remains pending.

Final-source build, typecheck, lint and budgets exit zero. The official test run reaches
**4,110 passed / 1 failed / 7 skipped**; the failure is the template guide's 100-line contract,
not runtime behavior. Folding the alignment guidance into the existing paragraph fixes it
without raising the limit: `template.spec.ts` **38 passed**. That document change moves all ten
scaffold hashes again; the observed mismatch is repinned together. The full suite is rerunning
in `/tmp/prd349-final-source-test-rerun.log`, so this checkpoint does not claim that rerun green.
The final encoder rebuild reproduces both pinned hashes
(`/tmp/prd349-final-source-encoder-rebuild.log`); its patch now avoids whitespace-only context
lines, and `git diff --check` is clean. No codec or generated binary changed in that cleanup.

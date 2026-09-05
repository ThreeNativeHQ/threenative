# PRD-349 — cook execution evidence

Execution in `.worktrees/prd-349-cook-default`, branched from
`assets/prd-349-352-execution` at `6685739e`. **PARTIAL** — in progress, no completion claim, no
PR and no archive move. iOS packaging is unrun on this host, and nothing here claims every game.

Two source points are cited throughout and must not be conflated. **Frozen source `57b76a66`**
carries the last official full-suite run and the packed tarballs every game lane below installed.
The **working tree is ahead of it**: the encoder supercompression default is restored in
uncommitted source, and separate workers hold in-flight watch and budget-review repairs. No gate
recorded against `57b76a66` covers the working tree, and nothing here is re-packed distribution
proof for it.

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
downscale, codec-policy change or new runtime dependency is introduced. That sentence also
claimed no supercompression default change; **the claim was false and is corrected below**.
The original npm encoder dependency is removed; the Apache license, MIT-derived
adapter attribution, source commit, container digest and artifact hashes ship with the package.

Observed red: `/tmp/prd349-ktx2-4k-red.log`, original encoder rejects 16,777,216 source texels.
Default-path green: `/tmp/prd349-assets-4k-green.log`, conditional real 4K test **1 passed**,
14 unrelated tests deselected; output remains **4096×4096**, **13 mip levels**, **UASTC**, KTX2
supercompression scheme **0**. The high-entropy fixture encodes in 171.344 seconds, source
57,402,213 bytes to 22,370,128 bytes. This test is explicitly executed, not inferred from its
conditional presence in the default suite. Scheme 0 and 22,370,128 bytes are what the wrapper
shipping at the time produced, not the encoder's own default; both are superseded below.

Existing-size parity: `/tmp/prd349-ktx2-1024-parity.log` compares the old and new encoders under
an explicit `needSupercompression:false` — which this entry wrongly called the caller's actual
policy, and which is not the path a cook takes. ETC1S output is byte-identical at
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

**Correction.** That sweep resolved acquisitions through the manifest, and the game fetches its
HDRI directly, so the 5,451,493-byte `kloofendal_48d_2k.hdr` is absent from the 76 rows. A
like-for-like comparison adds it, giving **304,915,228 bytes**. It is not a cook gain on either
side: source and emitted output are byte-identical, sha256
`5244534e9cf5b606f2ff513aa00ddb161b0a4826ffd88a0d3bd03ac29247d198`, 5,451,493 bytes, both statted
and hashed on disk.

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

## Encoder supercompression default — correction, 2026-09-04

The two entries above call the encoder's default scheme 0 and name `needSupercompression:false`
the caller's actual policy. **Both are wrong, and this repository's wrapper was the reason.**
`ktx2-encoder@0.6.0` sets `needSupercompression: true` in `DefaultOptions` (`dist/utils.js:7`) and
merges it as `{ ...DefaultOptions, ...options }` in `applyInputOptions`, so an omitted option means
Zstandard upstream, not none. `packages/assets/src/ktx2-encoder.ts` passed
`options.needSupercompression ?? false`, silently inverting that default for every cook, under a
comment crediting a PRD measurement of UASTC RDO — a different feature. The working-tree source
restores `?? true`: upstream's original default, lossless, with no RDO, no resizing and no codec
change. An explicit `false` still wins.

Red, with the wrapper still forcing false (`/tmp/prd349-encoder-default-red.log`):

```text
FAIL  packages/assets/__tests__/texture-pass.spec.ts > the ktx2 texture pass >
  should encode to UASTC when the source has an alpha channel
AssertionError: expected +0 to be 2 // Object.is equality
Tests  1 failed | 16 skipped (17)
```

Because encoded bytes change, `KTX2_ENCODER_VERSION` now enters the texture-pass configuration and
both model/shared-image cache keys, so earlier encodes cannot be recalled. Stale-key red
(`/tmp/prd349-encoder-cache-red.log`): `expected [ 'fd881d24b114411e', …(1) ] to not include
'fd881d24b114411e'`, 1 failed | 15 skipped. Green after both repairs: **54 passed | 1 skipped**
across three specs, 11.63 s (`/tmp/prd349-encoder-cache-green.log`). That single skip is the opt-in
4K case, run separately below — it is not new 4K evidence.

Old/new encoder parity re-run with the option **omitted**, which is the path a cook takes
(`/tmp/prd349-ktx2-omitted-default-parity.log`):

```text
{"equal":true,"name":"etc1s","newBytes":156962,"oldBytes":156962}
{"equal":true,"name":"uastc-normal","newBytes":38832,"oldBytes":38832}
```

Old and new encoders stay byte-identical on the default path, hashes included. The UASTC figure is
**not** comparable with the 1,398,560 bytes recorded earlier: that run pinned `false`, this one is
Zstandard-supercompressed, and ETC1S is unaffected by the setting either way.

The opt-in 4K case re-ran to completion under the restored default and passed
(`/tmp/prd349-4k-zstd-green.log`, **1 passed | 17 skipped**, 174.56 s): still 4096×4096, 13 mip
levels, UASTC, now supercompression scheme 2, `cliff_normal.png (uastc): 57402213 -> 21899523 bytes
(-61.8%)`. This supersedes the scheme-0 / 22,370,128-byte figure for the default path; that number
stands only for an explicit `needSupercompression:false`.

**Every byte total recorded in this file, including all three game lanes below, was produced with
the wrapper still forcing scheme 0.** None of them measures the restored default.

## Frozen-source checkpoint `57b76a66`

`pnpm test` (`bash scripts/run-test-suite.sh`) on the clean frozen tree, worktree-verified at
`57b76a66f82ee829d5e0c0c9f79fb09c0ae0fbe4` — `/tmp/prd349-frozen-test.log`:

```text
Test Files  381 passed | 2 skipped (383)
     Tests  4111 passed | 7 skipped (4118)
  Duration  84.35s
suite temporary directory count did not grow in '/tmp/threenative-suite.BypxWC': before 1, after 1
```

Inside the same run: `packages/runtime-native` 708 passed | 39 skipped over 100 files, the 29
physics-parity checks, and 16 Rust tests (14 lib + 2 parity). This supersedes the 4,092/2-failed and
4,110/1-failed runs recorded above and closes the rerun those entries left open. It does **not**
cover the working tree's encoder-default source, nor the in-flight watch and budget-review repairs.

Packed distribution the game lanes installed — `/tmp/prd349-frozen-pack.fNE24A/provenance.json`:
source commit `57b76a66`, tree `27bbdd60`, `cleanAtPack: true`, node 20.19.6, pnpm 10.25.0. sha256
prefixes (full digests in that file): core `48b6a99019ef6031`, assets `bd6c5950adac4b6e`, playtest
`c0cf06c5f1f1a4cb`, `create-threenative` `f7633f23d088f132`. This is frozen-source distribution
evidence, not final-source distribution evidence.

## Frozen-package game lanes

**threenative-hq (web).** The four checked-in browser scenarios re-ran on the frozen tarballs after
their sha256s were matched against `provenance.json`; only `package.json` and the lockfile changed,
and `threenative.config.ts` kept its authored `models: "none"` / `textures: "none"`. Parsed from
`/tmp/prd349-hq-after/web-scenarios.log`: `hq-office` 8, `hq-visitor` 4, `hq-office-animation` 9,
`hq-office-poses` 8 — **29 assertions, 0 failing, 0 diagnostics**, every scenario `pass: true`,
adapter `nvidia`/`turing` on all four, `hq-visitor` carrying its two pre-existing triviality
opt-outs. **`office-live` is unverified**: nothing listens on `127.0.0.1:7373` and the runner
printed `skipped: no live bridge on 127.0.0.1:7373, so the machine lane proves nothing`. Manifest
and receipt-owned bytes are **22,653,462 over 25 entries before and after, per-entry identical** —
the correct result for that opt-out, and the build said so:
`TN_ASSETS_COMPRESSION_SKIPPED model: 23 file(s), 22.4 MB shipped as authored`. Outputs rehashed
1:1 with no orphans; `assets.manifest.json` grew 2,213 bytes and `bake.receipt.json` 125 bytes for
the new per-entry `passes`/`extensions` fields. Evidence: `/tmp/prd349-opus-hq-frozen-proof.json`,
`/tmp/prd349-hq-after/{install,build,bridge,web-scenarios}.log` and its two manifest summaries.
Pushed as `ThreeNativeHQ/examples` `5e51bd8`. One compatibility lane on one host, not acceptance.

**Quarry source repair.** The six source GLBs were Meshopt-compressed, so the "uncooked source"
they stood for was not uncooked. `gltf-transform copy --vertex-layout separate` decoded them
losslessly: 216 checks over six files, **0 failures** — every index and attribute value equal under
`Object.is`, embedded image sha256s and byte lengths unchanged, no `EXT_meshopt_compression` in
parsed extensions or the raw JSON chunk, and the repaired files read with **no decoder registered**
where the originals throw. Sources moved 29,888,252 → 30,346,112 bytes (+457,860) at unchanged
56,124 triangles. This is a fixture repair: **the larger number is not a new baseline**, and the
growth is not a cook result. Proof: `sandbox/quarry/artifacts/prd349-meshopt-decode/proof.json`,
`/tmp/prd349-opus-quarry-source-repair.json`.

**Quarry (Android).** Rebuilt on the frozen packages over the decoded sources —
`/tmp/prd349-quarry-decoded-android-build.log`, `BUILD SUCCESSFUL`, and
`TN_ASSETS_BUDGET: uncooked 0 bytes (ceiling 64000000); total 30346112 bytes (ceiling none)`. The
APK is **140,959,998 bytes**, statted at `sandbox/quarry/dist-native/quarry.apk` rather than read
from the log. Compression is skipped by design: `this target has no WebAssembly and could not
decode it`. This replaces the earlier 29,888,252-byte figure for the same lane. **No device
executed it** — packaging only, still unverified on hardware.

## Provisional per-game byte gains

Manifest and receipt-owned bytes only. A whole-`public/` figure is never substituted for these:
threenative-hq's folder alone holds 71 unrelated historical files no cook touches. Every row was
produced on frozen `57b76a66` packages, **before** the supercompression correction, so all of them
are provisional.

| Game / target | Baseline input | Current cooked bytes | Overhead inside that total | Provisional gain |
| --- | --- | --- | --- | --- |
| Wildwood, web | 304,915,228 — 76 runtime acquisitions plus the HDR they omitted | 55,409,248 over 124 acquired outputs | 5,451,493 HDR passthrough + 584,862 Basis runtime | ≈ −81.8%, **not** the ≤45 MB target |
| Quarry, Android | 30,346,112 authored source, post-decode | 30,346,112 | none | 0% by design — no-WASM decoder exemption |
| threenative-hq, web | 22,653,462 over 25 entries | 22,653,462 over 25 entries | none | 0% by design — authored `models`/`textures` `"none"` |

Wildwood's two sides are not the same row set: 76 baseline acquisitions become 124 cooked outputs
because shared-image cooking splits embedded textures into separate files, so this is a whole
load-set ratio, not a matched per-entry diff. Excluding the HDR from both sides gives
299,463,735 → 49,957,755, ≈ −83.3%. Neither pairing is acceptance: the cook is the intermediate one
in `/tmp/prd349-wildwood-57-byte-proof.json`, whose own status field reads
`intermediate; encoder default regression, not final acceptance`.

## Post-review integration checks

The restored encoder and unnamed/duplicate-image budget repair pass the complete assets suite:
**300 passed / 2 skipped**, 29 files passed / 1 skipped, exit zero
(`/tmp/prd349-postreview-assets.log`). The separate opt-in 4K execution above closes that skip
for this checkpoint. Workspace build, typecheck and lint exit zero
(`/tmp/prd349-postreview-{build,typecheck,lint}.log`). These are working-tree checks, not a new
frozen distribution. The first missing-shared-image watcher fix was rejected for leaving
publication ownership and aggregate-budget gaps. The replacement uses one canonical
`compileAssets` call per burst, deleting the scratch publisher and manifest merger. Final
watcher regression results: **5 failed / 3 passed** on the old code, then **8 passed** with
the repair (`/tmp/prd349-watch-ownership-{red,green}.log`). They cover shared files, aggregate
budget rejection, add/edit/delete ownership, preservation of unowned files, cache accounting,
and recovery after a mixed valid/invalid burst. One invalid file now fails the whole burst;
the previous manifest stays live and the pending journal cleans partial writes on recovery.

A subsequent assets-suite run exposed a separate concurrent-publication defect:
**302 passed / 1 failed / 2 skipped** (`/tmp/prd349-watch-integrated-assets.log`). Two models
sharing an image raced on the same PID-based temporary filename; one rename failed `ENOENT`
in `compile.ts`'s auxiliary-output publication. This red supersedes the earlier full-assets
green until the targeted fix and rerun complete. The deterministic regression now holds both
writers after staging and before rename: PID-only names fail with the same `ENOENT`
(`/tmp/prd349-publish-race-red.log`). Per-write UUID staging names plus `finally` cleanup fix
the collision without changing final content-addressed paths or ownership order. Focused shared
image tests **17 passed**; the complete assets suite **304 passed / 2 skipped**, exit zero
(`/tmp/prd349-publish-race-green.log`); package typecheck and formatting also pass.

Quarry's repaired-source iOS retry again reaches asset cooking and UI bundling, then exits one:
`iOS simulator packaging requires a darwin-arm64 host; received linux-x64`
(`/tmp/prd349-quarry-decoded-ios-build.log`). Android APK SHA256 before that retry:
`08917f3f72fb55bd1d14a51e521e400581e11f9bdeb63d724d84cc5d71f4ad82`.

Wildwood's intermediate `pnpm test` ran on the frozen packages. Its cold-start probe
completed five runs on NVIDIA/Turing, reporting 79.95 MB transfer each. That is **not** the
deduplicated asset-size figure above: `tools/measure-startup.mjs` keeps
`Network.setCacheDisabled: true` throughout each run, and its first resource census contains
208 requests over 171 distinct URLs, including shared-image URLs fetched two to four times.
It also includes scripts and HTTP transfer encoding. Do not present either number as the other,
or claim a network-transfer reduction without a matching baseline using the same probe.
Evidence: `/tmp/prd349-wildwood-57-playtests.log` and the game's
`artifacts/startup/phase0-lowtier.json`. All five main gameplay scenarios pass. The overall
command exits one at the later animal check: `TN_ANIMAL_CLIPS_NEEDED_REPAIR` names all six
models; baseline/source diagnosis is pending, not waived. Final-source replay remains required.

Opened `artifacts/look/prd349-57-revealed.png` beside `prd349-before-full.png`: the same spawn
view retains bark detail, foliage alpha edges, terrain and framing, with no apparent material
regression. The new capture waits for the game's `__TN_WORLD_REVEALED__` signal, then five
seconds, and reports NVIDIA/Turing with zero console errors
(`/tmp/prd349-wildwood-57-revealed.log`). The ordinary 15-second `look.mjs` shot instead caught
the loading curtain and is **not visual evidence**. The full-resolution baseline was a temporary
fixed-scale control; the new capture keeps the game's automatic resolution policy. Neither
this intermediate comparison nor that control is a final-source performance claim.

## Release-source gate checkpoint

After the encoder, budget, canonical-watcher and concurrent-publication repairs, the sequential
workspace `pnpm build`, `pnpm typecheck`, `pnpm lint`, and official `pnpm test` all exit zero.
Root Vitest: **381 files passed / 2 skipped; 4,121 tests passed / 7 skipped**, 80.72 seconds.
The suite's temporary-directory count remains **1 → 1**. Logs:
`/tmp/prd349-release-{build,typecheck,lint,test}.log`. Lint reports 587 non-fatal warnings;
no limit was raised. This supersedes the previous integration test failure, but final package
installation and game evidence still need the new immutable source checkpoint.

The source-level animal diagnosis found the same mirrored-animation votes before and after
cooking for all six models; the five non-PSA animated controls remain unflagged in both forms.
Thus the animal failure is stale imported source, not a cooking regression. The original pack
is absent, and conflicting local entitlement records prevent assuming a re-download is
authorized. No importer change or download was performed. An exact, runtime-equivalent
fixture repair is being evaluated separately (`/tmp/prd349-opus-animal-diagnosis.json`).

Two additional compatibility baselines fail before any upgrade: Last Harvest and Spectral Sea
both lack eight pinned historical tarballs, with no exact-hash alternatives available locally.
`pnpm install --frozen-lockfile` exits 254; build and browser gates are unreachable. Their source,
config and lockfiles remain unchanged. Logs:
`/tmp/prd349-{last-harvest,spectral-sea}-baseline-{install,gates,missing-packages,summary}.log`.
These are unavailable baselines, not green compatibility rows.

## Frozen 2114d444 distribution checkpoint — PARTIAL

Commit `2114d44488a0388d1f982b624e1f37ca5630c851`, tree
`7fec89cab9a387bd5eade1eb7ae0fe94e255fab6`, clean before and after packing. All eight staged
and copied package SHA256s independently recomputed against
`/tmp/prd349-release-pack.H1bnal/provenance.json`. Assets SHA256
`7449332067cd24c6beba56d882c62b38cd58518ab56df04fde2084ef10d3e223`; CLI
`ca9d6cae5d8ca057e5db220babd73111d161a5354df348a25161115d4d15f54e`.

Quarry install, typecheck, web/desktop builds and both checked-in scenario executions exit zero;
**8/8 assertions per target**, browser NVIDIA/Turing. Logs
`/tmp/prd349-quarry-release-{install,typecheck,web-build,desktop-build,browser,desktop}.log`.
Opened raw and new `quarry-start.png`: textures and framing remain consistent. The vivid green
rocks are present in the raw control too, not introduced by cooking.

Actual web-manifest output files: six entries, nine unique primary/shared files, **3,984,176 B**.
Basis adds **584,862 B**: **4,569,038 B** inclusive. Zero resized. Compared with the original
**29,888,252 B** source payload: **25,319,214 B saved (84.71293%)**. The decoder-free fixture
repair grew source files to 30,346,112 B; that growth is not used to inflate the baseline.
Evidence `/tmp/prd349-quarry-release-web-bytes.json` sums actual filesystem sizes.

Quarry Android build exits zero; APK **140,959,998 B**, SHA256
`08917f3f72fb55bd1d14a51e521e400581e11f9bdeb63d724d84cc5d71f4ad82`.
Android/iOS asset lanes each carry six files, **30,346,112 B**, no compression gain. iOS again
cooks and bundles, then exits one because packaging requires darwin-arm64, not this linux-x64
host. Logs `/tmp/prd349-quarry-release-{android,ios}-build.log`. No mobile device execution.

Wildwood's restored-default cook exits zero. The same 76 baseline acquisitions map to 124 unique
primary/shared outputs, **45,273,869 B**, plus **584,862 B** Basis and **5,451,493 B** HDR:
**51,310,224 B**, versus **304,915,228 B** inclusive baseline. Savings **253,605,004 B (83.1723%)**;
zero resized. This still **fails the ≤45 MB target**. Full manifest: 297,715,426 B; uncooked:
10,386 B; exclusions: two files / 720,464,828 B. `/tmp/prd349-wildwood-release-cook.log`.
These numbers precede the separate six-animal fixture repair; later replay is not yet claimed.

HQ's refreshed four non-live browser scenarios exit zero, **29/29**, diagnostics zero,
NVIDIA/Turing; unchanged **22,653,462 B**, 25 entries. Live bridge7373 remains unavailable.
`/tmp/prd349-hq-final-web-scenarios.log`. Last Harvest and Spectral Sea were upgraded only after
their historical package baselines proved unavailable: each now installs, typechecks and builds;
their existing browser scenarios pass **12/12** and **10/10** respectively on NVIDIA/Turing.
No gameplay/config changes or relaxed assertions. Logs
`/tmp/prd349-{last-harvest,spectral-sea}-release-{install,typecheck,build-web,playtest}.log`.
These rows are additional compatibility evidence, not proof covering all thirty games.

The six stale Wildwood animal GLBs now have a **loader-equivalent fixture repair**, not a
reimport. Originals are recoverable at `/tmp/prd349-animal-backup.C0eKu8`; importer45 remains.
Main independently ran the strengthened verifier on actual replacements: all six pass with
unchanged geometry, skins, node rest transforms/hierarchy, material/texture metadata and image
hashes. Clip durations/counts, track values/times and interpolation match the original runtime's
repaired result exactly; the baked first-load repair detector is false. No download or licensed
source bytes committed. `/tmp/prd349-animal-root-verified.{json,log}`; runtime replay pending.

## Post-checkpoint containment and full-suite review

A trusted custom JS pass could publish `../outside.txt` outside its declared output directory.
Independently reproduced against 2114d444 with `/tmp/prd349-auxiliary-containment.mjs`; the
filing-base implementation has the same unchecked path. Five traversal/absolute-path regressions
fail before the fix (`/tmp/prd349-containment-red.log`); a five-line validation guard rejects
them before publication. Receipt/shared-image/watcher suites **43 passed**
(`/tmp/prd349-containment-green.log`). This validates lexical paths, not a sandbox for arbitrary
trusted pass code or hostile filesystem symlinks. Encoder/cache keys are unchanged.

Build, typecheck and lint pass after that fix. The complete test command exposes **two failures /
4,124 passes / seven skips**: the watcher can read truncated manifest JSON during a deletion,
and a playtest diagnostic fixture unexpectedly returns exit2 instead of exit1. The latter passes
all five tests in isolation (`/tmp/prd349-fails-closed-isolated.log`); its full-run cause is not
established or waived. The manifest writer needs atomic publication, not a test that ignores
malformed JSON. Logs `/tmp/prd349-containment-{build,typecheck,lint,test}.log`. A later immutable
source/package checkpoint must cover these follow-up fixes; 2114 evidence is not final-HEAD proof.

## Final stabilization and owner scope decision

The owner waived iOS packaging (no iOS machine) and accepted the practical approximately51MB
Wildwood result on 2026-09-04. No RDO, downsampling or other PRD-351 quality policy was added.
A read-only lossless Zstd22 probe on the largest shared texture saved only **825 B / 0.060918%**
against its existing level6 mip payloads; decoded lengths were validated and no assets changed.
This is the best verified result at the existing quality policy, not a mathematical minimum.

After the loader-equivalent animal fixture repair, Wildwood build and its complete `pnpm test`
exit zero: audio **191 checks, none failed**, five cold starts, all five main scenarios, and
the six-animal browser check. Asset health: **163 assets, 1,019 OK / 237 warnings / zero failures**.
Logs: `/tmp/prd349-wildwood-repaired-{cook,playtests}.log`.
Actual runtime primary/shared bytes **45,297,065**, HDR **5,451,493**, Basis **584,862**:
**51,333,420 B** versus **304,915,228 B**, saving **253,581,808 B (83.1647%)**.
Zero missing paths or resized textures. Full manifest including Basis: **297,738,622 B**;
this is not the valley runtime load set. Exclusions remain **720,464,828 B**, uncooked **10,386 B**.

Main opened `wildwood/artifacts/look/prd349-repaired-revealed.png` beside the full-resolution
baseline: consistent bark, foliage alpha, terrain and framing. Capture waits for world reveal,
records **2,341 revealed trees**, NVIDIA/Turing and zero browser/network errors. Log:
`/tmp/prd349-wildwood-repaired-revealed.log`. Automatic resolution remains enabled.

The manifest race now has a deterministic partial-write red and atomic sibling-file rename green.
The deletion test waits for the complete receipt (published after cleanup), not the earlier
manifest update; `watcher.close()` does not drain an active compile. Focused suites: **44 passed**.
Two browser fixture assertions now print diagnostics on failure; expectations are unchanged.
Their isolated run passes **24/24**. The final official full suite, with CPU affinity20–23 to
bound contention and no filtered tests, passes **381 files / 4,127 tests**, seven existing skips,
188.11 seconds; temporary directory count **1 → 1**. `/tmp/prd349-wrap-test.log`.
An overlapping typecheck encountered physics declarations while the suite rebuilt distribution;
the sequential post-build rerun is recorded in the close-out below.

Cloth Catcher also installs, typechecks, builds and passes all three existing browser scenarios.
Last Harvest and Spectral Sea are procedural compatibility fixtures with zero cooked asset bytes;
no whole-bundle reduction is claimed. Exploratory upgrades for four additional games and
Cloth CatcherV2 were restored to their exact protected baselines. V2's stale gameplay assertions
were not weakened. The full thirty-game matrix and HQ's unavailable live bridge are **not green
claims**. No mobile device execution occurred. Final packaging and PR close-out follow below.

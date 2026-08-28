# Runtime & core performance — the single state record

**Policy (owner, 2026-08-27):** this file is the one performance record for the native runtime and
`packages/core`. New performance findings **update this file in place**; they do not open a new
`docs/verification/prd-*-perf-*.md` file. (The one-file-per-run rule in `docs/PRDs/AGENTS.md`
keeps applying to everything that is not a runtime/core performance record.)

The 35 superseded performance reports were deleted 2026-08-27; their full text is recoverable from
git history (`git log --diff-filter=D --name-only -- docs/verification/` names the commit, then
`git show <commit>^:docs/verification/<file>`). §8 indexes what each one concluded. A claim whose
detail is not in this file exists only in git — quote it with the commit.

---

## 1. Native Android fps — every green in this section is a **120 Hz arm**

> **Baseline decided 2026-08-28 (PRD-228): acceptance runs on a 60 Hz panel at `maxFps: 60`, and
> accepts at presented p95 ≤ 14 ms.** Every result in §1.3.3 and §1.3.4 below was measured with the
> Pixel 8's Smooth Display on and the panel at physical 120 Hz. They remain true and they remain
> useful — as **high-refresh arms**. They are no longer the acceptance, and no gate may cite them.
>
> The same day, at `resolutionScale` 0.32 on a **60 Hz** panel (Smooth Display off,
> `peak_refresh_rate 60.0`, Battery Saver *off*), SurfaceFlinger measured **49.932 fps** over 2,943
> frames — 2,255 × 16 ms + 678 × 33 ms, **zero 8 ms intervals**. Render p95 was 15.5–17.8 ms in both
> configurations: the same frame, charged 33.3 ms on a 60 Hz panel and 25 ms on a 120 Hz one.
> **Under the decided baseline Bayview does not yet pass.** `device-preflight.mjs` now reads and can
> gate on the active panel mode (`requireRefreshHz`), so no later arm can repeat this ambiguity.

### 1.0 The 120 Hz arm (previously stated as acceptance)

**Goal (owner): 60 fps+ on a physical Pixel 8; 30 fps is a milestone, never a pass.** On 2026-08-28
Bayview reached the active 60 Hz display budget on the physical Pixel 8 while keeping the UI at the
full 2400×1080 presentation size. The game-owned 3D surface renders at scale 0.36 (864×389) and is
composited behind that full-resolution UI. The earlier claim that Chrome ran the scene at 59.99 fps
remains falsified; it is unrelated to this native measurement. A supported `display.maxFps: 120`
path now selects the Pixel's physical 120 Hz mode and uses mailbox presentation. The accepted run
held **63.45–72.52 fps across 11 steady windows / 3,300 frames**, with zero hitches and thermal
status 0 before and after. SurfaceFlinger independently measured 70.358 fps over 3,634 surface
frames at physical 120 Hz, with zero dropped frames. **On the 120 Hz arm the owner's 60+ fps goal is
met; on the decided 60 Hz baseline it is not — see the note opening §1.**

| Where it stands (2026-08-28, **120 Hz arm**) | value |
| --- | ---: |
| Pixel 8, Mali-G715/Vulkan, unplugged, active 120 Hz | **63.45–72.52 fps** |
| 11 steady 300-frame windows | **3,300 frames**, zero hitches, every window above 60 fps |
| Steady frame cadence | presented p50 13.41–15.32 ms; frame p95 at most 13.22 ms |
| SurfaceFlinger cross-check | **70.358 fps**, 3,634 frames, zero dropped frames |
| Presentation contract | UI 2400×1080; 3D 864×389, scaled by the compositor |
| Settled browser render budget | 232 draws; 665,531 triangles; diagnostics empty |
| High-refresh path | `display.maxFps: 120`; physical 120 Hz; mailbox (`vsync=false`) |

### 1.1 The model that fits every measurement

```text
Bayview submits about 818 draws: about 496 in the main pass + about 322 in the shadow pass.
1080p native adds expensive fragment work: the diagnostic estimates a ~63 ms GPU frame.
Chrome draws only 864×303 but is still ~30 fps: draw/pass count is load-bearing, not just pixels.
60 fps needs CPU ≤ 16.7 ms AND GPU ≤ 16.7 ms; 100 fps needs both ≤ 10 ms.
```

Native and Chrome therefore tell the same story at different pixel costs. The full-resolution native
surface makes the fragment-heavy town materials worse, but it is not the origin of the 20–30 fps
class. Bayview is already outside budget at one tenth of the native pixel count.

### 1.2 The fork already taken: Road B — GPU work

The diagnostic post-present drain (`TN_WEBGPU_GPU_DRAIN_PROFILE=ON`, blocking
`wgpuDevicePoll`, default-OFF and never shipped) measured the 1080p GPU frame on the
physical Pixel 8: **gpuDrain ≈ 49 ms in both FIFO and mailbox; GPU-frame estimate ≈ 63–64 ms in
both**. The pre-registered fork selects **Road B: the GPU owns the full-resolution frame**. A
present-seam fix cannot recover 46+ ms. Road A (Dawn on Android / wgpu-native present patch) is
*untried on device*, not refuted — it is parked behind Road B.

The pre-registered decal experiment was run and **falsified**. Hiding all 224 decal slots while
retaining allocation and placement changed gpuDrain 50.468 → 49.867 ms, only −0.601 ms and below
the 2 ms decision threshold. Source was restored.

The pass experiments then found two material costs:

| Diagnostic arm, 1080p native | period p50 | frameReplay p50 | gpuDrain p50 | verdict |
| --- | ---: | ---: | ---: | --- |
| Normal textured town + 2048² sun shadow | 110.898 ms | 12.711 ms | 50.468 ms | control |
| Sun shadow disabled only | 86.750 ms | 6.766 ms | 46.022 ms | material, but insufficient |
| Shadow disabled + flat-material bypass | 68.201 ms | 6.405 ms | 28.314 ms | town shader costs ~17.708 ms of GPU drain at 1080p |

The flat-material arm was diagnostic only. It did not become a proposed fix, and the original
textures, materials and shadows were restored immediately after measurement.

### 1.3 Owner and implementation history

**Layer verdict: the primary 20–30 fps defect is game-owned Bayview render construction.** The
secondary viewport-density and high-refresh-selection defects are engine-owned, but neither can
turn an 818-draw Chrome frame into a 100 fps frame.

Evidence gathered from the live Chrome game:

- Core calls one world render per game frame. Three.js adds exactly one shadow render because
  Bayview enables a dynamic 2048² directional shadow. There is no duplicate engine world render.
- A settled frame reports 804–818 draws and about 1.03–1.11 million submitted triangles. Disabling
  only the sun shadow reduces this to 496 draws and about 570,000 triangles; a warmed development
  sample reached 43.19 fps, still below 60.
- The authored scene has 830 meshes; 492 are effectively visible. The `town` root alone owns 363
  visible meshes and 215 of the scene's 287 shadow casters.
- Those 363 town meshes use 50 materials but **363 distinct geometry identities**. Runtime grouping
  found 295 meshes compatible with only 16 canonical topology/material/shadow-flag groups.
- Core's projection correctly reported `notWorthwhile`: it would draw 835 of 835 candidates and
  created zero batches. Identical material is insufficient on WebGPU because `BatchedMesh` still
  issues multidraw sub-draws; safe instancing needs shared geometry identity.

**2026-08-27 next fix (now landed):** change Bayview's generated render source to reuse canonical
primitive geometries and express dimensions through mesh transforms. Start with the 201
`BoxGeometry` objects, then the 84 cylinders and 22 planes. Preserve each authored mesh, material,
surface tag, transform, raycast and physics object; do not merge away gameplay identity. Once
geometry identity is shared, the existing core projection can instance compatible `(geometry,
material, castShadow, receiveShadow, layers)` groups in its private render mirror. The measured
grouping predicts the town's 363 render candidates can fall to about 84, which should remove roughly
279 main-pass candidates and many of the same shadow-pass candidates. This is a prediction, not a
measured fps result.

### 1.3.1 Geometry identity sharing — landed 2026-08-27 (late), web red-green + first device arms

Landed in `sandbox/fps-framework` (`1be75de`): every plain box/plane/straight-cylinder solid in
`town.ts` now shares one canonical unit geometry and expresses dimensions through `mesh.scale`
(pixel-identical for axis-aligned primitives); frustum cylinders (bollards, pier posts) cache by
shape like `roundedBox` already did. Materials, transforms, surface tags, colliders, raycast and
physics identity untouched; triangles hold at ~1.03M. The projection now reports `projecting:true`,
**11 instanced batches, 227 projected objects, 619 draw candidates (was 835)**, exact lane:
`renderOrder 336` (mostly the decal pool's hidden slots), `tooFewToBatch 140` (van/boat merged
parts, misc singletons), `transparent 75`, `skinned 40` (soldiers), `instanced 12` (palms).

Red-green, same scenario (`playtests/draw-budget.playtest.json`), same session, adapter turing,
headed (the runner's private Xvfb lane still lands on SwiftShader — adapter check in
`artifacts/playtest/capture.json`; capture lane must run `--headed` on `:0` here):

| Arm | settled drawCalls (render entity, in-frame capture) | triangles | verdict |
| --- | ---: | ---: | --- |
| geometry fix stashed (red) | 780 | 1,033,449 | FAIL `lte 550` |
| shared unit geometry (green) | 492 | 1,038,265 | PASS, exit 0 |

The scenario's `render` entity now captures `renderer.info` inside the frame callback — a
between-frames read sees zeros because `renderer.info` resets at each render, which silently
produced 0/0 in the first attempt. `performance.maxDrawCalls` (max over the whole bridge series)
is **unusable as a gate for this game**: the series includes the startup authored-scene phase
(~1345 draws for ~100 frames until startup readiness settles), so its max never goes below ~1370
in any arm. The steady entity gate replaced it.

Desktop native (Xvfb, 900 frames, post-fix): **render.p50 5.37 ms** (bug-hunt record: 10.83 after
`caa78a11`, 12.35 before) — the draw collapse halves desktop render cost. frameReplay p50 1.3 ms.
Desktop fps is not a verdict (present throttles); the render.p50 is.

Device, first arms of the session — **thermally confounded later in the session (battery 29.4 →
33.6 °C, status 0 → 1, phone charging at 50 % throughout; no clean cool-device A/B yet)**:

| Arm | pre-fix | post-fix | read |
| --- | ---: | ---: | --- |
| 1080p FIFO | 20.0–20.9 (doc) | 20.71 steady, JS frame p50 24.0 | flat — GPU/period-bound (period 48.1, present 16.3) |
| 720p mailbox | 34.39 (SF 34.2, doc) | 31.4–33.0 (SF cross-check 33.644) | inside session drift; phase split: render 14.9, hostGap 9.4 (replay 5.9, present 4.8), residual 4.4 |

Phase reading of the post-fix 720p mailbox frame: render p50 14.9 ms ≈ 492 draws × ~30 µs/draw of
three.js WebGPU submission; replay ~5.9 ms also scales with draw count. Reaching 60 fps needs the
JS frame + host ≈ 16.7 ms — the draw count must fall below ~300 or per-draw cost must fall, and
the 1080p arm additionally needs the fragment cost down (2048² shadow is a GPU constant across
viewport sizes).

### 1.3.2 Draw collapse completed + the GPU attribution (2026-08-28, ~01:00–02:00)

Second and third game commits (`d9dc879` and the material commit): ten targets share unit
primitives (60 → ~7 draws); every parked pool settles after the 2 s prewarm window — breakable
shards (27), muzzle-flash cards (7), and engine tracer streaks (28, `TracerPool3D.settle` landed
in core with a unit test, tarball `…tracer-settle-c73594118297`); `game.ts` now brackets the
projection reconcile inside the frame-budget render phase (its cost used to hide in `residual`);
town materials sample triplanar top-2 dominant-axis (`triTop2` in `townMaterials.ts`) and take the
1.618× breakup crossfade on the colour map only. Web settled draws: **780 → 492 → 403 → 315**,
triangles flat ~1.037M, pixel-diff of the spawn view against the 492-draw frame: **0 of 921,600
pixels differ by more than 8** — the material change is look-neutral.

Device, 720p mailbox (`wm size 720x1600` + `present_uncapped=1`), as the phone cooled through the
session: 34.6 → 37.1 → **47.2 → 53.1 → 50.9 fps steady** (presented 18.7, frame p50 9.3, render
8.8). The earlier 34–37 readings were thermally depressed (battery 33–34 °C after back-to-back
runs; the 29–31 °C windows read 47–53). **Best measured: 53 fps; 60 not reached.** The remaining
gap is the GPU frame (~18–19 ms at 720p against a 16.7 budget; the CPU chain is done at 9.3).

GPU attribution — the drain build (`-PthreenativeGpuDrainProfile=true`), 720p, ablations via
localStorage gates the host reads from `files/mystral/storage/<cwd-stem>.json` (push with
`run-as com.threenative.bayview cp /data/local/tmp/<f> files/mystral/storage/default.json`):

| Arm | gpuDrain p50 ms |
| --- | ---: |
| full scene, full materials, shadow on | 27.57 |
| shadow OFF | 27.89 (≈0 — the shadow is not a GPU cost) |
| shadow off + flat town materials | 24.22 (materials ≈ 3.3) |
| + town hidden | 13.55 (flat town pass ≈ 11.5) |
| + sky and soldiers hidden | 6.66 (soldiers + sky ≈ 6.9) |
| + `scene.environment` null | **0.35 — the IBL is ~6.3 ms on a nearly-empty scene** |
| full scene, IBL null | 22.24 (IBL ≈ 5.3 across the covered scene) |

Conclusion: the 720p GPU frame is spread per-pixel — IBL ~5–6, the flat town pass ~9–11
(geometry/dispatch/PBR core, not the texture fetches: `triTop2` cut fetches 24 → 10 and moved
gpuDrain not at all), material graphs ~2.5, soldiers/sky ~7 — over a true floor of 0.35. The
1080p arm stays GPU-bound (present 14.4 of a 49 ms period; 20.2 fps, unchanged by the CPU wins).

Falsified this session (do not re-derive): 1024² shadow map (33.0 vs 34.6 — flat at 720p
mailbox); PCFSoft/shadow cost (~0); town texture fetches as the GPU cost (top-2 flat); the
hemisphere-fill IBL replacement (−5.3 ms GPU but visibly darker in shaded faces at two tuning
attempts — `TN_NO_IBL` gate ships off by default; the A/B screenshots are
`/tmp/draw-budget-tritop.png` (IBL) vs `/tmp/draw-budget-hemisphere*.png`).

The designed path to 60 (each measured, none yet a pass): the GPU needs −2 ms of the ~18.7
presented — candidates in order: a cheap single-fetch IBL approximation (TSL `pmremTexture` at a
fixed mip via `material.envNode`, keeping the look the hemisphere cannot), the flat town pass's
9–11 ms (three's PBR core + dispatch for ~315 draws — the GPU-side twin of the closed CPU
per-draw question, **not** covered by that evidence), and CPU is already inside budget. The named
next instrument (§1.5) remains GPU timestamps to split the town pass into dispatch vs fragment.

Red-green handoff (completed by §1.3.3):

1. Add a Bayview playtest that currently fails with a steady `maxDrawCalls` threshold and still
   asserts the town triangle floor/nonblank frame.
2. Share canonical geometry in `sandbox/fps-framework/src/render/`; do not change textures or
   materials.
3. Require `TN_RENDER_PROJECTION` to report `projecting:true`, a nonzero batch count and a materially
   lower renderer draw count before measuring fps.
4. Re-run web rAF + SurfaceFlinger and native `TN_FRAME_BUDGET` + SurfaceFlinger on a cool device;
   only then choose the next lever between the 2048² game shadow and native pixel density.

### 1.3.3 Bayview reaches the native 60 Hz budget without shrinking the UI (2026-08-28)

**Layer verdict:** the fix belongs to Bayview's generated render source, not an engine package. The
resolution is a decision about how this game looks, and the project rule puts appearance decisions
in generated `src/render/` or game source. Web, desktop and non-Android paths remain at scale 1.

Two sandbox commits close the central frame-budget gap:

- `f83103f` uses a fixed roughness-0.8 PMREM IBL node, keeps dominant town/truck/awning shadows,
  removes shadows from small moving targets and effects, and holds the settled browser scene to 232
  draws and 665,531 triangles.
- `95d8729` changes only Android native's 3D resolution scale from 0.44 to 0.36. The physical
  overlay/UI surface remains 2400×1080; SurfaceFlinger reports the game surface transform at about
  2.777×, consistent with an 864×389 3D buffer scaled to the display.

Red-green on the same physical Pixel 8:

| Arm | steady result | verdict |
| --- | ---: | --- |
| scale 0.44 | 56.31–58.28 fps | red |
| scale 0.40 | 58.51–59.31 fps | insufficient |
| scale 0.36 | last four windows 59.81–59.99 fps | 60 Hz frame budget reached |

Acceptance used the intended Mali-G715 Vulkan adapter, normal real-time ticks, an unplugged device,
and the active 60 Hz display mode. Before the run the battery was 73%, device temperature 32.8 °C,
and Android thermal status 0 (`NONE`). The measured workload stayed in `playing` with five live
enemies, AI, physics, audio, HUD, PBR materials and retained dominant shadows. A controlled clone
reset the steady-state accumulator after startup and collected 2,009 frames over about 33.5 s:

| Metric | Result |
| --- | ---: |
| presented frame time | p50 16.66 ms; p95 22.87 ms; p99 32.40 ms |
| p50-derived nominal rate | 60.02 fps |
| worst / spikes | 74.72 ms / 13 frames above the spike threshold |
| largest section peaks | outside-game 73.45 ms; enemies 62.42 ms; game frame 62.80 ms |
| section p99 | outside-game 30.86 ms; enemies 3.05 ms; game frame 3.58 ms |

This proves the nominal 60 Hz budget on the current display mode; it does **not** prove throughput
above 60 fps. The remaining defect is tail smoothness: central frame pacing is at budget, while 13
of 2,009 frames spiked and the worst frame reached 74.72 ms.

The temporary reset/logger used for the exact 2,009-frame aggregate was removed before the final
APK. The clean rebuild has SHA-256
`3d072453ee23932d5153678cc0d5e7900a44c0c890d7a8cc57586635812f8b95`; a clean open reported
Mali-G715/Vulkan, `TN_RENDER_SCALE` 0.36 (**the live tree has since moved to
`renderer.android.resolutionScale: 0.32`; this figure describes the accepted build, not HEAD**),
`TN_NATIVE_SMOKE_READY:webgpu`, and
`TN_NATIVE_SMOKE_FIRST_FRAME`. The physical Android input smoke then fired the weapon: its artifact
contains the muzzle flash and the HUD changed from 30 to 29 rounds.

Verification status: sandbox typecheck and Android build pass; all 23 behavior scenarios pass; the
settled draw-budget scenario passes at 232 draws with empty diagnostics. The aggregate `pnpm test`
still exits nonzero in its final scale audit because two pre-existing content checks fail (`door`
missing and a 1.000 m muzzle-flash quad above the 0.3 m limit). This Android-only branch cannot
affect that web content audit. The sandbox has no lint script.

### 1.3.4 Supported 120 Hz + mailbox — sustained >60 acceptance green (2026-08-28)

**Layer verdict:** the missing high-refresh contract was engine-owned. A game cannot portably tell
Android which display mode to prefer, so the public config, native packagers, runtime pacing and
Android surface lifecycle now carry one value:

```ts
export default {
  display: { maxFps: 120 },
} satisfies IThreeNativeConfig;
```

`display.maxFps` defaults to 60, accepts whole numbers from 0 through 1000, and uses 0 for uncapped.
The runtime applies it before the first frame. Android packages it as `TN_MAX_FPS`, passes the same
value to the native pacing cap, calls `Surface.setFrameRate()` on API 30+, and reapplies the request
on resume and whenever Android creates or replaces the surface. Every generated template states
the conservative 60 fps default; a game opts into 120 without changing its UI or render source.
Desktop and iOS carry the same software ceiling through their packaged config.

The first mode-selection report was wrong: it read the app's 120 Hz override rather than the
physical active SurfaceFlinger mode. A valid cool run exposed Android's
`PRIORITY_LOW_POWER_MODE_RENDER_RATE max=60` vote because Battery Saver was on. The app voted 120,
but the physical display stayed at 60 Hz; SurfaceFlinger measured 58.082 fps over 6,192 frames.
After Battery Saver was disabled, SurfaceFlinger genuinely reported active mode 1 at 120 Hz.

That exposed a second engine defect. FIFO presentation quantizes an 11–12 ms frame that misses one
8.33 ms interval to the 60 Hz divisor. With the physical display at 120 Hz, Bayview's first FIFO
steady window was still only 57.8 fps. The runtime keeps FIFO **below** the full-refresh target and
uses its already-supported mailbox/immediate path at 60, above 60 and uncapped — the code is
`config.vsync = config.maxFps != 0 && config.maxFps < 60`
(`packages/runtime-native/src/platform/android_main.cpp:221`), so **`maxFps: 60` selects mailbox,
not FIFO**. An earlier revision of this paragraph said FIFO covered "1–60" and was wrong at the
boundary. The software ceiling remains active in either mode.

Red-green proof in the engine tree:

| Gate | Result |
| --- | ---: |
| config validation/default and all generated templates | **311/311 passed** |
| focused Android presentation/packaging/lifecycle tests | **26/26 passed** |
| Android/iOS/desktop packaging and runtime contracts | **577 passed, 1 unrelated preflight failure** |
| Android arm64 host + Java activity build | **passed** |
| desktop runtime and CLI compile | **passed** |
| core typecheck | **passed** |
| root typecheck | max-fps path clean; blocked by 3 pre-existing tracer-test nullability errors |

The final Bayview APK has SHA-256
`a519e4043de40c532c29e53a9d0175952959160d36dd41d1de041d669084e0c4`. Its manifest contains
`TN_MAX_FPS=120`; the approved 2400×1080 overlay HTML, JavaScript and CSS hashes match the staged UI
bundle byte for byte. On the physical Pixel 8 the host reported `maxFps=120`, `vsync=false`, mailbox
presentation and an applied `TN_DISPLAY_FRAME_RATE_REQUEST`. SurfaceFlinger independently reported
physical active mode 1 at 120 Hz and a 120 Hz vote for the Bayview surface.

The first mailbox run started unplugged over Wi-Fi ADB at 51% battery, 38.3 °C battery temperature,
37.0 °C skin and thermal status 0. After discarding startup, its first 600 steady frames measured
66.84 and 63.01 fps with zero hitches. The device then crossed to thermal status 1 (39.5 °C skin):
later windows fell to 57.84, 54.47 and 53.25 fps. SurfaceFlinger measured 56.957 fps over the whole
2,542-frame surface lifetime and recorded 224 true 8 ms present intervals, confirming that mailbox
removed the 60 Hz divisor even though the warmed run did not sustain the target.

The accepted rerun started at 60% battery, discharging over Wi-Fi ADB, with battery temperature
33.4 °C, skin 33.7 °C and thermal status 0. Battery Saver re-enabled when the charger was removed;
the run explicitly disabled it and verified `low_power=0` before a cold launch. The formal command

```sh
threenative-playtest perf --logcat 192.168.1.192:5555 \
  --require-windows 4 --min-fps 60 --text
```

exited 0 / `PASS`. After discarding window 1, all 11 steady windows passed: **63.45–72.52 fps over
3,300 frames**, zero hitches, presented p50 13.41–15.32 ms, frame p95 at most 13.22 ms and render
p95 at most 11.15 ms. The post-run device remained at thermal status 0, 34.0 °C battery temperature,
38.7 °C skin, 60% and discharging.

SurfaceFlinger independently held physical 120 Hz and measured **70.358 fps over 3,634 frames**,
with zero dropped, late-acquire or bad-desired-present frames. Its histogram recorded 1,007 8 ms
and 2,511 16 ms present intervals. This closes the owner's sustained 60+ fps goal without changing
the approved UI or the game-owned 0.36 3D scale.

The first CLI read falsely exited 1 because Android mirrors each console marker through both
`MystralStdio` and `MystralJS`: it parsed windows as `[1,1,2,2,…]` and discarded only one startup
copy. A red-green parser regression now counts byte-equivalent frame-budget payloads once while
leaving differing observations visible. Its focused suite passes 16/16, the rebuilt CLI passes
`publint`, and the same unchanged logcat source produces the exit-0 result above.

### 1.3.5 The pixel ladder — PRD-228 Phase 0's falsification gate, PASSED (2026-08-28)

**Verdict: Change A stands as a performance contract.** Five rungs, monotonic in pixel count, and
a slope an order of magnitude above the 2 ms/Mpx floor the PRD pre-registered as its falsifier.

**This is a 120 Hz arm, and it is a slope arm, not an acceptance.** It has to be. On the decided
60 Hz baseline every rung at or under 16.7 ms reads exactly 16.7 ms — SurfaceFlinger's own
`present2present` histogram for the earlier 60 Hz 0.32 arm is 16 ms and 33 ms bins with nothing
between them. A panel cannot resolve a frame cost below its own vsync period, so the PRD's
"uncapped ladder" was run at 120 Hz with `debug.threenative.present_uncapped 1` and
`display.maxFps: 240`. Acceptance still runs at 60 Hz and no gate cites this table.

Same commit, same session, same scene; one APK per rung, sha256 recorded; cold launch per method
rule 4 with `pidof` proved empty; one discarded launch per arm plus two discarded whole runs at
session start per rule 1; the first two windows of every kept run dropped; `device-preflight.mjs`
run before each arm with `requireRefreshHz: 120`, `requireDischarging: true`, thermal NONE.

| arm | scale | drawing buffer | Mpx | presented p50 | presented p95 | render p50 | our fps | SurfaceFlinger fps |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `b100` | 1.00 | 2400×1080 | 2.592 | 39.14 | 42.92 | 17.43 | 25.43 | **26.54** |
| `b072` | 0.72 | 1728×778 | 1.344 | 28.48 | 34.49 | 14.38 | 35.15 | **37.01** |
| `b055` | 0.55 | 1320×594 | 0.784 | 21.00 | 28.72 | 11.11 | 46.62 | **47.35** |
| `b044` | 0.44 | 1056×475 | 0.502 | 18.16 | 25.85 | 10.08 | 53.50 | **54.28** |
| `b032` | 0.32 | 768×346 | 0.266 | 16.73 | 24.32 | 9.28 | 57.62 | **61.84** |

```text
presented p50 = 9.94 ms/Mpx x pixels + 13.79 ms     R2 0.992, n=5, monotonic
presented p95 = 8.14 ms/Mpx x pixels + 22.32 ms     R2 0.991
render    p50 = 3.60 ms/Mpx x pixels +  8.50 ms     R2 0.970
```

SurfaceFlinger cross-check on the endpoints, game `(BLAST)` layer, `present2present`:
`b100` = 33 ms×830 + 42 ms×826 (four and five vsyncs); `b032` = 16 ms×2810 + 8 ms×443. Both agree
with our own fps to within 0.5–4.2 fps and neither shows the clamped single-bin signature.

> **WITHDRAWN 2026-08-28, same day, pending a probe: the `(scale × samples)` result below.** The
> fixed-frame-cost analysis (`docs/verification/prd-228-fixed-frame-cost-2026-08-28.md` §5) found
> that `TN_GPU_TEXTURES` is **byte-identical** between each `antialias: true` arm and its
> `antialias: false` twin — same 310 MB / 73 textures / 19 buckets at 0.32, same 318 MB / 73 at
> 0.55 — with no multisampled attachment appearing anywhere. Either the `antialias` request never
> reached a sample count on the native path, or the census cannot see the attachment. **If the
> flag was inert, "MSAA is free below 0.5 Mpx" measures nothing**, and the `+7.47 ms at 0.55` that
> looked like a cliff is better explained by the same analysis's finding of late-session drift in
> that exact arm (`c055aa` vs `b055`: +35.6 % with `frameReplay` up 4.98 → 7.38 ms, a segment MSAA
> cannot touch). The arms were built before `surface.sampleCount` shipped, so those logs cannot
> answer it. **One arm with the current core settles it**, because every window now reports the
> sample count it actually drew at. Change C's default is not decided until then.

**Two results the PRD did not predict, and they matter more than the confirmation:**

1. **The pre-registered 5.51 ms/Mpx was low by 1.8×.** It came from two cap-clipped points inside
   a 0.09 Mpx span. Over a 2.33 Mpx span the slope is **9.94 ms/Mpx**, so Change A's predicted
   saving for an untuned game is **2.256 Mpx × 9.94 = 22.4 ms/frame**, not the 12.4 ms filed.
2. **The intercept is 13.79 ms of a 16.67 ms budget.** At zero pixels this scene would still cost
   13.8 ms. Resolution scaling therefore buys Bayview about **2.9 ms of pixel budget at 60 fps and
   0.2 ms against the decided 14 ms bar** — roughly 0.02 Mpx. Bayview cannot reach the accepted
   baseline by scaling alone, whatever the scaler does, and the remaining work is in that fixed
   term rather than in the fill rate. This is a measurement, not an inference from it.

**Machine notes, so the next session does not re-derive them.** Battery Saver auto-armed at
`low_power_trigger_level 75` the moment the charger came off at 56 % and had to be pinned off; the
phone idles at 34–37 °C screen-on and never returned to the 31.5 °C the device lane usually asks
for, so arms were gated on thermal status NONE with the temperature recorded at both ends instead,
and rung order was scrambled (1.00, 0.72, 0.44, 0.32, 0.55) so thermal drift could not correlate
with pixel count. Six arms cost 8 % of battery.

**Method rule 9 is now wrong and needs replacing.** Its live-window test is `update.mean ≥ 3 ms`.
PRD-227 cut the update phase to **0.46 ms** in steady state, so that threshold rejects every live
window and accepts nothing. The classifier used here is: not one of the two windows after launch,
`substeps.mean ≥ 1`, and `update.mean > 0.05` — with the whole `update.mean` series recorded per
arm so the classification is auditable rather than asserted.

Artifacts: `<bayview>/artifacts/prd228/<arm>/` — `apk.sha256`, `config.txt`, `preflight-before.json`,
`battery-before.txt`, `battery-after.txt`, `logcat-kept.txt`, `sf-kept.txt`, and the discarded run
beside each. Harness: `tools/prd228-arm.sh`, `tools/prd228-ladder.sh`, `tools/prd228-read.mjs`.

### 1.3.6 The adaptive scaler on the device — it works, and it reaches the floor (2026-08-28)

**First device run of `resolutionScale: "auto"`.** Bayview, `display.maxFps: 60`, 60 Hz panel,
FIFO, engine core built from this tree and installed as a tarball with the installed bytes
verified (`threenative-core-0.3.0-auto-scale-3242a17bf93a.tgz`; `dist/index.js` contains
`scaleSource`). APK sha256 `b898ed4c…`. **Caveat on the record: the phone was on AC** —
`preflight-before.json` says `"charging":true,"chargingSource":"AC"` — so this is a functional
verification of the loop, **not an acceptance arm**. Thermal NONE at start, LIGHT at the end.

The scaler walked every pre-registered rung by itself, one step per window plus its cooldown:

| window | scale | drawing buffer | fps | presented p50 | presented p95 |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | 1.00 | 2400×1080 | 28.99 | 33.55 | 38.46 |
| 4 | 0.72 | 1728×778 | 35.65 | 27.00 | 35.25 |
| 8 | 0.52 | 1248×562 | 43.35 | 22.07 | 30.62 |
| 10 | 0.44 | 1056×475 | 48.95 | 19.84 | 26.27 |
| 14 | 0.32 | 768×346 | 48.59 | 19.77 | 27.36 |
| 18 | 0.23 | 552×248 | **55.37** | 17.04 | 23.40 |

SurfaceFlinger, game `(BLAST)` layer, whole run including the descent: **41.123 fps** — lower than
the last window because it averages every rung walked through, which is the point of the next
paragraph. Every window carried `surface: {resolutionScale, scaleSource:"auto", sampleCount,
drawingBufferWidth, drawingBufferHeight}`; the reporting defect that let the record say 0.36 while
the tree said 0.32 is closed end to end on a physical device.

**Two results, both actionable:**

1. **It reached the floor and did not reach 60.** Exactly what §1.3.5's 13.79 ms intercept
   predicts: 83 % of Bayview's frame does not scale with pixels, so no resolution reaches the
   target. The window now reports `atFloor` and `perf --text` prints "AT FLOOR, budget not met",
   because a window reporting 0.23 and nothing else reads as a budget met at a low resolution.
   **Bayview's remaining work is in the fixed term, not the fill rate.**
2. **The descent cost about three minutes.** Falling one rung per window plus one cooldown window,
   at 300 frames per window and ~30 fps at the top of the ladder, is ~20 s per rung and ten rungs
   from the ceiling. A game that starts at DPR-1 physical therefore spends minutes visibly at
   29 fps before settling. That is the pre-registered controller behaving exactly as specified and
   it is still a bad first impression. **Open, not fixed here:** a first-window multi-rung jump —
   the slope in §1.3.5 predicts the landing rung from one window's presented p50 in closed form —
   would reach the settling point in one step instead of ten. It is a change to PRD-228's Phase 2
   table, so it is filed rather than tuned in.

### 1.3.7 A scaffolded template holds 60 fps at full resolution, and the bug that found (2026-08-28)

**PRD-228 Phase 4's headline criterion, met once — with two caveats stated below.** A platformer
template scaffolded by `pnpm sandbox` into `sandbox/prd228-accept`: never hand-tuned,
`display.maxFps: 60`, `renderer.resolutionScale: "auto"`, and **no resolution constant anywhere in
its source** (`grep -rn resolutionScale src/` is empty). Engine installed from tarballs like a
user's machine, installed bytes verified. APK sha256 `fd71c9c0…`.

| | |
| --- | ---: |
| Settled scale | **1.00 — full 2400×1080** |
| Windows held at that scale | **59 consecutive** (7–65), ~17,700 frames, ~5 minutes |
| fps | **59.99–60.02** |
| `frame` p95 (the game's own work) | **6.51–8.70 ms** of a 16.67 ms budget |
| `presented` p95 (the panel's cadence) | 17.23–18.87 ms |
| SurfaceFlinger, game `(BLAST)` layer | **61.734 fps**, 19,372 of 19,562 frames at 16 ms, **0 dropped, 0 janky** |
| `atFloor` | false throughout |

The scaler dipped to 0.85 on the cold-start window (51.52 fps while loading), then climbed back to
1.00 at window 7 and never moved again.

**Caveats, on the record:** the phone was on **AC** — `preflight-before.json` says
`"charging":true` — and the criterion asks for three captures; this is one. Thermal was LIGHT at
the start of the long run and LIGHT at the end.

#### The defect this arm found, which is the reason it was worth running

The **first** run of this template walked to the floor. Same game, same 60 fps, and the scaler
took it from 2400×1080 to **552×248** across 20 windows and then reported `atFloor: true` —
claiming the budget was not met while it was being met at 59.99 fps.

The cause: **under FIFO the presented interval is the panel's period, not the game's cost.** The
controller's pre-registered down-trigger was `presented p95 > 14 ms`; a game locked at 60 fps on a
60 Hz panel reports presented p95 around 17.5 ms, so that condition is true forever. The template
had `frame p95` of 7.99 ms out of 16.67 at full resolution — enormous headroom — and the
controller destroyed its image quality anyway. **This affected every shipped configuration**,
since `maxFps: 60` on a 60 Hz panel is the decided baseline.

Fixed in `6898e5ee`: the trigger is **fps against the configured target**, which is correct capped
and uncapped because it comes from the mean presented interval and dropped frames pull it down on
their own. `presented p95` survives only as the up-step's tail guard, where a capped panel's own
p95 floor near 1.05× budget sits inside the 1.15× bar.

**The same error was in PRD-228's acceptance bar** — "accept at presented p95 ≤ 14 ms" is
unreachable on the panel that same decision pins. Amended there to `frame p95 ≤ 14 ms` plus fps at
target plus SurfaceFlinger confirming no dropped frames. **The general lesson, worth carrying:**
on a vsync-capped target, `presented` measures the panel and `frame` measures the game. Any bar or
trigger written against `presented` is measuring the display.

### 1.4 Secondary engine defects, after draw collapse

- **Native CSS-pixel parity:** native still exposes physical window dimensions with DPR 1
  (`runtime.cpp:2980`, `:2612`). Since PRD-228 the engine owns the cost portably —
  `renderer.resolutionScale` with an `"auto"` loop, reported in every frame-budget window — so a
  game no longer pays it by hand in generated source. The ratio itself is still a lie and the
  engine-level CSS-pixel contract is still open; it is PRD-228 Phase 1's remaining item.
- **High-refresh selection (closed):** the supported `display.maxFps` contract, Android frame-rate
  request and high-refresh mailbox policy are implemented. With Battery Saver off, the Pixel 8
  selects physical 120 Hz and Bayview sustains 63.45–72.52 fps. The evidence is in
  `docs/bugs/android-high-refresh-not-selected-2026-08-27.md`.

### 1.5 Untried, named

**Removed from this list 2026-08-28:** the panel-mode blind spot (now read and gateable by
`device-preflight.mjs`, `requireRefreshHz`); `renderer.resolutionScale` as a portable contract
(landed `696e86e3`), its `"auto"` loop and its per-window reporting (PRD-228, §1.3.5); and the
question of whether this scene is fill-bound at all, which §1.3.5 settled at 9.94 ms/Mpx.

Dawn on Android; any GPU-side timestamp timing (the drain is wall-clock algebra, not correlated
spans); matched native/Chrome logical-pixel capture after draw collapse; cross-engine QuickJS/JSC
lanes; a cheap-scene >100 presents/s ceiling arm; attribution and removal of the earlier 60 Hz
run's 13 steady-state tail spikes.

---

## 2. The ledger — do not rebuild any of this

### 2.1 The lever graveyard (measured flat or worse)

| # | Lever | Measured |
| --- | --- | --- |
| 1 | F12 batched pass op stream (−1,900 crossings/frame) | +5 % (18.61 → 19.60); per-crossing tax ~1 µs |
| 2 | F14 / PRD-224 per-class binding tables | 0.02–0.3 ms/frame; `createCommandEncoder` 30,746 → 928 ns, Chrome parity — a large per-call win is not a frame win |
| 3 | Lever A render-pass wrapper pooling | flat, removed (targeted 0.647 ms of a 22 ms frame) |
| 4 | Lever C projection/upload tuning | −0.31 ms, inside spread |
| 5 | F10 frame latency 3 (FIFO) and 1/3 (mailbox) | flat both modes |
| 6 | A1 Dawn ↔ wgpu-native backend swap (desktop) | flat (11.85 vs 11.51 ms render.p50) |
| 7 | A2 backend removed entirely (desktop) | backend presence = 1.95 ms of 11.21 (17 %) |
| 8 | 720×1600 under FIFO | flat 19.89 |
| 9 | GC / V8 heap tuning | GC is 0.2 % of wall clock; heap never configured, costs nothing steady |
| 10 | FIFO → mailbox at 1080p | flat 19.77 |
| 11 | Composited web UI off (`ui.renderer: "native"`) | flat 20.67 |
| 12 | PRD-227 P2 fixed-shape wrappers (+ borrowed values, specialized ids, bounded uploads) | **worse than baseline** (megamorphic shares 15.58/13.03/11.84 % vs 10.42 % baseline, gate 3 %) |
| 13 | Change 1 packed frame stream, alone | work −40 % (bridge 9.31 → 0.81 ms desktop), fps flat (20.39 → 20.02) |
| 14 | Swapchain `desiredMaximumFrameLatency` infrastructure | kept, never an fps lever |
| 15 | Optimising three.js renderer internals inside the host | refused on the ownership rule |
| 16 | Cutting Bayview draw counts in `packages/` | reverted; game code is experiment-only |

Also closed by evidence: the node-system megamorphic IC population is a **load-time compile
burst**, not per-frame churn (0 `Node.build()` calls/frame steady state); the `clock_gettime`
hotspot was the profiling instrument (two `steady_clock::now()` per replayed op ≈ 0.7 ms);
`FrameBudget.endFrame` allocates nothing on the heap (V8 scalar replacement, spec-pinned); the
~20 fps figure is real (SurfaceFlinger agrees within 2 %; `dumpsys gfxinfo` is a 5× flattering
WRONG meter for this app — it reads the Skia view hierarchy, not the game's SurfaceView).

**The backend question is closed by two independent routes** (A1 swap, A2 removal): no further
work on backend choice, wgpu-native upstream, or command-recording cost is justified by this
evidence. The megamorphic-IC owner is **three.js's node-material graph** (IC-log: `Node.js` /
`NodeBuilder.js` sites dominate; no native wrapper site appears) — not the bridge.

### 2.2 Landed real wins (kept; none moved device fps alone)

- **Change 1 packed stream** (PRD-227 P1): desktop `bridgeNs` 9.31 → 0.81 ms; work 23.19 → 14.32 ms.
  On device the same work left the JS meter into `frameReplay` (~8 ms).
- **Upload staging** (PRD-222): desktop +12 % write-heavy rung; device pair +21 % (18.95 vs
  15.70 fps, matched-warm — development-grade; Tier-1 rerun on a cool phone still owed).
- **Physics collision events** from Rapier's own transitions: 107.7 → 6.4 µs step at 128 bodies
  (was O(n²) pair polling); conformance row `native-physics-collision-events`.
- **Bug-hunt fixes** (2026-08-27): picking exclusion parent-walk skip (raycast A/B 12–16 → 5–9 ms
  @1,000 meshes); two dead per-frame sweeps in the projection; scan-internal classification pinned
  to `exactLaneReason`; canvas 2D dirty-tracking (upload gated on `hasDirtyPixels()`); bridge
  micro-fixes `caa78a11` (desktop render.p50 12.35 → 10.83).
- `platform::presentUncapped()` (`b3dc53d2`) — the Android present-mode channel; made two
  refutations possible.

### 2.3 What has ever moved the device number

| Change | fps |
| --- | --- |
| Upload staging ON vs OFF (matched-warm pair) | 18.95 vs 15.70 |
| **Mailbox + 720p** | **34.39 vs ~20** — zero code change |

### 2.4 Non-findings proven (do not "fix" these)

`FrameBudget.endFrame` sample object (scalar-replaced); `input.tick`, `scheduler.tick`, state
store, `Registry.sweep`, `TracerPool3D.update`, `GPUParticles3D.process`, viewport/canvas-layer,
loop `stepFrame`, physics plugin bulk writes, idle pumps, staging uploads — all measured clean.
Physics hot-path allocations (PRD-170) landed as hygiene, below instrument noise; string
contact-pair keys stay (BigInt alternative allocates more — do not re-derive). Core ordinary-frame
allocation-free contract (PRD-189) and template allocation probe (PRD-193) are standing tests,
kept green; their records were evidence, not open work.

---

## 3. Method rules — paid for in wasted sessions, binding

1. **Every A/B a same-session pair.** Discard the first TWO whole runs of a session, not just
   window 1 (run 1 measured 26.05 vs 11.4–12.0 ms after, same binary).
2. **Desktop is never an fps verdict.** Xvfb/`:0` throttles presents (present reads ~33 ms there);
   judge desktop by `render.p50` / `work = threadCpu − present`. Warmed, within-arm spread is
   0.6 ms. The device owns fps.
3. **Cross-check every fps claim** against `dumpsys SurfaceFlinger --timestats`; never `gfxinfo`.
4. **Cold launches verified:** `am force-stop` → `pidof` empty → `am start -W`. An `am start`
   race once nearly measured a stale process.
5. **Verify the binary carries the change** (`strings` the packaged `.so` for your marker) before
   trusting a number. Never trust a binary you did not watch being linked; sha256 and revision-name
   every artifact.
6. **Pre-register any lever**: `predicted ms/frame = calls/frame × (our ns/call − Chrome ns/call)`
   from `TN_BRIDGE_BY_NAME` on the actual scene; refuse anything predicting < 2 ms. This rule
   retroactively refuses half the graveyard.
7. **An ablation arm removes a complete recording path or none of it** — half-ablations return
   plausible wrong numbers instead of crashing.
8. **No cross-session absolutes.** The 22.2 ms desktop baseline does not reproduce (machine state
   ~2.3×, bundle drift). Device pixel counts vs desktop differ 2.8×; never state a desktop
   millisecond as a device one. Profiled builds inflate absolutes — use ratios.
9. **Live windows only** on device, or an end-screen idle reads as a 174 fps "win". Classify
   windows before comparing. **The old test — `update.mean ≥ 3 ms` — is dead:** PRD-227 cut the
   update phase to 0.46 ms in steady state, so it now rejects every live window (§1.3.5). Use: not
   one of the two windows after launch, `substeps.mean ≥ 1`, `update.mean > 0.05`, and record the
   `update.mean` series so the classification can be checked rather than taken on trust.
10. Red-green with named mutations; never claim a gate you did not run; paste output. Device
    preflight (thermal/battery) per `packages/runtime-native/AGENTS.md`. Commit path-limited as
    you go — another lane may hold this tree.

---

## 4. Instruments

| Meter | Where | What it gives |
| --- | --- | --- |
| `TN_FRAME_BUDGET:{json}` | JS-side (web + native), 300-frame windows | fps, presented/frame/substeps p50–p99, phases `hostGap/update/render/overlay/residual`, hitches. Emitted `packages/core/src/frame-budget.ts`; on by default (`frameBudget: false` silences the marker, not the measurement). |
| `TN_HOST_GAP:{json}` | native host loop only (`packages/runtime-native/src/runtime.cpp`) | Between-callback truth: period p50 + segments `events, io, audio, timers, microtasks, preFrame, frameDrain, frameReplay, present, gpuDrain, devicePoll, endFrameOther, handles, screenshot` (each p50/mean). `gpuDrain` is diagnostic-build-only. Σ segments ≈ hostGap must hold (±0.6 ms). |
| `TN_ANDROID_JS_NATIVE` | profiled host (`-DTN_ANDROID_JS_PROFILE=ON`) | `bridgeNs`, `bridgeOverheadNs`, `bindingNs`, `commandNs`, `bridgeCalls`, `bridgeArgs`, `threadCpuNs` per frame. |
| `TN_FRAME_HITCH` / `TN_COLD_START` / `stall_budget.h` | host | hitches; launch-phase attribution (PRD-218). |
| `gpubench.js` probe | desktop + Chrome | per-call ns: `writeBuffer` ~1.1–1.2 µs native vs 431 ns Chrome; `buffer.size` 5 ns (faster than Chrome's 21 — proves the cost is call-path-only). Versioned: `docs/verification/artifacts/prd-224-gpubench-2026-08-28.js`. |
| simpleperf + `TN_ANDROID_JS_PROFILE` | device | CPU attribution; symbolize against unstripped `libv8android.so` (embedded builtins = the unsymbolized 1.6 MB; JIT code = the `unknown` DSO). |
| SurfaceFlinger `--timestats` / `--latency` | device | independent fps + present-interval histogram on the game's `(BLAST)` layer. |
| `device-preflight.mjs` / `doctor --device` | device | thermal/battery gate (shared battery floor 50 %, hot-start 40 °C). |

**Desktop reading recipe** (render.p50, never fps):

```sh
cd <bayview>/.threenative/build
SDL_VIDEODRIVER=x11 sh <engine>/scripts/xvfb.sh \
  <engine>/packages/runtime-native/build/tn-linux/mystral run game.js --frames 900
# parse TN_FRAME_BUDGET + TN_HOST_GAP lines; window 1 discarded
```

**Device reading recipe** (fps with cross-check):

```sh
adb shell am force-stop com.threenative.bayview && adb logcat -c
adb shell am start -W -n com.threenative.bayview/com.threenative.runtime.MystralActivity
adb logcat -d | grep -o 'TN_FRAME_BUDGET.*' | tail -1
adb logcat -d | grep -o 'TN_HOST_GAP.*'  | tail -1
adb shell dumpsys SurfaceFlinger --timestats -dump   # cross-check
```

Building a device APK: `THREENATIVE_RUNTIME_SOURCE=<engine>/packages/runtime-native` +
`THREENATIVE_GRADLE_ARGS` (engine `package-android.mjs`) — see
`packages/runtime-native/AGENTS.md`. Controls: `debug.threenative.present_uncapped=1` (mailbox),
`-PthreenativeFrameLatency`, `-PthreenativeGpuDrainProfile=true` (diagnostic drain).

---

## 5. Closed questions, one line each

| Question | Verdict |
| --- | --- |
| Is the meter lying? | No — SurfaceFlinger agrees within 2 %; audited 2026-08-27. (`gfxinfo` is the wrong meter.) |
| Backend (wgpu-native vs Dawn)? | Closed — flat swap on desktop; removal = 17 % of frame. A1 on **device** is untried but parked. |
| Binding-table install tax? | Real per call, fixed for two classes, ≈0.3 ms of a frame. Phase 3 bounded before writing. |
| Wrapper shapes / megamorphic ICs? | Falsified as our defect — owner is three.js node-material graph; P2 made it worse. |
| Crossing count? | ~1 µs/crossing; F12's −1,900 bought +5 %. Per-value cost is the real seam term. |
| GC / V8 heap? | 0.2 % of wall clock steady. Not a lever. |
| Fill rate / resolution? | Material at 1080p: GPU-frame-time ≈63 ms and native draws 9.9× Chrome's landscape pixels. Not sufficient: Chrome is still ~30 fps at 864×303. |
| Present mode / swapchain depth? | Not the limiter (mailbox arm flat at 1080p; latency flat everywhere). |
| Composited web UI overlay? | Measured free twice. Not the owner. |
| Host-loop segments (events/audio/timers/microtasks/handles/screenshot)? | All < 1 ms on device steady state. Dead. |
| Is native slower than Chrome because of Android? | No matched parity claim remains. Chrome is ~30 fps at 864×303; native is ~20 fps at 2400×1080. The shared draw workload is primary and native's physical-pixel viewport compounds it. |
| Is native fast enough in principle? | Yes — fox platformer, 2026-08-11: ~106 fps median uncapped vs Godot 53.7–59.5 (unfair comparison, different games — see §6). |

---

## 6. Older results still worth quoting

- **Engine load test (PRD-117, 2026-08-15), scorer-equivalence-gated:** ThreeNative wins
  instanced rendering on web/desktop/mobile, 3.2–3.9× vs Godot 4.7.1 at scale (web 16,384 cubes:
  4.60 vs 17.95 ms p50), 4× on the knee. Loses unbatched per-object on web — that path is plain
  three.js, and a standalone plain-three page shows three's WebGPU backend already beating its own
  WebGL backend there: the cost is JS issuing thousands of draws, not a renderer defect.
- **ThreeNative vs plain three.js (SceneCollapse):** 11.6× on the 2026-08-15 workload — by
  removing draws, not by drawing faster. `defineGame` constructs collapse unconditionally.
- **Fox platformer on Pixel 8 (2026-08-11):** 60 fps sustained while played (253 windows, zero
  below 60; median 106 uncapped) after folding camera-parented HUD draws. Beats Chrome and Godot
  on *its* scene; must not be quoted as an engine comparison.
- **Launch stall (PRD-218, 2026-08-24):** the 12–14 s post-asset-load stall is first-frame
  pipeline compilation, now self-reporting via `stall_budget.h`; heat session attributed to
  sustained render + compile, with two runs thermal-confound-flagged.
- **Mobile perf probe (2026-08-24):** loading screen 15–20 s to playable on device, dominated by
  that one stall; wrong-package control incident is why every arm now verifies package id.

---

## 7. Harness status

`assert.performance` (playtest scenarios) bounds `maxFrameMsP95`, `minFps`, `maxPhaseMsP95`,
`maxDrawCalls`, `maxTriangles` from the bridge's `performanceSeries` — fail-closed on missing
samples. The `perf` subcommand of the playtest CLI (landed 2026-08-27) parses both markers from
a captured log, a spawned desktop host, or device logcat, reports p50/p95 per window and per
host-gap segment, discards window 1, and fails closed on missing evidence — the recipes in §4
remain the protocol for what it does not cover (SurfaceFlinger cross-check, device builds).

## 8. Deleted-record index (evidence lives in git history)

| Deleted record | What it carried that this file does not |
| --- | --- |
| `prd-222-2026-08-25.md` | Phase 0's Chrome 59.99 vs native 19.15 claim, now falsified by rAF + SurfaceFlinger; thermal-validity table |
| `prd-222-2026-08-26.md` | F8 crossing attribution; writeBuffer handler anatomy; paired arm logs |
| `prd-222-fix-plan.md` | The F13 lever list and the `threadCpuNs` desktop meter recipe |
| `prd-222-loop-log.md` | F1–F16 full text, iteration-cycle costs, device-arm tables, protocol traps |
| `prd-222-reassessment-2026-08-26.md` | The per-call pricing search that found the binding-table mechanism (its root-cause claim is refuted; mechanism stands) |
| `round-222-prd-222-2026-08-25.md` | Round ledger entry (round ledgers otherwise remain per-run files) |
| `perf-bug-hunt-2026-08-27.md` | Fix table with red-green commits (`17bfd794…b5021ce5`); gate-status ledger |
| `PATH-TO-60FPS-2026-08-27.md` | The 22.3 ms seam model (superseded as load-bearing; kept as the Change 1/2 rationale) |
| `HANDOVER-native-60fps-2026-08-27.md` | Rebuild commands (desktop + device), A3/A4 arm designs, open-caveat list |
| `HANDOVER-hostgap-2026-08-27.md`, `HANDOVER-60fps-road-2026-08-27.md` | The instrument tasks (both done) and the gpuDrain task 1 spec |
| `prd-224-frame-pricing-and-device-arm-2026-08-27.md` | Phase 1a same-binary A/B pricing tables; device 20.44 fps arm |
| `prd-224-binding-tables-once-per-class-2026-08-27.md`, `prd-224-phase1-pricing-2026-08-28.md` | The conversion record and its NO-MOVE frame pricing (baseline-drift forensic) |
| `prd-226-a1-backend-swap-2026-08-27.md` | A1 interleave protocol; warm-up discovery (F15) |
| `prd-226-a2-null-backend-2026-08-27.md`, `prd-226-budget-a0-a2-a5-2026-08-27.md` | A2 arm detail; A0/A2/A5 tables + validity checks + disclosure ledger |
| `prd-226-device-meter-audited-2026-08-27.md` | SurfaceFlinger `--latency` audit transcript (its 120 Hz inference is corrected in §1) |
| `prd-227-cadence-lock-2026-08-27.md` | The five-arm invariance tables; addenda refuting present cadence and overlay |
| `prd-227-hostgap-decomposition-2026-08-27.md` | TN_HOST_GAP design + cross-check tables; device arm matrix |
| `prd-227-gpu-frame-time-2026-08-27.md` | gpuDrain red-green control tables; the Road B fork arithmetic |
| `prd-227-p1-2026-08-27.md` | P1 acceptance: sha256s, eligibility windows, mutation names |
| `prd-227-p2-2026-08-27.md` | P2 falsification: symbol-share tables, IC-log site list, artifacts sha256s |
| `native-performance-benchmarks-2026-08-11.md` | The three-engine Pixel 8 afternoon table + its unfairness caveats |
| `native-gameplay-frame-rate-2026-08-11.md` | HUD-draw fold (93 → 11) closure; half-resolution probe incident |
| `native-cpu-profile-fox-scale-2026-08-11.md`, `native-cpu-webgpu-presentation-hardening-2026-08-11.md` | profile:native-cpu baseline + presentation fail-close hardening |
| `three-webgpu-per-object-cost-2026-08-15.md` (+ `.html` repro) | L1/L2/L3 rung tables behind §6 |
| `engine-load-test-summary-2026-08-15.md` | Full gate-PASS tables behind §6 (detail file `engine-load-test-2026-08-14.md` predates and remains) |
| `fps-framework-mobile-perf-2026-08-24.md` | Launch timeline tables; loading-stall discovery |
| `prd-218-launch-stall-and-heat-2026-08-24.md` | Stall-segment attribution; thermal confound ledger |
| `prd-189-core-frame-allocations-2026-08-22.md` | Negative-control table for the allocation-free contract |
| `prd-170-physics-allocations-2026-08-22.md` | Physics hygiene changes + BigInt key derivation |
| `prd-193-template-frame-allocations-2026-08-23.md` | Template probe design (`PathFollow3D` identity contract) |

# Verification — PRD-218: the launch stall, the presentation cap, and where the heat comes from

One device, one session, 2026-08-24 20:30 – 22:05 UTC+2. Everything below executed unless it is
listed under "What did not execute".

## Lane

- Device: physical Pixel 8 (`shiba`), Wi-Fi adb `192.168.1.192:5555`, Mali-G715, Dawn-on-Vulkan,
  1080×2400 @ 120 Hz. Discharging throughout (`status: 3`); Wi-Fi adb does not charge this phone.
- Game: `sandbox/fps-framework` ("bayview"), package **`com.threenative.bayview`**.
- Builds compiled from source with
  `THREENATIVE_RUNTIME_SOURCE=packages/runtime-native … threenative build --target android`.
  Every APK was verified to carry the change before it was measured — `strings` on
  `lib/arm64-v8a/libmystral-runtime.so` for native markers, and a grep of `assets/scripts/main.js`
  for JS ones. This matters: an earlier session's whole probe was invalidated by launching the
  wrong package, and a build that silently reuses a prebuilt produces the same class of confident
  nonsense.

**Thermal state is reported per run, because two runs in this session were confounded by it.**

## F1 — The stall is pipeline compilation, and now it says so

`TN_COLD_START` stamped `game_eval_begin` at 196 ms and `first_frame` at 14,711 ms, and between
them the process emitted **not one line**. `TN_FRAME_HITCH` gave the gap's width (12,295 ms), which
was the one thing never in doubt. `include/mystral/stall_budget.h` closes that hole: it accumulates
the calls the first frame serialises and reports them against the gap on the first present.

Attribution is against the **gap** — the first frame's own duration — not the whole launch. Asset
load is honest launch cost the game already reports as `TN_FPS_BOOT_MS`, and crediting it to the
named segments would let a slow asset read hide an unexplained stall.

Run at 21:23, device 35.4 °C, thermal status 0:

```
TN_STALL_SEGMENTS:{"toFirstFrameMs":14628.952,"frameBeganAtMs":2434.408,"gapMs":12194.545,
 "segments":{"pipelineCompile":{"ms":8228.089,"calls":107},
             "shaderCompile":{"ms":342.901,"calls":129},
             "textureUpload":{"ms":120.405,"calls":90},
             "bufferUpload":{"ms":194.930,"calls":8114},
             "queueSubmit":{"ms":25.592,"calls":76}},
 "attributedMs":8911.917,"residualMs":3282.628,"attributedShare":0.7308}
```

| phase | cost | calls | share of gap |
| --- | --- | --- | --- |
| pipelineCompile | 8,228 ms | 107 | 67.5 % |
| shaderCompile | 343 ms | 129 | 2.8 % |
| bufferUpload | 195 ms | 8,114 | 1.6 % |
| textureUpload | 120 ms | 90 | 1.0 % |
| queueSubmit | 26 ms | 76 | 0.2 % |
| **residual (unattributed)** | 3,283 ms | — | 26.9 % |
| **the gap** | 12,195 ms | — | 100 % |
| _(before the gap: process, bundle eval, asset load)_ | 2,434 ms | — | — |
| _(total tap-to-first-frame)_ | 14,629 ms | — | — |

Reproduced across four separate builds, all on a cool device: gap 12,195 / 12,006 / 11,728 /
11,699 ms, `pipelineCompile` 8,228 / 8,071 / 8,038 / 8,061 ms. The finding is stable.

**Acceptance criterion 1 is NOT met.** It requires ≥ 80 % attributed; this is **73.5 %**. The
3.3 s residual is JavaScript inside the first frame — three's render walk and node building — which
none of the five native segments covers. Naming it is outstanding work, and the table says
"residual" rather than absorbing it precisely so that this is visible.

### Red-green for criterion 1

The instrument's own consumer fails closed when the instrument is absent. Against the
pre-instrumentation baseline log:

```
$ node packages/runtime-native/scripts/attribute-launch-stall.mjs baseline-r1-logcat.txt
TN_STALL_ATTRIBUTION_MISSING: the log carries no TN_STALL_SEGMENTS line. The launch-stall
instrument (include/mystral/stall_budget.h) is not in this build, so the gap cannot be
attributed and this table must not be written.
exit=1
```

It also refuses to write a table that is mostly unknown (`TN_STALL_ATTRIBUTION_UNDER_MIN`), which
is why this document reports 73.5 % as a shortfall instead of presenting it as an explanation.

## F2 — `renderer.compileAsync()` does not work on the native host

This is the session's most consequential finding, and it invalidates advice the framework already
ships. `packages/core/src/renderer.ts` documents `compileAsync` as the fix for exactly this stall
("2,500 ms of a 2,882 ms Pixel 8 cold start sits between the bundle finishing and the first frame").
On native it has never worked, and nothing measured it until now.

Measured, cool device, warm-up enabled:

| granularity | result |
| --- | --- |
| one whole-scene `compileAsync(scene, camera)` | `{"compiled":0,"slices":1,"elapsedMs":15325,"abandoned":1,"timedOut":true}` |
| per-object, one representative per pipeline | `{"compiled":6,"slices":0,"elapsedMs":15004,"abandoned":484,"timedOut":true}` |

Both spent their entire budget and warmed nothing, while the first frame compiled the identical
pipelines synchronously in 8.0 s.

Three layers were found, in this order:

1. **`three`'s `yieldToMain()` fell back to a whole frame.** `src/utils.js` probes
   `self.scheduler.yield` and otherwise returns
   `new Promise(resolve => requestAnimationFrame(resolve))`. `NodeBuilder.buildAsync()` awaits it
   once per node, and the render path's deferred build queue
   (`NodeManager.getForRenderDeferred` → `_processBuildQueue`) uses the same call. This runtime
   shimmed `self` and never shimmed `scheduler`, so **every async node build cost one fully
   rendered frame**. Fixed: `scheduler.yield` is now installed by the host and recorded in
   `shim-manifest.json`.
2. **That was not the whole blocker.** With the shim confirmed present in the shipped `.so` and
   reporting no install failure, the whole-scene call still timed out:
   `{"compiled":0,"abandoned":1,"timedOut":true,"elapsedMs":15404}` on a 32.3 °C, thermal-0 device.
3. **The real blocker is ordering.** `#boot` calls `gameLoop.setHeld(true); gameLoop.start()`
   *before* the scene loads, and a held loop still calls `onRender`. So the loop's first world
   render begins in the same window the warm-up starts (`frameBeganAtMs` 2,656 ms) and takes
   11.7 s, compiling everything itself. The warm-up's timer continuations are starved by the very
   frame they exist to prevent. **Remaining work: the loop must not render the world while the
   warm-up runs.**

`warmUp` therefore ships **off by default**, with this measurement recorded on the option. Turning
on a convention that can only spend a budget waiting would be worse than not having it.

## F3 — A warm-up that held the launch open (caused and fixed in this session)

The first warm-up made things strictly worse, and the failure is worth recording because nothing
reported it. A `compileAsync` that never resolved left `#boot` awaiting forever: the loop stayed
held, the simulation never advanced, and the game sat on its loading screen. Nothing threw, nothing
tore down, and no error reached logcat. The only visible symptom was a game that rendered and did
not start — diagnosed from one number:

```
TN_FRAME_BUDGET:{"fps":20.37,"substeps":{"max":0,"mean":0,...},...}
```

`substeps mean 0` across 300 frames is a held loop. Each compile is now bounded by
`compileTimeoutMs` (2,000 ms; a real compile measured ~77 ms) and the whole warm-up by `budgetMs`
(15,000 ms), boot no longer rethrows, and `TN_WARMUP` always prints. After the fix the same run
reported `substeps mean 2.46` — the simulation running normally.

A second-order regression from the same cause reached the user: with `warmUp` enabled the
simulation stayed held for ~1 s after the first frame, so the animation mixer never advanced and an
enemy was visible in bind pose. Reported as "terrorist in a T-pose for 1–2 seconds", reproduced
against the timeline (first frame 14,355 ms, warm-up timeout 15,404 ms), fixed by shipping the
default off, and confirmed fixed by the user.

## F4 — Presentation cap: 119.8 → 60 presents/s

**Red**, the stale conformance build (`com.threenative.game`) on a static dark screen, three
textures, 39 MB — cumulative presents one second apart:

```
TN_PRESENTS_TICK:{"frames":2520,"presents":2520,...}   20:43:59.662
TN_PRESENTS_TICK:{"frames":2640,"presents":2640,...}   20:44:00.664
```

120 presents in 1.002 s = **119.8 presents/s**, indefinitely, on a frame with nothing in it.

**Green**, after the cap, every tick on the instrumented build:

```
TN_PRESENTS_TICK:{"frames":60,"presents":60,"textureMB":346,"textures":73,"bufferMB":14,"capHz":60}
```

The convention ships on at 60 Hz; `__tnPresentationCap` is the named override (0 = uncapped, and
fails closed on a rate the runtime cannot honour); and the effective cap rides along in every tick
so a probe reading 120 can tell "the game opted out" from "the cap is broken" without reading the
game's source. Criterion 3's ≤ 65 presents/s is met at the mechanism level.

**Caveat, stated rather than glossed:** the cap was verified by its reported value and by the game
running normally under it. The ≤ 65 presents/s reading on a *forced cheap frame* was not re-taken
after the cap landed, because the cheap-frame lane is the separate conformance package. That
specific re-measurement is outstanding.

## F5 — Where the heat comes from

Measured directly, same device, same session. Battery current from
`/sys/class/power_supply/battery/current_now` (µA, negative = discharge):

| state | mean draw | samples |
| --- | --- | --- |
| idle, screen on, no game | **−217 mA** | 10 |
| load + shader compile | **−478 mA** (peak −821) | 15 |
| steady gameplay | **−611 mA** (peak −1327) | 18 |

At ~3.85 V that is ~0.84 W idle against ~2.35 W in game, ~5 W at peak, in a sealed phone with no
fan. Power rails (`pixel-thermal`), gameplay vs idle:

| rail | idle | in game | |
| --- | --- | --- | --- |
| GPU `S2S_VDD_G3D` | 2.2 mW | **423.7 mW** | **190×** |
| CPU big `S2M_VDD_CPUCL2` | 23.8 mW | 304.8 mW | 13× |
| CPU little `S4M_VDD_CPUCL0` | 161.0 mW | 261.7 mW | 1.6× |
| CPU mid `S3M_VDD_CPUCL1` | 43.0 mW | 89.0 mW | 2× |
| memory bus `S1M_VDD_MIF` | 51.2 mW | 131.3 mW | 2.6× |
| display `VSYS_PWR_DISPLAY` | 110.3 mW | 116.2 mW | flat |

CPU across three clusters is 656 mW; the GPU is 424 mW. Thread and memory state during play:

```
118 %  SDLActivity (process total)      RES 1.6G
110 %  SDLThread                        (93.6–110 % sustained)
  GL mtrack 887,656 KB   EGL mtrack 132,084 KB   Graphics 1,019,740 KB   TOTAL PSS 1,647,558 KB
```

**One root cause drives both large rails**: 835 renderables are submitted as 835 individual draw
calls every frame (F6). That saturates one CPU thread and hammers the GPU with 835 state changes
against 1.0 GB of resident graphics memory, and it never idles, so the SoC never drops clocks.
Two smaller, per-launch contributors: 105–107 pipeline compiles at 8 s of one core (F1), and
presentation that ran uncapped at 119.8 FPS on empty frames (F4, fixed).

Correction to the previous session's record, which stated "the GPU is not the limiter, one CPU
thread is". That is true of *throughput* and false of *power*: the GPU rail is the single largest
increase over idle. Both statements can hold at once, and the earlier one was being used to reason
about heat, which it cannot support.

Battery temperature rose 35.4 °C → 43.2 °C over the session and thermal status went 0 → 2.

## F6 — The batching decline is correct, and names its own lever

`TN_RENDER_PROJECTION` reports, unchanged from the previous session:

```
{"projecting":false,"reasonCode":"notWorthwhile",
 "reason":"projecting would draw 835 of 835 candidates, which is not worth its own cost",
 "sourceRenderables":835,"resultDrawCandidates":835,"batches":0}
```

Read against `packages/core/src/projection-plan.ts`, this is arithmetic, not a bad threshold.
`addToBatchGroup` keys a group on **(geometry identity, material identity, batch flags)** and
`predictDraws` collapses a group to one draw only at `MIN_BATCH_MEMBERS` (4) or more. That key is
`InstancedMesh`-shaped: it requires the *same geometry* as well as the same material. Bayview's
town is 835 distinct building geometries sharing a handful of materials, so every group has exactly
one member, `predictedDraws == renderables == 835`, and the `WORTHWHILE_DRAW_RATIO` (0.75) test
declines. **Declining is the right answer for the mechanism the projection has.**

The lever is therefore not the threshold and not the device class. It is a second grouping keyed on
**material identity across differing geometries**, emitting three's `BatchedMesh` — which is
precisely the case `InstancedMesh` cannot express. Filed as input to PRD-214; see
`docs/PRDs/batch-2026-08-24-fps-framework-mobile-perf/`. Criterion 4 is satisfied by this written
measurement rather than by the heuristic accepting.

## F7 — Guard-rails

**Storage root, fixed.** Android sets neither `HOME` nor `XDG_DATA_HOME`, so the POSIX arm fell
through to `getpwuid()->pw_dir`, which on Android is the literal string `/data`:

```
[Storage] Failed to create directory "/data/.local/share/mystral/storage": Permission denied
[Mystral] localStorage initialized: /data/.local/share/mystral/storage/default.json
```

The store reported itself initialised at a path it had just failed to create, so saved settings
vanished between runs and nothing failed loudly. The resolution is now a pure function
(`LocalStorage::resolveStorageDirectory`) exercised for all four platforms from a Linux host — the
native lane needs no display, per the PRD-166 precedent. Red, by mutating the Android arm back:

```
FAIL: Android resolves under the app's own internal files directory:
      expected "/data/user/0/com.threenative.bayview/files/mystral/storage",
      got "/data/.local/share/mystral/storage"
FAIL: Android must not resolve to the system-owned /data path
FAIL: Android with no app path falls back to the working dir
FAIL: an empty app path is treated as absent, not joined
4 local-storage assertion(s) failed
```

Green: `local_storage bindings: all assertions passed` (exit 0). The old POSIX arm is retained as a
negative control, so if the fix is ever reverted the two arms agree and the test fails.

**Not done:** the 32 `THREE.Material: parameter 'map' has value of undefined` warnings during town
load are unattributed; and no `doctor`/docs note yet names `com.threenative.bayview` as
fps-framework's applicationId.

## What did not execute

- **No web-lane measurement.** The user reports web is fine; unverified here, as in the previous
  session.
- **No iOS claim.** No Apple hardware.
- **The ≤ 65 presents/s cheap-frame reading was not re-taken after the cap landed** (see F4).
- **Criterion 2 (≤ 8 s tap-to-playable, live overlay) was not attempted as a green.** The launch is
  unchanged at ~14.3 s to first frame, because F2's ordering fix is outstanding. No run in this
  session made the launch faster, and none is claimed to have.
- **Two instrumented runs are thermally confounded and are excluded from every number above.**
  They reported 44,337 ms and 43,947 ms to first frame against a 14,711 ms baseline. The cause was
  not the build: the device had climbed to 43.2 °C / thermal status 2, while the baseline ran at
  38.2 °C / status 0. They are recorded here only as the reason the lane now reports thermal state
  per run — and as a reminder that a device measurement without its temperature beside it is not a
  measurement.
- **No `simpleperf` capture.** Thread attribution is `top -H` sampling.

# PRD-222 loop log — findings and learnings

Running log for the agent looping on `docs/PRDs/PRD-222-performance-targets-per-platform.md`.
One entry per finding or lesson that cost time to learn. Newest last. Numbers without a run
reference are from the session dated 2026-08-25/26. Per-run evidence lives in its own
`prd-222-<date>.md` file; this log is the cross-session memory.

**Standing goal (owner, 2026-08-26): 60 FPS+ on Android — the maximum the platform gives.**
The PRD's Target tier already says this: bayview heavy = 58 fps target, 30 fps Floor.
Chrome does 59.99 fps on the same phone, so 60 native is physically reachable; every lever
below is a step on the vblank-cell ladder (20 → 30 → 60), never smooth.

## Findings

| # | Finding | Evidence | Disposition |
| --- | --- | --- | --- |
| F1 | A NUL byte inside `packages/core/src/projection-plan.ts` (`385fd50e`) silently truncated every desktop-native bundle at load — the host reads scripts through a C-string boundary; V8 reported an unrelated `Unexpected end of input`. Minified Android bundles rewrote the byte, masking it. | Local wgpu-native lane failed to load any bundle containing core; node parsed the same bundle fine | **Fixed** `a3865db4` + `scripts/__tests__/source-hygiene.spec.ts` scans tracked sources |
| F2 | Uniform uploads own the largest measured seam cost: 538 `queue.writeBuffer` calls/frame = 3.99 ms on-device, all uniforms, each driving wgpu-native's per-write staging map/unmap + registry + mutex work | Marker telemetry in `prd-222-2026-08-25.md`; simpleperf agrees | Upload staging built: `263981b0` |
| F3 | WebGPU forbids using a mapped buffer in submitted commands. A staging design that keeps one block permanently mapped dies in wgpu validation (`Buffer is still mapped`) on first flush | wgpu-core abort during local desktop verification of the first design | Redesign: CPU scratch arena → one async map → bulk copy → unmap → copies → submit |
| F4 | `wgpuDevicePoll(device, true, …)` inside a frame waits out the GPU's in-flight work and serializes the render thread against the GPU. On Mali this measured as a ~2× render regression (render p50 ~32 ms control → ~62 ms staged arm). Desktop NVIDIA cannot see this — coherent memory makes every map instant | Device A/B 2026-08-26, ON arm windows 2–4: 14.3–15.4 fps vs 18.9–20.1 controls | **Fixed and device-confirmed**: non-blocking spin + one blocking safety valve; v3 paired arms below |
| F4b | The first fix spun only 64×50 µs and abandoned still-pending maps whose callback writes into the frame's stack — a use-after-free that showed up as bimodal live-play fps (28 in one window, 14.5 in others) from one binary | v2 arm logs 2026-08-26 | Fixed: never abandon; escalate to exactly one blocking poll on spin exhaustion |
| F7 | The game's end screen ("RUN OVER") idles at unbounded fps with render ≈ 0 — budget windows must be classified live (`update.mean ≥ 3 ms`) before comparing, or an idle loop reads as a 174 fps "win" | v2 arm windows 5–8 vs screenshot at capture time | Protocol rule added |
| F5 | The physics SIGSEGV (`docs/bugs/physics-simulation-callback-segv-flaky-2026-08-25.md`) killed 5 of 9 launches in one session. At 75% loss per launch it is the single largest tax on every future measurement loop | Session log 2026-08-26: attempts died at 30 s, 120 s, 60 s, 45 s, 75 s | **Refuted at HEAD on the emulator lane 2026-08-27** (`docs/verification/prd-225-physics-callback-stability-2026-08-27.md`): 10/10 fresh-install cold launches of the merged-HEAD Bayview clean on `emulator-5554`/x86_64, zero tombstone-grade signatures, and the N-launch guard (`packages/runtime-native/scripts/device-physics-stability.mjs`) now exists so the question reports itself. Scope limits on the record: both original observations were physical Pixel 8 — the physical arm stays open (device offline that night), and the warm-upgrade path was not exercised |
| F6 | `writeBuffer` → `mapAsync(READ)` readback returns zeros then one-submit-stale data on the direct path (wgpu-native): mapping readiness does not imply queue drain. Three.js never reads back, so nothing caught it | `/tmp` probe against staging-OFF build, 2026-08-26 | Named defect; staging fixes the boundary by construction; direct fallback retains upstream behavior |
| F8 | The JS→C++ seam, not the GPU and not game logic, owns the frame: a fresh simpleperf capture at HEAD attributes SDLThread CPU overwhelmingly to V8 C++ API machinery under `V8Engine::nativeCallback` (bridge dispatch 37.5% incl, of which two unnamed-but-accessor-region libv8android clusters take ~20.6% + ~15.4%), with `render_pass_end` 7.94%. Only ~13 ms of the 40 ms render phase is inside measured wgpu commands; the rest is crossing dispatch and argument parsing for ~2,400–5,000 crossings/frame. Chrome pays none of this — Dawn calls are plain in-process C++ | `~/projects/threenative/scratch-perf-20260825/lat3.perf.data`, 2026-08-26, profiled latency-3 APK | **Primary diagnosis.** Next lever is fewer/cheaper crossings: command-batching seam or fast-path arg parsing |
| F9 | Bridge micro-fixes (interned property keys, pooled Persistent owners, reused arg vectors, `caa78a11`) cut desktop render p50 12.35 → 10.83 ms but moved Pixel 8 nothing (render.p50 39.9 → 39.9 ms, bindingNs 10.14 → 9.98): on-device cost lives in the per-call property/accessor machinery itself, not string/handle allocation churn. Desktop-only win is still real and kept | Paired desktop A/B + paired device arms same night, profiled builds | Kept; direction for device is crossing-count reduction, more marshalling micro-tuning |
| F10 | Swapchain depth is not the phone's serializer: `desiredMaximumFrameLatency=3` chained through `WGPUSurfaceConfigurationExtras` (`47e4cc7e`) measured flat on device (18.98 vs 18.92 fps) while collapsing desktop Xvfb frame work (frame.p50 21.0 → 13.8 ms). Knob kept as infrastructure; do not re-arm this hypothesis without new evidence | Compile-flag-verified arm `bayview-frameLatency3-profile.apk`, live windows w4+ | Rejected for device; useful on desktop lanes |
| F11 | Desktop Xvfb fps is throttled by FIFO present (~19 fps ceiling) no matter how fast frames get: judge desktop A/Bs by `phases.render.p50`/`frame.p50`, never fps | Latency-3 desktop run vs baseline, same night | Protocol rule |
| F12 | Removing ~1,900 encoder crossings per frame via batched pass recording bought only ~+5% fps on device (18.61 → 19.60 median): the per-crossing tax on Pixel 8 is ~1 µs, so crossings were ~2 ms of the 40 ms render — not the dominant owner. The unnamed libv8android clusters in F8's profile are therefore mostly **V8 executing Three.js itself** (JIT pages attribute to the invoking V8 runtime frames), plus ~4% scudo and ~2% frame-handle hash ops; V8 GC is only 0.4%. Next levers: extend the op-stream to queue/writeBuffer and canvas wrapper creation, then attack Three.js-side encode cost and allocator churn | Paired device arms `bayview-{head,batchedpass}-profile.apk` + GC/scudo symbol scan of `lat3.perf.data` | Batched pass encoding kept behind `TN_WEBGPU_BATCHED_PASS` / `-PthreenativeBatchedPass`; default OFF pending Tier-1 rerun |
| F13 | **Symbolizing the profile re-attributes the frame and retires F8 and F12.** `libv8android`'s hot addresses live in a 1.6 MB unsymbolized hole in `.text` that is V8's embedded builtins blob, and the `unknown` DSO is V8's JIT code space (executable, no mmap record, one 1.8 MB span). Self time on SDLThread = 37.2 ms CPU/frame: **V8 61.7% (22.9 ms)**, of which only 27.3% (10.1 ms) is running JavaScript; `libmystral` 21.9%, libc/scudo 11.6%, **Mali driver 6.2% (2.3 ms)**. The two hottest clusters disassemble to V8's **megamorphic stub cache** (7.3%) and a **name-dictionary lookup** (3.2%) — property-load slow paths, 3.9 ms/frame. Named V8 symbols name the rest: `LookupIterator`/`Object::Get` 4.6%, `GlobalHandles::Create`+Release 3.2%, `Isolate`/`Context` Enter+Exit 3.2%, `Value::IsExternal` 2.1%. Cause: the runtime reaches V8 through a generic `Engine` interface — wrapper objects assembled from C++ via `Reflect.set`, read back by name through `Object::Get`, one `v8::Persistent` per crossed value, and `Isolate`+`Handle`+`Context` scopes re-entered on every host call. It costs directly (API scaffolding + scudo churn) and indirectly, by giving Three.js dynamically-shaped objects that push its inline caches megamorphic. The lever is per-value/per-property cost, not crossing count — which is why F12's 1,900 fewer crossings bought only +5% | `bayview.perf.data` re-reported against unstripped `libv8android.so`, `docs/verification/prd-222-2026-08-26.md` § Correction | **Primary diagnosis, supersedes F8 and F12's attribution.** Levers ranked in the evidence file; 1–3 are mechanical and desktop-verifiable, 4 (fixed-shape wrapper objects via `ObjectTemplate` + internal fields) is the structural one |
| F14 | **The per-call binding-install tax is real, now fixed for two classes, and does not move the frame.** Paired desktop arms at HEAD (class tables ON against the one-line disable mutation, three runs each): `createCommandEncoder` 30,746 → 928 ns (~33×, **Chrome parity** at 919 ns) and `beginRenderPass`+`end` 80,977 → 8,168 ns (~9.7×), while frame work is **24.0207 ms ON against 24.0426 ms OFF — flat**. The arithmetic explains it: Bayview issues ~3 `createCommandEncoder` and ~3 `beginRenderPass` per frame, so the whole conversion is worth ≈0.3 ms of a 24 ms frame. The same arithmetic bounds the unconverted classes: `writeBuffer`, the highest-frequency crossing at ~428 calls/frame, costs 1,130 ns against Chrome's 431 ns — ≈0.3 ms of excess in total. Device at HEAD, cool physical Pixel 8, fresh install: **20.44 fps**, render.p50 33.56 ms (unpaired). | `docs/verification/prd-224-frame-pricing-and-device-arm-2026-08-27.md` | **Retires the 2026-08-26 claim that the binding tax is ~half the render excess.** The conversion is kept (correct, contract-proven, free). PRD-224 Phase 3 is bounded at ≈0.3 ms before it is written — do not spend a night on it expecting fps. The ~14 ms render excess is still unattributed; the next lever must be found, not assumed |

## Learnings

1. **Desktop-first triage catches spec violations, never platform asymmetries.** The local
   wgpu-native Linux lane (RTX/Vulkan) validated F3 within minutes and costs no phone time;
   the same lane was blind to F4 because coherent host memory hides map latency. Every
   candidate gets: local build → probe/A/B → then phone.
2. **Never trust a binary you did not watch being linked.** A failed compile leaves the stale
   binary in place, which produced one mislabeled A/B before the timeline was reconstructed.
   Copy the artifact with a name that encodes the exact source revision.
3. **Window 1 always lies** (load stall, shader compile); the marker emits under two tags
   (`MystralStdio`, `MystralJS`), so dedupe by window id when parsing.
4. **Measurement protocol hardening pays immediately**: crash-tolerant runner (pidof poll,
   relaunch on death, accept only ≥4-window survivors) turned an unusable arm into a valid one.
5. **`THREENATIVE_RUNTIME_SOURCE=<repo>/packages/runtime-native` + `THREENATIVE_GRADLE_ARGS`
   is the whole story for sandbox APK arms** — tarball installs alone have no runtime sources
   and gradle properties are unreachable without the args passthrough.
6. **`npm pack` breaks workspace packages** (`catalog:` specifiers survive into the tarball);
   `pnpm pack` rewrites them. Symptom: pnpm install fails with "catalog protocol" error.

## Iteration cycle, measured (2026-08-26)

| Step | Cost |
| --- | --- |
| C++ edit → desktop binary (incremental ninja, two backends configured) | ~40 s wgpu / ~1 min Dawn |
| Desktop probe + ladder A/B | ~2–4 min |
| APK rebuild (both ABIs, warm gradle) | ~2 min |
| Wi-Fi adb install | ~20–40 s |
| One clean 210 s device capture | 3.5 min |
| …with the SIGSEGV active | ×2–4 attempts ≈ 7–14 min |

## Next actions

1. Rerun the physics stability guard on the physical Pixel 8 when it is next online
   (`node packages/runtime-native/scripts/device-physics-stability.mjs --apk <apk> --package
   <id> --serial <serial>`): the emulator lane refuted the SIGSEGV at HEAD (10/10 clean
   fresh-install launches, 2026-08-27), but both original 5-of-9 observations were physical —
   the physical rerun is what retires F5. The warm-upgrade path also remains unexercised.
2. Tier-1 acceptance rerun of the upload-staging win on a cool, charged phone (this pair was
   matched-warm development evidence).
3. File the direct-path readback defect (F6) with its probe as evidence.
4. Android loading-gate capture on the Pixel (one pair): the loading-screen fix is
   desktop-proven at `b6d3a9bf`/`ca419748`, but its own caveat says Android wgpu-native has
   never been proven cheap. Parked here when the device stayed offline through night batch
   2026-08-26 → 27 (connection refused, twice recorded).
5. **Find the real owner of the render excess before writing another lever** — filed as
   [PRD-226](../PRDs/PRD-226-native-frame-budget-attributed-by-ablation.md), an ablation ladder with
   a self-consistency gate and a pre-registration rule that retroactively refuses Levers A and C,
   F10 and PRD-224 Phase 3. F14 measured the
   binding-install tax end to end: it is ≈0.3 ms of a 24 ms frame, not the half-of-the-excess the
   2026-08-26 root-cause section predicted. Neither crossing count (F12) nor per-call install cost
   (F14) explains the ~14 ms desktop gap against Chrome, so the next step is attribution, not
   optimisation. The F13 list below is retained as the standing hypothesis, but every item on it
   now needs its own per-frame arithmetic *before* it is built:
   **Attack the per-value seam cost (F13), not the crossing count.** In order: drop the
   per-call `Isolate`/`Context` scopes and hoist the cached `ExternalReference`; replace
   `Reflect.set` with `Object::CreateDataProperty` and name-keyed `Object::Get` with internal
   fields; stop wrapping every crossed value in a `v8::Persistent`; then give WebGPU wrappers
   fixed shapes (`ObjectTemplate` + internal fields), which is the only item that reaches the
   3.9 ms/frame of megamorphic and dictionary property lookups on the JavaScript side.
6. Do **not** re-rank `render_pass_end` as a lever: symbolized, the Mali driver is 2.3 ms of a
   53 ms frame. The earlier 7.94% was inclusive of everything wgpu defers into `end()`.

## Device result, 2026-08-26 evening — upload staging v3, paired arms

Same build lineage (HEAD core + runtime), arm64-only APKs, back-to-back launches, matched-warm
(ON 36.6 °C, OFF 38.9 °C battery — ON ran cooler, so part of OFF's deficit is thermal). Live
windows only (`update.mean ≥ 3 ms`):

| arm | live windows | fps median | render.p50 ms |
| --- | --- | ---: | ---: |
| staging ON (`bayview-staging-on-v3`) | w1–w3 | **18.95** | 27–32 |
| staging OFF (`bayview-staging-off-v3`) | w1–w3 | **15.70** | 37–43 |

Development-grade relative evidence: staging wins live play by ~+21% fps median and −12…−15 ms
of render p50, consistent in direction with the desktop A/B (+12% on the write-heavy rung).
Not Tier-1 acceptance evidence (warm arms, no charger waiver record, single pair). Desktop
probe (`writeBuffer`→`mapAsync` readback) passes on both arms' binaries; zero SIGSEGV deaths
in this pair after fresh installs.

## Device result, 2026-08-26 late — bridge fix and latency knob arms, paired profiled builds

All three arms same night, same protocol (cold launch, live windows `update.mean ≥ 3`,
profiled arm64 APKs from repo HEAD runtime source). Control = HEAD before tonight's commits.

| arm | fps median | render.p50 ms | bindingNs ms | verdict |
| --- | ---: | ---: | ---: | --- |
| control (`bayview-head-0eec59b6-profile`) | 18.92 | 39–41 | 10.14 | baseline |
| bridge fix (`bayview-bridgefix-profile`, `caa78a11`) | 18.23* | 39.5–40.5 | 9.98 | flat on device |
| frame latency 3 (`bayview-frameLatency3-profile`, `47e4cc7e`) | 18.98 | 39.2 | — | flat on device |

*fix-arm early windows ran a heavier match phase (update.mean 8–10 ms), so fps medians are
phase-confounded; matched-phase windows (update ≈ 2.8) show no render difference. Desktop
A/B for the same bridge commit: render p50 12.35 → 10.83 ms, frame p50 21.0 → 19.6 ms.

Raw captures: `~/projects/threenative/scratch-perf-20260825/prd222-{head,bridgefix,latency3}-capture.log`.

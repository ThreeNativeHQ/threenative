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
| F5 | The physics SIGSEGV (`docs/bugs/physics-simulation-callback-segv-flaky-2026-08-25.md`) killed 5 of 9 launches in one session. At 75% loss per launch it is the single largest tax on every future measurement loop | Session log 2026-08-26: attempts died at 30 s, 120 s, 60 s, 45 s, 75 s | **Next lane — fix before more measurement work** |
| F6 | `writeBuffer` → `mapAsync(READ)` readback returns zeros then one-submit-stale data on the direct path (wgpu-native): mapping readiness does not imply queue drain. Three.js never reads back, so nothing caught it | `/tmp` probe against staging-OFF build, 2026-08-26 | Named defect; staging fixes the boundary by construction; direct fallback retains upstream behavior |
| F8 | The JS→C++ seam, not the GPU and not game logic, owns the frame: a fresh simpleperf capture at HEAD attributes SDLThread CPU overwhelmingly to V8 C++ API machinery under `V8Engine::nativeCallback` (bridge dispatch 37.5% incl, of which two unnamed-but-accessor-region libv8android clusters take ~20.6% + ~15.4%), with `render_pass_end` 7.94%. Only ~13 ms of the 40 ms render phase is inside measured wgpu commands; the rest is crossing dispatch and argument parsing for ~2,400–5,000 crossings/frame. Chrome pays none of this — Dawn calls are plain in-process C++ | `~/projects/threenative/scratch-perf-20260825/lat3.perf.data`, 2026-08-26, profiled latency-3 APK | **Primary diagnosis.** Next lever is fewer/cheaper crossings: command-batching seam or fast-path arg parsing |
| F9 | Bridge micro-fixes (interned property keys, pooled Persistent owners, reused arg vectors, `caa78a11`) cut desktop render p50 12.35 → 10.83 ms but moved Pixel 8 nothing (render.p50 39.9 → 39.9 ms, bindingNs 10.14 → 9.98): on-device cost lives in the per-call property/accessor machinery itself, not string/handle allocation churn. Desktop-only win is still real and kept | Paired desktop A/B + paired device arms same night, profiled builds | Kept; direction for device is crossing-count reduction, more marshalling micro-tuning |
| F10 | Swapchain depth is not the phone's serializer: `desiredMaximumFrameLatency=3` chained through `WGPUSurfaceConfigurationExtras` (`47e4cc7e`) measured flat on device (18.98 vs 18.92 fps) while collapsing desktop Xvfb frame work (frame.p50 21.0 → 13.8 ms). Knob kept as infrastructure; do not re-arm this hypothesis without new evidence | Compile-flag-verified arm `bayview-frameLatency3-profile.apk`, live windows w4+ | Rejected for device; useful on desktop lanes |
| F11 | Desktop Xvfb fps is throttled by FIFO present (~19 fps ceiling) no matter how fast frames get: judge desktop A/Bs by `phases.render.p50`/`frame.p50`, never fps | Latency-3 desktop run vs baseline, same night | Protocol rule |

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

1. Fix the physics SIGSEGV (F5) — biggest lever on iteration speed and battery.
2. Tier-1 acceptance rerun of the upload-staging win on a cool, charged phone (this pair was
   matched-warm development evidence).
3. File the direct-path readback defect (F6) with its probe as evidence.
4. Attack the crossing tax (F8): batch WebGPU command recording so one JS→C++ crossing
   replays many ops (typed-array opcodes + cached wrapper handles), or fast-path the hot
   handlers' argument parsing (e.g. typed-array element size read directly off
   `v8::TypedArray` instead of a `BYTES_PER_ELEMENT` property Get on every `writeBuffer`).
   This is the only lever that reaches the ~27 ms of render time outside measured commands.
5. After any seam win: re-rank; `render_pass_end` (7.94% CPU, 4.35 ms/frame) is next.

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

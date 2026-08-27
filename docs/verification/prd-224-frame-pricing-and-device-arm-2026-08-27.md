# PRD-224 phases 1 and 4 — the class-table conversion priced at the frame and on the phone

**Date:** 2026-08-27 (morning), HEAD `ce6f3ee1`. Written from executables re-run the same hour,
each paste below produced by the command shown.

## Answer first

**The Android FPS defect is not solved.** Bayview measures **20.44 fps median** on the physical
Pixel 8 at HEAD, against a **30 fps floor** and a **58 fps target**.

The PRD-224 conversion **does** what it claimed per call — `createCommandEncoder` reaches Chrome
parity, a ~33× improvement — and **does not** move the frame. The desktop A/B is flat (24.02 ms ON
against 24.04 ms OFF), and the reason is arithmetic: Bayview issues these two classes about three
times each per frame, so the whole win is ~0.3 ms of a 24 ms frame. The ≥2 ms prediction recorded
on 2026-08-26 is **refuted**.

## Phase 1a — per-call pricing, same-binary A/B

Lane: `packages/runtime-native/build/tn-linux` (unprofiled), `gpubench.js` unchanged except for the
`beginRenderPass+end` row already present in the artifact. OFF arm = the same one-line mutation the
contract test uses (`if (engine != nullptr) return false;` at the top of both
`ensureCommandEncoderClassTable` and `ensureRenderPassEncoderClassTable`), rebuilt and then
reverted and rebuilt for the ON arm. Three runs each, 200,000 calls after 2,000 warm-up.

```sh
./packages/runtime-native/build/tn-linux/mystral run \
  artifacts/prd-222/frame-attribution-2026-08-26/gpubench.js --no-sdl
```

| Call | OFF — legacy per-call install (ns) | ON — class table at HEAD (ns) | Ratio | Chrome, 2026-08-26 |
| --- | --- | --- | ---: | ---: |
| `queue.writeBuffer` 16 B | 1,168 / 1,151 / 1,127 | 1,130 / 1,149 / 1,470 | flat | 431 |
| `device.createCommandEncoder()` | 29,757 / 30,746 / 34,988 | 882 / 928 / 999 | **~33×** | 919 |
| `encoder.beginRenderPass()` + `pass.end()` | 76,401 / 82,548 / 80,977 | 8,168 / 7,981 / 8,497 | **~9.7×** | not measured |
| `buffer.size` — control | 5 / 6 / 5 | 5 / 6 / 6 | flat | 21 |

`createCommandEncoder` is now **at Chrome's price on the same machine** (882–999 ns against 919 ns).
`writeBuffer` is untouched by this change, as expected — its class is one of the 37 still on the
legacy path — and it holds its value across both arms, which is what makes the two moved rows
attributable to the conversion and nothing else.

Scope note: the 64,436 ns legacy figure in the 2026-08-26 root-cause section came from a
differently-configured build. Today's OFF arm reprices the same legacy path at ~30 µs in this build
directory. The conversion's effect is the OFF→ON delta measured here, not the cross-day difference.

## Phase 1b — the frame meter, paired arms

Lane: `packages/runtime-native/build/tn-linux-wgpu` reconfigured `-DTN_ANDROID_JS_PROFILE=ON`, the
unchanged Bayview bundle at `~/…/sandbox/fps-framework/.threenative/build/game.js`, 900 frames under
the repo's own Xvfb wrapper. Meter is the recorded protocol: parse `TN_ANDROID_JS_NATIVE`, dedupe by
`(frame, bindingNs, calls, threadCpuNs)`, sum per frame, keep frames with ≥3 markers and >100
indexed draws, `work = threadCpu − present`, median of the last three quarters.

```sh
env -u WAYLAND_DISPLAY SDL_VIDEODRIVER=x11 sh <engine>/scripts/xvfb.sh \
  <engine>/packages/runtime-native/build/tn-linux-wgpu/mystral run game.js \
  --screenshot <out>.png --frames 900
```

| Arm | Run medians, ms work/frame | Median of runs |
| --- | --- | ---: |
| Class tables OFF (mutation) | 24.0426, 23.9172, 24.7012 | **24.0426** |
| Class tables ON (HEAD) | 25.7652*, 24.3505, 24.0207, 23.9185 | **24.0207** |

\* the ON arm's first run opened on a heavier gameplay phase (`update.mean` 9.8 ms against 4.3–5.6
in the others); it is kept on the record rather than dropped, and the median of the remaining three
is 24.02 either way.

**Δ = 0.02 ms/frame — flat**, far inside the ±3% run spread. Every run produced a non-blank
1280×720 screenshot and no runtime exceptions.

### Why a 33× per-call win is worth 0.02 ms

Bayview issues roughly **three `createCommandEncoder` and three `beginRenderPass` per frame**
(`TN_BRIDGE_BY_NAME`). Priced at the OFF-arm numbers, the whole conversion can save
3 × 29 µs + 3 × 70 µs ≈ **0.30 ms** of a 24 ms frame. The 2026-08-26 prediction of ≥2 ms assumed a
far higher per-frame call count for these two classes than the game actually makes.

The same arithmetic bounds Phase 3 before it is written: `writeBuffer` is the highest-frequency
crossing at ~428 calls/frame, and it costs 1,130 ns against Chrome's 431 ns — **~0.30 ms of excess
in total**. Converting the remaining 37 classes therefore cannot recover the ~14 ms desktop render
excess by this mechanism. The 2026-08-26 claim that the binding tax "accounts for roughly half" of
that excess is **not supported** by this A/B.

## Phase 4 — device arm, physical Pixel 8

Serial `37251FDJH0037Z` (shiba), reachable over USB this morning after two nights offline. Profiled
arm64-only APK built at HEAD from repo runtime source
(`THREENATIVE_RUNTIME_SOURCE`, `THREENATIVE_GRADLE_ARGS="-PthreenativeAbis=arm64-v8a
-PthreenativeJsProfile=true"`), **uninstalled first** so this is a fresh install, cold launch,
~230 s of logcat.

Device state: battery 94% → 93%, **28.9 °C → 32.7 °C**, thermal status 0 (NONE) at launch,
**USB-powered throughout** — the charger confound the protocol names is present and unwaived.

| Window | fps | frame.p50 | render.p50 | update.mean |
| ---: | ---: | ---: | ---: | ---: |
| w1 (discarded) | 20.26 | 37.79 | 31.63 | 6.42 |
| w2 | 20.51 | 39.41 | 32.94 | 6.50 |
| w3 | 20.37 | 40.92 | 34.17 | 6.11 |
| w4–w11 | 18.24–20.21 | — | 37.1–44.6 | 1.3–1.6 (idle, not comparable) |
| w12–w13 | 15.78–16.43 | — | 59.6–60.2 | 2.1–2.2 |

**Live windows (w>1, `update.mean` ≥ 3 ms): fps median 20.44, render.p50 median 33.56 ms.**

Zero SIGSEGV, zero tombstones; the one `tombstone` hit in the log is the runtime's own
crash-handler policy line. The process was alive at capture end (pid 5695).

**This is a single unpaired arm**, not a paired A/B: the 2026-08-26 control (18.92 fps,
render.p50 39–41 ms) was captured on a different night at a different temperature with a different
game build, so the 20.44 against 18.92 is **not** a claimable win for the conversion. What it does
establish, at Tier-1-adjacent quality on a cool phone, is the current number: **Bayview runs at
about 20 fps on the Pixel 8 at HEAD.**

## Standing

| PRD-224 phase | Before today | Now |
| --- | --- | --- |
| Phase 1 — frame pricing | not started | **done, and it refutes the ≥2 ms prediction** |
| Phase 2 — `GPURenderPassEncoder` conversion | contract-proven, unpriced | **priced: ~9.7× per call, 0 ms at the frame** |
| Phase 3 — widen to the remaining 37 classes | not started | **not started, and now bounded at ≈0.3 ms by the writeBuffer arithmetic above** |
| Phase 4 — device arm | blocked, phone offline | **run: 20.44 fps, unpaired** |

PRD-224 stays live. What is closed is its *measurement* question; what is open is whether Phase 3 is
worth writing at all, which is a decision the numbers above now inform rather than a task the PRD
should simply carry forward.

## Disclosure ledger

- **A sibling lane was pricing the same thing at the same hour.** `docs/verification/prd-224-phase1-pricing-2026-08-28.md`
  (lane A of night batch 2026-08-27 → 28) is a more rigorous instrument for the desktop half of
  this question: it sha256s both binaries and builds a true baseline-revision control in a detached
  worktree instead of using a source mutation. At the time this file was written that lane's
  readings were still `PENDING`. **Where the two disagree, prefer the sha256'd lane for the desktop
  per-call and frame numbers.** This file's independent contribution is the device arm, which that
  lane does not cover.
- **The desktop arms were not run on a quiet machine.** An unrelated jest storm (load ~22) ran
  2026-08-27 09:49–09:57, overlapping the ON arm's first run and all three OFF runs; ON runs 2–4
  landed after it. The contention therefore fell *harder on the OFF arm*, and the OFF arm still
  measured equal-to-faster — which is consistent with "flat" and cannot manufacture it. A quiet-window
  repeat is still the better instrument, and the sibling lane is running one.
- **The device arm ran USB-powered.** The protocol's charger waiver was not recorded. Battery held
  94% → 93% and the phone rose 28.9 → 32.7 °C across the capture, inside the cool band.
- **The device arm is unpaired.** No OFF-arm APK was built, so nothing here attributes the 20.44 fps
  to the conversion; it is the current number at HEAD, not a delta.
- Lane used the sibling lane's extended `gpubench.js` (the `beginRenderPass+end` row was added by
  that lane at 09:48); the versioned copy is `docs/verification/artifacts/prd-224-gpubench-2026-08-28.js`.

# PRD-224 phase 1 — frame-level pricing of the binding-table conversions, 2026-08-28

**Lane:** desktop host, `packages/runtime-native/build/tn-linux` (headless V8 + wgpu-native,
Vulkan on NVIDIA RTX 2080). Written by lane A of night batch 2026-08-27 → 28. Phase 2's
measurement checkboxes are priced here too (the conversion itself landed at `47d1adb3`; this
lane prices it, it does not convert anything).

**Verdict: NO-MOVE.** The frame does not move materially below its baseline as a result of
the binding-table conversions. The recorded 22.2 ms baseline no longer reproduces for reasons
that predate PRD-224 (machine state ~2.3× and game-bundle drift, both measured below — the
zero-conversion control arm lands at ~11.2 ms today), and the conversion-attributable delta
across three matched interleaved pairs is **+0.25 ± ~0.5 ms** against a −0.30 ms prediction:
below the lane's noise floor. Per the PRD's stop rule, phases 3–4 widening is refused until
explained — the explanation is the priced arithmetic in the Decision section. The per-call
evidence the PRD asked for is solid and sustained: `createCommandEncoder` 29 455 → 849 ns
(same file, both hosts, ~31–41× within-cycle), `beginRenderPass+end` 77 981 → 8 036–9 141 ns
(~8.5–9.9× — the phase-2 "≥10×" bar is marginal on the same-file probe and the record says
so), `writeBuffer` unchanged at ~1.1 µs (not converted; queue class leads phase 3's order).

## Binaries measured (linked, not trusted)

| Arm | Revision | Binary sha256 (first 32) | Built |
| --- | --- | --- | --- |
| HEAD (treatment) | `ce6f3ee1` (docs-only on top of `d36a2ea0`; runtime code identical to `d36a2ea0`) | `44397cc44f98c7676b8164683a0ca35116539797d0d5a54a104fe467c4abbf30` | 2026-08-27 09:31, linked in-job: `[351/352] … Linking CXX executable mystral` |
| Baseline control | `af36d3f3` (the recorded frame-attribution session's runtime revision; parent of step 1 `c9941d0a`) | `7059530b1a80f888bc39a03e373bf0b1781b26554f9ee70b6456b71eaf8be97f` | 2026-08-27 09:35 in a detached worktree at `/home/joao/prd224-base-host` (third_party copied; `download-deps.mjs` unchanged between the revisions), linked in-job: `[396/396] … Linking CXX executable mystral` |

The control arm exists because the recorded 22.2 ms baseline predates two intervening changes
that are not PRD-224's (the PRD-223 squash `84640c6a`, gate repairs `4a24924c`) and because a
same-session control removes machine-state drift from the A/B. Both arms run the **identical
game bundle bytes** (below), so the host is the only variable inside the pair.

## Game bundle and lane identity

| Thing | Value |
| --- | --- |
| Game | `/home/joao/projects/threenative/sandbox/fps-framework` |
| Bundle run | `.threenative/build/game.js`, sha256 `c7883c688d8da329692f8635c37f9aab5d03a3b148a43bee910898ce6ba2f2cd` (mtime 2026-08-27 00:52) |
| Baseline's bundle | sha256 `12d7edb2…` (recorded in the session's `source-revision.txt`) — **no longer on disk**; the game was rebuilt at 00:52 by another lane. The likely delta is the uncommitted `src/ui/Hud.tsx` / `vite.config.ts` / `package.json` tweaks plus framework dep updates; the UI-layer feature commit (`3152feb`, Aug 24) and all gameplay commits predate the baseline build. Consequence: absolute cross-session comparisons against 22.2 ms carry game-drift risk; the same-session base-vs-HEAD pair does not. |
| Display lane | `:0` — the machine's X11 display (the recorded `x0.log` baseline ran here; Xvfb is a different meter and was NOT used for any number in this record). `SDL_VIDEODRIVER=x11` set explicitly; without it the host picks the Wayland video driver and fails with "X11 display not available". |
| Frame protocol | 900-frame screenshot mode (`--frames 900`), the baseline's own protocol. `TN_FRAME_BUDGET` windows are 300 frames (the meter's default): w1 ≈ frames 1–300 (startup — discarded, "window 1 always lies"), w2 ≈ 301–600, w3 ≈ 601–900. The loop-log's "frames 226–899" band maps onto w2+w3 at this meter's granularity; windows are reported individually, never averaged across the run, and whole-run numbers appear nowhere below. |

## gpubench — per-call prices

Probe: `artifacts/prd-222/frame-attribution-2026-08-26/gpubench.js` (extended this lane with the
`beginRenderPass+end` row; the versioned copy is
`docs/verification/artifacts/prd-224-gpubench-2026-08-28.js`, byte-identical, sha256 below).
Protocol unchanged from the PRD-222 root-cause session: 200,000 timed iterations after a
2,000-iteration warm-up, identical file in the native host and Chrome, `GPUBENCH\t<label>\t<ns>`
lines pasted raw.

**Chrome comparison numbers are the recorded ones** (919 / 431 / 21 ns — root-cause session,
same machine, 2026-08-26): they are cited, not re-run; no claim below rests on a Chrome number
that was not measured in some session on this machine.

### Runs — labelled with the machine state each ran under

The machine never returned to the morning's quiet state (from 09:49 on: an unrelated project's
jest/tsc storms, then a sustained user game session and dev work; the timeline is in the
disclosure ledger). Every run below carries its 1-minute load reading at launch. The red/green
claims rest on **within-cycle interleaved pairs**, whose arms share machine state; ratios —
not absolute ns — are the claim, because load inflates both arms multiplicatively.

**HEAD host, original probe, four runs, load ≤ 2 (quiet), 09:38–09:43:**

```
[log] GPUBENCH	writeBuffer-16B	1120
[log] GPUBENCH	createCommandEncoder	849
[log] GPUBENCH	buffer.size-getter	5
[log] GPUBENCH_DONE
```
```
[head-run2] GPUBENCH	writeBuffer-16B	1081 / createCommandEncoder	862 / buffer.size-getter	5
[head-run3] GPUBENCH	writeBuffer-16B	1079 / createCommandEncoder	867 / buffer.size-getter	5
[head-run4] GPUBENCH	writeBuffer-16B	1067 / createCommandEncoder	864 / buffer.size-getter	5
```

**Baseline control host (af36d3f3, legacy per-call install), original probe:**

```
[base-run1, load ~2-4] GPUBENCH	writeBuffer-16B	1074 / createCommandEncoder	29455 / buffer.size-getter	5
[base-run2, load ramping] GPUBENCH	writeBuffer-16B	1362 / createCommandEncoder	34557 / buffer.size-getter	5
```

**Extended probe (adds `beginRenderPass+end`), interleaved cycles — cycle 1, cycle 2:**

```
== cycle 1 ==
[head-ext, load 2.51] GPUBENCH	writeBuffer-16B	1134
[head-ext, load 2.51] GPUBENCH	createCommandEncoder	885
[head-ext, load 2.51] GPUBENCH	beginRenderPass+end	8036
[head-ext, load 2.51] GPUBENCH	buffer.size-getter	5
[base-ext, load 15.83] GPUBENCH	writeBuffer-16B	1369
[base-ext, load 15.83] GPUBENCH	createCommandEncoder	32693
[base-ext, load 15.83] GPUBENCH	beginRenderPass+end	79228
[base-ext, load 15.83] GPUBENCH	buffer.size-getter	5
== cycle 2 (matched load ~8 on both arms) ==
[base-ext, load 8.05] GPUBENCH	writeBuffer-16B	1373
[base-ext, load 8.05] GPUBENCH	createCommandEncoder	32722
[base-ext, load 8.05] GPUBENCH	beginRenderPass+end	77981
[base-ext, load 8.05] GPUBENCH	buffer.size-getter	6
[head-ext, load 8.67] GPUBENCH	writeBuffer-16B	1416
[head-ext, load 8.67] GPUBENCH	createCommandEncoder	1043
[head-ext, load 8.67] GPUBENCH	beginRenderPass+end	9141
[head-ext, load 8.67] GPUBENCH	buffer.size-getter	6
```

(A third run pair, the 09:50 head-ext pair at load 22 — writeBuffer 2 000/2 068,
`beginRenderPass+end` 14 496/14 201 — is **discarded as load-inflated**, kept here only to
show the inflation factor: ~1.6× on the pass row between load 2.5 and load 22.)

### Readings

| Call | Base host `af36d3f3` (legacy) | HEAD `ce6f3ee1` (converted) | Fall | Chrome (recorded 2026-08-26) |
| --- | ---: | ---: | ---: | ---: |
| `createCommandEncoder` | 29 455 ns (quiet) / 32 722 ns (load 8) | **849–885 ns quiet / 1 043 ns load 8** | **31–41× within-cycle** | 919 ns |
| `beginRenderPass+end` | 77 981 ns (load 8) / 79 228 ns (load 16) | **8 036 ns (load 2.5) / 9 141 ns (load 8)** | **8.5–9.9× within-cycle** | not measured on any session |
| `queue.writeBuffer` (16 B) | 1 074 ns (quiet) / 1 373 ns (load 8) | 1 067–1 134 ns (quiet) / 1 416 ns (load 8) | ~1.0× — not converted; queue class is still on the legacy path | 431 ns |
| `buffer.size` — control | 5 ns | 5 ns | — | 21 ns |

- `createCommandEncoder` at HEAD is **0.85 µs — below the recorded Chrome price (919 ns) and
  well below the ~3.8 µs the phase-1 checkbox expected** from step 1. Two named contributors:
  the PRD-223 squash `84640c6a` landed further bridge work after step 1, and today's machine
  prices every binding ~2.3× cheaper than yesterday's window (drift finding below). The
  within-cycle ratio (~31–41×) is the machine-state-independent claim.
- **`beginRenderPass+end` red→green is ~8.5–9.9× — the phase-2 checkbox's "≥10×" is NOT
  clearly met by the same-file probe, and the record says so rather than rounding.** The two
  cycles bracket it: 9.86× (cycle 1, red measured under 2× worse load than green — flatters
  the ratio) and **8.53× (cycle 2, matched load ~8 — the honest pairing)**; clean-corrected,
  ~7.8–8.5×. Two honest caveats, both stated, neither pasted as a red→green: (a) the probe's
  descriptor is minimal (one color attachment); the recorded in-game red (154 748 ns/call,
  begin-only, the game's real 15-read descriptor, yesterday's machine) against today's green
  would read ~17–19× — a different meter, a different machine state, and a begin-only row, so
  it is context, not evidence; (b) the row prices begin**+end**, so the green includes real
  end-of-pass work both hosts perform (the recorded 154 748 was begin-only). What the probe
  does establish cleanly: the per-call table-install storm is gone from the pass path
  (~78 µs → ~8–9 µs), and the converted pass path still costs ~8–9 µs/call — ~9× the
  converted `createCommandEncoder` — which is phase-3 ordering material.
- `writeBuffer` is unchanged by the conversions, as expected: no class it belongs to has been
  converted. Its ~2.5–3× residual over Chrome (at Chrome's recorded 431 ns) is phase-3
  material — the highest-frequency crossing still on the legacy path. Per-frame call count:
  the reassessment's table said 862 for yesterday's game build; the sibling record's fresh
  `TN_BRIDGE_BY_NAME` count at today's bundle is ~428 — either way the total excess is
  ~0.25–0.30 ms/frame (428 × ~0.65–0.9 µs over Chrome), which bounds phase 3.

**Machine-state drift finding.** Yesterday's session measured the *same host revision*
(`af36d3f3` lineage, pre-conversion) at `writeBuffer` 2 519 ns and the frame baseline
render.p50 22.2 ms. Today the same revision measures `writeBuffer` 1 074 ns. The recorded
22.2 ms baseline therefore does not reproduce today **even with zero conversions applied** —
the base-host control arm renders the current game bundle at render.p50 **11.12 ms** (w2,
fps 59.7 vsync-capped). Two measured contributors: (a) machine state (~2.3× on the
identical-host gpubench row — yesterday's session ran alongside heavy profiling and builds);
(b) game drift — the current bundle (rebuilt 00:52 by another lane) runs `substeps.mean` 1
(baseline-era probes: 4.3–4.6) and `update.mean` 1.5 ms (was 4.0–4.9); the baseline's exact
game bytes (`12d7edb2…`) are no longer on disk. **Consequence: phase 1's literal absolute
gate ("move materially below 22.2 ms") is not decidable cross-session any more; the decision
signal is the same-session base-vs-HEAD pair, which is why the control arm exists.**

## Desktop TN_FRAME_BUDGET pair

Same game bundle bytes on both arms (`.threenative/build/game.js`, sha `c7883c68…`), same
display lane (`:0`), 900-frame screenshot mode, gate analyzer green on every completed run
(markers, one present per frame, non-blank screenshot). The first three runs (below) were
exploratory: they established the lane's load sensitivity — ±2 ms on render.p50 for a load
swing of 2.8→13 on the *same binary* — which is the same magnitude as the predicted
conversion effect, and therefore why the decision instrument became matched-load interleaved
pairs (next section) rather than single arms.

| Run | Host | load | w2 render.p50 | w2 frame.p50 | w2 fps | w2 update.mean | w3 |
| --- | --- | ---: | ---: | ---: | ---: | ---: | --- |
| base1 | `af36d3f3` | 2.8 | **11.12** | 12.66 | 59.7 | 1.49 | not reached (SIGSEGV on attempt 1; this is attempt 2) |
| head1 | `ce6f3ee1` | ~5 | 13.64 | 15.29 | 58.75 | 1.67 | w3 not printed (run completed clean) |
| base2 | `af36d3f3` | 5→13 ramp | 12.99 | 14.58 | 58.93 | 1.68 | — |

Full w2 rows (identical binary pairs, base1 vs head1):

```
w2 fps=59.7 frames=300 hitches=0 frame.p50=12.66 render.p50=11.12 render.p95=13.93 render.mean=11.42 update.mean=1.49 hostGap.p50=4.01 substeps.mean=1
w2 fps=58.75 frames=300 hitches=0 frame.p50=15.29 render.p50=13.64 render.p95=17.05 render.mean=14.04 update.mean=1.67 hostGap.p50=0.51 substeps.mean=1.02
```

**Frame-level arithmetic at today's machine prices.** The two converted classes are worth,
per frame (3 `createCommandEncoder` + 3 `beginRenderPass` calls — the reassessment's per-frame
counts): 3 × (32 722 − 1 043) + 3 × (77 981 − 9 141) ns ≈ 95 + 207 ≈ **0.30 ms** on an
~11–13 ms render phase (~2.5%). At yesterday's machine prices the same arithmetic gives
~0.65 ms of the recorded 22.2 ms (~3%). The phase-1 prediction of a *material* frame move
always rested on the whole-bridge excess (≈6.7 ms, all ~3 200 crossings), which phases 1–2
alone do not touch — they converted 2 classes covering 6 of 3 214 calls. The stop rule
anticipates exactly this outcome; the question the pair still has to answer is whether the
~0.3 ms is visible at all (MOVE) or vanishes into the noise/measured-flat (NO-MOVE).

**PENDING: the matched-load interleaved pairs.** STATUS: blocked on a quiet machine window —
ambient load (user game session + unrelated dev work) has been continuous since 09:49; every
load dip below 3 has been shorter than one 90-second run. No verdict is claimable from the
three runs above (the 11.12 vs 13.64 gap is load-order, proven by base2).

### Matched interleaved pairs (the decision instrument)

With the machine never returning to the morning's quiet state, the pair was run as three
back-to-back (base, head) pairs whose arms share ambient conditions, alternating which arm
goes first; any pair whose arms saw a load regime change is discarded (none had to be — the
bursts stayed between pairs). Launch loads are printed per arm; all runs green on the gate
analyzer. w2 (frames ≈ 301–600) is the decisive window: it is the last full window the
900-frame protocol emits (the host exits at frame 900 before w3 closes — the recorded
baseline's `x0.log` has the same property), and it sits inside the loop-log's 226–899 band.

| Pair (order) | arm | launch load | w2 render.p50 | head − base |
| --- | --- | ---: | ---: | ---: |
| 1 (base→head) | base3 | 2.55 | 12.17 | **−0.67** |
| | head3 | 4.79 | 11.50 | |
| 2 (head→base) | head4 | 5.37 | 11.57 | **+0.40** |
| | base4 | 4.33 | 11.17 | |
| 3 (base→head) | base5 | 2.65 | 11.74 | **+1.01** |
| | head5 (attempt 2; attempt 1 failed to save its screenshot) | 2.67 | 12.75 | |

Raw w2 lines, all six runs:

```
w2 fps=59.07 frames=300 hitches=0 frame.p50=13.87 render.p50=12.17 render.p95=15.98 render.mean=12.55 update.mean=1.62 hostGap.p50=2.82 substeps.mean=1.01   (base3)
w2 fps=59.7  frames=300 hitches=0 frame.p50=13.08 render.p50=11.50 render.p95=14.04 render.mean=11.78 update.mean=1.52 hostGap.p50=3.48 substeps.mean=1.02   (head3)
w2 fps=59.7  frames=300 hitches=0 frame.p50=13.21 render.p50=11.57 render.p95=14.42 render.mean=11.87 update.mean=1.52 hostGap.p50=3.39 substeps.mean=1      (head4)
w2 fps=59.38 frames=300 hitches=0 frame.p50=12.55 render.p50=11.17 render.p95=13.76 render.mean=11.47 update.mean=1.47 hostGap.p50=4.16 substeps.mean=1.01   (base4)
w2 fps=59.74 frames=300 hitches=0 frame.p50=13.16 render.p50=11.74 render.p95=14.14 render.mean=11.97 update.mean=1.51 hostGap.p50=3.42 substeps.mean=1      (base5)
w2 fps=58.65 frames=300 hitches=0 frame.p50=14.38 render.p50=12.75 render.p95=16.59 render.mean=13.16 update.mean=1.61 hostGap.p50=2.09 substeps.mean=1.02   (head5)
```

Mean head−base across the three pairs: **+0.25 ms** (individual diffs −0.67 / +0.40 / +1.01;
per-pair noise ~±0.7 ms). The predicted effect of the conversions, from the same-session
per-call pricing, is −0.30 ms — inside that noise band, and the point estimate carries the
opposite sign. No pair, in either order, shows the converted host materially below the
legacy control.

## Decision

**NO-MOVE.**

- Against the recorded 22.2 ms baseline: today's native render.p50 (11.2–13.6 ms, both arms)
  is about half of it — but the zero-conversion control arm lands there too, so the movement
  is machine state (~2.3×, measured on the identical-host gpubench row) plus game-bundle
  drift (substeps 4–5 → 1, update ~4.5 → 1.5 ms), not PRD-224. The literal gate as written
  cannot be answered cross-session any more; answering it that way would have scored a false
  MOVE.
- Conversion-attributable movement (the question underneath): **+0.25 ± ~0.5 ms across three
  matched pairs — no material move.** Two independent instruments agree: the per-frame
  arithmetic from the same-session per-call prices (−0.30 ms predicted for the 6 converted
  calls of ~3,214 crossings) and the paired frame measurement (+0.25 ± 0.5 measured). The
  effect of converting these two classes is below this lane's noise floor.
- **Per the PRD's stop rule, widening is refused until explained — and the explanation is
  now priced on the record:** the installed per-call tax is real (31–41× on
  `createCommandEncoder`, ~8.5× on `beginRenderPass+end`, same file, same session), but the
  two converted classes cover 6 of ~3,214 crossings per frame. The frame is owned by the
  unconverted crossings — `queue.writeBuffer` alone is 862 calls/frame at a 2.5–3× residual
  over Chrome — plus render work outside the bridge. Phase 3's widening order is already
  priced by this record: the queue class leads it. Phases 3 and 4 are refused by the stop
  rule as written; this record is the explanation the rule asks for.
- Scope note: this verdict prices phases 1–2 only. It does not judge phase 3's own future
  win: the fresh `TN_BRIDGE_BY_NAME` count in `97a4c808` puts `writeBuffer` at ~428
  calls/frame, so the queue class's total excess (~0.65–0.9 µs × 428 ≈ 0.3 ms/frame) bounds
  what converting the remaining 37 classes could recover by this mechanism — the ~14 ms
  desktop render excess lives elsewhere, and `d17de550` (PRD-226) is where that attribution
  continues.

The Chrome web arm was not re-run: the decision is complete without it (the recorded
7.6–8.9 ms cell is cited as baseline context, with the same machine-state caveat as
everything else from that session), and the user's active game session shares the GPU and
display the web arm would need.

## Cross-reference: the sibling record

`docs/verification/prd-224-frame-pricing-and-device-arm-2026-08-27.md` (commit `97a4c808`)
priced the same question at the same hour with a different design — OFF arm by source
mutation (the contract test's disable lines) on the profiled `tn-linux-wgpu` build, frame
meter `TN_ANDROID_JS_NATIVE` work/frame under the repo's Xvfb wrapper, plus the device arm
this lane does not cover. Its independent contribution is Phase 4; it explicitly defers to
this lane for the desktop per-call and frame numbers. Where both lanes measured the same
thing, they agree within a few percent:

| Quantity | This lane (sha256'd control host) | `97a4c808` (mutation OFF arm) |
| --- | ---: | ---: |
| `createCommandEncoder` legacy red | 29 455–34 557 ns | 29 757–34 988 ns |
| `createCommandEncoder` converted | 849–1 043 ns | 882–999 ns |
| `beginRenderPass+end` red | 77 981–79 228 ns | 76 401–82 548 ns |
| `beginRenderPass+end` converted | 8 036–9 141 ns | 7 981–8 497 ns |
| `writeBuffer` | ~1.07–1.42 µs, flat across arms | 1,127–1,470 ns, flat across arms |
| Frame verdict | NO-MOVE (+0.25 ± ~0.5 ms, paired, `:0`, TN_FRAME_BUDGET windows) | FLAT (Δ 0.02 ms, work/frame, Xvfb, per-frame marker) |

Two meters, two OFF-arm constructions, one verdict: **the conversion is real per call and
flat per frame.**

## Disclosure ledger

- The machine was quiet only until 09:49. From then on: an unrelated project's jest/tsc
  storms (load 22+), a sibling lane's `tn-linux-wgpu/mystral` captures, and a sustained user
  game session (Wine/Proton, ~105% CPU) plus dev work. Every run above carries its launch
  load; runs taken inside a burst are either discarded (the 09:50 head-ext pair) or
  bracketed by the within-cycle interleaving. The morning's clean-window runs (load ≤ 2) and
  the load-labelled later runs agree wherever they overlap, which is what the ratio claims
  rest on.
- Launch failures across ~10 game launches: 2 flaky SIGSEGVs at audio-source startup (one on
  each host arm — host-agnostic, consistent with loop-log F5's pattern but on the desktop
  lane with today's bundle; not attributed) and 1 "Failed to save screenshot!" (head5
  attempt 1; retried clean). Every launch that reached 900 frames passed the gate analyzer.
- The Chrome web arm was skipped (reason in the Decision section); the recorded Chrome
  per-call numbers (919/431/21 ns) are cited from the 2026-08-26 session, not re-measured.
- The untracked `artifacts/` tree is gitignored, so the versioned probe copy lives in
  `docs/verification/artifacts/` (forced add, same as the prd-222-phase0 evidence files);
  the executed file and the versioned copy are byte-identical (sha256 `bb6cf43a…`).
- The control host was built in a detached worktree at `/home/joao/prd224-base-host`
  (third_party copied from the primary checkout; `download-deps.mjs` is byte-identical
  between `af36d3f3` and HEAD, and the CMakeLists delta between the revisions is
  test-target bookkeeping only — verified by diff). The worktree is left in place for the
  next lane's re-verification; it is ~2 GB and safe to delete after.
- The PRD file briefly carried a corrupted first line (`mark ---` breaking the frontmatter)
  while this lane worked — not this lane's edit; it was repaired by whoever rewrote the
  PRD's status block (`97a4c808`'s author) before this lane's checkbox marks landed.

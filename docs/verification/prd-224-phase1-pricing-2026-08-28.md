# PRD-224 phase 1 — frame-level pricing of the binding-table conversions, 2026-08-28

**Lane:** desktop host, `packages/runtime-native/build/tn-linux` (headless V8 + wgpu-native,
Vulkan on NVIDIA RTX 2080), written by lane A of night batch 2026-08-27 → 28. Phase 2's
pricing checkboxes are measured here too (the conversion itself landed at `47d1adb3`; this
lane prices it, it does not convert anything). Every number below was produced under the
repository's private-Xvfb wrapper (`sh scripts/xvfb.sh`, per-run display, `DISPLAY` exported
by the wrapper); the display lane is stated per table.

**Verdict: NO-MOVE.** The frame does not move as a result of the binding-table conversions.
The recorded 22.2 ms baseline no longer reproduces for reasons that predate PRD-224 (machine
state ~2.3× and game-bundle drift, both measured below — the zero-conversion control arm
lands at 12.3–12.5 ms render.p50 today), and the conversion-attributable delta across two
matched Xvfb pairs is **+0.50/+0.59 ms** (head marginally *slower*, spread inside pair noise)
against a −0.30 ms prediction from the same-session per-call prices. Per the PRD's stop rule,
widening is refused until explained — the explanation is the priced arithmetic in the
Decision section. The per-call evidence is solid and lane-confirmed:
`createCommandEncoder` 30 322–30 460 → 890–984 ns (**31–34×**, at Chrome parity),
`beginRenderPass+end` 71 189–73 318 → 8 231–8 948 ns (**8.2–8.7×** — the phase-2 "≥10×" bar
is marginal on the same-file probe and this record says so rather than rounding),
`writeBuffer` flat ~1.1–1.2 µs (not converted; the queue class leads phase 3's order).

## Binaries measured (linked, not trusted)

| Arm | Source revision | Binary sha256 (full) | Built |
| --- | --- | --- | --- |
| HEAD (treatment) | `ce6f3ee1` — docs-only commit on top of `d36a2ea0`; runtime code identical to `d36a2ea0` | `44397cc44f98c7676b8164683a0ca35116539797d0d5a54a104fe467c4abbf30` | 2026-08-27 09:31, primary checkout `build/tn-linux`, linked in-job: `[351/352] … Linking CXX executable mystral` |
| Baseline control | `af36d3f3` — the frame-attribution session's runtime revision and the parent of step 1 `c9941d0a`; the worktree at `/home/joao/prd224-base-host` is detached at exactly this commit | `7059530b1a80f888bc39a03e373bf0b1781b26554f9ee70b6456b71eaf8be97f` | 2026-08-27 09:35, detached worktree `build/tn-linux` (third_party copied; `download-deps.mjs` is byte-identical between the revisions and the CMakeLists delta is test-target bookkeeping, verified by diff), linked in-job: `[396/396] … Linking CXX executable mystral` |

The control arm exists because the recorded 22.2 ms baseline predates two intervening changes
that are not PRD-224's (the PRD-223 squash `84640c6a`, gate repairs `4a24924c`) and because a
same-session control removes machine-state drift from the A/B. Both arms run the **identical
game bundle bytes** (below), so the host is the only variable inside the pair.

## Game bundle and lane identity

| Thing | Value |
| --- | --- |
| Game | `/home/joao/projects/threenative/sandbox/fps-framework` |
| Bundle run | `.threenative/build/game.js`, sha256 `c7883c688d8da329692f8635c37f9aab5d03a3b148a43bee910898ce6ba2f2cd` (mtime 2026-08-27 00:52) |
| Display lane | **private Xvfb per run via `scripts/xvfb.sh`** (1600×900×24, `-displayfd`, `DISPLAY` exported by the wrapper, `SDL_VIDEODRIVER=x11`). `:0` — the machine's real display — is a different meter and is forbidden for host launches after the user reported visible windows; every `:0` capture this lane took earlier today is **void** (ledger below) and none of its numbers appear here. |
| Frame protocol | 900-frame screenshot mode (`--frames 900`), the baseline's own protocol. `TN_FRAME_BUDGET` windows are 300 frames (the meter's default): w1 ≈ frames 1–300 (startup — discarded, "window 1 always lies"), w2 ≈ 301–600. w3 never closes: the host exits at frame 900 before it reports (the recorded baseline's `x0.log` has the same property), so w2 is the last full window and sits inside the loop-log's 226–899 band. Windows are reported individually, never averaged across the run; whole-run numbers appear nowhere below. |

## gpubench — per-call prices (lane: private Xvfb, `--no-sdl`, so the probe never touches a display)

Probe: `artifacts/prd-222/frame-attribution-2026-08-26/gpubench.js`, extended this lane with
the `beginRenderPass+end` row (begin and end per iteration — a pass left open across the loop
is unbounded resource growth in both engines); the versioned copy is
`docs/verification/artifacts/prd-224-gpubench-2026-08-28.js`, byte-identical, commit
`ed1bb226`. Protocol unchanged from the PRD-222 root-cause session: 200,000 timed iterations
after a 2,000-iteration warm-up, identical file in the native host (and, on the web, in
Chrome — the Chrome cell below is the recorded 2026-08-26 number, cited not re-run).

Two interleaved cycles, order reversed between them; each row carries its 1-minute load at
launch. Ratios — not absolute ns — are the claim.

```
== cycle 1 (head first) ==
[head-xvfb, load 2.45] GPUBENCH	writeBuffer-16B	1208
[head-xvfb, load 2.45] GPUBENCH	createCommandEncoder	890
[head-xvfb, load 2.45] GPUBENCH	beginRenderPass+end	8231
[head-xvfb, load 2.45] GPUBENCH	buffer.size-getter	5
[base-xvfb, load 3.30] GPUBENCH	writeBuffer-16B	1137
[base-xvfb, load 3.30] GPUBENCH	createCommandEncoder	30322
[base-xvfb, load 3.30] GPUBENCH	beginRenderPass+end	71189
[base-xvfb, load 3.30] GPUBENCH	buffer.size-getter	5
== cycle 2 (base first, matched load 5.21) ==
[base-xvfb, load 5.21] GPUBENCH	writeBuffer-16B	1152
[base-xvfb, load 5.21] GPUBENCH	createCommandEncoder	30460
[base-xvfb, load 5.21] GPUBENCH	beginRenderPass+end	73318
[base-xvfb, load 5.21] GPUBENCH	buffer.size-getter	6
[head-xvfb, load 5.21] GPUBENCH	writeBuffer-16B	1192
[head-xvfb, load 5.21] GPUBENCH	createCommandEncoder	984
[head-xvfb, load 5.21] GPUBENCH	beginRenderPass+end	8948
[head-xvfb, load 5.21] GPUBENCH	buffer.size-getter	5
```

### Readings (lane: private Xvfb)

| Call | Base host `af36d3f3` (legacy) | HEAD `ce6f3ee1` (converted) | Fall | Chrome (recorded 2026-08-26) |
| --- | ---: | ---: | ---: | ---: |
| `createCommandEncoder` | 30 322 / 30 460 ns | **890 / 984 ns** | **31–34× within-cycle** | 919 ns |
| `beginRenderPass+end` | 71 189 / 73 318 ns | **8 231 / 8 948 ns** | **8.2–8.7× within-cycle** | not measured on any session |
| `queue.writeBuffer` (16 B) | 1 137 / 1 152 ns | 1 192 / 1 208 ns | ~1.0× — not converted; queue class is still on the legacy path | 431 ns |
| `buffer.size` — control | 5 / 6 ns | 5 / 5 ns | — | 21 ns |

- `createCommandEncoder` at HEAD is **0.89–0.98 µs — at the recorded Chrome price (919 ns) and
  well below the ~3.8 µs the phase-1 checkbox expected** from step 1. Two named contributors:
  the PRD-223 squash `84640c6a` landed further bridge work after step 1, and today's machine
  prices every binding ~2.3× cheaper than yesterday's measurement window (drift finding
  below). The within-cycle ratio (~31–34×) is the machine-state-independent claim.
- **`beginRenderPass+end` red→green is 8.2–8.7× — the phase-2 checkbox's "≥10×" is NOT met by
  the same-file probe, and the record says so rather than rounding.** Two honest caveats,
  both stated, neither pasted as a red→green: (a) the probe's descriptor is minimal (one
  color attachment); the recorded in-game red (154 748 ns/call, begin-only, the game's real
  15-read descriptor, yesterday's machine) against today's green reads ~17–19× — a different
  meter, a different machine state, and a begin-only row, so it is context, not evidence;
  (b) the row prices begin**+end**, so the green includes real end-of-pass work both hosts
  perform. What the probe establishes cleanly: the per-call table-install storm is gone from
  the pass path (~72 µs → ~8–9 µs), and the converted pass path still costs ~8–9 µs/call —
  ~9× the converted `createCommandEncoder` — which is phase-3 ordering material.
- `writeBuffer` is unchanged by the conversions, as expected: no class it belongs to has been
  converted. Its ~2.5–3× residual over Chrome (at Chrome's recorded 431 ns) is phase-3
  material — the highest-frequency crossing still on the legacy path. Per-frame call count:
  the reassessment's table said 862 for yesterday's game build; the sibling record's fresh
  `TN_BRIDGE_BY_NAME` count at today's bundle is ~428 — either way the total excess is
  ~0.25–0.30 ms/frame (428 × ~0.65–0.9 µs over Chrome), which bounds phase 3.

## Baseline drift finding — the recorded 22.2 ms does not reproduce (named section per the night lead's ruling)

Yesterday's session measured the *same host revision* (`af36d3f3` lineage, pre-conversion) at
`writeBuffer` 2 519 ns and a desktop-native frame baseline of render.p50 22.2 ms (fps 29–34).
Today, the same revision — the sha256'd control binary above — measures `writeBuffer`
1 137–1 152 ns and renders the current game bundle at render.p50 **12.33–12.45 ms** (w2) on
the Xvfb lane. Two measured contributors:

1. **Machine state, ~2.3×.** The identical-host gpubench row fell from 2 519 ns (2026-08-26
   session) to 1 137–1 152 ns (today). Yesterday's numbers were taken alongside heavy
   profiling and build work; today's control arm ran at launch load 2.5–6.1.
2. **Game-bundle drift.** The current bundle (rebuilt 00:52 by another lane) runs
   `substeps.mean` 1.0 on an uncapped lane (baseline-era probes: 4.3–4.6) and `update.mean`
   ~1.5 ms (was 4.0–4.9). The baseline's exact game bytes (`12d7edb2…`, recorded in the
   session's `source-revision.txt`) are **no longer on disk**; the UI-layer feature commit
   (`3152feb`, Aug 24) and all gameplay commits predate the baseline build, so the drift is
   the uncommitted tweaks plus framework dep updates at rebuild time.

**Consequence, stated as a protocol rule going forward: frame-level gates in this repository
must be same-session control A/Bs. Cross-day baselines are void as decision inputs** — the
22.2 ms number cannot decide anything today, and answering the literal phase-1 gate against
it would have scored a false MOVE (the control arm lands ~45% below it with zero
conversions applied). The PRD-222 loop log's machine-quiet and window rules remain binding;
this adds the same-session requirement on top.

## Desktop TN_FRAME_BUDGET pair (lane: private Xvfb, both arms)

Identical game bundle bytes on both arms, same per-run private Xvfb display, 900-frame
screenshot protocol, gate analyzer green on all four runs (markers, exactly one present per
frame, non-blank 1280×720 screenshot). w2 is the decisive window (see protocol note above).

| Pair (order) | arm | launch load | w2 render.p50 | w2 frame.p50 | w2 fps | w2 update.mean | head − base |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 (base→head) | xbase1 | 6.08 | **12.45** | 15.72 | 21.81 | 2.98 | **+0.59** |
| | xhead1 | 4.34 | 13.04 | 16.76 | 19.74 | 3.54 | |
| 2 (head→base) | xhead2 | 2.86 | 12.83 | 16.25 | 19.49 | 3.68 | **+0.50** |
| | xbase2 | 2.47 | **12.33** | 15.78 | 20.02 | 3.29 | |
| 3a (base→head) — EXCLUDED, phase confound (F7) | xbase3 attempt 1 | 3.49 | 19.11 | 27.0 | 13.15 | **10.45** | — |
| | xhead3 attempt 1 | 11.70 | 12.74 | 16.34 | 19.68 | 3.52 | |
| 3b (base→head) — EXCLUDED, phase confound (F7) | xbase3 attempt 2 | 4.82 | 14.72 | 19.44 | 18.46 | 5.05 | −0.96* |
| | xhead3 attempt 2 | 6.00 | 13.76 | 18.32 | 18.59 | 4.41 | |

Raw w2 lines, all eight runs (pairs 1–2 decide; pair 3 shown for audit only):

```
w2 fps=21.81 frames=300 hitches=0 frame.p50=15.72 render.p50=12.45 render.p95=14.91 render.mean=12.85 update.mean=2.98 hostGap.p50=28.46 substeps.mean=2.74   (xbase1)
w2 fps=19.74 frames=300 hitches=0 frame.p50=16.76 render.p50=13.04 render.p95=14.78 render.mean=13.2  update.mean=3.54 hostGap.p50=33.66 substeps.mean=3.04   (xhead1)
w2 fps=19.49 frames=300 hitches=0 frame.p50=16.25 render.p50=12.83 render.p95=16.26 render.mean=13.26 update.mean=3.68 hostGap.p50=33.78 substeps.mean=3.08   (xhead2)
w2 fps=20.02 frames=300 hitches=0 frame.p50=15.78 render.p50=12.33 render.p95=14.56 render.mean=12.5  update.mean=3.29 hostGap.p50=33.76 substeps.mean=3     (xbase2)
w2 fps=13.15 frames=300 hitches=0 frame.p50=27    render.p50=19.11 render.p95=36.59 render.mean=24.02 update.mean=10.45 hostGap.p50=40.21 substeps.mean=4.3  (xbase3 attempt 1 — heavy-match phase)
w2 fps=19.68 frames=300 hitches=0 frame.p50=16.34 render.p50=12.74 render.p95=14.63 render.mean=12.92 update.mean=3.52 hostGap.p50=33.86 substeps.mean=3.05   (xhead3 attempt 1)
w2 fps=18.46 frames=300 hitches=0 frame.p50=19.44 render.p50=14.72 render.p95=21.17 render.mean=16.11 update.mean=5.05 hostGap.p50=33.67 substeps.mean=3.12   (xbase3 attempt 2)
w2 fps=18.59 frames=300 hitches=0 frame.p50=18.32 render.p50=13.76 render.p95=16.32 render.mean=14.15 update.mean=4.41 hostGap.p50=34.78 substeps.mean=3.23   (xhead3 attempt 2)
```

\* attempt 3b's −0.96 carries a phase confound in the opposite direction (the base arm ran
+0.64 ms more simulation), so it is not comparable and both pair-3 attempts are excluded
under the live-window/phase-classification rule (loop-log F7/F9): pairs 1–2 are the
update-matched, order-alternated decision pairs and they agree tightly.

### The voided `:0` first pass (retained per the night lead's instruction; never decision-grade)

The redo's predecessor ran the same protocol on the machine's real display (`:0`,
`SDL_VIDEODRIVER=x11`) across both host binaries: nine completed 900-frame arms (base1,
base2, base3, base4, base5, head1, head3, head4, head5 — three matched interleaved pairs
plus one exploratory pair taken 40 minutes apart) and two gpubench pass-pairs, plus three
failed launches (two SIGSEGV, one screenshot-save failure). The night lead voided all of it
after the user reported visible windows — display contention moves render.p50 more than any
lever under test — and ordered a full Xvfb redo. The `:0` rows are retained in the record's
prior revision (commit `89325fd5`) with this void marker; their three matched-pair deltas
(−0.67 / +0.40 / +1.01 ms) were directional agreement only and are superseded by the Xvfb
pairs above. No `:0` number is decision-grade anywhere in this file.

The fps 19–22 and `hostGap.p50` ~28–34 ms are the Xvfb FIFO present throttle (loop-log F11) —
fps is never the metric here; `render.p50` is, per protocol. The two pairs agree tightly
(+0.59, +0.50): the converted host is, if anything, marginally slower than the legacy
control, and in no pair does it move materially below. For lane context, the desktop **web**
arm ran the same frozen game build on the same private-Xvfb wrapper in the same session:
headed Chromium via Playwright, adapter `{"vendor":"nvidia","architecture":"turing"}` (real
hardware, not SwiftShader), windows 2–9 steady at fps 59.99, **render.p50 3.3–3.5 ms** — the
native-vs-web render gap on this lane today is ~3.7×, directionally the recorded 2.9×; the
web number is 2× below its recorded 7.6–8.9 ms cell for the same machine-state reasons as
everything else from yesterday.

```
w2 fps=59.99 frames=300 hitches=0 frame.p50=5.5 render.p50=3.4 render.p95=4.5 render.mean=3.52 update.mean=1.25 hostGap.p50=11.2   (web, Chromium, same Xvfb lane)
```

**Frame-level arithmetic at today's machine prices.** The two converted classes are worth,
per frame (3 `createCommandEncoder` + 3 `beginRenderPass` calls — the reassessment's per-frame
counts, confirmed by the sibling record's `TN_BRIDGE_BY_NAME`): 3 × (30 460 − 984) +
3 × (73 318 − 8 948) ns ≈ 88 + 193 ≈ **0.28 ms** on a ~12.3–13.0 ms render phase (~2.3%). At
yesterday's machine prices the same arithmetic gives ~0.65 ms of the recorded 22.2 ms (~3%).
The phase-1 prediction of a *material* frame move always rested on the whole-bridge excess
(≈6.7 ms, all ~3,200 crossings), which phases 1–2 alone do not touch — they converted 2
classes covering 6 of 3,214 calls.

## Decision

**NO-MOVE — and NO-MOVE holds under Xvfb: the Xvfb pair deltas (+0.59 / +0.50 ms, matched
pairs) agree with the voided `:0` pass's direction-of-no-effect, so the verdict does not
change between lanes.**

- Against the recorded 22.2 ms baseline: today's native render.p50 (12.3–13.0 ms, both arms,
  Xvfb lane) is ~45% below it — but the zero-conversion control arm lands there too, so the
  movement is machine state (~2.3×, measured on the identical-host gpubench row) plus
  game-bundle drift (see the named section above), not PRD-224. The literal gate as written
  cannot be answered cross-session any more; answering it that way would have scored a false
  MOVE.
- Conversion-attributable movement (the question underneath): **+0.50/+0.59 ms across two
  matched Xvfb pairs — no material move**; the point estimate carries the opposite sign to
  the prediction and sits inside the lane's pair-to-pair spread. Two independent instruments
  agree: the per-frame arithmetic from the same-session per-call prices (−0.28 ms predicted
  for the 6 converted calls of ~3,214 crossings) and the paired frame measurement (+0.5 ms
  measured). The effect of converting these two classes is below this lane's noise floor.
- **Per the PRD's stop rule, widening is refused until explained — and the explanation is
  now priced on the record:** the installed per-call tax is real (31–34× on
  `createCommandEncoder`, 8.2–8.7× on `beginRenderPass+end`, same file, same session, same
  lane), but the two converted classes cover 6 of ~3,214 crossings per frame. The frame is
  owned by the unconverted crossings — `queue.writeBuffer` alone is the highest-frequency
  legacy term (~428 calls/frame at today's count) — plus render work outside the bridge.
  Phase 3's widening order is priced: the queue class leads it, bounded at ~0.3 ms/frame.
  Phases 3 and 4 are refused by the stop rule as written; this record is the explanation the
  rule asks for, and `d17de550` (PRD-226) is where the render-excess attribution continues.
- Scope note: this verdict prices phases 1–2 only. It does not judge phase 3's own future
  win; it removes the premise that the already-landed conversions moved the frame.

## Cross-reference: the sibling record

`docs/verification/prd-224-frame-pricing-and-device-arm-2026-08-27.md` (commit `97a4c808`)
priced the same question at the same hour with a different design — OFF arm by source
mutation (the contract test's disable lines) on the profiled `tn-linux-wgpu` build, frame
meter `TN_ANDROID_JS_NATIVE` work/frame under the same Xvfb wrapper, plus the device arm
this lane does not cover. Its independent contribution is Phase 4. Where both lanes measured
the same thing, they agree within a few percent — and after this lane's void-and-redo, both
lanes' frame and per-call numbers are now on the same sanctioned Xvfb lane:

| Quantity | This lane (sha256'd control host) | `97a4c808` (mutation OFF arm) |
| --- | ---: | ---: |
| `createCommandEncoder` legacy red | 30 322–30 460 ns | 29 757–34 988 ns |
| `createCommandEncoder` converted | 890–984 ns | 882–999 ns |
| `beginRenderPass+end` red | 71 189–73 318 ns | 76 401–82 548 ns |
| `beginRenderPass+end` converted | 8 231–8 948 ns | 7 981–8 497 ns |
| `writeBuffer` | 1 137–1 208 ns, flat across arms | 1,127–1,470 ns, flat across arms |
| Frame verdict | NO-MOVE (+0.50/+0.59 ms, paired, TN_FRAME_BUDGET w2, private Xvfb) | FLAT (Δ 0.02 ms, work/frame, Xvfb, per-frame marker) |

Two meters, two OFF-arm constructions, one lane, one verdict: **the conversion is real per
call and flat per frame.**

## Disclosure ledger

- **The `:0` violation and the void.** This lane's first measurement pass (09:38–11:05) ran
  the host windowed on the machine's real display (`DISPLAY=:0`, `SDL_VIDEODRIVER=x11`),
  matching the recorded baseline's lane; the user saw the windows and the night lead voided
  every `:0` capture as a measurement (display contention moves render.p50 more than any
  lever under test) and banned `:0` launches. All numbers in this record come from the
  private-Xvfb redo. The voided runs — 4+2 gpubench passes and 5 completed frame arms across
  both host binaries — are superseded; their numbers live only in the prior revision of this
  file (commit `89325fd5`) and in no evidence table anywhere.
- **Machine quiet-ness.** The machine was fully quiet only until 09:49. The redo block ran
  at launch loads 1.84–6.08 (each row labelled) after the unrelated jest/tsc storms and the
  user's game session ended — near the machine's idle baseline, per the night lead's
  sanction ("single digits / whatever this machine's idle baseline is"). The Wine session
  seen earlier was gone for the whole redo block (process table checked before each arm);
  the only coexisting load was a Vite dev server started by another lane in the measurement
  game's own sandbox (~15–38% CPU, first seen 12:43, not this lane's process, not killed) —
  its cost lands in the per-row load labels. The within-cycle interleaving keeps each
  red/green and each pair's arms in the same load regime.
- **Launch failures across ~10 game launches:** 2 flaky SIGSEGVs at audio-source startup
  (exact signature: `Audio] Source registered, active sources: N` → `[Mystral] Caught signal
  SIGSEGV, exiting gracefully`, N = 24 on the first (base arm, launch 1 of that arm, ~09:44),
  N = 14 on the second (head arm, launch 2 of that arm, ~10:17); one per host binary —
  host-agnostic, unattributed, consistent with loop-log F5's pattern but on the desktop lane
  with today's bundle) and 1 `Error: Failed to save screenshot!` (head5 attempt 1, ~10:58;
  retried clean). Every launch that reached 900 frames passed the gate analyzer. Recorded
  per the night lead's instruction; not chased.
- The Chrome web arm ran under the same private-Xvfb wrapper (window count: 1 browser window
  on the virtual display, never on `:0`); the recorded Chrome per-call numbers (919/431/21 ns)
  are cited from the 2026-08-26 session, not re-measured.
- The untracked `artifacts/` tree is gitignored, so the versioned probe copy lives in
  `docs/verification/artifacts/` (forced add, same as the prd-222-phase0 evidence files);
  the executed file and the versioned copy are byte-identical (sha256 `bb6cf43a…`).
- The control host worktree at `/home/joao/prd224-base-host` is left in place for
  re-verification; it is ~2 GB and safe to delete when the batch closes.
- The PRD file briefly carried a corrupted first line (`mark ---` breaking the frontmatter)
  while this lane worked — not this lane's edit; it was repaired by whoever rewrote the
  PRD's status block (`97a4c808`'s author) before this lane's checkbox marks landed.

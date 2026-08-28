# PRD-228 — what the 13.79 ms intercept is made of (2026-08-28)

Answers one question: `presented p50 = 9.94 ms/Mpx × pixels + **13.79 ms**` (§1.3.5 of
`runtime-perf-state.md`) — what is the 13.79 ms?

**Verdict up front: the intercept is CPU, and it is CPU work whose size is set by the frame's
draw/op count, not by pixels.** The host's GPU-blocking segment (`present`) fits with a *negative*
intercept and measures 0.29 ms at the smallest rung — 1.7 % of that frame. Three named CPU terms
carry it: the JS `render` phase 8.50 ms, the host's `frameReplay` 4.03 ms, and one physics/game
substep 1.9–2.2 ms.

## 0. What was and was not executed

- **No device arm was run for this analysis.** `pgrep -af prd228` was empty before starting and no
  `adb`, no build, and no install was issued from this lane. Every number below is re-derived from
  the logs the Phase 0 ladder already wrote.
- Inputs: `sandbox/fps-framework/artifacts/prd228/{b100,b072,b055,b044,b032}/logcat-kept.txt`
  (the fitted ladder) plus `{c032aa,c044aa,c055aa}` (the antialias arms, used only in §5).
- The pipeline was validated by reproducing the published fit exactly before anything new was read:
  `presented p50` slope **9.940**, intercept **13.794**, R² **0.992**; `render p50` slope **3.603**,
  intercept **8.501**, R² **0.970**. Those match §1.3.5 to the digit, so the phase-level and
  segment-level fits below sit on the same rows the ladder was published from.
- **Not measured here, and named as such:** any GPU-side timing. `gpuDrain` is 0.000 in all five
  arms — the arms were built without `-PthreenativeGpuDrainProfile=true` — so the ladder contains
  no direct GPU number at all. §4 says exactly what that costs the answer.

### Method notes that bind the numbers

- **Liveness classifier.** Method rule 9's `update.mean ≥ 3 ms` is dead (PRD-227 cut update to
  0.46 ms steady). This analysis uses the classifier `tools/prd228-read.mjs` actually used for
  §1.3.5: *not one of the two windows after launch*, `substeps.mean ≥ 1`, `update.mean > 0.05`.
  The per-arm `update.mean` series is printed below so the classification is auditable.
- **Host-gap pairing.** `TN_HOST_GAP` carries no window number. logcat duplicates every marker
  line; after de-duplication there is exactly one host-gap line per frame-budget window, emitted in
  window order, and the pairing was checked against the shared period value (b100 window 5:
  `presented.p50` 40.44 ↔ `periodP50Ms` 40.440). Pairing is by order, and `periodP50Ms` fits pixels
  with slope 9.933 / intercept 13.828 — i.e. the host's own period meter reproduces the JS meter's
  fit independently.
- **Statistic.** Each arm's value is the mean over its live windows of that window's p50, the same
  statistic §1.3.5 fitted. p50s do not add, so the parts do not sum exactly to the whole; §1 states
  the residual rather than hiding it.

Per-arm live windows and their `update.mean` / `substeps.mean` series:

| arm | live / windows | `update.mean` per live window | `substeps.mean` per live window |
| --- | --- | --- | --- |
| `b100` | 3 / 5 | 8.48, 6.35, 1.43 | 2.30, 2.34, 2.43 |
| `b072` | 5 / 7 | 3.18, 5.08, 6.04, 3.13, 1.25 | 1.45, 1.59, 1.79, 1.95, 1.83 |
| `b055` | 7 / 9 | 2.89, 3.58, 4.41, 4.65, 2.31, 0.79, 1.10 | 1.24 … 1.38 |
| `b044` | 8 / 10 | 2.95, 2.96, 3.29, 3.48, 3.44, 0.86, 0.66, 0.68 | 1.05 … 1.20 |
| `b032` | 6 / 12 | 2.56, 3.08, 3.00, 2.88, 2.67, 0.65 | 1.00 … 1.09 |

`b100` keeps only three live windows and two of them carry a much larger `update.mean` than any
other arm. That inflates the `update` term specifically; it does not touch `render`, `frameReplay`
or `present`. §1 gives leave-one-out ranges so the reader can see how much any single arm moves any
single term.

## 1. The decomposition

Every term below is fitted against drawing-buffer megapixels across the same five arms, with the
same statistic, as the headline model. "LOO" is the range of the intercept over the five
leave-one-out refits — the honest uncertainty on each part.

| term | meter | slope ms/Mpx | **intercept ms** | R² | LOO intercept | share of 13.79 |
| --- | --- | ---: | ---: | ---: | --- | ---: |
| `render` (JS phase) | `TN_FRAME_BUDGET` | 3.603 | **8.501** | 0.970 | 7.75 … 8.64 | 61.6 % |
| `frameReplay` (host) | `TN_HOST_GAP` | 0.713 | **4.026** | 0.819 | 3.67 … 4.28 | 29.2 % |
| `update`, per substep | derived | 0.116 | **1.878** | 0.233 | 1.65 … 2.04 | 13.6 % |
| all other host-gap segments | `TN_HOST_GAP` | 0.147 | **0.056** | 0.949 | 0.03 … 0.07 | 0.4 % |
| `residual` | `TN_FRAME_BUDGET` | 0.010 | **0.007** | 0.942 | 0.01 | 0.1 % |
| `overlay` | `TN_FRAME_BUDGET` | 0.000 | **0.000** | n/a | 0.00 | 0 % |
| `present` (host GPU/display wait) | `TN_HOST_GAP` | 4.346 | **−1.798** | 0.965 | −2.53 … −1.30 | **−13.0 %** |
| **sum of parts** | | 10.24 | **12.67** | | | 91.8 % |
| **fitted total** `presented p50` | | 9.940 | **13.794** | 0.992 | 13.02 … 14.14 | 100 % |

The parts under-sum the whole by **1.125 ms (8.2 %)**. That gap is p50-of-p50 non-additivity, not a
missing phase: the same five windows' `frame` p50 (10.235 intercept) already exceeds
`update + render + residual` (9.99) by the same kind of margin, and the host's own
`Σsegments ≈ hostGap` invariant holds (b100: 15.84 vs 16.26). Nothing unaccounted was found.

The raw per-arm rows the fits run on:

| arm | Mpx | period p50 | `render` | `frameReplay` | `present` | `update` | substeps | hg-other |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `b100` | 2.592 | 39.16 | 17.43 | 5.68 | **9.74** | 5.34 | 2.36 | 0.42 |
| `b072` | 1.344 | 28.50 | 14.38 | 5.24 | **4.03** | 3.33 | 1.72 | 0.30 |
| `b055` | 0.784 | 21.03 | 11.11 | 4.98 | **0.44** | 2.43 | 1.29 | 0.14 |
| `b044` | 0.502 | 18.21 | 10.08 | 4.26 | **0.36** | 1.96 | 1.12 | 0.11 |
| `b032` | 0.266 | 16.76 | 9.28 | 3.88 | **0.29** | 2.30 | 1.04 | 0.11 |

### 1.1 The intercept is not an extrapolation artefact — read it directly at `b032`

`b032` draws 0.266 Mpx. On the fitted model that is only 2.64 ms of pixel cost, so the smallest
rung *is* very nearly the intercept, measured rather than modelled:

```
b032, presented p50 16.73 ms
  render        9.28   frameReplay  3.88   update  2.30 (1.04 substeps)
  present       0.29   other host   0.11   residual 0.010
  Σ parts      15.87   unattributed +0.87 ms (+5.2 %, p50 non-additivity)
  GPU-blocking share of the frame: 1.7 %
```

At one tenth of the panel's pixels the frame still costs 16.73 ms and **0.29 ms of it is the host
waiting on the GPU or the display.** That is the finding, without a regression in it.

## 2. The prior decomposition ("8 ms replay + 14 ms GPU-tail wait in present") — tested, not assumed

The memory-recorded decomposition (`hostGap` 2026-08-27: `TN_HOST_GAP` names ~25 ms as ~8 ms replay
+ ~14 ms GPU-tail wait in `present`) was checked against all five rungs rather than carried forward.

- **The `present` half is confirmed as a GPU-tail wait, and therefore confirmed *out* of the
  intercept.** `present` fits pixels at **4.346 ms/Mpx, R² 0.965, intercept −1.798 ms**. Read across
  the ladder it is 9.74 → 4.03 → 0.44 → 0.36 → 0.29 ms. This is not a linear term: it is
  ≈ 0.3 ms flat below 0.8 Mpx and rises steeply above it — the signature of `max(0, GPU − CPU)`
  switching on when the GPU becomes the limiter somewhere between 0.78 and 1.34 Mpx. Forcing a
  straight line through a hinge is what produces the negative intercept. Either way the direct test
  asked for comes out the same: **`present` contributes nothing to the fixed term.**
- **Its magnitude has moved.** At the closest comparable pixel count (`b100`, 2.592 Mpx) `present`
  is 9.74 ms, not ~14 ms. The draw collapse and the PMREM IBL landed in between, and this ladder is
  mailbox + uncapped at 120 Hz. Do not quote the ~14 ms figure against this build.
- **The replay half survives, smaller, and it *is* in the intercept.** `frameReplay` is 3.88–5.68 ms
  across the ladder against the prior's ~8 ms, and its fixed part — **4.03 ms** — is 29 % of the
  intercept. It is the second-largest single thing in the frame at zero pixels.

## 3. Which terms are pixel-driven and which are not

- **Pixel-driven:** `present` (4.35 ms/Mpx) and the pixel slopes inside `render` (3.60) and
  `frameReplay` (0.71). See §4 for what those two slopes actually are.
- **Not pixel-driven, and this is the intercept:** `render`'s 8.50, `frameReplay`'s 4.03,
  one substep of `update` at 1.9–2.2, and 0.06 ms of everything else the host does — events, io,
  audio, timers, microtasks, preFrame, frameDrain, devicePoll, endFrameOther, handles, screenshot
  put together. The host loop outside replay and present is not a cost.
- **`update`'s apparent pixel slope (1.44 ms/Mpx, R² 0.959) is an artefact and must not be read as
  a pixel cost.** `substeps.mean` itself fits pixels at 0.583/Mpx with R² 0.993 — 2.36 substeps at
  `b100` down to 1.04 at `b032` — because a slower frame accumulates more fixed-timestep substeps.
  Per substep the cost is pixel-flat: 2.27, 1.93, 1.88, 1.74, 2.21 ms (fit slope 0.116, R² 0.233,
  i.e. no relationship). `update` scales with *frame time*, not with pixels; it is a consequence of
  the slow frame, not a cause. The fitted `update` intercept of 1.486 ms is low for the same reason
  — the fit's substep intercept is 0.866, not 1 — so the table above uses per-substep × 1 substep.

## 4. CPU-fixed vs GPU-fixed — how far this data separates them, and where it stops

**The intercept is CPU.** The decisive evidence is not the negative `present` intercept; it is the
direct read: at 0.266 Mpx the host blocks for 0.29 ms of a 16.73 ms frame. A fixed *GPU* term —
binning, per-draw state, a fixed-resolution shadow pass — could only enter the presented frame time
by making the host wait, and the host is not waiting. Whatever Bayview's fixed GPU cost is, it is
smaller than the CPU frame at low resolution and therefore invisible in the number this PRD is
trying to move. **The intercept points at draws, ops and per-frame CPU, not at fill rate and not at
fixed GPU work.**

Two further facts make the CPU attribution structural rather than inferential:

1. **The scene is byte-identical across all five arms.** `TN_RENDER_PROJECTION` reports the same
   line in every arm — `sourceRenderables 835`, `resultDrawCandidates 563`, `batches 15`,
   `projectedObjects 287`, `exactObjects 548` (`renderOrder 336`, `tooFewToBatch 80`,
   `transparent 75`, `skinned 40`, `instanced 12`, `points 5`) — and `TN_DRAW_DIAG` is identical too
   (`groups 119`, `belowFloorMeshes 101`). Nothing about the CPU's encoding work changes between
   rungs. Only the pixel count does.
2. **Therefore the pixel slopes inside `render` and `frameReplay` cannot be CPU encoding work.**
   With an identical draw list, there is no per-frame CPU whose cost rises with resolution. Those
   slopes are GPU/display back-pressure surfacing inside CPU phases — and the runtime says exactly
   where: `packages/runtime-native/src/webgpu/context.cpp:1205` documents the backend's frame
   latency letting `getCurrentTexture` block the next frame's encode, *"measured on Pixel 8 as
   acquire waiting inside the render phase"*. `GPUCanvasContext.getCurrentTexture()` is a
   synchronous binding (`src/webgpu/surface_texture_transaction.h`) called from JS inside
   `renderer.render()`, so the acquire wait lands in the `render` phase; the queue submit inside the
   host replay can absorb the rest.

### What could not be separated, and why

**`render`'s 8.50 ms intercept cannot be split into CPU command encoding versus acquire wait from
these logs.** The argument in (2) shows the *slope* is wait; it does not prove the *intercept*
contains none. A frame where the acquire blocks by a constant amount at every resolution would look
exactly like this. Three instruments would settle it and none of them ran:

- `gpuDrain` is 0.000 in every arm (the diagnostic drain build was not used), so there is no GPU
  frame time on the ladder at all.
- There is no timer around `getCurrentTexture`. **The single highest-value next measurement is to
  bracket the surface acquire as its own segment** — a `TN_HOST_GAP`-style timer inside the
  bindings' `getCurrentTexture`, or an extra `TN_FRAME_BUDGET` sub-phase — because it decides
  between two lever families that differ by 8.5 ms/frame.
- The projection reconcile runs inside the `render` phase (§1.3.2 brackets it there deliberately),
  walking 835 renderables per frame, and is not separately metered. Bracketing it as its own phase
  is the second instrument worth adding.

`frameReplay`'s 4.03 ms intercept is on firmer ground: it is host C++ replaying a packed op stream
whose length is identical in every arm, so its fixed part is CPU by construction, and only its
0.71 ms/Mpx slope is attributable to a blocking submit.

## 5. Three incidental findings that affect how this ladder should be read

1. **The `c*aa` arms are not a valid MSAA probe.** `c032aa`, `c044aa`, `c055aa` set
   `renderer.antialias: true` at scales 0.32/0.44/0.55 and would have been an ideal fixed-pixel
   GPU-load probe. They are not usable: `TN_GPU_TEXTURES` is byte-identical between each AA arm and
   its non-AA twin (310 MB / 73 textures at 0.32; 318 MB / 73 at 0.55, same 19 buckets), and no
   multisampled attachment or extra texture appears. Either the `antialias` request did not reach a
   sample count on the native path, or the texture census cannot see the attachment. **Unresolved,
   and worth its own investigation** — `packages/core/src/renderer.ts:200` already computes a
   `sampleCount` that nothing logs, so a one-line marker would settle it.
2. **Because AA appears inert, the AA arms are accidental replicates — and one of them drifted
   badly.** `c032aa` vs `b032`: presented p50 16.80 vs 16.73 (+0.4 %). `c044aa` vs `b044`: 17.76 vs
   18.16 (−2.2 %). Those bound within-session repeatability at roughly ±0.4 ms at the low rungs.
   But `c055aa` vs `b055` reads **28.47 vs 21.00 ms (+35.6 %)**, with `frameReplay` up 4.98 → 7.38 —
   a segment MSAA cannot touch. Battery-after temperature was 37.9 °C vs 37.8 °C and thermal status
   ended at 1 for both, so temperature does not explain it; `c055aa` was the ninth arm of the
   session at 42 % battery. **Late-session drift of this size is real and unattributed.** It did not
   enter the fitted ladder, whose rung order was scrambled precisely against this, and the fitted
   intercept survives leave-one-out at 13.02–14.14 ms. Refitting with all eight arms as replicates
   gives intercept 14.70 but collapses R² from 0.992 to 0.897 — the drift, not the model.
3. **`b100` is the thinnest arm** (3 live windows, and its `update.mean` series spans 8.48 → 1.43).
   Dropping it moves the presented intercept to 13.06 and the slope to 11.14. The verdict does not
   depend on it: dropping any single arm leaves the intercept in 13.0–14.2 ms, and the CPU
   attribution rests on `b032`'s direct read, which `b100` does not touch.

## 6. Pre-registered levers (method rule 6)

Rule 6's formula is written for bridge crossings and does not apply verbatim to a
draw/op-count lever, so each entry shows its own arithmetic and names its measured basis. Anything
predicting < 2 ms/frame is refused below rather than filed. Nothing here appears in §2's lever
graveyard; `render`'s ownership rule is respected — no proposal optimises three.js internals inside
the host.

### L1 — Take the host replay off the JS critical path (engine-owned). Predicted **−3.9 ms/frame**

The loop is strictly serial: JS rAF (`update` + `render`) → `endDawnFrame` (`frameDrain`,
`frameReplay`, `present`, `devicePoll`). `frameReplay` is host C++ replaying the packed stream after
JS has finished producing it, and it is 4.03 ms of fixed cost that overlaps nothing.

```
predicted = frameReplay intercept                       = 4.026 ms
cross-check, measured directly at b032, no extrapolation = 3.88  ms
conservative (50 % overlap only)                         = 1.94–2.01 ms
predicted ms/frame = 3.9 (full overlap), 2.0 (half)
```

Valid only while the GPU is not the limiter, which is the regime the acceptance bar lives in:
`present` is 0.29–0.44 ms at scales 0.32–0.55, so removing CPU from the serial chain removes it
from the period one-for-one there. At `b100` it would be absorbed by `present` and buy nothing —
state that in the arm.

Not in the graveyard: entries 1, 2 and 13 attack the *cost per crossing*; this moves an unchanged
cost off the critical path. Not in §1.5's untried list either. **Falsifier:** if double-buffering
the packed stream cuts `frameReplay` out of the period and device presented p50 at scale 0.32 falls
by < 2 ms, it is dead and goes to the graveyard.

### L2 — Raise projection coverage past the `renderOrder` lane (mixed game/engine). Predicted **−2.3 to −7.1 ms/frame**

The projection collapses 287 of 835 renderables into 15 batches and leaves 548 walked exactly. The
largest exclusion lane is `renderOrder: 336` — objects excluded solely because they carry a
non-zero `renderOrder` (`packages/core/src/projection-plan.ts:159`; a batch is one draw so it holds
one place in the transparency sort). In the game these are pool slots: decals at 23, tracers,
muzzle-flash cards at 27–30, the rifle at 20.

```
measured projection ratio on what it already takes: 287 projected -> 15 batches = 19.1 : 1
if the 336 renderOrder objects project at the same ratio: 336 -> 18, candidates 563 -> 245 (-318)

fixed CPU per walked candidate, from this ladder:
  ceiling  (render 8.501 + replay 4.026) / 563 = 22.2 us
  floor    (replay 4.026 alone)          / 563 =  7.15 us
predicted ms/frame = 318 x 22.2us = 7.06   ceiling
                     318 x 7.15us = 2.27   floor
```

Both bounds clear 2 ms. Independent support for a per-draw CPU rate at all: §1.3.1's measured
draw-count A/B moved desktop `render.p50` 10.83 → 5.37 ms when walked draws fell 780 → 492 — a
36.9 % draw cut for a 50.4 % render cut, i.e. more than proportional. That is a desktop absolute and
is quoted here only as a ratio, per method rule 8.

**Stated weakness, pre-registered as the falsifier.** `resultDrawCandidates` counts the scene the
renderer walks, not the draws it issues (`packages/core/src/projection-apply.ts:651`), and §1.3.1
records the 336 as *"mostly the decal pool's hidden slots"*. If they are hidden, three.js already
skips them and the saving collapses to the reconcile's own walk. **Falsifier: if
`resultDrawCandidates` falls by ≥ 300 and device `render` p50 at scale 0.32 falls by < 2 ms, the
lever is dead.** Because of this, L1 should be run first — its basis has no such ambiguity.

Look risk: `renderOrder` exists to pin transparency sort position. Batching across it changes draw
order, which is an appearance decision and belongs to the game, not to a package.

### Refused here, with the arithmetic that refuses them

| Candidate | Arithmetic | Verdict |
| --- | --- | --- |
| Batch the `tooFewToBatch: 80` lane | 80 → ~4 at 19.1:1, saves 76 candidates × 22.2 µs = **1.69 ms** | refused, < 2 ms |
| Batch the `transparent: 75` lane | 75 → ~4, saves 71 × 22.2 µs = **1.58 ms** | refused, < 2 ms, and it changes blending order |
| Cap the substep accumulator at 1 | at zero pixels substeps already ≈ 1; saving at the intercept = **0 ms** | refused |
| Trim per-substep `update` cost | whole term is **1.9–2.2 ms**; a realistic fraction is < 2 ms | refused |
| Any resolution/scaler change | §1.3.5 already priced it: 2.9 ms of pixel budget at 60 fps, 0.2 ms against the 14 ms bar | refused — this is the finding, not a lever |
| Frame latency / present mode / backend / UI overlay / GC | §2.1 entries 5, 6, 7, 10, 11, 14, 9 | refused, graveyard |
| Optimise three.js render internals in the host | §2.1 entry 15 | refused, ownership rule |

### Not a lever — the instrument that must come first

Splitting `render`'s 8.50 ms into command encoding versus surface-acquire wait. A timer around
`GPUCanvasContext.getCurrentTexture()` (and a second bracket around the projection reconcile)
decides whether the largest single piece of the intercept is CPU work to be cut or GPU
back-pressure to be overlapped — an 8.5 ms fork. It predicts 0 ms by itself and is filed as a
measurement, not a lever.

## 7. Reproducing every number above

No repository file was modified to produce this. Run from `sandbox/fps-framework`:

```python
# python3 - <<'EOF'   (fits every frame-budget phase and host-gap segment against Mpx)
import json, os, re
root = "artifacts/prd228"; B = ["b100","b072","b055","b044","b032"]
SEG = ["events","io","audio","timers","microtasks","preFrame","frameDrain","frameReplay",
       "present","gpuDrain","devicePoll","endFrameOther","handles","screenshot"]

def load(a):
    d = os.path.join(root, a)
    txt = open(os.path.join(d, "logcat-kept.txt"), errors="replace").read()
    scale = float(re.search(r"resolutionScale: ([\d.]+)",
                            open(os.path.join(d, "config.txt")).read()).group(1))
    w, h = round(2400 * scale), round(1080 * scale)
    fb = {}
    for l in txt.split("\n"):                      # logcat duplicates lines; dedup by window
        i = l.find("TN_FRAME_BUDGET:")
        if i >= 0:
            try: o = json.loads(l[i+16:].strip()); fb[o["window"]] = o
            except Exception: pass
    hg, seen = [], set()
    for l in txt.split("\n"):                      # one host-gap line per window, in order
        i = l.find("TN_HOST_GAP:")
        if i < 0: continue
        try: o = json.loads(l[i+12:].strip())
        except Exception: continue
        k = (o["periodP50Ms"], o["sumP50Ms"])
        if k not in seen: seen.add(k); hg.append(o)
    wins = [fb[k] for k in sorted(fb)]
    assert len(hg) == len(wins)
    # prd228-read.mjs's classifier; method rule 9's `update.mean >= 3 ms` is dead (PRD-227).
    live = [(wins[i], hg[i]) for i in range(len(wins))
            if i >= 2 and wins[i]["substeps"]["mean"] >= 1
            and wins[i]["phases"]["update"]["mean"] > 0.05]
    m = lambda xs: sum(xs) / len(xs)
    r = {"arm": a, "mpx": w * h / 1e6}
    r["presented"] = m([f["presented"]["p50"] for f, _ in live])
    for p in ("render", "update", "residual", "overlay", "hostGap"):
        r[p] = m([f["phases"][p]["p50"] for f, _ in live])
    r["substeps"] = m([f["substeps"]["mean"] for f, _ in live])
    r["updPerSub"] = r["update"] / r["substeps"]
    for s in SEG:
        r["seg." + s] = m([g["segments"][s]["p50Ms"] for _, g in live])
    r["hgOther"] = sum(r["seg." + s] for s in SEG if s not in ("frameReplay", "present"))
    return r

rows = {a: load(a) for a in B}
def fit(arms, key):
    xs = [rows[a]["mpx"] for a in arms]; ys = [rows[a][key] for a in arms]
    sx, sy = sum(xs)/len(xs), sum(ys)/len(ys)
    sl = sum((x-sx)*(y-sy) for x, y in zip(xs, ys)) / sum((x-sx)**2 for x in xs)
    b = sy - sl*sx
    sst = sum((y-sy)**2 for y in ys); ssr = sum((y-(sl*x+b))**2 for x, y in zip(xs, ys))
    return sl, b, 1 - ssr/sst

for k in ["presented", "render", "seg.frameReplay", "seg.present", "updPerSub", "hgOther",
          "residual", "substeps"]:
    sl, b, r2 = fit(B, k)
    loo = [fit([a for a in B if a != d], k)[1] for d in B]
    print(f"{k:<18} slope {sl:7.3f}  intercept {b:7.3f}  R2 {r2:.3f}  LOO {min(loo):.2f}..{max(loo):.2f}")
# EOF
```

Expected first line, which is the published §1.3.5 fit and the check that the pipeline is sound:
`presented slope 9.940 intercept 13.794 R2 0.992`.

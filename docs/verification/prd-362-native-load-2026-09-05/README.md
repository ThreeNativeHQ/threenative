# PRD-362 — starter adaptive quality under measured GPU load, native desktop, 2026-09-05

Bounded claim: **the starter's quality controller responds to measured GPU load on desktop Linux
under a private Xvfb.** Nothing here accepts PRD-362, closes a phase, or reports a device, browser,
real-workload or frame-rate result. The physical-acceptance bullets stay open.

Run against the reconciled PR base, engine head `79f87914`, with every engine package repacked from
that base and reinstalled into the sandbox game.

## Result

| Variant | Build | Proof exit | Expected | Outcome |
| --- | ---: | ---: | ---: | --- |
| `normal` | 0 | 0 | 0 | tier sequence `high,medium,low,medium,high`; recovery decided at window 24 and held for windows 25–29 |
| `pinned` | 0 | 0 | 0 | 20 consecutive eligible windows, every one `high` / `source=pinned`, under continuous GPU overload |
| `negative` | 0 | 1 | 1 | fails the tier-sequence assertion — `expected high,medium,low,medium,high; observed high` |

All three runs report `[WebGPU] Adapter: NVIDIA GeForce RTX 2080` and `[WebGPU] Backend: Vulkan` in
the raw console, apply a 1920×1080 drawing buffer on every frame window, and finish with no stderr
line and no teardown error.

Full structured windows, decisions and overload sets, unchanged from the run receipts:
[`normal-receipt.json`](normal-receipt.json), [`pinned-receipt.json`](pinned-receipt.json),
[`negative-receipt.json`](negative-receipt.json). Each records the sha256 of the complete local
receipt it was slimmed from; only the per-sample and per-capture world snapshots were replaced by
the player observations they were checked for.

Captures, GPU frame read-backs at 1920×1080:
[`normal-high.png`](normal-high.png), [`normal-medium.png`](normal-medium.png),
[`normal-low.png`](normal-low.png). The `pinned` and `negative` frames are near-identical to
`normal-high` (both are stressed `high`) and are not duplicated here.

## What the negative control deletes

The build fixture is the Vite transform factory `build-starter-quality-load.mjs`; the runner labels
each applied transform in the receipts' `build.transformReport`. For `negative` it inserts
`return report("platform-only")` immediately after the pinned branch, so the entire measured
decision in the starter's `adaptiveQuality.ts` is bypassed while observation, validation, startup
and compiling skipping, and reporting all stay live. That run still measured 45 fresh GPU-overload
windows with the CPU under budget, so its exit 1 is the deleted decision and not a broken run.

## Provenance

[`provenance.json`](provenance.json) carries every identity in machine-readable form. Summary:

- `packages/runtime-native` is byte-identical to `origin/main` at this head, so the Release host
  `53fe0026…` corresponds to this base and was reused rather than rebuilt. That is an inference from
  source identity: no host build receipt exists.
- The installed `@threenative/core` resolves to the repacked PR-base tarball and its `dist/index.js`
  is byte-identical to it; `gpuFrameAge` is present. The game lockfile has no reference to the older
  shared tarball directory.
- The game's `src/render/adaptiveQuality.ts` is byte-identical to the starter template in this
  branch, and its `patches/three@0.185.1.patch` is byte-identical to the engine's.
- Variant executables and their embedded config hashes are recorded in each receipt and match the
  build receipts.
- Both temporary game configs were restored byte-for-byte after every build, and the ordinary
  desktop output was rebuilt from the restored configs afterwards.

## Reproducing

The executed runner is `artifacts/batch-2026-09-05/starter-quality-load-native.mjs` — sha256
`86ad1b39af8a3c606590c2eaeb1f554dd6cae1265b0dfce39fbbaa787b866b1b`, the `runnerSha256` in all three
receipts — kept local because `artifacts/` is gitignored. It is invoked from the repository root:

```sh
node --import tsx artifacts/batch-2026-09-05/starter-quality-load-native.mjs <absolute game path> <normal|pinned|negative> 1920 1080
```

It reads the packaged executable from, and writes its receipt and captures to,
`artifacts/batch-2026-09-05/` — a gitignored path, which is why the receipts and captures are copied
here rather than linked there.

To rebuild a variant: register `createQualityLoadPlugin(<game>, <variant>, { endOnLow: true })` from
the fixture factory `artifacts/batch-2026-09-05/build-starter-quality-load.mjs` as the first Vite
plugin of the game, set the desktop window to 1920×1080, point `THREENATIVE_RUNTIME_BINARY` at the
built host, run the game's `build:desktop`, and copy the output directory — the executable **and**
its sibling `ui/` — next to the runner. The transform factory fails closed if any anchor it
rewrites is not found exactly once, and each receipt lists the labels that were applied. The build
wrapper used here stays local: it hardcodes this machine's sandbox
path, and the steps above are what it performs.

## Controls

- **The retained runs use the `scripts/xvfb.sh` default screen.** An earlier `normal` rerun set
  `TN_XVFB_SCREEN=1920x1080x24` and failed the tier-sequence assertion with an oscillating sequence.
  Its measured costs differ from the retained runs', but same-tier costs also differ several-fold
  between the passing runs, so **no causal link to screen geometry is claimed** and the cause of the
  variation is unidentified. The numbers are recorded once, in
  [`runtime-perf-state.md`](../runtime-perf-state.md). No production threshold was changed and
  nothing was rerun to obtain the pass: three independent `normal` runs at the retained
  configuration passed.
- **Clipping is ruled out physically.** The desktop capture is a GPU frame read-back, not an X grab,
  and the region beyond the 1600×900 boundary carries fully shaded scene content in all three
  captures above.
- **The oscillating run is a counter-example to PRD-362's "transitions do not oscillate" bullet.**
  Each of its decisions is individually consistent with the shipped policy given the sample it
  cites. The retained pass proves the sequence occurred and held for five consecutive windows; it
  does not prove long-run stability, because the runner stops as soon as the target state holds.

## Limitations

1. Desktop Linux under a private Xvfb only. No phone, no browser rerun, no device acceptance.
2. Absolute GPU cost on this lane is unstable between runs and is not a hardware performance claim.
   Frame rate here is dominated by Xvfb present behaviour and carries no meaning; the controller's
   only input is GPU cost.
3. Recovery is fixture-driven, not load-driven: under stress the fixture gives `high` and `medium`
   the same load, so the first downshift buys nothing, and relief at `low` comes from the fixture
   switching the load off. This lane does not show that a downshift reduces GPU cost.
4. The `high` and `medium` captures were taken while the fixture was active, so they show fixture
   appearance, not shipped-tier appearance. Only `low` is a clean preset.
5. The scenario is a bespoke native handshake: the runner deletes the web-only diagnostics and
   visibility assertions and substitutes its own visibility, movement and odometer checks. It is not
   the game's shipped playtest assertion set.
6. `receipt.tiers` is built without the runner's own eligibility filter. It does not bite here —
   every GPU-meter decision in all three runs has an age of one frame — but the sequence assertion is
   weaker than the eligibility rule beside it.
7. `presentationTolerance` (0.05) was not exercised: every eligible decision used the GPU meter. It
   remains an explicit unmeasured allowance.
8. The proof logs record the thrown error or the final pass line, not an explicit exit-code line;
   the exits above were observed in the shell that ran them.

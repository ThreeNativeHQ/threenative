<!-- schemaVersion: 1 -->

# Every template ships a quality switch — PRD-304, 2026-08-31

What executed on this machine for PRD-304, and what did not. Base: `origin/main` at `2e014460`
(the lane was cut before the board docs landed as `4036f341`). Linux, Chromium through Playwright
1.62.1 under a private Xvfb, `pnpm` 10.25.0, Node 20.19.6.

Two results below are **pre-existing failures reproduced on `origin/main` in the same harness**,
recorded here so they are not read as this change's. Both are named with the control that
attributes them.

## What the change is

Each of the eight templates gains `src/render/quality.ts` — `QualityTier`, three preset objects,
`resolveQualityTier` and `qualityPreset` — and its `postprocessing.ts` is rewritten to read that
file and nothing else. The two anonymous `desktopPreset` / `mobilePreset` literals per template are
deleted. `scripts/check-template-quality.ts` joins the `budgets` chain.

## Green

| Gate | Command | Result |
| --- | --- | --- |
| Types | `pnpm typecheck` | pass |
| Lint | `pnpm lint` | pass (498 pre-existing warnings, unchanged) |
| Root unit suite | `pnpm exec vitest run` | **308 files, 3062 passed, 1 skipped** |
| New units | `vitest run …/template-quality.spec.ts …/check-template-quality.spec.ts` | 25 passed |
| Invariants | `pnpm budgets` | pass, ending `template quality: 8 templates ship src/render/quality.ts, read it, and document it` |
| Pristine scaffold typecheck | `vitest run …/template.spec.ts` | 32 passed — all eight templates scaffold and `tsc --noEmit` clean |

## The default look did not move — proved on the objects, not on a capture

Captures here are not bit-deterministic: two identical runs of the same build moved **65.263 % of
921,600 pixels, mean |Δ| 2.668/255**. A pixel comparison therefore cannot answer "did the default
look move". The object the chain is handed can.

`scripts/preset-neutrality.local.ts` reconstructs each template's `desktopPreset` and
`mobilePreset` from `git show origin/main:…/postprocessing.ts` and deep-compares them to this
branch's resolved tiers:

```
action-rpg   high == origin/main desktopPreset, low == mobilePreset
defense      high == origin/main desktopPreset, low == mobilePreset
minimal      high == origin/main desktopPreset, low == mobilePreset
platformer   high == origin/main desktopPreset, low == mobilePreset
racing       high == origin/main desktopPreset, low == mobilePreset
sailing      high == origin/main desktopPreset, low == mobilePreset
shooter      high == origin/main desktopPreset, low == mobilePreset
starter      high == origin/main desktopPreset, low == mobilePreset

8 templates: the default look at either platform is byte-identical.
```

`medium` is new and unreachable without an explicit `tier`, so no default changed.

## The switch is reached, and it reports

`scripts/tier-capture.local.ts` scaffolds the starter, captures it twice at its default tier, then
forces `tier: "low"` in the scene and captures again.

```
default (a)      TN_QUALITY_TIER high mobile=false source=platform
                 distinctColors=13931 brightPixelRatio=0.6409 luminanceStdDev=0.0651 maxLuminance=0.8960
default (b)      TN_QUALITY_TIER high mobile=false source=platform
                 distinctColors=14689 brightPixelRatio=0.6604 luminanceStdDev=0.0668 maxLuminance=0.8965
tier: "low"      TN_QUALITY_TIER low mobile=false source=override
                 distinctColors=637 brightPixelRatio=1.0000 luminanceStdDev=0.0181 maxLuminance=0.8474

same-code noise band (default a vs default b): 65.263% of 921600 pixels moved; mean |Δ| 2.668/255
the switch     (default a vs tier low):        99.700% of 921600 pixels moved; mean |Δ| 23.953/255
```

The tier is named in every capture and the override is reported as an override rather than
silencing the line. The frames differ by **9× the same-code noise band**.

## Not proved: that `low` is a cheaper *picture* rather than no picture

The `tier: "low"` capture is blank — the canvas renders nothing behind the DOM HUD. That is not
what this PRD set out to show, and it is **not caused by this change**.

Control: `scripts/control-capture.local.ts`, run from a worktree of `origin/main`'s templates with
no PRD-304 code, scaffolds the same starter and forces the incumbent `mobilePreset` by passing
`mobile: true`. It produces the same blank frame with the same four statistics:

```
=== PRD-304 control: origin/main templates, mobilePreset forced on desktop ===
distinctColors=637 brightPixelRatio=1.0000 luminanceStdDev=0.0181 maxLuminance=0.8474
  TN_RENDER_CHAIN:{"applied":{"dropped":[],"requested":["sharpen","bloom"],…,"stages":["sharpen","bloom"],…}}
  THREE.WebGPURenderer: Render pipeline creation failed (renderPipeline_MeshStandardMaterial_28):
    Color target has no corresponding fragment stage output but writeMask
    (ColorWriteMask::(Red|Green|Blue|Alpha)) is not zero.
   - While validating targets[1] framebuffer output.
```

So the shipped mobile look of the starter draws nothing on this desktop WebGPU path, and has done
since before this PRD. The chain reports itself as applied (`sharpen`, `bloom`, no refusals), which
is the honest-reporting hole: the stages installed and the frame is still empty.

Two limits on that finding, stated rather than assumed:

- **The adapter would not name itself.** `navigator.gpu.requestAdapter()` returned an adapter whose
  `info` was `{"keys":[],"values":{}}`, so this repository's own rule applies — a WebGPU run that
  cannot name its adapter may be a fallback. Nothing here claims a discrete GPU drew it.
- **No phone was involved.** The Pixel 8 record of a scaffolded template at 59.99–60.02 fps is a
  real render, so this is more likely specific to this adapter than to every phone. Proving that
  needs a device run, which this lane did not do.

This is filed as a finding for its own lane, not fixed here: PRD-304's own text says it changes
where the choice lives, not the default look, and the neutrality proof above shows it did exactly
that.

## Negative controls — every one observed red

```
### 1. racing/src/render/quality.ts deleted
TEMPLATE_QUALITY_INCOMPLETE: 1 problems
- racing: no src/render/quality.ts
(exit 1)

### 2. an anonymous desktopPreset literal restored in defense/postprocessing.ts
TEMPLATE_QUALITY_INCOMPLETE: 1 problems
- defense: postprocessing.ts still holds the `desktopPreset` literal the tiers replace
(exit 1)

### 3. the SSR cost comment stripped from shooter/quality.ts
TEMPLATE_QUALITY_INCOMPLETE: 1 problems
- shooter: quality.ts enables ssrEnabled (line 87) with no measured cost beside it
(exit 1)

### 4. the quality-tier section removed from sailing/AGENTS.md
TEMPLATE_QUALITY_INCOMPLETE: 2 problems
- sailing: AGENTS.md does not name quality.ts and its three tiers
- sailing: AGENTS.md does not show the tier override
(exit 1)

### 5. starter's three tiers made identical
 × should differ between low and high in at least one enabled stage
 × should give medium its own look, between the other two
AssertionError: starter: low and high render the same thing, so the switch is three names for one
look: expected { bloomEnabled: true, …(10) } to not deeply equal { bloomEnabled: true, …(10) }
(exit 1)
```

The empty-template-list red is proved by its own fixture test —
`should throw when it finds no templates at all` asserts `rejects.toThrow(/TEMPLATE_QUALITY_NO_TEMPLATES/)`
against a directory with no templates, so a scan that finds nothing throws instead of reporting
"0 of 0 passed".

## Revert check

Deleting `starter/src/render/quality.ts` and running the pristine-scaffold typecheck:

```
 FAIL  packages/create-threenative/__tests__/template.spec.ts > template contracts >
       should typecheck a pristine scaffold of every template that advertises the script
+ starter:
+ > tsc --noEmit -p tsconfig.json
+ src/render/postprocessing.ts(14,69): error TS2307: Cannot find module './quality.js' or its
+ corresponding type declarations.
```

## Instruction budgets

The AGENTS.md section was cut to its shortest form (the per-stage numbers live in `quality.ts` and
are not repeated), then measured: `defense` and `shooter`, the two templates sitting exactly at
their caps, both render exactly **+134** words. Every cap moves by that, and `sailing` absorbed all
of it in headroom.

```
action-rpg    3091/3170 words  OK
defense       3170/3170 words  OK
minimal       3940/4015 words  OK
platformer    3508/3547 words  OK
racing        3137/3170 words  OK
sailing       2971/3170 words  OK
shooter       3235/3235 words  OK
starter       4287/4385 words  OK
instruction budgets met across 8 templates
```

## Red, and not this change's

### `pnpm test:templates` — 7 of 8 templates pass; `defense` fails a gameplay assertion

```
action-rpg: scaffolded playtests passed.
defense:    scaffolded playtests failed: pnpm test exited 1.
minimal:    scaffolded playtests passed.
platformer: scaffolded playtests passed.
racing:     scaffolded playtests passed.
sailing:    scaffolded playtests passed.
shooter:    scaffolded playtests passed.
starter:    scaffolded playtests passed.
```

The one failure, twice in this lane and reproducible:

```
{"scenarioSummary":{"diagnostics":["TN_PLAYTEST_RESOURCE_ASSERTION_FAILED"],
 "failed":["resource.state.leaks"],"reasons":["Resource assertion failed for 'state' path 'leaks'."],
 "frames":1203,"lastTick":1315,"pass":false,"scenario":"defense-survive-ten-waves"}}
```

**Control:** the same `TN_TEMPLATE_ONLY=defense pnpm test:templates` run from a worktree of
`origin/main`'s templates fails identically, same scenario, same assertion:

```
{"scenarioSummary":{"diagnostics":["TN_PLAYTEST_RESOURCE_ASSERTION_FAILED"],
 "failed":["resource.state.leaks"],…,"frames":1203,"lastTick":1313,"pass":false,
 "scenario":"defense-survive-ten-waves"}}
```

Pre-existing. It is a wave-survival outcome, not a render result, and this change is preset-neutral.

### `pnpm test` stops in `runtime-native` before the root suite runs

Six reds, all the same shape — the C++ test executables are not compiled in a fresh worktree:

```
AssertionError: …/packages/runtime-native/build/tn-linux/threenative-crash-handler-policy-test
is not built. Run: cmake --build build/tn-linux --target threenative-crash-handler-policy-test
```

`pnpm native:build` was not run in this lane. The root suite was therefore executed directly
(`pnpm exec vitest run`, 3062 passed) rather than through the recursive script it hides behind.

## Not executed

- No Android, iOS, macOS or Windows run. The tier switch is generated TypeScript in the templates
  with no platform seam, but nothing here claims a platform it did not execute.
- `pnpm visuals` was not run: it requires a human score file and a parity frame pair, and it writes
  captures into `docs/verification/visuals/`. The preset-neutrality proof above answers the same
  question — did the default look move — without restaling a generated record.
- No measurement was taken of what a tier *costs*. Every millisecond in the generated files is
  quoted from `runtime-perf-state.md`'s per-stage ablation and cited there; none is new.

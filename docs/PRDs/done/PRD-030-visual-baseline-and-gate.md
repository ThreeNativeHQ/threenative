# PRD-030 — The visual baseline: one look across every template, and a gate that scores it

**Complexity: 7 → LARGE mode** (three templates +2, new script +2, browser capture +2,
scoring integration +1)

**Depends on:** PRD-027 (`setOutputNode` — without it every template re-patches
`renderer.render` and bloom is not affordable), PRD-026 (`camera` config, for the framing
files).
**Blocks:** nothing.
**Charter authority:** `AGENTS.md` rule 3 (**never own the look** — this PRD is the
constraint's positive form: the look ships as generated source), rule 1, "Verification
honesty"; `CHARTER.md` §3 (the head-to-head scores visuals as well as LOC).

## 1. Context

**Problem:** "the framework looks good by default" is currently unowned and unmeasured. The
three templates ship three different render layers of three different qualities, and nothing
anywhere scores what a freshly scaffolded project looks like. The vanilla control, by
contrast, was hand-tuned by a person who looked at it: additive plankton, a bloom stack, glow
materials with `toneMapped: false`, a deliberate palette. A default scaffold that renders a
grey box on a grey background loses the visual column of `CHARTER.md` §3 before gameplay is
written, and no gate would notice.

**Files analyzed:** `packages/create-threenative/templates/minimal/src/render/*` (3 files,
50 lines), `templates/starter/src/render/*` (6 files, 318 lines),
`templates/platformer/src/render/*` (4 files, 193 lines),
`examples/abyss-framework/src/render/*`, `examples/abyss-vanilla/src/main.js:219-224`,
`scripts/sweep-capture.ts`, `scripts/capture-guard.ts`, `scripts/score-blind.ts`,
`.claude/skills/self-improve/references/judge-rubric.md`.

**Current behavior:**

| Fact | Evidence |
|---|---|
| No template ships bloom | `templates/starter/src/render/postprocessing.ts` builds a `RenderPipeline` around a bare `pass`; `minimal` sets tonemapping only |
| The vanilla control does | `main.js:221-224` — `bloom(colour, 0.9, 0.5, 0.25)` |
| The three templates have three different render file sets | `minimal`: lighting, materials, post. `starter`: + camera, shapes, sky. `platformer`: palette, rig, sky, terrain — and no post file at all |
| Only one template has a palette module | `templates/platformer/src/render/palette.ts` |
| Nothing captures or scores a scaffolded project's appearance | `scripts/` has capture and blind scoring for **sweeps**, never for templates |
| The scaffold smoke test asserts the build, not the pixels | CI "scaffold smoke" — it does not open a browser |
| Headless Chromium renders WebGPU as a blank canvas on this machine | prior session finding; any capture gate here runs under `xvfb-run` or it measures nothing |
| A uniform frame is already treated as a capture failure | `capture-guard.ts` `assertFrameShowsSomething`, and `judge-rubric.md` voids on a black canvas |

The last two rows are what makes this affordable: the fail-closed capture guard and the
blind rubric already exist and are already trusted. This PRD points them at templates.

## 2. Solution

**The rule 3 line, stated once.** Every pixel decision in this PRD ships in
`packages/create-threenative/templates/*/src/render/` — generated source in the user's
project, theirs to read and delete. **No colour, tonemap, exposure, light, fog value, bloom
threshold or material default enters `packages/*/src`.** What the framework gains is a
*gate*: the ability to say a scaffolded project looked like something, scored, on every CI
run. Owning the measurement is not owning the look.

- **One render layer, same six file names, in every template:** `palette.ts`, `camera.ts`,
  `sky.ts`, `lighting.ts`, `materials.ts`, `postprocessing.ts`. An agent that has seen one
  template knows where everything is in the other two, and that discoverability is worth more
  than per-template cleverness — it is rule 4's argument applied to file layout. Content
  differs per genre; names and responsibilities do not.
- **A stated quality floor, identical across templates**, each item a line in the generated
  file with the comment saying why:
  1. tonemapping and exposure set deliberately (not the renderer default);
  2. a three-light rig with the rim light the starter's comment already argues for, soft
     shadows with `normalBias`;
  3. a sky or background that the fog colour is derived from — never a flat clear colour with
     unrelated fog;
  4. bloom through `setOutputNode`, with a threshold that leaves mid-tones alone;
  5. a palette module of at most six named colours, with exactly one accent, imported by
     `materials.ts` and the sky — so a scene is internally consistent by construction.
- **`pnpm visuals` is the gate.** Scaffold each template into a temp dir, build, serve, boot
  under `xvfb-run`, capture one frame per template through the existing capture guard, and
  score the frames with the blind rubric's **Visuals** column. Floor: **4**. Below it fails.
  A blank or uniform frame fails as a capture failure, never as a score of 1.
- **Reference frames are committed** under `docs/verification/visuals/`, so a regression is a
  visible image diff in a pull request rather than a number nobody looks at.
- **Parity with the control is measured, not asserted.** One scored pair per round: the
  framework arm and the vanilla control, same scene time, blind, through `score-blind.ts`.
  **The requirement is framework ≥ vanilla.** A loss is written into the round ledger as a
  loss.

### Explicitly rejected

| Proposed | Why not |
|---|---|
| A `defineGame({ look: "moody" })` preset | Rule 3 and `CHARTER.md` §2 in one line. The look is source the user edits |
| Default tonemapping/exposure in `createRenderer` | Rule 3 names tonemapping explicitly. It goes in the template's `postprocessing.ts`, one line, visible |
| A shared `@threenative/render` package the templates import | Rule 5 (no dependency to isolate) and rule 3 (the look would become package code with a version number the user cannot edit) |
| One template with three "modes" instead of three templates | Modes are presets wearing a hat |
| Pixel-diff assertions against committed PNGs in CI | GPU output is not deterministic across drivers. Commit the frames for humans; gate on the guard and the score |
| Score with a fixed heuristic (contrast, saturation, entropy) | It would pass a beautiful still of nothing and fail a deliberately flat art style. The rubric judges against the reference, as `judge-rubric.md` already requires |
| Skip `xvfb` and capture headless | Measured blank on this machine. A gate that scores a blank frame is worse than no gate |

## 3. Integration Ledger

| # | New thing | Live caller (non-test) | Replaces | Old path removed? | Negative control |
|---|---|---|---|---|---|
| 1 | Six-file render layer in all three templates | `npx create-threenative`; the scaffold smoke test | three divergent file sets | yes — old names deleted, not aliased | scaffold each template and assert all six files exist and are imported; delete one → smoke test red |
| 2 | The stated quality floor | the generated files themselves; `templates/*/AGENTS.md` | an unstated standard | n/a | a template whose `postprocessing.ts` sets no tonemapping → `pnpm visuals` structural check fails before any capture |
| 3 | `pnpm visuals` | CI, after the scaffold smoke test | nothing scored appearance | n/a | point it at a template with lighting removed → score below floor, gate red; point it at a blank canvas → capture failure, not a score |
| 4 | `docs/verification/visuals/<template>.png` | pull-request review | no visual record | n/a | change a palette colour and do not refresh → the gate still passes on score, and the stale frame is the reviewer's signal, so the refresh is part of the same commit |
| 5 | Framework-vs-control visual pair per round | `docs/verification/round-*.md`; `score-blind.ts` | an unmeasured claim of parity | n/a | supply both frames with arm names in the filenames → the rubric's blinding check voids the round, as it already does for sweeps |

**Reachability:** a user runs `npx create-threenative`, `pnpm dev`, and the first frame has a
lit scene, a coherent palette, tonemapping and bloom — and if a later change breaks that, CI
says so in the same run that checks the types.

## 4. Phases

#### Phase 1: the floor, written down

**Files:** `docs/product/VISUAL-BASELINE.md` NEW · `packages/create-threenative/templates/*/AGENTS.md` EDIT ·
`CLAUDE.md` REGENERATED.

Five numbered items, each with its rule-3 boundary stated. This is the document the gate
scores against and the templates implement; writing it after the code would make it a
description instead of a standard.

#### Phase 2: one render layer

**Files:** `packages/create-threenative/templates/{minimal,starter,platformer}/src/render/*` EDIT/NEW/DELETE ·
each template's `src/main.ts` EDIT.

Same six names everywhere. `postprocessing.ts` uses `setOutputNode` from PRD-027 and ships
bloom. `palette.ts` in all three. Genre-specific content stays genre-specific — the
platformer's terrain and the starter's shapes keep their own files, outside the six.

#### Phase 3: the gate

**Files:** `scripts/visual-gate.ts` NEW · `scripts/__tests__/visual-gate.spec.ts` NEW ·
`package.json` EDIT · CI workflow EDIT.

Scaffold, build, serve, `xvfb-run`, capture, guard, score, floor at 4. Structural checks
(all six files present, tonemapping set, bloom wired) run **before** the browser, so a
missing file fails in seconds rather than after a capture. Unit tests cover the scoring and
threshold logic against fixture frames; the browser leg is exercised by the CI job.

#### Phase 4: reference frames and control parity

**Files:** `docs/verification/visuals/*.png` NEW · `docs/verification/round-<n>-<date>.md` EDIT.

Commit one frame per template. Score the framework arm against the frozen control, blind,
and write the pair into the round ledger — including if the framework loses.

#### Phase 5: gates

`pnpm typecheck && pnpm lint && pnpm test && pnpm budgets`, plus `pnpm visuals` green for all
three templates under `xvfb-run`, plus the committed frames matching the current templates,
plus the control-parity pair recorded. Report the scores as numbers. A phase that reports
"looks good" without a score has not run.

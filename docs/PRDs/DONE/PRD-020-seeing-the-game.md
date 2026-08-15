# PRD-020 — Seeing the game: capture, the blank-frame guard, and a blind instrument judge

**Status: complete.** Phases 1–5 are implemented and verified against the archived
framework/vanilla pair. The human-authoritative visual benchmark remains a separate,
deliberately unautomated protocol step.

**Complexity: 6 → MEDIUM mode** (6-10 files +2, new system +2, protocol amendment +2)

**Depends on:** PRD-019 (the pair, the sealed proof set that carries the screenshot
requests). **Blocks:** PRD-021.
**Charter authority:** `CHARTER.md` §5b (never own the look — so the look must be
measured, not asserted), §12 criterion 2 ("does not look worse than the vanilla control");
`docs/benchmark/PROTOCOL.md`; `AGENTS.md` "Verification honesty".

## 1. Context

**Problem:** `CHARTER.md` §12 makes "does not look worse than the vanilla control" a
condition of the project's survival, and **nothing in this repository can see a frame.**
`AGENTS.md` states it outright: *"Nothing in the toolchain can see the game. `typecheck`,
`lint` and every playtest pass on grey boxes on a black screen."* Every visual judgement
made so far has been a human looking at a screenshot in a transcript that no longer exists.

**Files analyzed:** `scripts/score-blind.ts`, `scripts/__tests__/score-blind.spec.ts`,
`docs/benchmark/PROTOCOL.md`, `docs/benchmark/RESULTS-2026-08-02.md`,
`.claude/skills/build-on-sandbox/SKILL.md` rules, `package.json` devDependencies,
`docs/verification/SWEEP-TEMPLATE.md` (`Visual result` field), `playwright.config.ts`.

**Current behavior:**

| Fact | Evidence |
|---|---|
| The blind scorer handles **text only** | `score-blind.ts:74` — `readFileSync(path, "utf8")`, `stripArmIdentifiers` is a regex over a string |
| No screenshot is stored with any sweep | seven `docs/benchmark/sweeps/*/` archives — `src/`, `playtests/`, `package.json`, `sweep.json`, no image |
| The one visual field in the ledger is free prose | `SWEEP-TEMPLATE.md` — `Visual result: <pass or fail, with the largest remaining difference>` |
| Headless Chromium renders WebGPU as a blank canvas here | `build-on-sandbox/SKILL.md`: *"If a screenshot is black, suspect the capture before rewriting materials"* |
| A blank capture is indistinguishable from a broken scene downstream | nothing inspects pixel content anywhere in the repo |
| `pngjs` is already a devDependency | root `package.json` — `pngjs 7.0.0`, `@types/pngjs 6.0.5` |
| The blind bundle's void conditions exist and are tested | `score-blind.ts:120-134`; `RESULTS-2026-08-02.md` — "The scorer tests prove identifier redaction, deterministic shuffling, and prompt-hash voiding" |
| No quality score has ever been recorded | `RESULTS-2026-08-02.md` — every blind sample row is `not run` |

The sixth row is why this is buildable cheaply: the void machinery is already right, and
already tested. This PRD teaches it about images and puts a judge behind it.

The fourth and fifth rows are the trap this PRD is mostly about. A capture pipeline that
returns black frames and a scoring pipeline that dutifully scores them `1` produces a
confident, false, permanent record that the framework arm looks terrible. **The guard is the
feature**; the judge is the easy half.

## 2. Solution

- **Capture rides the sealed proof run.** PRD-019's scenarios already carry screenshot
  artifact requests, so `pnpm sweep:capture <archive>` re-runs the sealed set with artifacts
  enabled and writes `captures/<scenario>-<step>.png` into the archive. No second harness,
  no second browser recipe, and the frames are taken at assertion points — moments the game
  is known to be in a defined state, rather than an arbitrary wall-clock instant.
- **`scripts/capture-guard.ts` fails closed on a frame that shows nothing.** It decodes each
  PNG with `pngjs` and rejects: a single unique colour; fewer than a floor of distinct
  colours; luminance standard deviation under a floor; a fully transparent image; or a
  frame whose bright pixels occupy only HUD-sized content. The last condition is evidence
  from the first live run: the framework capture had 702 colours and enough variance to
  pass the naive guard, but visual inspection showed only the HUD over an empty field. The
  error is `TN_CAPTURE_BLANK` and it names the likely cause — headless WebGPU — because the
  next agent will otherwise spend the round rewriting materials. Thresholds live in one
  exported constant with the reasoning next to it.
- **Browser recipe, stated once.** Headed Chromium under
  `xvfb-run -a -s "-screen 0 1600x900x24"` with `--enable-unsafe-webgpu`,
  `--disable-gpu-sandbox`, `--ignore-gpu-blocklist`, fixed 1280×720 viewport, fixed device
  pixel ratio. The recipe is a shared constant used by capture and by `test:playtest`, so
  the two cannot drift.
- **`score-blind.ts` learns images.** A new `--image <arm:path>` artifact kind copies frames
  into `bundle/sample-NN/`, strips every PNG ancillary chunk that could carry a path or a
  tool name (`tEXt`, `iTEXt`, `zTXt`, `eXIf`), keeps the existing deterministic shuffle, and
  writes the reveal mapping to a **separate file the bundle does not reference**. Existing
  text behaviour is untouched.
- **`pnpm sweep:judge <bundle> --input <fresh-critic.json>` validates a fresh blind critic**
  run against `.claude/skills/self-improve/references/judge-rubric.md`, and writes
  `judge.json`: per-sample playability, visuals, screenshot-worthy, evidence, biggest gap,
  plus the comparison verdict. The critic is spawned read-only by the improvement loop and
  is never handed the reveal; the command validates its output rather than pretending to
  manufacture a critic score.
- **`PROTOCOL.md` gains an "Instrument scores" section** that says plainly what an
  instrument score is and is not: it drives the improvement loop; it can never produce a
  non-VOID `RESULTS-<date>.md`, and it can never satisfy `CHARTER.md` §12 criterion 2. Those
  need a human blind session, unchanged. The existing void conditions are extended to cover
  a judge that saw the reveal and a bundle with fewer samples than arms.

### Explicitly rejected

| Proposed | Why not |
|---|---|
| Perceptual pixel diff against `reference.png` as the score | Rewards copying the reference's framing over making a better game, and a platformer legitimately looks different from its reference. Distance is not quality |
| Let the judge read the source | Then it scores code, not the game, and arm identity leaks in the first import line. The whole point is that it sees what a player sees |
| Score from the build transcript | The failure mode this repository exists to avoid: grading a summary instead of the artifact |
| A human in every round | `PROTOCOL.md` keeps the human for the head-to-head result. Blocking every round on one makes the loop stop, which is the thing being built |
| Playwright's screenshot assertions as a second path | `test:browser` already owns a browser recipe; a second one drifts. One shared constant, two consumers |
| Store captures outside the archive | The archive is the unit that survives. A screenshot that is not beside the source it depicts is an orphan by the next round |
| Retry a blank capture automatically | A retry loop turns a real black screen into a timeout and hides both. Throw, name the cause, let the operator decide |

## 3. Integration Ledger

| # | New thing | Live caller (non-test) | Replaces | Old path removed? | Negative control |
|---|---|---|---|---|---|
| 1 | `pnpm sweep:capture` writing `captures/*.png` | `.claude/skills/self-improve/SKILL.md` step 4; PRD-021's round ledger | screenshots that lived only in a transcript | n/a | run it against a build whose renderer never clears → `TN_CAPTURE_BLANK`, not a stored black frame |
| 2 | `scripts/capture-guard.ts` | `sweep:capture`; `sweep:judge` re-checks before scoring | the assumption that a stored PNG shows something | n/a | feed it a 1×1 black PNG and a real frame → throws on the first, passes the second; raise the threshold above the real frame → the real frame is rejected, proving the check is live |
| 3 | Shared browser recipe constant | `sweep:capture`; `package.json` `test:playtest` | two hand-copied flag lists | **yes**, `test:playtest`'s literal flags | drop `--enable-unsafe-webgpu` → capture goes blank and the guard throws, so the flag's necessity is asserted rather than assumed |
| 4 | `--image` artifacts in `score-blind.ts` | `sweep:judge`; `PROTOCOL.md` example | text-only bundles | no — text path unchanged | embed `@threenative` in a PNG `tEXt` chunk → bundle is `void`; today it would ship |
| 5 | `pnpm sweep:judge` writing `judge.json` | `self-improve` step 4; PRD-021 ledger's instrument column | free-prose `Visual result` | ledger field becomes a score plus prose | hand the judge the reveal file → it must return `BLOCKED`; score a bundle with one arm missing → `BLOCKED`, never a default |
| 6 | `PROTOCOL.md` "Instrument scores" | `PROTOCOL.md`; `self-improve` skill; `CHARTER.md` §12 note | silence about model judges, which reads as permission | n/a | claim §12 criterion 2 from `judge.json` → the section says it is void, and the round-ledger schema test rejects the claim |

**Reachability:** `pnpm sweep:capture docs/benchmark/sweeps/platformer-<date>-framework` →
frames in the archive, or a loud `TN_CAPTURE_BLANK` → same for the vanilla archive →
`pnpm tsx scripts/score-blind.ts --image framework:<...> --image vanilla:<...>` → a bundle
with no arm identity anywhere in it → `pnpm sweep:judge <bundle> --input <fresh-critic.json>` → `judge.json` with a
score per sample and one comparison verdict → PRD-021 reads it into the round ledger.

## 4. Phases

#### Phase 1: the guard, before anything can store a frame

**Files:** `scripts/capture-guard.ts` NEW · `scripts/__tests__/capture-guard.spec.ts` NEW.

Export `assertFrameShowsSomething(png: Buffer, label: string)` and the threshold constant.
Tests: uniform black, uniform white, fully transparent, a two-colour gradient below the
distinct-colour floor, a mostly dark HUD-only frame, and a real captured frame checked in as
a fixture. The fixture is the control that proves the thresholds do not reject reality.

#### Phase 2: capture

**Files:** `scripts/sweep-capture.ts` NEW · `scripts/browser.ts` NEW (shared recipe) ·
`scripts/__tests__/sweep-capture.spec.ts` NEW · `package.json` EDIT.

Boot the archive's dev server on a fixed port, run the sealed scenarios with artifacts
enabled, write `captures/`, guard every frame, and write `captures/index.json` recording
scenario, step, viewport, and the recipe used. Point `test:playtest` at the shared recipe.

A capture run against an archive with no `node_modules` installs first; a capture run
against an archive whose `proofHash` does not match the sealed set throws before booting.

#### Phase 3: blind image bundles

**Files:** `scripts/score-blind.ts` EDIT · `scripts/__tests__/score-blind.spec.ts` EDIT.

Add `--image`, PNG ancillary-chunk stripping, per-sample directories, and `--reveal <path>`
written separately and never inside the bundle. Keep `stripArmIdentifiers` for the manifest
and any text artifact in the same bundle. Extend the void conditions: an arm identifier
found in any file **or filename**, a sample count below the arm count, or a reveal path
inside the bundle directory.

#### Phase 4: the judge

**Files:** `scripts/sweep-judge.ts` NEW · `scripts/__tests__/sweep-judge.spec.ts` NEW ·
`docs/benchmark/PROTOCOL.md` EDIT · `package.json` EDIT.

`sweep:judge` re-runs the guard over the bundle, spawns the blind critic with the rubric,
validates the returned structure field by field, and writes `judge.json`. A response missing
a required field, scoring a sample it was not given, or returning a score for a `BLOCKED`
sample is rejected — malformed input throws, per `AGENTS.md`.

Amend `PROTOCOL.md`: the "Instrument scores" section, the extended void list, and one line
in the blind rubric table pointing at
`.claude/skills/self-improve/references/judge-rubric.md` as the instrument's copy.

#### Phase 5: gates

`pnpm typecheck && pnpm lint && pnpm test && pnpm budgets`, plus a live capture-and-judge of
the archived `platformer-2026-08-05-2` sweep. The gate is not the judge agreeing with anyone
— it is a stored, non-blank frame and a structurally valid `judge.json`, with the blank-frame
negative control demonstrated red.

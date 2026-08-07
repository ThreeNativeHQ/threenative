# PRD-025 — Honest LOC counting: the two arms are not measured the same way

**Complexity: 3 → SMALL mode** (1-5 files +1, existing system +0, tooling in one script +2)

**Depends on:** nothing shipped is blocking.
**Blocks:** PRD-026 and PRD-027 both report their savings against this number, so this
lands first or their results are unreadable.
**Charter authority:** `AGENTS.md` rule 2 (the kill switch is scored by
`scripts/count-loc.ts`), rule 6, "Verification honesty"; `CHARTER.md` §3 (the win condition
is *against vanilla*), §10.

## 1. Context

**Problem:** the README publishes `vanilla 410 / framework 480 — vanilla wins`. That
verdict is the kill switch for the whole framework, and **63 of its 70-line margin is
formatting.** The vanilla control is excluded from Biome; the framework arm is formatted at
100 columns with one import per line. The classifier counts newlines and does not know the
difference. The framework may or may not be losing — the current instrument cannot say.

**Files analyzed:** `scripts/count-loc.ts:1-120`, `biome.json:3-16`, `README.md` benchmark
block, `examples/abyss-vanilla/src/main.js`, `examples/abyss-framework/src/scenes/Abyss.ts`,
`examples/AGENTS.md`, `docs/benchmark/PROTOCOL.md`.

**Current behavior:**

| Fact | Evidence |
|---|---|
| The vanilla control is excluded from the formatter | `biome.json:9` — `examples/abyss-vanilla/src/main.js` in `files.ignore` |
| The framework arm is formatted, at 100 columns, spaces | `biome.json:14-18`; `pnpm lint` covers `examples/abyss-framework` |
| Formatting the control with the **repo's own config** adds 63 lines | `biome format` over a copy: 410 → 473 lines, no code change |
| That is 90% of the published margin | 480 − 410 = 70; 480 − 473 = 7 |
| One import statement costs 6 lines in one arm and 19 in the other | `main.js:11-14` (4 lines) vs `Abyss.ts:2-19` (18 lines), same TSL symbols |
| The classifier counts raw newlines | `count-loc.ts:63-77` — `sourceLines()` splits on `\r?\n`, blank lines are `plumbing` |
| Nothing checks the counted file set is closed | `FRAMEWORK_PORT_FILES` in `count-loc.ts:52-57` is a hand-written list; a counted file may import an uncounted one and nothing objects |

The last row is the one that will bite later: PRD-026 and PRD-027 both propose moving lines
out of `Abyss.ts`. With an open file set, "moved to a file nobody counts" and "deleted"
produce the same README table. That is exactly the shape of the 19 validators that returned
`undefined` in v1.

## 2. Solution

- **Canonicalise both arms before classifying.** `count-loc.ts` formats each source in
  memory with the repo's Biome config, then counts. The frozen control is never rewritten on
  disk — `examples/AGENTS.md` still holds, and the diff stays empty.
- **Publish both columns.** The table gains `Raw LOC` and `Normalised LOC`; the
  **normalised column carries the verdict** and the README says so in one line. Hiding the
  raw number would be its own dishonesty; the point is that the two are visibly different.
- **Close the file set.** The counter walks the imports of every counted file. A relative
  import that resolves inside the arm and is not counted fails the run, unless it is listed
  in an `UNCOUNTED` table with a reason string. `src/ui/**` and `ViewportProbe.ts` go in that
  table with the reasons already written in `count-loc.ts:47-51`. A future PRD cannot quietly
  park 40 lines in `src/helpers/`.
- **`--check` stays the CI gate**, and now fails on three things: a stale README block, an
  unlisted counted-file import, and a formatter that cannot parse an arm.
- **The target is written down, and the arm may not grow.** `count-loc.ts` gains a ratchet:
  a `benchmark/loc-baseline.json` holding the normalised framework total, and `--check`
  fails when the total exceeds it. Lowering the baseline is a normal diff; raising it is a
  rule 2 event and needs a line in the round ledger saying what was bought. The stated goal
  is **framework ≤ 50% of the normalised vanilla total (≤ 237 against today's 473)**, and
  the README prints the current ratio next to the table so the distance is never a guess.

**Why 50% is not reachable by absorbing plumbing alone.** Vanilla is 138 plumbing + 272
game. A framework that absorbed *every* plumbing line leaves 272 — 43% below the normalised
control, and that is the floor for this approach. The last 7 points have to come from
game-shaped code: Godot-shaped nodes that replace hand-written gameplay (PRD-027, PRD-029)
and a state surface that is declared once instead of three times (PRD-028). This PRD does
not deliver the reduction; it makes the reduction measurable and stops it leaking back.

### Explicitly rejected

| Proposed | Why not |
|---|---|
| Format `abyss-vanilla/src/main.js` on disk | `examples/AGENTS.md`: the control is frozen. Changing it invalidates every result measured against it |
| Drop the raw column and publish only normalised | The gap between the two numbers is the finding. Publishing one number hides that the old verdict was an artefact |
| Count tokens, or statements, instead of lines | LOC is what `CHARTER.md` §3 and the README table commit to. Changing the unit mid-benchmark makes every dated result incomparable |
| Un-ignore the control in `biome.json` | Same as row one, plus it makes `pnpm lint` able to rewrite the control on any developer's machine |
| Declare the framework the winner once the gap is 7 lines | 7 lines is a tie, and a tie is not the win condition. PRD-026 and PRD-027 are where the win comes from |
| Exempt import blocks from the count | An arbitrary carve-out that only ever helps one arm. Normalising both arms is the neutral fix |

## 3. Integration Ledger

| # | New thing | Live caller (non-test) | Replaces | Old path removed? | Negative control |
|---|---|---|---|---|---|
| 1 | In-memory Biome normalisation in `collectLoc` | `pnpm tsx scripts/count-loc.ts`, CI `--check` | counting two differently-formatted files as if they were comparable | yes — raw-only verdict | feed a source Biome cannot parse → throws, does not silently count raw |
| 2 | `Raw` + `Normalised` columns in the README block | `README.md` benchmark block | one ambiguous total | yes | hand-edit either column → `--check` red |
| 3 | Import-closure check over counted files | `count-loc.ts` `--check` in CI | a hand-maintained file list | n/a | add `import "./helper.js"` to `Abyss.ts` without listing it → run fails naming the file |
| 4 | `UNCOUNTED` table with per-entry reasons | `count-loc.ts`, `docs/benchmark/PROTOCOL.md` | a comment explaining why `src/ui/` is absent | yes — the comment at `count-loc.ts:47-51` becomes data | remove a reason string → schema throws; empty string is not a reason |
| 5 | `benchmark/loc-baseline.json` ratchet + published ratio | CI `count-loc --check`; PRD-026 to PRD-029 each lower it | "the framework got bigger and nobody noticed" | n/a | add 10 lines to `Abyss.ts` without lowering the baseline → CI red naming the overage |

**Reachability:** CI runs `count-loc --check` → normalised totals recomputed from both arms
→ README block compared → a PRD that moves code into an unlisted file fails the same job
that publishes the win.

## 4. Phases

#### Phase 1: normalise, and prove the delta

**Files:** `scripts/count-loc.ts` EDIT · `scripts/__tests__/count-loc.spec.ts` EDIT.

Format in memory, count, keep the raw count alongside. Test with a fixture pair that is the
*same program* written packed and expanded: raw totals differ, normalised totals are equal.
Record the measured control delta (410 → 473) in the test as a regression pin, so a Biome
config change that moves it is visible.

#### Phase 2: the file set is closed

**Files:** `scripts/count-loc.ts` EDIT · `scripts/__tests__/count-loc.spec.ts` EDIT ·
`docs/benchmark/PROTOCOL.md` EDIT.

Resolve relative imports of every counted file, one level of transitivity at a time until
the set stops growing. Anything inside the arm's `src/` that is neither counted nor listed
fails. Negative control: a fixture arm with a counted file importing an unlisted sibling
must fail, and the failure names the sibling.

#### Phase 3: the ratchet

**Files:** `benchmark/loc-baseline.json` NEW · `scripts/count-loc.ts` EDIT ·
`scripts/__tests__/count-loc.spec.ts` EDIT.

Baseline written from the current normalised total. `--check` fails on any excess, with the
message naming the overage and the target ratio. Test both directions: a smaller total
passes and prints the new suggested baseline; a larger one fails.

#### Phase 4: publish

**Files:** `README.md` REGENERATED · `docs/benchmark/PROTOCOL.md` EDIT.

Regenerate the block. Above the table, generated not hand-written: which column decides, why
there are two, the current framework/vanilla ratio, and the 50% target.

#### Phase 5: gates

`pnpm typecheck && pnpm lint && pnpm test && pnpm budgets`, plus
`pnpm tsx scripts/count-loc.ts --check` green on a clean tree, plus the fixture negative
controls from phases 1 and 2 both red when their guard is removed.

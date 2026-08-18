---
prd_contract: v1
---

# PRD-151 — Seven hand-copied `AGENTS.md` files, and four of them dropped the rules

**Status:** PROPOSED, 2026-08-17. Nothing below has executed. The duplication counts and the
coverage matrix in §1 were measured on the tree at that date; everything in §2 and §3 is
unbuilt.

**Outcome:** a rule that every generated project's agent must read is written once, and every
template ships it — enforced by a gate rather than by whoever remembers to paste it into seven
files.

**Depends on:** nothing. `pnpm sync:agents` and its `--check` CI step already exist and already
own the `AGENTS.md → CLAUDE.md` mirror.

**Blocks:** nothing.

**Complexity: 3 → LOW mode.** One new directory of fragments, one expansion pass inside an
existing script, one required-set spec, seven edited templates.

**Blast radius: ~20 files.** `packages/create-threenative/agent-docs/` (new),
`packages/create-threenative/templates/*/AGENTS.md` and their generated `CLAUDE.md` mirrors,
`scripts/sync-agent-docs.ts`, `scripts/__tests__/sync-agent-docs.spec.ts`,
`packages/create-threenative/__tests__/template.spec.ts`.

---

## 1. The instructions the user's agent reads are seven hand-maintained copies

A scaffolded project's `AGENTS.md` comes from `templates/<name>/AGENTS.md`, copied verbatim with
`__PROJECT_NAME__` substituted. `scripts/sync-agent-docs.ts` mirrors it to `CLAUDE.md` and does
nothing else. There is no shared layer: seven standalone files, each hand-written.

Measured across the seven template `AGENTS.md` files on 2026-08-17, counting lines of 25
characters or more:

| Template | Substantive lines | Also present in another template |
| --- | --- | --- |
| starter | 321 | 190 |
| minimal | 283 | 190 |
| platformer | 163 | 99 |
| shooter | 56 | 23 |
| defense | 47 | 23 |
| racing | 45 | 22 |
| action-rpg | 42 | 21 |
| **total** | **957** | **568 (59%)** |

Fifteen distinct lines appear in all seven files; eighty-four appear in three.

**The cost is not the typing. It is that the copies diverged, and the divergence silently drops
rules from four of the seven products.** Which universal sections each template actually ships:

| Template | asset MCP loop | sculpt loop | "look at it" / budget the look | `--browser-recipe webgpu` | `xvfb-run` trap | `ctx` surface table |
| --- | --- | --- | --- | --- | --- | --- |
| starter | yes | yes | yes | yes | yes | yes |
| minimal | yes | yes | yes | yes | yes | yes |
| platformer | yes | yes | yes | yes | yes | **no** |
| action-rpg | yes | **no** | **no** | **no** | **no** | **no** |
| defense | yes | **no** | **no** | **no** | **no** | **no** |
| racing | yes | **no** | **no** | **no** | **no** | **no** |
| shooter | yes | **no** | **no** | **no** | **no** | **no** |

An agent scaffolded into `racing`, `shooter`, `defense` or `action-rpg` is never told how to look
at the game it is building, is never warned that headless Chromium serves WebGPU from
SwiftShader, is never warned that `xvfb-run` replaces a passing exit status with a failing one,
and never learns that `ctx.goto`, `ctx.tween`, `ctx.after` and `ctx.random` exist. Those are the
four traps this repository has paid for twice each, written down in two of seven products.

**The test suite hides this rather than reporting it.** `template.spec.ts:367` asserts the `ctx`
surface table only over `templates = ["starter", "minimal"]`; the sculpt-tool assertion at line
467 runs only over `typecheckTemplates`. The gate is scoped to wherever the text happens to
already exist, so a template that never had a rule passes for not having it. That is a check
reporting green while asserting nothing about five of the seven files it covers — the failure
mode this repository names as its most dangerous.

The trigger for writing this down: adding one rule — drop to plain Three.js when a framework API
blocks you — took seven identical edits on 2026-08-17, and nothing in the tree would have
reported six of them being skipped.

## 2. What lands

1. **`packages/create-threenative/agent-docs/<fragment>.md`** — one file per universal rule, the
   single source. It sits **outside `templates/`** on purpose: several specs enumerate
   `readdir(templateRoot)` directories and read `<dir>/AGENTS.md`, `<dir>/src/game.ts` and
   `<dir>/package.json` from each, so `templates/` must keep meaning exactly one directory per
   template.
2. **Markers in each template `AGENTS.md`**, placed where that template wants the rule to read:

   ```md
   <!-- shared: framework-blocks-you -->
   ...expanded copy, written by pnpm sync:agents...
   <!-- /shared -->
   ```

3. **Expansion inside `scripts/sync-agent-docs.ts`**, before the existing mirror pass: replace
   each marked region with the fragment body, then mirror to `CLAUDE.md` as today. `--check`
   already runs in CI and already fails on a stale mirror, so a hand-edited region fails the same
   way a hand-edited `CLAUDE.md` does. Fail closed: a marker naming a fragment that does not
   exist, an unclosed marker, or a fragment no template includes is an error, not a skip.
4. **A required-set spec** asserting every directory under `templates/` includes every fragment
   in the required set, over `readdir` rather than over a hand-listed subset. This is what fixes
   the four thin templates: they acquire the missing sections because the gate demands them, not
   because someone remembered.
5. **Rescope the two subset-scoped assertions** at `template.spec.ts:367` and `:467` onto the
   same `readdir` list once the fragments exist.

Fragments to extract, and no others in this PRD: the escape hatch (`framework-blocks-you`), the
asset MCP loop, the sculpt loop, look-at-it-and-budget-the-look including the WebGPU capture
recipe and the `xvfb-run` trap, and the `ctx` surface table.

The generated project still receives one flat self-contained `AGENTS.md` and one `CLAUDE.md`.
The user's agent never resolves an include; composition happens in this repository, before ship.

## 3. Acceptance

Executable, in order. Each pasted with its real output into
`docs/verification/prd-151-shared-agent-docs-<date>.md`.

| # | Command | Required result |
| --- | --- | --- |
| 1 | `pnpm sync:agents` | writes the expanded regions; `git diff` shows the four thin templates gaining the missing sections |
| 2 | `pnpm sync:agents --check` | exit `0` on the synced tree |
| 3 | edit one expanded region by hand, re-run #2 | **fails**, naming that file |
| 4 | delete a `<!-- shared: … -->` marker from one template, run the required-set spec | **fails**, naming template and fragment |
| 5 | point a marker at a fragment that does not exist, run `pnpm sync:agents` | **fails** with the unknown fragment name |
| 6 | `pnpm test` | exit `0` |
| 7 | scaffold each template, read the generated `AGENTS.md` | one flat file, no marker comments surviving into the project |

Steps 3, 4 and 5 are not optional. A gate nobody has watched fail is a gate nobody has tested.

## 4. What this does not claim

Not that the seven templates should say the same thing overall. Genre-specific prose stays
hand-written per template, and near-duplicate prose that names a template's own files —
`racing`'s `src/track/`, `shooter`'s wave contract — is left alone rather than forced into a
fragment with substitutions. Only rules that are word-for-word universal move.

Not that any agent reads better because of this. Nobody has measured whether an agent scaffolded
into `racing` builds a better game once it is told how to look at one; that would be a sweep, and
this PRD does not run one.

Not a change to what the scaffolder does. `renderTemplate` still copies a template directory
verbatim; composing at scaffold time was considered and rejected, because it breaks the property
that the template directory is exactly what ships and rewires every spec that reads
`templates/*/AGENTS.md` directly.

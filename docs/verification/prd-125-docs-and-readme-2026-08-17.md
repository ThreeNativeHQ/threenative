# PRD-125 docs and README overhaul — acceptance run — 2026-08-17

Every criterion in PRD-125 §8, executed on 2026-08-17 against the working tree, with the output
pasted. No physical-device, mobile-readiness, or stranger-usability claim is made by this file.

**Most of this PRD was already satisfied by the tree.** The README rewrite, the LOC table move,
the tarball untracking and the retention document landed with the batch's low lane on 2026-08-16
(`cc63a26`) without the PRD's status line being updated — it still read `NOT STARTED`. What was
genuinely open was criterion 1, and it was open for a reason worth recording.

## The one real defect, and it was in the checker

`pnpm check:docs` exited 1 with:

```
Malformed Markdown link in docs/PRDs/batch-26-08-16/PRD-125-docs-and-readme-overhaul.md:
missing closing ')'
```

The line it choked on is PRD-125 §7 itself — the sentence specifying that the checker must skip
code:

> **Skip fenced code blocks.** A shell snippet inside ``` fences can contain `](` — this very
> document does.

`stripFencedCodeBlocks` was implemented and worked. **Inline backtick spans were not stripped at
all**, and that sentence puts a literal `](` inside one. So the checker read the requirement
describing itself as a malformed link and failed the tree.

`blankInlineCodeSpans` now blanks inline spans after fences are stripped, preserving character
positions and newlines so error offsets stay true. It honours CommonMark's rule — a run of N
backticks is closed by the next run of exactly N — and leaves an unclosed run alone rather than
swallowing the rest of the file.

## What the fixed checker then found

Five broken links, all the same defect: **PRD-129 was archived to `docs/PRDs/done/` and no inbound
reference was repaired.**

```
docs/PRDs/batch-26-08-16/PRD-125-docs-and-readme-overhaul.md -> PRD-129-licensing-and-the-studio-split.md
docs/PRDs/batch-26-08-16/README-HIGH-COMPLEXITY.md -> ./PRD-129-licensing-and-the-studio-split.md
docs/PRDs/batch-26-08-16/README-LOW-COMPLEXITY.md -> ./PRD-129-licensing-and-the-studio-split.md
docs/PRDs/batch-26-08-16/README.md -> ./PRD-129-licensing-and-the-studio-split.md
docs/verification/prd-129-phase-3-2026-08-16.md -> ../PRDs/batch-26-08-16/PRD-129-licensing-and-the-studio-split.md
```

All five repointed at `done/`. This is the gate earning its place on its first working run: the
archive rule moved a file and the links rotted silently, exactly as the PRD predicted.

## Criteria

| # | Command | Result |
| --- | --- | --- |
| 1 | `pnpm tsx scripts/check-doc-links.ts` | **exit 0**, no output |
| 2 | `pnpm exec vitest run scripts/__tests__/check-doc-links.spec.ts` | **9 passed**, including `fails with the offending path for a broken link` and three new inline-span tests |
| 3 | `pnpm tsx scripts/count-loc.ts --check` | **exit 0**; `docs/benchmark/LOC.md` present; `grep -c "count-loc\|LOC-TABLE" README.md` → `0` |
| 4 | README contents | `pnpm create threenative` present (1); `VOID` count **0**; `pnpm dev` appears only inside the block labelled *"Run these commands inside the scaffolded project"*, and `README.md:101` states **"There is no root `pnpm dev`"** |
| 5 | README scripts vs root `package.json` | the only names not in `scripts` are `create`, `install`, `--filter` and `dev` — the first three are pnpm built-ins and `dev` is covered by #4 |
| 6 | honesty sentence | `README.md:84`: *"physical-phone framework/device evidence remains unverified, and no stranger has played a ThreeNative game for five minutes. This is not mobile-ready."* |
| 7 | `git ls-files 'docs/benchmark/sweeps/**/*.tgz' \| wc -l` | **0**; `git ls-files .linchpin .gauntlet \| wc -l` → **0** |
| 8 | retention | `docs/benchmark/SCREENSHOT-RETENTION.md` exists; tracked sweep PNGs **506, unchanged** — the decision is open, not taken |
| 9 | `pnpm typecheck` / `pnpm lint` / `pnpm test` | typecheck **exit 0**; lint **exit 0**, 202 warnings and **0 errors**; test **exit 0 — 133 files, 1195 tests passed**, 23.56 s |
| 10 | `git diff --stat` | one file under `docs/verification/` changed — `prd-129-phase-3-2026-08-16.md`, a §4 link repair, one line. **No PRD status header changed.** |

### One deviation from criterion 10, stated rather than hidden

`docs/PRDs/batch-26-08-16/README.md` gained a state table and lost its `PROPOSED — nothing in this
folder has run` line, which had been false since 2026-08-16. That is a batch index, not a PRD
status header, and it is not a §4 link repair. Recorded here because criterion 10 exists to stop
exactly this kind of quiet edit going unnoticed.

## What this does not prove

The README's job is to make a stranger able to start, and nobody outside this project has tried.
`PRD-080-five-minute-stranger-test.md` is the gate that would answer it, and it is blocked on a
person. A link that resolves can still point at the wrong file; the checker reads syntax and
existence, never meaning.

# PRD-357 search-path verification

Status: PARTIAL. C1-C4 are implemented, the approved duplicate cleanup is complete, and the
search-path, consumer, scaffold and budget controls are green. The required unfiltered test gate
still has one unrelated baseline failure in `negative-fixtures.spec.ts`; no runtime source was
changed to hide it. No owner checkpoint remains.

Source PRD: `docs/PRDs/agent-leverage/PRD-357-the-search-path-is-mostly-noise.md`

Delivery branch: `prd-357-search-noise-delivery`

Delivery base: `origin/main` at `8ea7b3a47c655415150df585f16a632575db3d28`

Pre-C4 delivery HEAD: `5d300c897cf29d107621b8f08995e3c0cddeab88`

## Acceptance evidence

| Criterion | Evidence |
|---|---|
| A1 | Removing `.claude/worktrees` from `.gitignore` made the search-path spec exit **1**: one assertion saw no ignore match and the other received `../../.git/info/exclude` instead of `.gitignore`. With the line restored, the final search-path suite passed 9/9. |
| A2 | Removing `.claude/worktrees/` from the root never-search sentence made the spec exit **1** for both `AGENTS.md` and its generated mirror. The final suite checks both clauses green. |
| A3 | Removing `.ignore` made its spec exit **1** with two `ENOENT` failures. The tracked file now lists `docs/PRDs/done/` and `CLAUDE.md`; sync, budgets, quality and primary-docs gates are green with it present. |
| A4 | The complete `origin/main` archive control passed: 383 files (1 skipped), 4,055 tests (3 skipped). The post-C4 delivery archive also passed: 384 files (1 skipped), 4,072 tests (3 skipped), with the five cached native executables. |
| A5 | Restoring the deleted 1,675,247-byte physics-puzzle alias made the cap check exit **1** and name the duplicate group `docs/benchmark/genres/physics-puzzle/reference.png`. The alias was moved back to ignored scratch and the clean cap check is green. |
| A6 | The exact headline commands now report 66,479,735 bytes for raw lane grep and 955,476 bytes for `docs packages`; the PRD §1 before values were 41,171,218 and 982,814. Scope is documented below. |

Red-control output is retained in ignored `artifacts/prd-357/` logs; the original mutations were
restored immediately. The final focused consumer/scaffold run passed 8 files and 138 tests,
including all 9 search-path tests, 12 evidence-budget tests, 4 sweep-judge tests, 55 scaffold
tests and 38 template tests.

## C4 full-tree cleanup

The complete pre-C4 manifest is [`prd-357-c4-duplicate-inventory-before.json`](prd-357-c4-duplicate-inventory-before.json).
It was taken from the Git index, not a filename search, and contains all 207 groups:

```text
tracked image paths: 819 before / 450 after
duplicate groups: 207
copies in groups: 576
redundant files: 369
redundant bytes: 103,754,237
```

The current [`prd-357-c4-duplicate-inventory.json`](prd-357-c4-duplicate-inventory.json) has zero
groups and zero duplicate bytes. Every planned removal matched its manifest SHA and size. The
cleanup removed 360 paths directly plus nine template icon aliases; the action-rpg icon blob was
moved to the shared source below. This is the full repository map, not a cleanup narrowed to the
two evidence roots.

The approved canonical rule keeps `docs/benchmark/genres/<genre>/reference.png` when present and
otherwise keeps the lexicographically first path. The platformer genre reference remains the
fixed input consumed by `scripts/make-sandbox.ts`; `examples/REFERENCE.png` and its two live
citation links now resolve to that canonical. The two affected rendered Markdown links found by
the link gate now resolve to `docs/benchmark/genres/exploration/reference.png` and
`docs/benchmark/genres/endless-runner/reference.png`. Historical archived prose remains text.

The ten identical template icons are now one packaged source at
`packages/create-threenative/template-assets/icon.png`. The scaffolder copies it after the
template tree copy to every generated `<target>/public/icon.png`. The template and scaffold specs
assert the source is byte-identical in every generated output; no generated icon is removed.

The consumer update covered 43 JSON manifests: 15 sweep capture indexes and 28 blind bundle
manifests. Their affected relative paths now reference retained canonical images. PRD-137 reveal
labels remain unchanged while its eight sources point to the labeled bundle images. `sweep:judge`
accepts a canonical PNG elsewhere in this repository, rejects paths outside the repository root,
and keeps generated bundles self-contained. A full Markdown-link check found no broken image links.

The exact proposal, including every group, path, SHA, size, canonical and consumer treatment, is
[`prd-357-c4-duplicate-proposal.md`](prd-357-c4-duplicate-proposal.md). It corrects the historical
baseline explanation: `git diff --name-status 8df60c0c 853fdee7` prints only the added PRD, so no
image changed between those commits. The earlier 206/359/101,679,076 result excluded roots; it was
not historical image drift.

## Duplicate budget

The post-C4 residual caps are measured all-blob caps, because the evidence gate also protects
non-image generated records:

```text
docs/verification duplicateBytes: 3,073
docs/benchmark    duplicateBytes: 1,007,187
```

Clean final check:

```text
evidence docs/verification: 550 tracked file(s), 45.3 MB, 0.0 MB duplicate across 5 group(s)
evidence docs/benchmark: 1584 tracked file(s), 104.4 MB, 1.0 MB duplicate across 146 group(s)
evidence budget: ok
```

Final A5 restoration proof:

```text
GATE_EXIT=1
evidence docs/benchmark: 1585 tracked file(s), 106.0 MB, 2.6 MB duplicate across 147 group(s)
evidence tree 'docs/benchmark' holds 2.6 MB of byte-identical tracked content across 147 group(s), over the 1.0 MB duplicate budget — largest group: 'docs/benchmark/genres/physics-puzzle/reference.png' stored 2 times, 1.6 MB redundant. Store it once and cite it; do not raise the cap
```

## New-base round controls

The required commands were captured immediately before and after C4 with
`NODE_NO_WARNINGS=1 FORCE_COLOR=0 pnpm --silent`. Each pair is byte-identical; the nonzero status
is the existing malformed round-14 Dispositions ledger, which was not edited in this lane.

```text
round:next       pre=1 post=1 cmp=0 sha=3219a7e1b7fcc0de8e8b6b24239bb76a8678a4797195a16c7e7029ed6ed0ceb3
round:deletions  pre=1 post=1 cmp=0 sha=6f2ca9cd6fe43622509bdad93c3a0dd3bd1de28f7563b09b459ab131517dc00c
alpha:bar        pre=2 post=2 cmp=0 sha=a9d6683ab5e03859257d99a7860e7997928e1576062095103b9574952164ec06
```

The full pre/post logs and exit captures are in ignored `artifacts/prd-357/c4-pre/` and
`artifacts/prd-357/c4-post/`; the comparison is `artifacts/prd-357/c4-round-compare.txt`.

## Required gates

The final focused run is green. Required repository gates after the consumer repair were:

```text
pnpm build                 EXIT 0
pnpm typecheck             EXIT 0
pnpm lint                  EXIT 0
pnpm sync:agents --check   EXIT 0
pnpm budgets               EXIT 0
pnpm quality               EXIT 0
primary-docs spec          EXIT 0
focused C4/search suite   EXIT 0 — 8 files, 138 tests
```

The unfiltered lane test remains honest and ungreen:

```text
pnpm test                  EXIT 1
4066 passed, 1 failed, 6 skipped tests
FAIL packages/playtest/__tests__/negative-fixtures.spec.ts > seeded page error fixture is observed red
expected exit code 1, received 2
```

The manager’s isolated same-file rerun passed 10/10, but the full lane failure is not part of this
PRD’s scope and no source was changed for it. The committed post-C4 archive used the same five
cached native executables as the origin control and passed:

```text
git archive HEAD                 final delivery commit
pnpm install --frozen-lockfile   EXIT 0
pnpm test                        EXIT 0
Test Files                       384 passed | 1 skipped (385)
Tests                            4072 passed | 3 skipped (4075)
```

The final archive log is `artifacts/prd-357/post-c4-archive-delivery-final-2.log`; it records the exact
HEAD and the five native executable hashes.

## A6 scope

The exact commands were run from this lane only:

```text
grep -rn "CharacterBody3D" . | wc -c       66,479,735
rg -n "CharacterBody3D" docs packages | wc -c 955,476
```

The raw grep ignores neither `.gitignore` nor `.ignore`; it traversed this lane’s ignored archive
scratch and counted binary matches in extracted `.git/index` files. Therefore the `.ignore` file
is not claimed to change that raw number. The `rg` measurement is limited to `docs packages`.

# PRD-357 search-path verification

Status: PARTIAL. C1-C3, the search-path specs, and the duplicate-byte measurement mechanism are
implemented. C4 image deletion remains blocked on the owner checkpoint; no evidence image has been
deleted. The exact owner proposal is [`prd-357-c4-duplicate-proposal.md`](prd-357-c4-duplicate-proposal.md),
backed by [`prd-357-c4-duplicate-inventory.json`](prd-357-c4-duplicate-inventory.json).

## Scope correction

The image inventory uses `git ls-files -s .`, not only the two evidence trees. It records all 207
original duplicate groups: 369 redundant paths and 103,754,237 redundant bytes. The earlier
206-group / 359-path / 101,679,076-byte output was a two-tree inventory and was not a baseline
change. `git diff --name-status 8df60c0c 853fdee7` contains only the added PRD, so there were no
image changes between the PRD's measured commit and the lane baseline `853fdee7`.

The proposal covers the ten template `public/icon.png` copies and the `examples/REFERENCE.png`
copy explicitly. The icon plan moves one existing 5,925-byte blob to
`packages/create-threenative/template-assets/icon.png`, adds a copy step after the existing
template copy, and retains `public/icon.png` in every generated project. The platformer-reference
plan keeps `docs/benchmark/genres/platformer/reference.png`, the fixed path consumed by
`scripts/make-sandbox.ts:246-254`, and updates citations before removing aliases. No package or
image cleanup was executed before approval.

## Red controls

Each mutation was restored immediately and recorded with a reliable subprocess exit capture.

| Criterion | Mutation and observed result |
|---|---|
| A1 | Removed `.claude/worktrees` from `.gitignore`; `scripts/__tests__/search-path.spec.ts` exited **1**, with two failures. One reported `expected undefined to be defined`; the other reported `Expected: ".gitignore"`, `Received: "../../.git/info/exclude"`. |
| A2 | Removed `.claude/worktrees/` from the root never-search sentence; the spec exited **1** with one failure: the isolated sentence did not contain ``.claude/worktrees/``. |
| A3 | Removed `.ignore`; the spec exited **1** with two `ENOENT` failures opening `.ignore`. |
| A4 | Force-added `docs/benchmark/sweeps/fps-2026-08-17/AGENTS.md`; `scripts/__tests__/evidence-budget.spec.ts` exited **1**. It named the tracked path and the sweep-instruction finding. The index entry was removed; the on-disk file remains ignored. |
| A5 (provisional) | Added one index/worktree probe copy of `docs/benchmark/genres/physics-puzzle/reference.png`; `pnpm tsx scripts/check-evidence-budget.ts` exited **1** and named `docs/benchmark/.prd-357-a5-probe.png` as the largest group. The probe was restored. Final restore-deleted-blob proof is pending C4 approval. |

The A5 probe output was:

```text
evidence tree 'docs/benchmark' holds 78.8 MB of byte-identical tracked content across 316 group(s), over the 77.2 MB duplicate budget — largest group: 'docs/benchmark/.prd-357-a5-probe.png' stored 13 times, 19.2 MB redundant. Store it once and cite it; do not raise the cap
EXIT=1
```

## Green checks so far

Commands run after the scope correction:

```text
pnpm install --frozen-lockfile       exit 0 (pnpm 10.25.0; lockfile up to date)
pnpm sync:agents                    exit 0 — agent docs synced: 19 mirrors, 1 written
pnpm sync:agents --check            exit 0 — agent docs in sync: 19 CLAUDE.md mirrors
pnpm typecheck                      exit 0
pnpm lint                           exit 0 — Biome checked 1,929 files; 577 pre-existing warnings
pnpm budgets                        exit 0 — evidence and retention budgets ok
pnpm quality                        exit 0 — advisory findings only
pnpm tsx scripts/check-evidence-budget.ts exit 0 — evidence budget: ok
scoped Biome check                  exit 0 — 3 files checked, no fixes
```

`pnpm exec vitest run scripts/__tests__/search-path.spec.ts scripts/__tests__/evidence-budget.spec.ts scripts/__tests__/primary-docs.spec.ts`
is green:

```text
Test Files  3 passed (3)
Tests       28 passed (28)
EXIT=0
```

The standalone primary-docs gate also passed: `scripts/__tests__/primary-docs.spec.ts`, 7 tests,
exit 0.

The full lane test, with the five cached native executables provisioned from the manager control,
also passed:

```text
pnpm test
Test Files  381 passed | 1 skipped (382)
Tests       4032 passed | 3 skipped (4035)
EXIT=0
```

The evidence gate currently reports these provisional per-tree caps and measurements after C3:

```text
evidence docs/verification: 668 tracked file(s), 66.1 MB, 14.5 MB duplicate across 44 group(s)
evidence docs/benchmark: 1823 tracked file(s), 180.6 MB, 77.2 MB duplicate across 316 group(s)
evidence budget: ok
```

The generated compact inventory is 214 lines; its exact path is ignored by Biome so formatting does
not expand this evidence artifact beyond the repository's 1,000-line evidence limit.

## Archive controls

The manager ran the complete pre-untracking control from `origin/main` at
`8ea7b3a47c655415150df585f16a632575db3d28`, including the five cached native test executables.
The full log is `/home/joao/projects/threenative/threenative-engine/.linchpin/prd-357-manager-control.log`;
the extracted archive is `artifacts/prd-357/manager-archive-control`. Result:

```text
COMMAND ['pnpm', 'test']
EXIT 0
383 passed / 1 skipped files
4055 passed / 3 skipped tests
```

The same native cache must be provisioned for the post-untracking archive and lane `pnpm test`.
At commit `7ae37434`, the first post-change archive invocation exited 1 in two playtest
negative-control tests (`e2e-runner.spec.ts` and `generated-shooter-input.spec.ts`); its log also
reported private-Xvfb listener collisions while another archive process was active. A fresh archive
extraction after that process ended, with the same five native hashes, passed:

```text
git archive HEAD -> artifacts/prd-357/post-untracking-archive-rerun
pnpm install --frozen-lockfile       exit 0
pnpm test
Test Files  381 passed | 1 skipped (382)
Tests       4032 passed | 3 skipped (4035)
EXIT=0
```

The initial failed log is `/tmp/prd357-post-archive.log`; the accepting rerun log is
`/tmp/prd357-post-archive-rerun.log`. Both archive scratch trees are inside this lane's ignored
`artifacts/prd-357/` directory.

## Headline measurement (A6)

The PRD's historical measurements at `8df60c0c` were:

```text
grep -rn "CharacterBody3D" . | wc -c       41,171,218
rg -n "CharacterBody3D" docs packages | wc -c 982,814
```

Current isolated-lane measurements, run with the exact commands from this directory, are:

```text
grep -rn "CharacterBody3D" . | wc -c       25,557,947
rg -n "CharacterBody3D" docs packages | wc -c 955,089
```

The raw grep is confined to this lane but ignores neither `.gitignore` nor `.ignore`; it traversed
lane artifacts and reported binary matches in the two extracted archive `.git/index` files. The
`rg` command is limited to `docs packages`. The `.ignore` change therefore does not claim to alter
the raw grep number.

## Pre-checkpoint observations

These were captured with `NODE_NO_WARNINGS=1 FORCE_COLOR=0 pnpm --silent` and include the exact
command output plus exit status. They are the byte-identical observations to compare after the
owner approves C4 and the consumer/reference updates are made.

`pnpm round:next` — exit 0:

```text
stop round 13
Stop condition recorded: budget — the session's scope was the instrument, and the instrument changes are landed with gates. Resolve it before resuming the round.
```

`pnpm round:deletions` — exit 1:

```text
Error: Round 13 names missing archive '/home/joao/projects/threenative/threenative-engine/.worktrees/prd-357-search-noise/unmeasured — no build ran this round'.
```

`pnpm alpha:bar` — exit 1:

```text
A1  fail        (3 of 11 publishable packages are absent)
A2  pass
A3  pass
A4  pass
A5  pass
A6  deferred
A7  fail        (generated table does not match this run)
0 of 7 rows unmeasured, 2 failed, 1 deferred. Not alpha.
```

The normalized output hashes are, respectively:

```text
round:next       513d4253d9ec9f197a469286298e9eb00bc710c5c6e89ab528a616f7a14b1072
round:deletions  7ffe2975f3ceb6f1f14d372c0d619b166c2f0d4a7c53b769f7460f8cce4da865
alpha:bar        ae8ed47de18a36329505a695e583efb92144925d933688ef73ab4058c2397d29
```

## Remaining delivery gates

`pnpm lint` now exits 0 after the generated inventory was added to Biome's generated-evidence
ignore list. The run checked 1,929 files and reported 577 pre-existing warnings in unrelated
example files, including `examples/vfx-gallery/src/scenes/Gallery.ts`; no changed PRD-357 file
appears in those diagnostics.

Still required before the manager can call the PRD complete: the post-checkpoint A5
restore-deleted-blob proof. C4 remains PARTIAL until the owner approves the exact 207-group map; no
tracked evidence image is removed in this lane.

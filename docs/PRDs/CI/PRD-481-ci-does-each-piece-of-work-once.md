---
prd_contract: v1
---

# PRD-481 — CI does each piece of work once

**Status:** IN PROGRESS — phase 3 complete, phase 2 in progress, phase 1 blocked on the merge queue
**Complexity:** 5 (HIGH)
**Owner:** CI tooling
**Depends on:** None ([PRD-480](PRD-480-linux-ci-runs-on-the-owner-machine.md) and
[PRD-380](PRD-380-a-pull-request-never-starves-the-runner-pool.md) are complementary, not prerequisites)

Complexity: 5 → MEDIUM (about 8 files +2, verdict reuse is new logic +2, GitHub API +1); risk override → HIGH
because a wrong reuse key passes an untested tree.

## Context

Audit of `ThreeNativeHQ/threenative` Actions history from 2026-09-18 to 2026-10-02: 1,651 runs, 35,168 jobs,
115.5k runner-minutes (about 58k a week). Waste by bucket:

| Bucket | Runner-min (14 days) | Evidence |
|---|---|---|
| PR runs cancelled by a newer push | 43.1k (37%) | 349 runs, median 25 min before cancellation; 56 of the cancelling pushes were Markdown-only (37 PRD ticks) |
| Same tree tested again on the way to `main` | 10.1k | 27 promotion-PR reruns; 9 of 10 `push: main` runs repeat a tree the promotion PR passed (36095260574, 36134527157, 36960030428) |
| Nightly on an unchanged tree | 4.2k | 14 of 15 scheduled runs; `af60e210` red 7 nights running (36230464827 to 36847832850) |
| Runs still going after the PR merged or closed | 5.0k | 41 runs; 36372446379 ran 382 min after merge |
| Pipeline cache verification on unrelated PRs | 2.4k | android-arm64 ABI job, 31 min median, 41 runs; still lists dead branch `feat/prd-368-persistent-pipeline-cache` |

Within one full run (37043413533):

- The workspace dist compiles about 9 times. Every consumer `needs: scope` only, so all miss the cache
  `build-artifacts` saves (`.github/actions/workspace-dist/action.yml:54`, `ci.yml:953`). That is 71–95 s each.
- Shards are mis-sized. `template-nonvisual (shooter)` takes 967 s in one shard, `rain` 654 s and
  `sailing` 542 s, while `starter` is split into three ~210 s shards that each pay about 90 s of setup
  (`ci.yml:730-747`). `test-unit (3/3)` takes 605 s against 340 s for 1/3 (`ci.yml:206`).
- `test-native` compiles the Linux host every run. Its cache key hashes `ci.yml` (`ci.yml:~354`), and
  `develop` never runs CI on push, so no PR ever restores a shared cache. Three PRs each hold a 1.35 GiB copy.

Already owned elsewhere, not repeated here: the queue (PRD-480); release proof on PRs, the native
matrix on PRs, and cancelling merged-PR runs (PRD-380 phases 1–3). The ~3.5k/week of
`Native runtime release` PR runs is PRD-380 phase 1.

**Why "Never cache test verdicts" exists:** PR #33 (2026-09-01) let `golden-path` skip on a hash of a
hand-listed set of inputs. PRD-373 (2026-09-11) removed it, because a key that misses one input
reuses a stale pass. The same failure happened earlier with `native-platforms` path filters, which left three reds on
`main`. The danger is a partial key, not reuse itself.

## Solution

**Tree reuse.** The `scope` job computes the tree SHA of the candidate it checked out (for a PR, the
merge ref). It then looks for a completed, successful `CI` run whose checked-out candidate has that
exact tree, found through the Actions API, never by a name a job can write. On a hit it emits
`selection: reused` with the source run id. Every board job skips, and `ci-required` passes only when
the source run's `ci-required` passed. The key is the whole tree: it contains every source file, the
lockfile, the workflows and the scripts, so there is no input to forget.

- **Applies to:** the `develop → main` promotion PR, `push: main`, re-pushes and rebases with an
  unchanged tree, and the merge group below.
- **Never applies to:** `workflow_dispatch`, which stays an explicit full audit. Nightly reuses
  Monday to Saturday; Sunday's nightly is always full, to catch drift in the runner image and network
  dependencies.

**Merge queue on `develop`.** `ci.yml` gains `merge_group`. GitHub then tests the exact result a merge
would produce before it lands, which closes today's gap: two PRs merged back to back put a tree
on `develop` that no run tested. When `develop` has not moved, the merge group's tree equals the
PR's tested tree, and tree reuse makes the queue instant.

**Work once per run.** Consumers download the `build-artifacts` dist instead of rebuilding it. The
native host cache key drops `ci.yml`, and a build-only job on `develop` pushes warms it. Shards are
sized to land at about 4–6 min each.

**Pushes that cancel a running board.** With PRD-480 the board finishes in about 15–20 min instead of
40+, which shrinks the cancellation window. The rule that cuts the rest is in PRD-482.

## Acceptance Criteria

- [ ] AC-1 [shared]: proof: the audit script in the PR body re-run over the 7 days after the last phase lands.
  Weekly runner-minutes outside the PRD-380 and PRD-480 buckets drop by at least 7.5k against the
  2026-09-18 to 10-02 baseline. Evidence: pending.

## Blocked on

- Merge queue enabled on `develop` in the repository ruleset — unblocked by João (org admin).

## Integration Ledger

| Capability | Reachable consumer/trigger | Replaces / disposition | Evidence |
|---|---|---|---|
| Tree reuse | `scope` job → `scripts/ci-change-scope.mjs` → `selection: reused` → `ci-required` | Replaces nothing; full board stays the miss path | Phase 1 |
| Merge queue | `merge_group` event → `ci.yml` | `develop` merges go through the queue instead of direct squash | Phase 1 |
| Shared dist | `build-artifacts` upload → consumers' download step | Per-job `workspace-dist` builds are deleted | Phase 2 |

## Decisions

- 2026-10-02 (João): verdict reuse is allowed when it stays reliable. Reuse is keyed only on the
  whole-repo tree, recorded only by a successful CI run, and never on a hand-listed set of inputs. AGENTS.md
  "Never cache test verdicts" becomes "Reuse a verdict only for an identical whole-repo tree that CI
  itself passed".

## Execution Phases

#### Phase 1: The same tree is tested once

**Status:** NOT STARTED
**Files:** EDIT `scripts/ci-change-scope.mjs`, `scripts/ci-required.mjs`, `.github/workflows/ci.yml`
(`merge_group`, schedule weekday/Sunday split), `AGENTS.md` (+ mirror), `scripts/__tests__/ci-structure.spec.ts`.
**Implementation:** lookup by tree via `gh api` with the job's `GITHUB_TOKEN` (`actions: read`). A miss,
an API error or an ambiguous match falls back to the full board. Fail closed means run the work, never
skip it.

- [ ] A promotion PR whose tree already passed reports `reused`, under 2 min. proof: CI run id plus the
  source run id it cites.
- [ ] A tree that changed by one byte runs the full board. proof: `pnpm exec vitest run scripts/__tests__/ci-needs.spec.ts`,
  with a case where the trees differ by one file and a case where the API errors.
- [ ] `develop` merges go through the merge queue, and an unchanged-base merge group reuses. proof: merge
  group run id.

#### Phase 2: Each run does each piece of work once

**Status:** NOT STARTED
**Files:** EDIT `.github/workflows/ci.yml`, `.github/actions/workspace-dist/action.yml`,
`.github/workflows/native-platforms.yml` (the Linux host built once), `scripts/__tests__/ci-structure.spec.ts`.

- [ ] Only `build-artifacts` compiles the workspace dist; every other job downloads it. proof: a full CI run
  where no consumer's log contains the dist build step.
- [ ] The native host cache restores on a PR from a `develop`-warmed key. proof: a `test-native` log with a
  cache hit and a build time under 60 s.
- [ ] No template or unit shard runs longer than 6 min. proof: per-job durations of one full CI run.

#### Phase 3: Triggers fire only when they prove something

**Status:** COMPLETE
**Files:** EDIT `.github/workflows/pipeline-cache.yml`, `.github/workflows/integration-*.yml`,
`scripts/__tests__/ci-structure.spec.ts` (workflow-file allow-list, so per-branch workflows cannot land
unreviewed).

- [x] `pipeline-cache.yml` fires only on paths its proof reads, with no dead branch. proof:
  `pnpm exec vitest run scripts/__tests__/ci-structure.spec.ts`. Evidence: 2026-10-02, 126 passed;
  the new assertion fails on the pre-change file and passes after `feat/prd-368-persistent-pipeline-cache`
  is gone from `push.branches`.
- [x] Integration workflows skip drafts and fire once per commit. proof: `pnpm exec vitest run
  scripts/__tests__/ci-structure.spec.ts`, rejecting a `push` plus `pull_request` pair. Evidence:
  2026-10-02, 126 passed; the pair case is a fixture in the spec and the assertion fails on the
  pre-change files. `integration-csg`'s unfiltered `push` and `integration-decals`' per-branch `push`
  (pull request #394 merged 2026-10-02) are both removed; every integration job now carries
  `!github.event.pull_request.draft`, and each trigger gained `ready_for_review` so that guard cannot
  silence the lane.

# PRD-373 — Selective CI and develop-to-main promotion

Status: NOT STARTED

## Outcome

Keep feature PRs small and inexpensive to verify. Merge them into `develop` after the checks
their changes require. Run full integration verification daily and before promoting a fixed
candidate to `main`. Main remains the fully qualified branch.

This PRD is an implementation brief. No workflows, branches, repository settings or agent
instructions have been changed as part of writing it.

## Why

Three inspected successful CI runs took 67–80 minutes and scheduled 45 jobs each. Initial jobs
waited 6–18 minutes to start; one four-second merge gate waited 22 minutes for a runner.
[Example run](https://github.com/ThreeNativeHQ/threenative/actions/runs/34549880812).
The existing classifier only distinguishes narrow prose-only changes from full verification.
Reduce unnecessary execution and queue pressure; increasing PR size is not the solution.

## Implementation order

### 1. Select checks from the complete PR diff and its dependencies

**Progress:**

- [ ] Implemented and wired: `scripts/ci-change-scope.mjs` classifies from the merge-base diff (deletions and both rename sides)
- [ ] Required test green
- [ ] Observed red recorded, then restored green
- [ ] Verified on a real PR, not only locally


Extend `scripts/ci-change-scope.mjs`; keep one classifier used by CI and local verification.
Compare against the target branch's merge base, including deletions and both sides of renames.
Emit selected check families and a readable reason for each selection or exemption.

| Change | Required feature-PR checks |
| --- | --- |
| Inert prose | Documentation checks |
| Agent instructions and generated mirrors | Documentation, mirror synchronization and relevant contract checks |
| Isolated website | Website build, types and tests |
| A template or package | Its checks plus affected consumers, including native where applicable |
| Shared runtime, native, dependencies, CI configuration or unknown impact | Broad affected verification; full suite when safe narrowing is unproven |

Use explicit, tested dependency rules. Native impact includes shared `core`, `playtest`,
scaffolding, native fixtures, build inputs and dependencies, not just `packages/runtime-native/`.
The native workflow records previous regressions caused by that directory-only filter.
Unresolved diffs, unmapped paths and invalid classifier output must select full verification or
fail visibly. Preserve an explicit manual full-run option. Do not use an LLM to decide exemptions.

### 2. Wire selection into protected feature PRs targeting develop

**Progress:**

- [ ] Implemented and wired: `ci.yml` and `native-platforms.yml` consume the same selection; `ci-required` verdict always evaluated
- [ ] Required test green
- [ ] Observed red recorded, then restored green
- [ ] Verified on a real PR, not only locally


Update `.github/workflows/ci.yml` and `.github/workflows/native-platforms.yml` to consume the
same selection. Run only selected jobs and matrix entries. Replace native's independent
classification with the caller's validated decision; manual invocation defaults to full.

Introduce one always-evaluated required verdict, `ci-required`, that verifies the classifier
succeeded and every selected job succeeded. Selected jobs that failed, were cancelled, are
missing or unexpectedly skipped must block merging. Only explicit unselected jobs are exempt.
Remove unconditional dependency edges that make this verdict wait for unselected native jobs
or advisory reporting. Require the verdict on `develop`; do not retain branch rules expecting
individual jobs that intentionally do not run.

Keep checkout/install/build reuse where it helps. Consolidate tiny jobs and tune matrix
concurrency using observed queue pressure; do not add shards merely to make individual jobs
shorter. Preserve diagnostics when one selected job fails.

### 3. Add daily qualification and protected promotion to main

**Progress:**

- [ ] Implemented and wired: daily qualification job and protected `develop` -> `main` promotion
- [ ] Required test green
- [ ] Observed red recorded, then restored green
- [ ] Verified on a real PR, not only locally


Feature branches start from `develop`; squash their focused PRs into `develop`. Capture a fixed
`develop` SHA for each daily full run and each promotion candidate. Every job, including reusable
workflows, must execute that same candidate. A scheduled workflow must explicitly check out
`develop`, because its workflow definition is loaded from the default branch.

Open a promotion PR from a fixed candidate branch into `main`. Run the full suite against the
proposed combined result before merging. A candidate or base change invalidates the relevant
proof. Use merge commits for promotions to preserve ancestry between the long-lived branches.
Main accepts fully verified promotions; emergency fixes must receive full checks and flow back
into `develop`.

Avoid running the full suite twice solely because a promotion emits both PR and push events.
Reconcile this with `npm-release.yml`, `native-release.yml`, `release-candidate.yml` and their
existing verification helpers: release authorization must still identify the exact main commit
and the tested inputs/artifacts. A changed SHA is not automatically equivalent proof. Any reuse
needs a tested provenance handoff binding the successful candidate, final merge result and
artifact digests; missing or mismatched proof requires fresh verification. Until that handoff
works, retain the existing release gate rather than weakening it to save a run.

Let daily full runs finish; do not cancel them on every new develop commit. Record the tested
SHA and failures in the existing Actions summary. Fix integration failures before promotion.

### 4. Improve caches without reusing stale products or test verdicts

**Progress:**

- [ ] Implemented and wired: caches keyed so no stale product or test verdict is reused
- [ ] Required test green
- [ ] Observed red recorded, then restored green
- [ ] Verified on a real PR, not only locally


Audit the existing workspace-dist, pnpm, browser, compiler and Android caches before adding
anything. Reuse existing composite actions. Key dependency caches by lockfiles and toolchain;
key native products by platform, architecture, compiler/SDK, configuration and relevant inputs.
Compiler object caches may reuse compatible objects across source revisions; complete build
products require all build inputs to match.

Preserve the workspace cache's restoration of generated files outside `dist`. Repack templates
when their shipped files change even if compiled package bundles are reusable. Validate required
files and archive contents after restoration. Never treat a cache hit as a passing test or use
PR-controlled cache data to authorize a release.

Measure cold and warm runs, cache hit/miss, queue delay and execution duration separately in
existing Actions summaries or the implementation PR. Compare equivalent candidate workloads.

### 5. Update instructions, local commands and repository settings together

**Progress:**

- [ ] Implemented and wired: instructions, local commands and repository settings updated together
- [ ] Required test green
- [ ] Observed red recorded, then restored green
- [ ] Verified on a real PR, not only locally


Edit root `AGENTS.md` and affected nested `AGENTS.md` files to describe feature branches from
`develop`, selective PR checks, full promotion checks, local sync and worktree cleanup.
Generate `CLAUDE.md` mirrors with `pnpm sync:agents`; never edit them directly.
Make `ci:fast`/`ci:local` and documented verification commands agree with the classifier, while
preserving focused regression checks and an explicit full local option. A fast pass must not
claim platforms it did not execute.

Land the enabling workflow changes through the current protected-main flow first. Create
`develop` from qualified main and enable its protection before directing feature PRs there.
Update main protection and agent/tool defaults as part of the same cutover. Inventory existing
open PRs and active worktrees; migrate each deliberately without resetting local work or
mass-retargeting active PRs. Rollback restores full selection and the previous protected flow.

## Acceptance checks

- [ ] Real feature PRs for inert docs and isolated website changes omit native jobs, report why,
  and can merge into protected develop after their selected checks pass.
- [ ] Regression fixtures for shared-core/native dependencies, renames, deletions, lockfile
  changes and unknown paths select the necessary coverage. A selected failed, missing,
  cancelled or unexpectedly skipped job makes `ci-required` fail.
- [ ] A daily develop run executes one fixed SHA. A promotion cannot merge with failed or stale
  full checks. Release checks reject mismatched candidate/main/artifact provenance.
- [ ] Warm caches reduce measured execution time; changing a relevant input invalidates the
  affected cache or regenerates the product. Template-only changes produce current tarballs.
- [ ] Branch rules, workflow triggers, local verification and generated agent instructions
  agree. The implementation PR records actual queue/execution timings and the cutover result.

## Verification for implementation

Extend the existing scope, CI structure/needs/efficiency, local/fast runner and release-gate
tests instead of creating a competing harness. Add meaningful failing regression cases before
behavior changes. Test classifier and gate failure handling locally; use real docs, website,
shared/native and promotion PRs to confirm GitHub scheduling and protection behavior.

Run `pnpm typecheck`, `pnpm lint`, `pnpm test` and the affected workflow/release checks before
cutover. Run `pnpm sync:agents --check` after regenerating mirrors. Keep verification results
in this PRD or the implementation PR. Target an ordinary unaffected-native feature PR under
10 minutes; report queue and execution time separately rather than promising that every native
change meets that target.

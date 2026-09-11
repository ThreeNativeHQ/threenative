# PRD-373 — Selective CI and develop-to-main promotion

Status: PARTIAL — enabling implementation; protected-branch cutover and hosted acceptance pending

## Outcome

Keep feature PRs small and inexpensive to verify. Merge them into `develop` after the checks
their changes require. Run full integration verification daily and before promoting a fixed
candidate to `main`. Main remains the fully qualified branch.

The original brief below is retained. Implementation and verification observations, including the
staged administrative cutover that is not yet activated, follow the acceptance checks.

## Why

Three inspected successful CI runs took 67–80 minutes and scheduled 45 jobs each. Initial jobs
waited 6–18 minutes to start; one four-second merge gate waited 22 minutes for a runner.
[Example run](https://github.com/ThreeNativeHQ/threenative/actions/runs/34549880812).
The existing classifier only distinguishes narrow prose-only changes from full verification.
Reduce unnecessary execution and queue pressure; increasing PR size is not the solution.

## Implementation order

### 1. Select checks from the complete PR diff and its dependencies

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


## Implementation and staged activation — 2026-09-10

This is an enabling change through **main**, not a declaration that develop is protected or that
release provenance may be reused. No branch protection, repository default, existing PR target,
or other worktree was changed. The integration returned HTTP 403 for
`GET /repos/ThreeNativeHQ/threenative/branches/main/protection`; that is unavailable administrative
access, not evidence that protection is absent. Keep this PRD PARTIAL until the operational
acceptance cases below have actually passed.

### Implemented contract

- The dependency-free classifier emits a versioned plan with a candidate SHA and a required or
  explicitly exempt reason for every coverage job. It resolves the complete merge base, includes
  both rename endpoints and deletions, rejects symlink/submodule exemptions, and falls back to full
  on missing/ambiguous Git data, unknown paths, shared consumers, or dirty local inputs.
- Develop-only exemptions are inert allowed prose; root/playtest agent mirrors plus their executable
  contract tests (other nested instruction consumers remain full); and isolated `site/` source/build/type/unit/browser checks. Dependency manifests,
  scaffolding/templates, core/playtest/physics, fixtures and native/CI/toolchain inputs select full
  until a narrower dependency closure is proven. Instruction checks share the lint job. Website
  dependency changes are full, not website-only.
- `ci-required` always evaluates, validates the plan and actual checkout, and rejects selected
  failed, cancelled, skipped, missing or unmapped job results. For PRs it also validates the exact
  proposed base/head parents of the checked-out merge commit. It does not wait for run-summary.
  Native selection is passed by the caller and validated, not independently guessed. Full includes
  desktop parity even without a label; exemptions cannot silently narrow a full promotion.
- Main PRs, main pushes, schedules and explicit manual CI dispatch are full. A scheduled run captures
  its source once and passes that immutable SHA to every worker and reusable native checkout and
  artifact identity. Until activation it stays on qualified main; after activation it captures
  develop. Ordinary PR runs supersede older runs; complete qualification is not cancelled when
  newer commits arrive. The large nonvisual matrix starts at max-parallel 4; tune it only from
  measured queue/execution behavior, without removing scenarios.
- After activation, main only accepts frozen `promotion/<full-head-sha>` or explicit `hotfix/`
  candidates through the new verdict. Release-candidate/native/npm authorization is unchanged:
  scheduled or PR success, an older main run, or a mismatched candidate/artifact is not release
  evidence. The final main-push full suite remains until an exact-source, exact-artifact handoff is
  implemented and verified; there is deliberately no speculative duplicate-run suppression.
- Both local commands report the same classifier. `ci:local --affected` executes selected local
  families; `--full` retains the existing full board and focused-job interface. `ci:fast` remains
  bounded and explicitly says it has not run native qualification.

### Cache audit

| Product/input | Reuse boundary and validation |
| --- | --- |
| pnpm store | Existing lockfile/package-manager keyed input store; installs and assertions still execute. It is not a test verdict. |
| Playwright Chromium | Resolved Playwright version, OS and architecture; runtime libraries are installed even on cache hits. |
| Workspace bundles | OS, architecture, exact Node version, workspace/root/package manifests, lock/catalog/patches, shared tsconfigs, source/build scripts and action implementation. Only `dist` is cached. |
| Published archives | Archive consumers always repack current files; bundle-only consumers explicitly opt out. Archives are never restored as cached verdicts or stale template products. Outside-dist core MCP output is restored before packing and its payload is checked. A real pack regression changes template bytes while leaving the bundle unchanged and reads the new bytes from the resulting tarball. |
| Complete Linux native products | Exact key only, no broad restore prefix. Includes native source/tests/build scripts/CMake/Cargo/configuration plus a fingerprint of the actual runner image, compiler, CMake, Rust, Node and installed system-library versions after prerequisite installation. Actual native builds/tests still execute. |
| Native compiler cache | Existing per-job namespaces, OS/architecture/configuration and ccache compiler/input validation; content-compatible object reuse, not a complete-product or test-result assertion. Existing per-build cache statistics remain. |
| Android SDK/Gradle/Cargo | Pinned Android 35/NDK version and OS/architecture for SDK payloads; existing Gradle-wrapper/build and Cargo-lock keyed dependency/compiler stores remain inputs to actual package/build/parity commands. No cached pass bypasses those commands. |
| Golden-path proofs | Removed. Selected golden-path verification executes again, including when compiled products are restored. |

The existing run summary now records API job-created → runner-start **queue** time separately
from runner-start → completion **execution** time, including the selected candidate and workflow
definition identities. Missing observations are unavailable, not zero. Bundle cache-hit and
restore/build/repack/validation elapsed time are reported separately from test verdicts. The API
read is report-only and cannot authorize or bypass the required verdict. Cold/warm equivalent-
workload measurements and protected-develop timings remain acceptance work, not claimed savings.

### Owner activation sequence (administrative access required)

1. Merge this enabling PR through the current protected-main checks. Require a successful full CI
   run on the exact resulting main SHA before creating the integration branch. Retain all existing
   main contexts during this transition; do not make a selective feature PR the first protection
   experiment.
2. Inventory `gh pr list --state open --json number,headRefName,baseRefName` and each owner's
   `pnpm worktree:status`. At implementation start, the open inventory was #167, #180, #183 and
   #189; refresh it rather than treating that list as a current migration instruction. None was
   automatically retargeted. Create develop at the qualified main SHA, protect it immediately,
   require `ci-required` with strict up-to-date checks and the intended review policy, and disallow
   force pushes/deletion. Do not open it for feature merges until protection is verified.
3. Keep main protected with full checks and strict up-to-date-base requirements, plus
   `ci-required`; allow merge commits for promotions so develop ancestry is retained. Main must
   never accept only the last develop feature's result. Keep the repository default main while
   changing agent/tool feature defaults explicitly: `git config threenative.integrationBranch
   develop` per migrated checkout and `gh pr create --base develop` for new features.
4. Only after protection and matching instructions/tool defaults are verified, set repository
   variable `TN_DEVELOP_CI_ENABLED=true`. This activates fixed-develop daily qualification and the
   main promotion/hotfix source rule together. Migrate remaining PRs individually with their
   owners; refresh their merge-base decisions and checks. Do not rewrite active worktrees.
5. Exercise real protected-develop prose, instruction, website and shared/native canary PRs. Inspect
   plan reasons, actual job execution and required-context behavior, including deliberate missing
   or failed selected checks. Record check URLs and queue/execution observations here before
   checking off acceptance. Run the same full workload cold and warm, including a template-only
   edit after a warm bundle cache, and compare archive payloads and full test verdicts.

### Frozen promotion and emergency flow

After a successful daily full run, use its **recorded candidate SHA**, not whatever develop points
at later. Verify that candidate still contains current main; merge main back to develop and
requalify when it does not. Create a new branch named `promotion/<that-full-40-character-SHA>` at
that exact SHA and open it against main. Do not push later develop commits onto that branch.
The PR full suite checks the combined merge result against the proposed main base. A changed
candidate gets a new frozen branch; a changed base requires new full evidence and strict protection
prevents the old result from satisfying an up-to-date merge. Merge with a merge commit and a
head-SHA match, never squash or rebase a promotion:

```sh
# QUALIFIED_SHA is copied from the successful daily run's candidate record, not origin/develop.
git fetch origin main develop
git merge-base --is-ancestor origin/main "$QUALIFIED_SHA"
git push origin "$QUALIFIED_SHA:refs/heads/promotion/$QUALIFIED_SHA"
gh pr create --base main --head "promotion/$QUALIFIED_SHA" --title "Promote $QUALIFIED_SHA" --body "Full combined-result qualification required; preserve merge ancestry."
# After this PR's exact combined result passes the protected full suite:
gh pr merge <PR_NUMBER> --merge --match-head-commit "$QUALIFIED_SHA"
```

An emergency `hotfix/` branch starts from main, gets the same complete qualification and review,
and flows back into develop with a merge commit before the next promotion. Never reuse the
hotfix's pre-merge proof to authorize a different final main SHA or published archive.

### Rollback

Set `TN_CI_FORCE_FULL=true` to disable all hosted selective exemptions immediately, and use
`pnpm ci:local --full`. Keep full required contexts protected throughout. To restore the prior
feature-to-main flow, first verify main protection and exact-main qualification, then set
`TN_DEVELOP_CI_ENABLED=false`, reset each migrated checkout's integrationBranch to main, and
retarget PRs deliberately with their owners. Do not delete or force-reset develop or other
worktrees. A reviewed revert of the enabling commit is the final fallback; release provenance
checks never relax during either rollback.

### Verification observations

- Local workspace `pnpm build`, complete `pnpm typecheck`, `pnpm lint`, `pnpm check:docs`
  and `pnpm sync:agents --check` passed. Mirrors were regenerated with `pnpm sync:agents`.
- The final focused run passed **279 tests across 15 existing suites**, including real-Git
  classifier/rename/deletion/shared-dependency fixtures, every unsuccessful selected-job state,
  merge-parent/frozen-promotion negatives, release authorization negatives, local runners,
  instruction consumers and real template-tarball regeneration. New behavior was tested red-green.
- Full local `pnpm test` ran docs/build and entered package tests, then exited 2 because Chromium
  was not installed for playtest's real orphan-cleanup check. This is **not a passing full suite**.
  The browser-equipped hosted verification and the enabling PR's complete platform CI must provide
  that evidence; no local result claims Android/iOS/macOS/Windows qualification.
- Pre-change observation: [run 34549880812](https://github.com/ThreeNativeHQ/threenative/actions/runs/34549880812)
  scheduled 45 jobs. API-created → start / start → completion were scope **43s / 12s**,
  typecheck **88s / 164s**, benchmark **89s / 131s**, and test-native **100s / 518s**.
  These are baseline job observations, not claimed savings or equivalent cold/warm measurements.
- Administrative cutover, full hosted qualification, representative protected-develop canaries,
  main-promotion protection and equivalent cold/warm timing acceptance remain **pending**. Do not
  check off the end-to-end acceptance boxes on the strength of these local regression tests.

- Cold-run follow-up: source-verification run 34564425607 passed 270 tests but could not load
  `primary-docs.spec.ts` before `@threenative/assets` was built. The instruction lane and matching
  local command now prepare their JavaScript workspace dependencies before those contracts;
  two new regressions failed before the fix and passed after it. This does not enable native
  compilation for instruction-only changes. The website types/build and 20 unit tests passed
  in that run; browser execution was blocked because the preceding failure skipped installation.

### PR #190 integration repair — 2026-09-11

Merged current main `7e6dffc1e7d67908d0ceb43388db45bb2d16964b` without dropping the
Android V8 source producer or restoring native label exemptions. The producer now follows the
validated full selection, checks out the captured candidate, and publishes the same candidate-keyed
artifact its consumer downloads; the NDK cache also retains the matching version and architecture.
The parity dependency regression permits additional producers while still requiring scope and the
web reference.

Reproduced the failed temp-directory guard and moved both CI fixtures to the registered cleanup
helper. Updated the package-inventory regression to inspect the composite action that now owns
fresh packing, while retaining the dynamic added/renamed package and literal-enumeration checks.
Updated the native protected-build assertion for the full selection; its executable negative tests
still reject missing, failed, skipped, and cancelled producers. Regenerated the retention index with
its generator after reproducing its stale-output failure; no evidence or budget was removed.

Local focused verification: 204 tests passed across seven CI/workspace/cleanup suites, and all 35
native-platform workflow tests passed. These are not a claim that the entire native runtime ran
locally: the unbuilt C++ executables fail closed here and require the hosted lane.

The previous full run's Android row `86-pointer-keyboard-events` failed because adb reported the
device offline while restoring user rotation (73 passed, one failed, 19 explicitly unsupported
rows). Its aggregate verdict also rejected a stale event-base/merge-parent pair. Neither guard was
weakened; a fresh full run on the synchronized branch must establish the final hosted result.

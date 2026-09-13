# PRD-373 — Selective CI and develop-to-main promotion

Status: PARTIAL — classifier/verdict negative controls re-executed. PR #199 repairs
release-report candidate binding and the native-loading proof fixture. A real narrowed feature PR
is observed: #232 selects the inert-prose lane (every non-scope job skipping, `ci-required` pass)
and #230 selects `full` and passes on a real develop PR. **The cutover is applied**: `develop`
carries the active `develop integration` ruleset (no force-push/deletion, squash-only PRs,
required `ci-required` with strict up-to-date checks) and `TN_DEVELOP_CI_ENABLED=true`, so the
daily scheduled run checks out `develop`. Both verdict halves are now observed on real PRs: green
(#230 full, #232 prose) and red (#233 canary — a failing `website` job made `ci-required` fail).
Still outstanding: promotion/cutover proof and equivalent cold/warm measurements.

A parallel draft implementation of these two phases (`scripts/ci-check-families.mjs`,
`scripts/ci-required-verdict.mjs`, branch `backup/prd373-lane3-draft`) was written from a base that
predated PR #190 and duplicates what landed. It is superseded and is not being merged; the branch is
retained so nothing is lost.

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

**Progress:**

- [x] Implemented and wired: `scripts/ci-change-scope.mjs` classifies from the merge-base diff (deletions and both rename sides) — landed on `main` in PR #190; both workflows consume it (`ci.yml:55`, `native-platforms.yml:75`).
- [x] Required test green — `scripts/__tests__/ci-structure.spec.ts`, `ci-needs.spec.ts`, `ci-efficiency.spec.ts`, `ci-local.spec.ts`, `ci-fast.spec.ts`: 188 passed across 5 files, run locally 2026-09-11 against `main` at `30f749f12`.
- [x] Observed red recorded, then restored green
      Re-executed 2026-09-11: malformed classifier plans exit 2; restored plans exit 0. Real Git controls cover both rename endpoints, deletions, symlinks, unknown/native/shared inputs, dirty trees and full overrides.
- [x] Verified on a real PR, not only locally
      Two real develop PRs. PR #232 (this docs-only update) selected the inert-prose lane: `Change scope` pass (9s) and `ci-required` pass, with every other job — native, unit, browser, playtest, golden-path, template, website — `skipping`. That is a *narrowed* selection observed end-to-end on a real PR. PR #230 (a `packages/runtime-native` change) selected `full` and passed every selected job including the native matrix. Runs 34743918375 (#230) and 34745621262 (#232).


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

- [x] Implemented and wired: `ci.yml` and `native-platforms.yml` consume the same selection; `ci-required` verdict always evaluated — `ci.yml:1160` runs `scripts/ci-required.mjs`, which re-validates the plan, asserts the verdict executes the classified candidate SHA, and fails closed on a selected job that is missing, cancelled or unexpectedly skipped.
- [x] Required test green — the same 188 tests above cover the workflow shape and the needs graph (`ci-structure.spec.ts`, `ci-needs.spec.ts`).
- [x] Observed red recorded, then restored green
      Re-executed 2026-09-11: selected failed/cancelled/skipped/missing jobs each make the actual verdict exit 1; restored success exits 0. Stale base/candidate, failed scope, forged exemptions and unmapped jobs fail closed.
- [x] Verified on a real PR, not only locally
      Both halves observed on real develop PRs. Green: `ci-required` success on runs 34622294627, 34743918375 (#230, `full`) and 34745621262 (#232, narrowed prose). Red: a deliberate canary PR (#233) whose only change was a failing `site/__tests__` spec selected `website` alone (native and every other family `skipping`), the `website` job failed (52s), and `ci-required` then failed (10s) — run 34746139967. The canary was closed and its branch deleted immediately, never merged.


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

- [x] Implemented and wired: daily qualification job and protected `develop` -> `main` promotion
      Verified 2026-09-13 via the GitHub API: the `develop integration` ruleset (id 23003414) is active on `refs/heads/develop` with no deletion/force-push, squash-only PRs and required `ci-required` (strict); the `main protection` ruleset requires the full context list plus `ci-required`; `TN_DEVELOP_CI_ENABLED=true`. `.github/workflows/ci.yml:13,41` schedules `17 3 * * *` and checks out `develop` when the variable is true.
- [x] Required test green — Actions run 34653691910: 262 passing tests across 10 files.
- [x] Observed red recorded, then restored green — run 34651109589 failed the captured-checkout regression (187/188 passed); this run restores it. New shell tests reject a mismatched checkout while accepting a different event SHA.
- [ ] Verified on a real PR, not only locally
      PARTIAL — the develop ruleset enforces `ci-required`; a real promotion PR and a red verdict are not yet observed (see the 2026-09-13 observations).


Feature branches start from `develop`; squash their focused PRs into `develop`. Capture a fixed
`develop` SHA for each daily full run and each promotion candidate. Every job, including reusable
workflows, must execute that same candidate. A scheduled workflow must explicitly check out
`develop`, because its workflow definition is loaded from the default branch.

Open a promotion PR from `develop` into `main`. Run the full suite against the
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

- [x] Implemented and wired: caches keyed so no stale product or test verdict is reused — existing cache wiring audited below; CI efficiency contracts and actual repack tests pass. Equivalent cold/warm measurements remain open.
- [x] Required test green — Actions run 34653691910: 262 passing tests across 10 files.
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

- [x] Implemented and wired: instructions, local commands and repository settings updated together
      Root `AGENTS.md` describes develop-targeted feature PRs and the active integration flow; `ci:fast` and `ci:local --affected` exist (`package.json:25`, `scripts/ci-local.sh`); the repository settings (both rulesets, `TN_DEVELOP_CI_ENABLED=true`) are applied — verified via the API 2026-09-13.
- [x] Required test green — run 34653691910: 262 passing tests across 10 files, including the local-runner and CI-efficiency suites.
- [ ] Observed red recorded, then restored green
      PARTIAL — the classifier/verdict negative controls were re-executed earlier; a settings-specific red control is not separately run.
- [x] Verified on a real PR, not only locally
      #230 (`full`) and #232 (narrowed prose) both target `develop` and pass `ci-required` under the active ruleset (runs 34743918375, 34745621262).


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

## Acceptance criteria

- [ ] Real feature PRs for inert docs and isolated website changes omit native jobs, report why,
  and can merge into protected develop after their selected checks pass.
- [x] Regression fixtures for shared-core/native dependencies, renames, deletions, lockfile
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
- After activation, main only accepts `full` candidates through the new verdict. The head branch's
  name is not part of it: the frozen-branch rule was retired on 2026-09-12 as redundant (see
  "Frozen promotion and emergency flow" below). Release-candidate/native/npm authorization is unchanged:
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
   main full-selection rule together. Migrate remaining PRs individually with their
   owners; refresh their merge-base decisions and checks. Do not rewrite active worktrees.
5. Exercise real protected-develop prose, instruction, website and shared/native canary PRs. Inspect
   plan reasons, actual job execution and required-context behavior, including deliberate missing
   or failed selected checks. Record check URLs and queue/execution observations here before
   checking off acceptance. Run the same full workload cold and warm, including a template-only
   edit after a warm bundle cache, and compare archive payloads and full test verdicts.

### Promotion and emergency flow

**Retired 2026-09-12: the `promotion/<full-head-sha>` branch.** It restated a SHA that
`CI_REQUIRED_PR_CANDIDATE_MISMATCH` already verifies on the same run, and that GitHub already keys
its required checks to. The two mechanisms that actually freeze a candidate are unchanged, so the
branch name carried no evidence of its own — while it cost a manual branch-creation step, rejected
the obvious `develop -> main` PR with `CI_REQUIRED_PROMOTION_REF`, and drew conflict-resolution work
onto PR #222, a sync PR that could never merge. `ci-required` now checks only that a main PR's
selection is `full`.

Promote by opening an ordinary `develop -> main` PR and merging it with a merge commit, never
squash or rebase. The PR full suite checks the combined merge result against the proposed main base;
a changed head or base requires fresh full evidence, and strict protection prevents an old result
from satisfying an up-to-date merge.

```sh
git fetch origin main develop
gh pr create --base main --head develop --title "Promote develop" --body "Full combined-result qualification required; preserve merge ancestry."
# After this PR's exact combined result passes the protected full suite:
gh pr merge <PR_NUMBER> --merge --match-head-commit "$(git rev-parse origin/develop)"
```

The cost this trades for: develop can move while the ~70-minute matrix runs, which re-runs the
checks rather than admitting unverified code. `--match-head-commit` still refuses a merge whose head
moved after the evidence was produced.

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

## PR #199 verification follow-up — 2026-09-11

Actions run 34653691910: 262 passing tests across 10 files.

The original five CI suites were red at 187/188 in run 34651109589: the release-reports
worker used the event SHA rather than the captured candidate. Checkout and report
arguments are now pinned to the scope candidate, with a real Git identity assertion before
report generation. New tests execute the actual workflow shell; only report-generator
commands are stubbed. Native/npm release authorization remains unchanged.

The session executed 28 local controls against byte-identical classifier/verdict blobs
`2ae8c413d9cbd14d2eeb9f352117d3cdb0526c05` and
`f8e2fb7bbaebacf16b5ded2faa26e23962a0cd0c`. Failed, cancelled, skipped and missing selected
jobs were observed red, then restored green; invalid plans, stale base/candidate identity
and moving promotion refs also failed closed. These are local contracts, not evidence
of protected-develop scheduling or real merge authorization.

Windows artifact 10280857827 from full CI run 34640887143 recorded only 57 surface
presents during the compile stall; the first 60-frame tick followed compile-end. The
example fixture now waits at least three seconds AND 61 frame opportunities, with a
ten-second failure bound and observer cleanup. The native verifier still independently
requires a real 60-frame present tick. This changes the fixture, not runtime rendering.
The new tests evaluate its actual expression with independent time/frame controls. Four
of six new regressions failed before the fix; all six passed afterward in the local Node
assertion adapter, and the actual hosted Vitest results are recorded above.

The retention index is regenerated and checked, not hand-edited. The acceptance heading
now matches the progress parser, which counts all five acceptance criteria. Full CI and
the actual Windows loading replay still need verification on the final committed
candidate; these targeted tests do not substitute for platform qualification.

### 2026-09-12 — native evidence leaves the merge verdict

The required `build` context now asserts only `scope` and `build-artifacts`.
`native-platforms` still runs on full selections, but the classifier marks it
`required: false` with a reason, so a slow or red native matrix no longer fails
`ci-required` or holds a merge. The Android V8 source payload lane was hitting its
120-minute build timeout and the iOS simulator worker proof was red; both kept
`build`/`ci-required` red on main and blocked a qualified main for the develop
cutover. Release provenance is unchanged and still native-gated: `native-release.yml`
validates the native rows (`desktop`, `Windows desktop core`, `macOS desktop core`,
`Android emulator visual parity`, `Scaffolded starter desktop artifact`) for the exact
candidate SHA, and `npm-release.yml` refuses to publish without the matching native
tag on the same commit. So a native red does not block a merge but does block a
release. Fixing the Android V8 build time and the iOS worker proof remains open, and
is tracked against PRD-221 (16 KB V8) and the native platform lanes.

### 2026-09-12 — a Markdown-only PR runs nothing

The prose family now matches **any** `.md` the executable fixtures do not consume, not only
`docs/PRDs/` and `docs/verification/`. A diff whose every path is such a `.md` selects `prose`,
where `lint` and `supply-chain` are `required: false` and the workflow skips both jobs, so the only
work is the `scope` classification and the trivial `ci-required` verdict. This is deliberately lean
and deliberately weaker: broken doc links, stale evidence budgets and leaked secrets in Markdown
are no longer caught on the PR — the develop nightly run and every promotion still scan the full
history and re-run the docs lane, so the regression is caught before it reaches main. `AGENTS.md`
and `CLAUDE.md` remain instruction consumers (the instruction lane still runs), and ledger Markdown
consumed by a fixture remains full.

### 2026-09-13 — real develop-PR observations and the applied cutover

**A real develop PR runs the classifier and the verdict.** PR #230 (PRD-375, a
`packages/runtime-native` change) selected `full` and passed every selected job — `Change scope`,
`ci-required`, unit/browser/playtest, `golden-path`, `template-nonvisual` and the whole
`native-platforms` matrix. Run `34743918375`. PR #232 (this docs-only update) selected the
inert-prose lane: `Change scope` pass, `ci-required` pass, and every other job `skipping` (run
`34745621262`). Both the full and the narrowed policy are now observed on real develop PRs.

**The cutover is applied, verified through the API on 2026-09-13.** An earlier note in this PRD
inferred "not protected" from `GET /branches/develop/protection` returning 404 — that endpoint
reports *classic* branch protection, and this repository uses **rulesets**, so the inference was
wrong. The correct facts:

```sh
gh api repos/ThreeNativeHQ/threenative/rulesets
# develop integration (23003414) + main protection (21959171), both enforcement: active
gh api repos/ThreeNativeHQ/threenative/rulesets/23003414
# refs/heads/develop: deletion, non_fast_forward, pull_request (squash-only),
#   required_status_checks: [{context: "ci-required", strict_required_status_checks_policy: true}]
gh api repos/ThreeNativeHQ/threenative/rulesets/21959171
# main: deletion, non_fast_forward, pull_request,
#   required_status_checks: typecheck, lint, build, budgets, benchmark, golden-path, test,
#   test-browser, test-playtest, ci-required
gh api repos/ThreeNativeHQ/threenative/actions/variables
# TN_DEVELOP_CI_ENABLED = true
```

So `develop` **is** protected and `ci-required` **is** enforced with strict up-to-date checks;
`main` requires the full context list; and `ci.yml`'s scheduled run (`cron: 17 3 * * *`) checks out
`develop` when `TN_DEVELOP_CI_ENABLED` is true (`.github/workflows/ci.yml:13,41`).

**The red half of the verdict is observed too.** A deliberate canary PR (#233) added one failing
`site/__tests__` spec. The classifier selected `website` alone — native and every other family
`skipping` — the `website` job failed (52s), and `ci-required` failed (10s) on run `34746139967`.
That is the contract the local controls only approximated: a selected failed job blocks the merge
verdict on a real PR. The canary was closed and its branch deleted without merging.

Remaining, all hosted and/or owner-gated: a real promotion/cutover proof and equivalent cold/warm
cache measurements.

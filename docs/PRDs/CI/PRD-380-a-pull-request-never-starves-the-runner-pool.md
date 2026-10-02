---
prd_contract: v1
---

# PRD-380 — A pull request never starves the runner pool

**Status:** NOT STARTED
**Complexity:** 6 → MEDIUM-HIGH (+1 workflow triggers, +1 reduced PR matrix, +1 scheduled janitor, +1 shared release concurrency, +1 guarded specs, +1 npm-release wiring).
**Owner:** CI release tooling.
**Problem:** The org's GitHub-hosted runner concurrency is small (roughly three runs at once) and it is consumed by matrices that a pull request does not need. On 2026-09-12 thirteen CI runs sat queued, five of them `main` pushes, while three heavy runs held the pool; a two-minute `build` join waited over an hour. Three multipliers: `native-release.yml` runs its macOS/Windows/Linux proof on **every** PR that touches one of four paths (including `native-platform-workflow.test.mjs`, which ordinary runtime-native PRs touch), `ci.yml` runs the **full** `native-platforms` matrix for any `selection == 'full'` PR, and nothing cancels a run whose PR has already merged, so dead runs keep holding runners. The owner's ask: pushing to a branch must not restart or stall the whole board.

Baseline: `develop`. [PRD-373](../done/PRD-373-selective-ci-and-develop-promotion.md) owns the selective-CI classifier and the develop→main promotion rule; this PRD narrows what the selection is allowed to spend a runner on. PRD-379 changes *how* `native-release` learns about CI completion; this PRD changes *what triggers* it.

## Decisions

- 2026-10-02 (João, via the CI audit): reshaped to the current PRD rules (proof on every box, no ceremony
  boxes, at most 3 phases). The old phase 4, one concurrency group for release proofs, folds into phase 1
  because it edits the same workflow. The janitor is a `pull_request: closed` trigger instead of a
  scheduled script. Linux native rows move to the owner's machine under
  [PRD-480](PRD-480-linux-ci-runs-on-the-owner-machine.md), so phase 2 is mainly about the hosted
  macOS, Windows and iOS legs. Measured 2026-09-18 to 10-02: native-release PR runs cost 7.0k
  runner-min, and runs still going after their PR merged or closed cost 5.0k.

### Phase 1 — The release proof stops running on every PR push

**Files:** `.github/workflows/native-release.yml`, `.github/workflows/npm-release.yml`,
`.github/workflows/release-candidate.yml`, `scripts/__tests__/native-release-proof.spec.ts`,
`scripts/__tests__/ci-structure.spec.ts`.

- [ ] Release proof never runs on an ordinary PR push. proof: `pnpm exec vitest run scripts/__tests__/native-release-proof.spec.ts`,
  which also asserts it still runs on a promotion PR, the `release-proof` label, manual dispatch and an npm `v*` release.
- [ ] At most one release proof holds runners at a time across branches. proof: `pnpm exec vitest run
  scripts/__tests__/ci-structure.spec.ts`, with a case asserting the shared concurrency group.

### Phase 2 — PRs run a reduced native matrix; the full matrix stays on main and nightly

**Files:** `.github/workflows/ci.yml`, `.github/workflows/native-platforms.yml`,
`scripts/__tests__/ci-efficiency.spec.ts`.

- [ ] An ordinary PR selection emits only the Linux native rows. proof: `pnpm exec vitest run scripts/__tests__/ci-efficiency.spec.ts`.
- [ ] `main` pushes, the nightly and `promotion/*` PRs keep the full matrix. proof: `pnpm exec vitest run
  scripts/__tests__/ci-efficiency.spec.ts`, which also asserts no label exempts it.

### Phase 3 — A merged or closed PR stops spending runners

**Files:** NEW `.github/workflows/ci-janitor.yml` (`pull_request: types: [closed]`, cancels the head
ref's queued and in-progress runs with `gh run cancel`), `scripts/__tests__/ci-structure.spec.ts`.

- [ ] Closing or merging a PR cancels its head ref's in-flight runs within a minute. proof: the janitor run id
  and the cancelled run ids on one merged PR.

## Acceptance criteria

- [ ] AC-1 [shared]: proof: the PRD-481 audit script over the 7 days after phase 3 lands. Native-release
  PR runs plus post-close runs fall from 12.0k to under 2k runner-min per 14 days. Evidence: pending.

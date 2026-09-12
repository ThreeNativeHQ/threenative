---
prd_contract: v1
---

# PRD-380 — A pull request never starves the runner pool

**Status:** NOT STARTED
**Complexity:** 6 → MEDIUM-HIGH (+1 workflow triggers, +1 reduced PR matrix, +1 scheduled janitor, +1 shared release concurrency, +1 guarded specs, +1 npm-release wiring).
**Owner:** CI release tooling.
**Problem:** The org's GitHub-hosted runner concurrency is small (roughly three runs at once) and it is consumed by matrices that a pull request does not need. On 2026-09-12 thirteen CI runs sat queued, five of them `main` pushes, while three heavy runs held the pool; a two-minute `build` join waited over an hour. Three multipliers: `native-release.yml` runs its macOS/Windows/Linux proof on **every** PR that touches one of four paths (including `native-platform-workflow.test.mjs`, which ordinary runtime-native PRs touch), `ci.yml` runs the **full** `native-platforms` matrix for any `selection == 'full'` PR, and nothing cancels a run whose PR has already merged, so dead runs keep holding runners. The owner's ask: pushing to a branch must not restart or stall the whole board.

Baseline: `develop`. [PRD-373](../production-readiness/PRD-373-selective-ci-and-develop-promotion.md) owns the selective-CI classifier and the develop→main promotion rule; this PRD narrows what the selection is allowed to spend a runner on. PRD-379 changes *how* `native-release` learns about CI completion; this PRD changes *what triggers* it.

### Phase 1 — The release proof stops running on every PR push

**Progress:**

- [ ] Callers wired and building: `.github/workflows/native-release.yml`, `.github/workflows/npm-release.yml`, `scripts/__tests__/ci-structure.spec.ts`, `scripts/__tests__/native-release-proof.spec.ts`
- [ ] Required test green: the release proof's PR trigger is label-gated (e.g. `release-proof`) or `workflow_dispatch`-only, and a `develop`→`main` promotion PR still runs it; a `v*` npm release still triggers the native release
- [ ] Observed red recorded, then restored green
- [ ] User verification performed on the named platform
- [ ] Evidence record written
- [ ] Independent reviewer returned PASS

### Phase 2 — PRs run a reduced native matrix; the full matrix stays on main and nightly

**Progress:**

- [ ] Callers wired and building: `.github/workflows/ci.yml`, `.github/workflows/native-platforms.yml`, `scripts/__tests__/ci-efficiency.spec.ts`
- [ ] Required test green: a PR selection emits the Linux-only native rows; a `main` push or nightly emits the full matrix, and the full set cannot be label-exempted away
- [ ] Observed red recorded, then restored green
- [ ] User verification performed on the named platform
- [ ] Evidence record written
- [ ] Independent reviewer returned PASS

### Phase 3 — Runs for merged or closed PRs are cancelled automatically

**Progress:**

- [ ] Callers wired and building: new `.github/workflows/ci-janitor.yml` + `scripts/ci-janitor.ts`, registered in `scripts/__tests__/ci-structure.spec.ts`
- [ ] Required test green: the janitor cancels queued/in-progress runs for a merged or closed PR head and leaves open-PR and `main` runs alone
- [ ] Observed red recorded, then restored green
- [ ] User verification performed on the named platform
- [ ] Evidence record written
- [ ] Independent reviewer returned PASS

### Phase 4 — Release-proof workflows share one repo-wide concurrency group

**Progress:**

- [ ] Callers wired and building: `.github/workflows/native-release.yml`, `.github/workflows/release-candidate.yml`, `scripts/__tests__/ci-structure.spec.ts`
- [ ] Required test green: at most one native release proof matrix runs at a time across branches, and a superseded proof is not evicted mid-run
- [ ] Observed red recorded, then restored green
- [ ] User verification performed on the named platform
- [ ] Evidence record written
- [ ] Independent reviewer returned PASS

**Files (maximum five):**

- EDIT `.github/workflows/native-release.yml` — PR trigger gate, `v*` release input, shared concurrency group.
- EDIT `.github/workflows/native-platforms.yml` — reduced PR rows, full rows for main/nightly.
- EDIT `.github/workflows/ci.yml` — pass the selection to the native call.
- ADD `.github/workflows/ci-janitor.yml` and `scripts/ci-janitor.ts` — cancel runs for merged/closed PR heads.
- EDIT `scripts/__tests__/ci-efficiency.spec.ts`, `scripts/__tests__/ci-structure.spec.ts` — guards for every change above.

## Acceptance criteria

- [ ] A push to an open runtime-native PR starts only the reduced Linux native rows, not the macOS/Windows/Android simulation matrix.
- [ ] The full native matrix still runs on every `main` push and nightly, and a frozen `promotion/*` PR.
- [ ] The native release proof runs on a promotion PR, on a label or manual dispatch, and on an npm `v*` release — never on an ordinary PR push.
- [ ] A merged or closed PR's queued and in-progress runs are cancelled within one janitor interval.
- [ ] Two release proofs on different branches cannot hold runners at the same time.
- [ ] `pnpm exec vitest run scripts/__tests__/ci-efficiency.spec.ts scripts/__tests__/ci-structure.spec.ts scripts/__tests__/native-release-proof.spec.ts` is green.

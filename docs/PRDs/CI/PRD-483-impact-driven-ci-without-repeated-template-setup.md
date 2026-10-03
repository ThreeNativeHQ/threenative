---
prd_contract: v1
---

# PRD-483 — Impact-driven CI without repeated template setup

**Status:** PARTIAL — local verification green; live CI pending.
**Owner:** CI tooling
**Scope:** One cleanup PR; builds on PRDs 373, 380, 480 and 481 and the conservative #417 reuse repair.

## Decisions

- João, 2026-10-03: first ask whether the change needs tests, then whether each test earns its cost,
  then whether retained tests apply now. Docs-only skips product tests. CI configuration proves its
  routing/contracts. Native runs for native and shared runtime consumers. Unknown meaningful inputs
  keep full coverage. No settings, credentials, runners or concurrency changes.
- Exhaustive template scenarios remain on broad changes, main qualification and scheduled audits.
  Exact kit changes run the affected kits; shared generator/render sources keep exhaustive fanout in
  this tranche. Narrowing shared sources further needs a proved dependency boundary.
- Unsafe matrix/reusable verdict reuse remains disabled by #417: missing, partial, failed, skipped,
  stale or otherwise unproven source evidence never authorizes a skip. This PR creates no new verdict
  cache. Workspace products remain immutable artifacts from this exact run/candidate.

### Phase 1 — Remove duplication and select retained coverage

- [x] Exact template paths map to shipped kit identities; shared/unknown inputs retain the full matrix; docs and CI lanes apply to PR and merge-group diffs. proof: `pnpm exec vitest run scripts/__tests__/ci-template-selection.spec.ts`, 19 passed locally on 2026-10-03.
- [x] Every nonvisual scenario runs once per selected template, with empty coverage rejected and the matrix derived from kit manifests. proof: `pnpm exec vitest run scripts/__tests__/ci-structure.spec.ts scripts/__tests__/ci-template-selection.spec.ts`, green in the 264-test focused run on 2026-10-03.
- [x] CI/template unit contracts preserve mixed-scope unions; full unit shards retain their existing unit-only command; native tests honor shared/native reach; the final verdict checks exact queue source identity, with full history at the verdict checkout. proof: `pnpm exec vitest run scripts/__tests__/ci-*.spec.ts scripts/__tests__/verify-template-playtests.spec.ts scripts/__tests__/sync-agent-docs.spec.ts scripts/__tests__/primary-docs.spec.ts`, 303 passed on 2026-10-03.

### Phase 2 — Qualify the smaller pipeline

- [x] Final typecheck, lint, docs and relevant unit checks pass. proof: `pnpm build`, `pnpm typecheck`, `pnpm lint`, `pnpm check:docs` exit 0; 303 focused tests passed, 2026-10-03.
- [ ] Normal CI passes on this cleanup PR before ready/merge. proof: PR check run; no bypass authorized.

## Coverage and cost

Measured baseline: [CI run 37078784853](https://github.com/ThreeNativeHQ/threenative/actions/runs/37078784853),
2026-10-02, successful completed jobs API. Nonvisual: 29 jobs, 5,674s (94.6 runner-min), slowest 319s.
Golden journey: 2 jobs, 382s (6.4 runner-min). Total: 31 template jobs, 100.9 runner-min.
There are 13 kit manifests, not a hardcoded CI count.

| Change | Previous PR / queue | Proposed PR / queue |
|---|---|---|
| Inert docs | no product jobs / full board | no product jobs / no product jobs |
| CI configuration | 4 full unit shards, no template jobs / full board | 1 CI-contract unit job, no template jobs / same |
| One kit | 4 full unit shards + 31 template jobs / full board | 1 scaffolder-contract unit job + 2 template jobs / same |
| Shared runtime, generator, unknown meaningful code; main/nightly | exhaustive 31 template jobs | exhaustive 13 scenario jobs + 1 journey job |

The template cap stays four. Baseline's nonvisual slot-work lower bound is 94.6 / 4 = 23.6 minutes;
removing 16 repeated setups at the workflow's documented ~65s estimates 17.3 runner-min saved,
plus the removed 111s generic platformer journey. That gives ~81.7 template runner-min before the retained platformer production-build step, an estimate,
not measured after-change wall time. Individual exhaustive template jobs will be longer (shooter
roughly 18 minutes using baseline work minus repeated setup); the 30-minute timeout is retained.
Queue contention can improve while a single heavy leg lengthens; live CI must settle wall time.
Full unit shards keep their existing `pnpm test` with `TN_SUITE_PHASES=unit`; it already excluded builds. No full-unit rebuild saving is claimed. CI-only avoids those product suites entirely.

| Removed work | Why it adds little marginal value | Remaining proof |
|---|---|---|
| 16 per-template scaffold/install/typecheck/cook copies | Same template and exact run tarballs; only scenario partition differed | One setup per template, all classifier scenarios, template compilation/contracts |
| Duplicate platformer golden setup/journey | Its unique production build/artifact check moves into the existing installed platformer scenario job | Same production CLI and nonempty dist/index.html guard; when golden drives platformer the added step skips |
| Four shard-count snapshot cases and obsolete partition arithmetic | Assert old scheduling constants; do not prove product behavior | Manifest-derived complete matrix, whole classifier execution, empty selection rejection, direct impact fixtures |
| CI structure/needs checks repeated by lint and CI unit lane | Same candidate/contracts in two jobs | CI lane targeted unit run; instructions-only lint retains contracts when no unit job runs |
| Full product units on CI-only changes | No runtime/package/template source changed | CI contracts plus existing typecheck, budgets, lint and supply-chain gates |
| Full unit command retained | Existing unit phase already excluded build | Units execute freshly; existing exact-run producer artifact is consumed |

No rendering PR acceptance tests, security checks or required protection settings are removed.

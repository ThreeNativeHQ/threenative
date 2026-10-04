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
- João, 2026-10-04 follow-up: allow up to eight existing hosted template legs at once; preserve selected coverage, fail-fast false, runner routing and timeouts. This separately authorized cap change does not alter the original cleanup decision or historical measurements.
- Exhaustive template scenarios remain on broad changes, main qualification and scheduled audits.
  Exact kit changes run the affected kits; shared generator/render sources keep exhaustive fanout in
  this tranche. Narrowing shared sources further needs a proved dependency boundary.
- Unsafe matrix/reusable verdict reuse remains disabled by #417: missing, partial, failed, skipped,
  stale or otherwise unproven source evidence never authorizes a skip. This PR creates no new verdict
  cache. Workspace products remain immutable artifacts from this exact run/candidate.

### Phase 1 — Remove duplication and select retained coverage

- [x] Exact template paths map to shipped kit identities; shared/unknown inputs retain the full matrix; docs and CI review lanes apply to ordinary PR diffs; merge groups now require exhaustive exact-candidate qualification. Original selection proof: `pnpm exec vitest run scripts/__tests__/ci-template-selection.spec.ts`, 19 passed locally on 2026-10-03; qualification follow-up proof: 404 CPU CI/mirror tests passed on 2026-10-04.
- [x] Every nonvisual scenario runs once per selected template, with empty coverage rejected and the matrix derived from kit manifests. proof: `pnpm exec vitest run scripts/__tests__/ci-structure.spec.ts scripts/__tests__/ci-template-selection.spec.ts`, green in the 264-test focused run on 2026-10-03.
- [x] CI/template unit contracts preserve mixed-scope unions; full unit shards retain their existing unit-only command; native tests honor shared/native reach; the final verdict checks exact queue source identity, with full history at the verdict checkout. proof: `pnpm exec vitest run scripts/__tests__/ci-*.spec.ts scripts/__tests__/verify-template-playtests.spec.ts scripts/__tests__/sync-agent-docs.spec.ts scripts/__tests__/primary-docs.spec.ts`, 303 passed on 2026-10-03.

### Phase 2 — Qualify the smaller pipeline

- [x] Final typecheck, lint, docs and relevant unit checks pass. proof: `pnpm build`, `pnpm typecheck`, `pnpm lint`, `pnpm check:docs` exit 0; 303 focused tests passed, 2026-10-03.
- [ ] Normal CI passes on this cleanup PR before merge; the authorized ready transition starts qualification. proof: PR check run; no bypass authorized.

## Coverage and cost

Measured baseline: [CI run 37078784853](https://github.com/ThreeNativeHQ/threenative/actions/runs/37078784853),
2026-10-02, successful completed jobs API. Nonvisual: 29 jobs, 5,674s (94.6 runner-min), slowest 319s.
Golden journey: 2 jobs, 382s (6.4 runner-min). Total: 31 template jobs, 100.9 runner-min.
There are 13 kit manifests, not a hardcoded CI count.

| Change | Previous PR / queue | Proposed PR / queue |
|---|---|---|
| Inert docs | no product jobs / full board | no product jobs / exhaustive qualification |
| CI configuration | 4 full unit shards, no template jobs / full board | 1 CI-contract unit job, affected Integration / exhaustive qualification |
| One kit | 4 full unit shards + 31 template jobs / full board | 1 scaffolder-contract unit job + 2 template jobs / exhaustive qualification |
| Shared runtime, generator, unknown meaningful code; main/nightly | exhaustive 31 template jobs | exhaustive 13 scenario jobs + 2 journey jobs |

The hosted template cap is eight; selected kits and scenarios are unchanged. The historical baseline at cap four had a nonvisual slot-work lower bound of 94.6 / 4 = 23.6 minutes;
removing 16 repeated setups at the workflow's documented ~65s estimates 17.3 runner-min saved,
retaining both existing golden journeys. That gives ~83.6 template runner-min, an estimate,
not measured after-change wall time. Individual exhaustive template jobs will be longer (shooter
roughly 18 minutes using baseline work minus repeated setup); the 30-minute timeout is retained.
Queue contention can improve while a single heavy leg lengthens; live CI must settle wall time.
Full unit shards keep their existing `pnpm test` with `TN_SUITE_PHASES=unit`; it already excluded builds. No full-unit rebuild saving is claimed. CI-only avoids those product suites entirely.

| Removed work | Why it adds little marginal value | Remaining proof |
|---|---|---|
| 16 per-template scaffold/install/typecheck/cook copies | Same template and exact run tarballs; only scenario partition differed | One setup per template, all classifier scenarios, template compilation/contracts |
| Both full-board golden journeys retained | Distinct starter and platformer proofs remain qualified | In selective multi-kit coverage where platformer is not the chosen golden kit, its existing installed scenario job verifies the production CLI and nonempty artifact |
| Four shard-count snapshot cases and obsolete partition arithmetic | Assert old scheduling constants; do not prove product behavior | Manifest-derived complete matrix, whole classifier execution, empty selection rejection, direct impact fixtures |
| CI structure/needs checks repeated by lint and CI unit lane | Same candidate/contracts in two jobs | CI lane targeted unit run; instructions-only lint retains contracts when no unit job runs |
| Full product units on CI-only changes | No runtime/package/template source changed | CI contracts plus existing typecheck, budgets, lint and supply-chain gates |
| Full unit command retained | Existing unit phase already excluded build | Units execute freshly; existing exact-run producer artifact is consumed |

No rendering PR acceptance tests, security checks or required protection settings are removed.


Integration relevance also compares exact candidate Git objects. A bounded parser validates lane filters,
output identity and transitive job dependencies; an exposure-only job/filter edit selects exposure,
while a native dependent edit selects its root and dependent consumers. Shared scheduling, selector,
header or ambiguous graph changes select every lane. Existing runtime source filters remain applicable,
with native host/action reach retained for decals and fluid and all five canonical/generated exposure
modules covered. Renames include both endpoints. The selector introduction itself runs all integration
lanes; unrelated failures are not hidden. Normal CI run 37141675755 on review-fix head 38ee061be
passed with one relevant unit job, zero template jobs and no native jobs; final integration head still
requires its own normal CI and independent review.

Parent review corrected the full-board count to 15 (13 scenario jobs plus both retained golden journeys); no golden journey saving is claimed. Unsupported output expressions, including bracket access or `||` fallbacks, fail the paths job visibly instead of emitting a partial lane decision.

Final bounded parent-review fixtures pass: 333 focused tests (318 CI contracts and 15 primary-docs/mirror checks). Output inventory spans blank/comment lines, validates filter/root completeness, and fails visibly on deleted outputs or unsupported expressions.

## Bounded qualification follow-up

Ordinary develop reviews retain affected coverage and existing Android coverage. Queue, main, explicit full and unknown inputs require all templates, both golden journeys, full native tier and every Integration lane. Integration is called by CI at the exact candidate; its completion job checks selected canonical receipts against completed-success Jobs API entries for this run and attempt, and `ci-required` independently repeats inventory and identity validation. Full-tree reusable matrix verdict reuse remains disabled.

CPU fixtures exercise writer→collector→protected verdict and reject missing, skipped, failed, stale and wrong-source evidence. Live reusable job-name/output behavior and a genuinely exhaustive queue cold path remain unverified; partial reruns require all selected Integration legs in the current attempt. This follow-up does not complete #430's separate rollout checkbox, defer Android, or change queue settings/timeouts.

PR #435's first ready run37237559625 attempt1 actually selected exhaustive qualification (all13templates, bothgoldens, full native and all Integration) at merge candidate `bb017d1cdf3a5a65f75adf131934abef0cbdd331`, distinct from workflow head `d11a545a8`. Its capture leg failed before runtime frames because the verifier's expected source input incorrectly included run/attempt artifact prefixes. The bounded repair restores the bare candidate SHA and retains attempt-qualified artifacts; proof: regression1 failing/66 passing →67/67 passing, plus299 related CPU contracts passed. Independent review approved the repair. Live corrected capture and full required joins remain unverified; no Android deferral, assertion waiver or timeout/settings change.

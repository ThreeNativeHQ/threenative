# PRD-496 — Heavy CI uses Blacksmith only while free budget remains

**Status:** PARTIAL — 2/8 implementation boxes verified; draft, provider dispatch disabled.
**Priority:** P2 — reduce heavy CI feedback time without introducing paid runner dependency.
**Tier:** scripts / CI infrastructure.
**Depends on:** Existing runner and work-selection contracts from [PRD-480](PRD-480-linux-ci-runs-on-the-owner-machine.md) and [PRD-481](PRD-481-ci-does-each-piece-of-work-once.md); preserve the shipped [PRD-483 impact-driven CI](../done/PRD-483-impact-driven-ci-without-repeated-template-setup.md). This optional acceleration does not block those PRDs or releases.
**Scope:** Allowlisted Linux x64 CPU jobs in the existing GitHub Actions CI; budget accounting, admission, fallback, and operator visibility.
**Consumer adoption:** N/A — CI infrastructure; existing workflow jobs are the consumers.
**Created:** 2026-10-05.

## Outcome

Keep GitHub Actions. Spend Blacksmith's monthly free allowance only on measured, expensive jobs. Before dispatch, reserve enough allowance for the selected job; when allowance is insufficient or accounting is uncertain, run that same work on standard GitHub-hosted Ubuntu. Resume Blacksmith eligibility after the provider's next billing period is confirmed.

The experience is automatic: developers push normally, required checks stay the same, and a job summary explains the runner choice. Blacksmith is optional acceleration, never permission to omit a test or buy more compute.

## Current repository baseline

Inspected `develop` at `d3c009e4404abcc2041f58124693edb9c78d802b`:

- [CI](../../../.github/workflows/ci.yml) already classifies work in `scope` through `scripts/ci-change-scope.mjs`; it emits a plan and `candidate_sha`. Draft PRs skip the board. Preserve these decisions before considering a provider.
- Linux jobs currently use `TN_RUNNER` or standard `ubuntu-24.04`; `scope` uses `TN_RUNNER_LIGHT`. This proposal does not globally replace either setting.
- `test-native` depends on `scope` and `build-artifacts`, has a 75-minute timeout, and runs for selected native work or the `warm` selection. It is the first candidate to benchmark, not an assertion that Blacksmith is already faster or compatible.
- The native job restores third-party dependencies, compiler cache, and build outputs. Moving only the cache-warming producer to a different provider can stop warming the cache its consumers actually read.
- Current-run/attempt receipts, exact candidate identity, required joins, matrix qualification, and no duplicate proof remain authoritative. See the existing [CI execution order](EXECUTION-ORDER.md).

## Decisions

2026-10-05 — requested by the owner: heavy work gets free Blacksmith capacity, then falls back to ordinary GitHub Actions. This draft proposes the following implementation choices for review:

2026-10-06 — owner requested one PR first: [#444](https://github.com/ThreeNativeHQ/threenative/pull/444) retains this PRD and absorbs the source history and migration intent of [#445](https://github.com/ThreeNativeHQ/threenative/pull/445). The original PRD head is `f9f52492597e95c3a612b6d5ee044f2e635e913f`; bot heads `e59e245e9f58366db2c81ac124ea798178dff0a3`, `422adc7a12a64ed77817fd0bc146a517131f2df4`, and `768b90cf1953a8c68446a93df126313792c06e2d` are preserved in the retained branch history. The bot's broad runner and checkout substitutions are superseded by the guarded, allowlisted rollout below; they are not enabled by consolidation. The bot branch remains preserved. #444 stays draft with existing GitHub/owner routing and no Blacksmith dispatch.

Official documentation confirms the allowance and 4-vCPU multiplier, but the spending settings describe alerts without establishing a hard no-paid-overage stop. Historical estimated usage does not establish authenticated credit expiry, reporting completeness, or billing-period boundaries. These missing facts keep enforcement off; expired, exhausted, unavailable, or unverifiable credit must select standard GitHub before dispatch. [Runner FAQ](https://docs.blacksmith.sh/blacksmith-runners/overview#faq), [account settings](https://docs.blacksmith.sh/introduction/settings).

2026-10-06 — the owner reports no credit card on the account. Blacksmith's product representative described historical no-card workloads continuing past free credits and announced a control to prevent further runs at exhaustion. This establishes historical provider behavior, not this account's current charges or the control's current availability/enabled state. The next account step is read-only inspection of the existing `ThreeNativeHQ` Wallet/Billing view: exact credit-stop wording/state, balance, reset/expiry and scope for in-flight jobs and optional services. Public alerts alone do not satisfy the activation gate. No new credentials or account setting change is performed here. [Provider explanation](https://news.ycombinator.com/item?id=48476323), [announced control](https://news.ycombinator.com/item?id=48482211).

The closure-time bot head `9cd80dd09f395ea98aa66c5d93160e109e216d8e` is also preserved in this branch history. #445 closed at `2026-10-06T01:56:14Z`; implementation continues only in #444. The disabled bootstrap uses three small CI scripts and adjacent tests, without deploying a controller or state ref. Internal normalized observations are controller contracts, not invented authenticated provider fixtures.

| Choice | Proposed policy |
| --- | --- |
| Provider | Blacksmith runners within GitHub Actions, not a new CI platform |
| Initial scope | One proven CPU-only Linux x64 job; expand only from measured benefit |
| Candidate runner | `blacksmith-4vcpu-ubuntu-2404`; 2-vCPU comparison allowed during the capped pilot |
| Exhaustion fallback | `ubuntu-24.04`, matching the current hosted baseline; not a larger paid runner |
| Existing owner runners | Unenrolled jobs and dedicated hardware stay unchanged; enrolling an owner-routed job is an explicit policy change |
| Default mode | `off`; `shadow` computes decisions without provider dispatch; `enforce` admits within budget |
| Allocation | One organization-wide allowance, not a fresh allowance per repository |
| Local guard | 300 normalized minutes withheld from the advertised 3,000; effective ceiling 2,700 |
| Unknown state | Choose GitHub-hosted; never assume zero usage |
| Added services | No new database, server, paid cache, or third-party monitoring service for v1 |

A periodic `USE_BLACKSMITH=true/false` switch alone is rejected: several jobs can start between polls. A list of two `runs-on` labels is also not fallback; provider selection happens before a job is dispatched.

## Verified provider facts and limits

Blacksmith documents a monthly allowance of **3,000 Linux x64 2-vCPU-equivalent minutes per organization**. Therefore 1,500 actual minutes on a 4-vCPU runner consume the whole allowance. Other operating systems and architectures have different conversion factors. Account-wide reporting must include them even though this PRD only enrolls Linux x64 jobs. [Runner catalog and allowance](https://docs.blacksmith.sh/blacksmith-runners/overview)

The integration requires a Blacksmith account and its GitHub integration on a GitHub organization. The current quickstart excludes personal repositories. Signup advertises no credit card requirement; optional Docker-layer storage, sticky disks, and static IPs have separate prices. Do not use the migration wizard to rewrite every workflow. [Quickstart](https://docs.blacksmith.sh/introduction/quickstart), [pricing](https://www.blacksmith.sh/pricing)

There is a documented machine-readable usage interface: `blacksmith usage`, with absolute time bounds and breakdowns, plus `blacksmith runners catalog`. Use it rather than scraping the dashboard. The current CLI supports organization tokens and disabling automatic updates. [Usage reporting](https://docs.blacksmith.sh/blacksmith-cli/usage), [CLI authentication and version control](https://docs.blacksmith.sh/blacksmith-cli/overview)

**Unverified:** this account's provider-enforced zero-paid-overage cap, exact billing-period boundaries, reporting delay, and the complete billable lifecycle. Local estimates and a safety buffer are not a billing guarantee. Provider dispatch stays disabled until the owner's provider configuration has a confirmed no-charge exhaustion contract. If that protection is unavailable, remain `off`/`shadow`.

## Design contract

The numbered requirements below are specifications of the eight implementation boxes in the three phases. They are not additional progress checkboxes.

### 1. Eligibility and routing

Use a small reviewed allowlist keyed by workflow/job and matrix identity. Start by evaluating `test-native`; include it only after confirming its OS, memory, graphics-adapter, and native toolchain requirements are met. CPU rendering tests are not proof of hardware GPU qualification. `build-artifacts` is a later candidate if measurements justify it.

Preserve the existing impact plan: skipped jobs remain skipped. Lint, formatting, scope/classification, admission, tiny unit tests, summaries, and budget maintenance never consume Blacksmith. Windows, macOS, Android/iOS qualification, owner GPU jobs, and device-specific lanes are outside this change.

For an enrolled job, decision order is:

1. Verify the work is selected and the candidate identity is unchanged.
2. Reject provider use for `off`, `shadow`, an explicit hosted override, unsupported labels, or an untrusted event.
3. Obtain fresh organization usage and atomically reserve the full job allowance.
4. Emit either the approved Blacksmith label plus reservation identity, or `ubuntu-24.04` plus a stable reason code.

Forks, Dependabot contexts without the necessary trust, and changes to privileged routing/workflow policy use hosted runners. Same-repository PRs are not automatically trusted merely because they are not forks: document the authorized actor/ref policy. Where its enforcement cannot be established, keep that event hosted. Build jobs retain read-only credentials.

Recommended reasons include `disabled`, `shadow`, `not-allowlisted`, `untrusted`, `insufficient-budget`, `usage-stale`, `provider-error`, `ledger-conflict`, `unsupported-sku`, and `forced-hosted`.

### 2. Accounting and atomic reservations

All balances use normalized x64 2-vCPU units, represented as integer fixed-point units rather than floating-point money. Resolve charge factors from a pinned, validated provider catalog; an unexpected SKU or pricing change closes admission. Use the billed SKU, not extra CPUs from a complimentary machine upgrade.

For local conservative Linux x64 estimates, round each attempt upward to a whole minute, then multiply by its billed vCPU count divided by two. This is a local estimation policy, not an unverified claim about the provider's rounding contract. Reconcile against provider-reported billing units after validating their meaning.

Admission maintains this invariant:

```text
provider-confirmed usage
+ completed usage not yet included in that provider snapshot
+ outstanding worst-case reservations
+ this job's worst-case reservation
<= confirmed free allowance - safety guard
```

Reserve from the configured hard timeout plus a verified cancellation/post-job billing allowance, not the average successful runtime. For example, a 75-minute 4-vCPU job with a proposed 5-minute tail reserves 160 normalized minutes. The tail is a provisional floor, not a proven billing bound; activation requires validation and the provider-side no-overage protection above. Near exhaustion, a job that cannot fit its full reservation runs on GitHub even if it would probably finish faster.

Keep a small JSON ledger on a dedicated non-release state ref, proposed `ci/blacksmith-budget`, using GitHub Contents API SHA-checked writes as compare-and-swap. Do not commit state to `develop` or trigger product CI from ledger updates. Store only accounting metadata, not credentials or job logs. Demonstrate concurrent writers cannot overwrite one another; bounded retries end in hosted fallback. GitHub variables, cache artifacts, and workflow concurrency groups alone are not an atomic ledger.

Reservation keys include organization, provider period, repository, run ID, run attempt, candidate SHA, job ID, and matrix key. Duplicate requests are idempotent; a new attempt needs a new reservation. States distinguish reserved, running, completed-but-unreconciled, settled, and confirmed-never-started.

Use one ledger authority for all enrolled repositories. Include other organization usage in provider totals. If outside jobs can spend concurrently without the same reservation mechanism, do not claim the ledger alone prevents overshoot: keep the rollout isolated or require the provider's hard stop. Do not allocate 3,000 minutes separately to each repo.

Match provider usage and local attempts without double counting. Prefer per-attempt attribution or a verified completeness watermark; when neither exists, retain uncertain reservations conservatively instead of subtracting them. Failed, cancelled, timed-out, matrix, and rerun attempts count. An expired lease is not evidence a job stopped billing.

### 3. Usage refresh and renewal

Use a pinned CLI binary with verified checksum and `BLACKSMITH_DISABLE_AUTO_UPDATE=1`. Obtain its organization token through the approved noninteractive mechanism; do not copy a person's credentials file. The current reporting command shape is:

```sh
blacksmith usage --start-time "$PERIOD_START" --end-time "$NOW" \
  --breakdown-by runner_type,repo,job --format json
blacksmith runners catalog --format json
```

Capture a redacted real response before defining parser fixtures. Distinguish billing minutes from runtime minutes, gross usage from allowance already deducted, and compute from optional storage charges. Query the entire organization, follow available pagination, and validate period/timezone, completeness, schema, and token permissions. Never treat an empty or partially paged response as zero.

Refresh on demand before admission when the snapshot is older than a proposed five minutes. Reconcile on completion and in the existing scheduled CI path; the schedule is repair/reporting, not the spending lock. Bound routing work, proposed 15 seconds, and fall back on timeout, authentication failure, rate limiting, or malformed reports. A successful fetch does not prove the provider's underlying data is current; retain outstanding local exposure.

Renew only on confirmed provider period boundaries, not a blind local-time first-of-month toggle or a rolling 30-day query. Preserve prior-period history and unresolved jobs. Jobs that could cross a reset reserve exposure against both possible periods, or stay hosted until attribution is safe. Lost/corrupt state closes admission until reconstructed from authoritative usage and run history.

### 4. Workflow integration and security

Keep provider choice separate from `scope` correctness. A provider failure emits an explicit hosted choice; an invalid impact plan still fails CI. Do not hide selector failures behind `continue-on-error` if that can produce missing outputs and skipped required jobs.

Only a trusted, reviewed controller can read the organization token and update the ledger. It runs on GitHub-hosted compute with the minimum supported permissions; privileged execution never checks out or runs PR-controlled code, restores untrusted executable caches, or evaluates PR strings as shell. Pin reviewed controller code independently of the candidate. A changed PR workflow must not be able to grant itself the controller secret. If the available GitHub controls cannot enforce this for an event, that event remains hosted.

Do not add broad `contents: write` or Blacksmith secrets to the main build/test jobs. Reuse the existing trusted workflow/control infrastructure; do not introduce a workflow file per feature. Ledger/control code may be implemented in small `scripts/ci-blacksmith-*.mjs` modules with adjacent Vitest tests. Any final deployment arrangement must prove the trust boundary before enforcement.

Preserve existing job names, `candidate_sha`, `needs`, required-check joins, cancellation policy, timeout/resource controls, and receipt validation. A provider switch changes the machine, not the test contract or the candidate under test. Never introduce successful placeholder jobs to satisfy required checks.

Do not assume the providers share caches: validate cache backend behavior and cold-build correctness. Keep compatible compiler/toolchain/OS/architecture keys and source-trust boundaries. In particular, preserve GitHub-side `warm` producers while fallback consumers depend on them; exclude warm-only dispatch from initial enrollment. Reuse immutable same-run build artifacts where already supported. Do not add paid sticky disks, Docker builders, or static IPs.

### 5. Reruns, outages, and recovery

Every dispatch needs valid attempt-specific admission. GitHub's rerun-failed/single-job behavior may reuse an earlier selector's outputs. Conservatively force `github.run_attempt > 1` onto the hosted label directly in the enrolled job's `runs-on` expression, regardless of stale outputs. A fresh run ID can be admitted normally. No reservation check occurs only after a Blacksmith VM has already started charging.

Budget fallback is pre-dispatch and automatic. It is not live migration: changing a variable does not move a queued/running Blacksmith job. The runbook distinguishes an accounting fallback from a provider outage. Use the existing cancel/rerun operation when required; the new attempt is hosted by the rule above. Do not retry a failing test on another provider merely to turn its check green. Full automatic provider-outage watchdogs and cancel/retry orchestration are deferred.

Maintain a forced-hosted kill switch for future decisions. Turning the feature off keeps ordinary CI functional and leaves reservations intact until running work is reconciled. A provider outage never authorizes extra paid capacity.

### 6. Observability and rollout

Each routing summary reports provider, job/attempt, period, normalized used/reserved/remaining allowance, snapshot age, and fallback reason. Show actual job minutes separately from normalized budget units. No tokens, credentials, or unnecessary organization billing details appear in public PR output. Private billing detail stays in the controller's restricted reporting surface; a public summary can show only this repo's allocation and decision.

Ship `off` by default. In `shadow`, report simulated decisions without reserving real spend. Pilot one job under a smaller proposed 300-normalized-minute ceiling, then raise toward 2,700 only after the external activation gates are met. Policy limits may be lowered freely; increases need owner approval and never exceed the confirmed free allowance minus the guard.

Compare identical candidates on the existing hosted baseline and Blacksmith with cold and warm caches. Measure end-to-end time including queue, admission, setup, compilation, cache transfer, and downstream waits; report normalized units per successful required check. Expand only for demonstrated feedback-time benefit. Vendor speed claims are not acceptance evidence. Avoid creating duplicate expensive proof on every push just to benchmark.

### Phase 1 — Budget engine without live spending

- [ ] Implement the validated provider-usage/catalog adapter. proof: `pnpm exec vitest run scripts/__tests__/ci-blacksmith-usage.spec.ts` covers schema changes, partial reports, SKU conversions, and unavailable credentials.
- [x] Implement the atomic reservation ledger. proof: `pnpm exec vitest run scripts/__tests__/ci-blacksmith-ledger.spec.ts` — 15 PASS, exit 0; twenty-writer CAS race, exact idempotency, SHA-checked Contents transport, attributed settlement, corruption/reset rejection, immutable period boundaries, missing/inherited snapshot rejection, and high-water persistence on duplicate/denied requests. No live state ref is deployed.
- [x] Implement the pure eligibility and fallback policy. proof: `pnpm exec vitest run scripts/__tests__/ci-blacksmith-policy.spec.ts` — 41 PASS, exit 0; exact ceilings, timeout/tail reservations, verified dispatch-delay horizon, expired/stale/unknown credit, modes, allowlist and trust gates. These tests use internal observations; no live billing compatibility is claimed.

**Gate:** Unit fixtures can exercise exhaustion and concurrency without a Blacksmith account or paid runner.

### Phase 2 — Existing CI routes eligible jobs safely

- [ ] Integrate attempt-bound runner selection into the enrolled existing job. proof: `pnpm exec vitest run scripts/__tests__/ci-blacksmith-routing.spec.ts scripts/__tests__/ci-structure.spec.ts scripts/__tests__/ci-needs.spec.ts` preserves selected work and forces stale-output reruns onto hosted compute.
  Partial: 21 routing tests PASS, including evaluation of the actual scalar `runs-on` expression; default-off/warm owner routing, names, needs, timeout, candidates and required joins remain intact. Non-off, forced-hosted and non-warm rerun attempts select `ubuntu-24.04` directly. No provider output can authorize dispatch. Live enrollment waits for the activation gates.
- [ ] Isolate the trusted accounting controller from candidate execution. proof: `pnpm exec vitest run scripts/__tests__/ci-blacksmith-security.spec.ts` rejects fork, unauthorized actor, modified privileged workflow, and secret exposure paths.
  Blocked deployment: candidate execution has no added credential or ledger permission, but independently pinned controller/token isolation and organization runner-label access restrictions remain unverified. No permissions or installation settings are changed here.
- [ ] Add completion reconciliation and bounded recovery in the existing control paths. proof: `pnpm exec vitest run scripts/__tests__/ci-blacksmith-reconcile.spec.ts` covers cancellation, provider lag/outage, missing completion events, and pending reset exposure.
  Partial: 28 recovery tests PASS, exit 0. Completion updates and closed-period settlement use bounded SHA compare-and-swap; historical settlement requires fresh final organization totals, matching immutable period bounds and exact per-attempt final billing confined to that period. Running/reserved/omitted attempts, cancellation alone, partial reports, regressing totals and cross-period billing retain exposure. Inherited object properties cannot identify a reservation. Tests prove verified historical settlement permits next-period admission while preserving history. These are internal trusted-controller contracts, not authenticated vendor fixtures. Existing control-path wiring and live renewal remain undeployed and unverified.

**Gate:** The normal hosted path remains operational when every provider dependency is unavailable. Enforcement remains disabled pending the external gates below.

### Phase 3 — Operator control and rollout support

- [ ] Add sanitized usage/routing summaries and the operator runbook. proof: `pnpm exec vitest run scripts/__tests__/ci-blacksmith-reporting.spec.ts` validates normalized units, redaction, and fallback reasons; `pnpm check:docs` validates the runbook links.
  Partial: the existing optional run-summary reports the disabled boundary using stable reason codes, without private usage/token/account details; routing tests cover redaction. Authenticated allocation/period reporting waits for the provider adapter.
- [ ] Implement default-off, shadow, capped-pilot, and kill-switch configuration. proof: `pnpm exec vitest run scripts/__tests__/ci-blacksmith-rollout.spec.ts` verifies that none of these paths can bypass the confirmed free ceiling or silently enable paid add-ons.
  Partial: pure policy tests cover off/shadow/enforce, the 300-unit pilot ceiling, maximum 2,700-unit ceiling and forced-hosted behavior. Deployed shadow accounting and any live pilot remain disabled.

**Gate:** Current focused policy/ledger/recovery/routing plus existing CI structure, needs and Integration contracts: 384 PASS across seven files, exit 0. Focused TypeScript 7 strict/noUncheckedIndexedAccess check PASS; documentation check validates 2,425 links across 1,238 Markdown files. Unchecked proof commands above remain planned; full repository/native/GPU/live-provider gates were not run. Publication uses normal hooks.

## Operator behavior in the disabled bootstrap

An absent or `off` `TN_BLACKSMITH_MODE` preserves existing owner/GitHub routing. `shadow`, `enforce`, or an unknown nonempty value routes the selected non-warm native job to standard GitHub; none can activate Blacksmith. `TN_BLACKSMITH_FORCE_HOSTED=true` also selects standard GitHub for that job. Every non-warm rerun uses GitHub directly even if old selector outputs are reused. Warm producers retain their existing routing and cache contracts.

Keep the mode off while activation facts are unavailable. Turning it off does not migrate queued/running work or erase reservations. A provider outage uses the existing cancel/rerun operation; the new attempt is hosted, while uncertain prior billing remains reserved. Do not release exposure from cancellation or elapsed time alone, and do not reset the ledger at a guessed calendar boundary. No watchdog, paid add-on, new secret, or broad permission is installed by this bootstrap.

## Acceptance scenarios

| Scenario | Expected result |
| --- | --- |
| Heavy selected job, verified free capacity | One atomic reservation; one Blacksmith execution; ordinary required evidence |
| Effective use/reservations 2,600; new reservation 160 | Hosted fallback, because 2,760 exceeds the 2,700 ceiling |
| Local 4-vCPU estimate for a 61-second attempt | Four normalized units after conservative per-attempt rounding |
| Twenty simultaneous PRs near the ceiling | Aggregate committed reservations cannot exceed the ceiling |
| No token, unknown SKU, rate limit, stale report, corrupt ledger | Hosted selection with a diagnostic; required work is not skipped |
| Single-job rerun retaining old selector outputs | Hosted runner due to direct run-attempt guard; old receipt cannot authorize spend |
| Cancelled job with missing final usage | Exposure retained until non-billing/final usage is confirmed |
| First run after reset, old job still active | No blind budget reset or double allocation |
| Docs-only, tiny job, fork, or GPU-specific qualification | Existing skip/hosted/dedicated-hardware behavior; no Blacksmith consumption |
| Kill switch during a provider job | Future admissions hosted; current reservation not forgotten |
| Actual test failure on either provider | Required check fails normally; no success masking |

## Blocked on

Owner — inspect the existing `ThreeNativeHQ` Blacksmith account read-only and supply a redacted Wallet/Billing view of the credit-stop control and free-credit balance/reset/expiry. This execution environment has no authenticated Blacksmith browser/CLI session; GitHub organization-admin membership does not supply one. Do not recreate the account or expand installation scope to perform this check. No account, subscription, app installation, credential change, or service activation is performed by this draft PR.

Owner / provider — confirm free eligibility, billing-unit mapping, period boundaries, rounding/lifecycle rules, reporting completeness, and **provider-enforced no-paid-overage behavior**, including optional services. No-card signup alone does not establish that contract.

Owner — supply a machine organization token through protected CI secrets after approving its actual permissions. Do not paste tokens into a PR, issue, or conversation. If minimum safe permissions are unavailable, keep automated admission disabled.

Owner / provider — prove organization runner access or ref restrictions and the no-overage boundary against direct label dispatch outside the controller. Protecting the accounting token alone does not restrict a modified workflow from naming a provider runner.

Provider / live environment — establish a bounded admission-to-start queue delay, complete timeout/post-job billing tail, and final historical per-attempt attribution before enabling reset/renewal. The five-minute tail and test dispatch-delay values are internal examples, not verified billing guarantees.

Live environment — after those gates, run the capped compatibility/performance pilot, compare the provider's usage with the ledger, and exercise fallback using a deliberately lowered local budget rather than exhausting the real allowance. Record results inline here before declaring production readiness. Until then live performance, billing reconciliation, and zero-charge exhaustion remain unverified.

## Non-goals and exit condition

No migration away from GitHub Actions, paid capacity purchase, new hardware, replacement of the owner-runner work, weakened test selection, full fleet scheduler, or new render-quality qualification. No generalized multi-provider abstraction.

The implementation is ready only when the phase work is verified and the live activation evidence above is available. With only external gates remaining, follow the repository's blocked-PRD filing rules. This partial implementation stays a draft; the unverified adapter, deployment, recovery and live rollout remain open.

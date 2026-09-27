# PRD-446 — Stable API and upgrade contract

**Status:** PARTIAL — phase 1 landed and verified (`prd:25%`); phases 2 and 3 open.
**Complexity:** 6 → MEDIUM; touches release scripts and CI, no runtime code.
**Depends on:** [PRD-445](../BLOCKED/requires-release-credentials/PRD-445-public-release-hygiene.md) (changelog exists). Blocks rung R3
(1.0) of [RELEASE-READINESS-2026-09-23](RELEASE-READINESS-2026-09-23.md).

## Context

A production framework promises that a game written against version N keeps working on N+1, or
tells the author exactly what changed. ThreeNative promises nothing yet: packages are `0.x`,
breaking changes ship in minor versions (`docs/CURRENT-CHALLENGES.md` row 7), and no gate notices a
removed export. The 2026-09-23 inspection found no PRD that owns the public surface, a deprecation
window, or a proof that a game on the previous release upgrades cleanly. PRD-060's N-1 work is about
*rolling back a release*, not *upgrading a game*.

Agents are the primary consumer. An agent trained or prompted on version N that meets a silently
removed symbol on N+1 fails without a hint — exactly the friction this framework exists to remove.

## Solution

Reuse what enumerates the surface today: each package's `exports` map and the capability manifest
(`scripts/build-capability-manifest.ts` → `packages/create-threenative/capabilities.json`). Search
the manifest and `scripts/` for an existing API snapshot before writing one. Add:

1. a committed per-package surface snapshot, and a check that fails when a public symbol is removed
   or changes signature without a `Breaking` entry in `CHANGELOG.md`;
2. a short written policy — semver meaning before and after 1.0, a one-minor deprecation window
   with a one-time runtime warning, and the capability detail marking the symbol deprecated;
3. an upgrade proof that scaffolds a template from the previous npm `latest`, bumps it to the
   candidate cohort, follows the changelog's migration notes verbatim, then builds and passes its
   scenario.

Out of scope, closed with evidence elsewhere: an upgrade CLI command or codemod vocabulary.

## Execution Phases

### Phase 1 — The surface is enumerated and guarded

- [x] Existing surface tooling searched; the reuse decision is recorded here. proof: the two
  searches described in this box, over `packages/create-threenative/capabilities.json` and
  `scripts/`.
  The OpenCode arm had no engine MCP tools in its worktree, so it searched the committed manifest
  directly: 356 entries, one tangential hit (`@threenative/core#getWorldCapabilities`, renderer
  limit facts — unrelated), and no public-API, surface-snapshot, semver or deprecation capability.
  The owning session also ran `engine_search_capabilities` for deprecation and capability metadata;
  neither found a matching system. A warm-up query's tangential hits were inspected with
  `engine_capability_detail` and were unrelated to this gate.
  `scripts/` holds none either: `check-capability-docs.ts` proves manifest symbols exist in built
  output, `ios-package-output-snapshot.ts` is the commit-a-snapshot precedent, and
  `check-version-pins.ts` is the script shape copied. **Reused, not rebuilt:**
  `workspace-packages.ts` supplies the published list and its export subpaths, `capabilities.json`
  supplies every exported class and function with its signature (`CAPABILITY_ALLOWLIST` is empty —
  "every exported class and function is a discoverable engine capability"), and
  `check-capability-docs --census` already guarantees every published package is walked. What did not
  exist and had to be added is the committed copy a regenerated manifest cannot disagree with —
  `scripts/api-surface.json` — plus `scripts/check-api-surface.ts`.
- [x] Committed surface snapshot for every published package. proof: `pnpm api:surface:check` →
  `api surface ok: 11 published packages, 335 symbols` (exit 0) and
  `pnpm exec vitest run scripts/__tests__/api-surface.spec.ts` → 9 passed.
  `scripts/api-surface.json` records 11 published packages and 335 symbols, each as
  `importPath#symbol` → signature, plus each package's export subpaths. `--update` is the only
  writer, so regenerating the manifest cannot absorb a removal. That command also runs Biome on
  the generated JSON; `pnpm lint` exits 0 after the sync. The package list is
  `publicWorkspacePackages()`, not the code-export filter: `@threenative/runtime-native` publishes
  with no `exports` map and is recorded honestly as `{"exports":[],"symbols":{}}`. The first cut
  filtered it away and a published package was outside its own contract; `records every published
  package, including one whose manifest declares no exports map` proves both halves. An empty
  committed snapshot fails `TN_API_SURFACE_SNAPSHOT_EMPTY`; the focused test failed before that
  guard and passed after it.
- [x] Red: deleting one exported symbol fails the check. proof: the `TN_API_SURFACE_UNANNOUNCED_BREAK`
  exit-1 run below.
  Deleted `export { formatAudioSizes } from "./report.js"` from `packages/assets/src/index.ts`,
  regenerated the manifest (`pnpm exec tsx scripts/build-capability-manifest.ts`, 356 → 355
  entries); `pnpm api:surface:check` exited **1** with `removed symbol @threenative/assets
  @threenative/assets#formatAudioSizes has no Breaking entry naming it`. The red caught a real gap in
  the first cut — a `### Breaking` section heading was not read as the marker, only the word inside
  a bullet — and that was fixed before the green. Source and both manifests were reverted with
  `git checkout --`. Durable regression proof: `fails when the live surface drops a published
  package, a subpath or a symbol` in `scripts/__tests__/api-surface.spec.ts`. A subpath is red the
  same way: with `./web-brand` dropped from `packages/create-threenative/package.json`,
  `pnpm api:surface:check` exited **1** with `export subpath create-threenative./web-brand is gone
  without a Breaking entry`.
- [x] Green: the same deletion passes once `CHANGELOG.md` carries a `Breaking` entry naming it.
  proof: the exit-0 run below, plus `accepts the same removal once a Breaking entry names it, and
  only that symbol` in `scripts/__tests__/api-surface.spec.ts`.
  With the deletion still in place, a `### Breaking` bullet naming `formatAudioSizes` was added under
  `## [Unreleased]`; `pnpm api:surface:check` exited **0** (`api surface ok: 10 published packages,
  334 symbols, every removal and signature change announced`). A subpath break was announced the same
  way and stayed green: with the `./web-brand` subpath still missing, a `### Breaking` bullet naming
  `create-threenative/web-brand` gave exit **0** (`api surface ok: 11 published packages, 335
  symbols`). The first cut could not reach that green — a removed subpath became a finding whether or
  not the changelog named it, so no note could ever retire one; the regression proof is `passes a
  removed export subpath once a Breaking entry names it, and only that subpath`. Both entries were
  temporary probes and were reverted with the deletions (`git checkout -- CHANGELOG.md
  packages/create-threenative/package.json`), so no broken or probe artifact is left in the tracked
  tree.
  A second review found a false green in the gate itself: `announcedBreakingSymbols` read the whole
  changelog, so a `Breaking` bullet under a shipped `## [0.3.2] - 2026-09-12` — an announcement that
  already served the consumers of that release — excused any removal made since, and the gate
  reported green on an unannounced break. A version section is now in scope only when explicitly
  marked unreleased and carrying no release date (`[Unreleased]`, and this cohort's
  `## [0.3.3] - unreleased (release candidate)`), and a
  changelog with no such section throws `TN_API_SURFACE_CHANGELOG_SCOPE_MISSING` rather than passing
  every break as announced. Red: `reads a Breaking entry only where the next release would carry it`
  failed with `expected [] to deeply equal [ Array(1) ]` — the finding `export subpath
  @threenative/gone. is gone without a Breaking entry` was swallowed by the dated 0.3.2 note. Green:
  the same note under `## [Unreleased]` and under the dated-less 0.3.3 candidate each retire the
  removal, while a dated-only changelog throws and an old version without a date does not excuse the
  break. Against the real `CHANGELOG.md` with a
  `formatAudioSizes` note injected under each heading in turn: `under 0.3.2 dated -> false`, `under
  [Unreleased] -> true`, `under 0.3.3 candidate -> true`, and the untouched file announces nothing;
  `pnpm exec vitest run scripts/__tests__/api-surface.spec.ts` → 9 passed and `pnpm api:surface:check`
  exits **0** (`api surface ok: 11 published packages, 335 symbols`). The change is the version-heading
  scope in one loop, not a changelog framework: multi-line bullets, the `### Breaking` heading marker
  and the whole-name package matcher are untouched, and the three red-greens above still hold. A
  full `pnpm test` was started but stopped after native runtime tests failed: this fresh checkout has
  neither the V8 nor QuickJS host executable those tests run. The full-suite gate remains unverified
  for this branch; the focused API test and typecheck passed.
- [x] The check runs in `pnpm ci:fast` or an existing required CI job. proof: the `drift` lane
  command from `scripts/ci-fast.sh` run verbatim → `Test Files 8 passed (8) / Tests 304 passed
  (304)`, and `pnpm exec vitest run scripts/__tests__/ci-fast.spec.ts` → 3 passed.
  `scripts/__tests__/api-surface.spec.ts` joins the existing `drift` lane of `scripts/ci-fast.sh`, so
  the pre-push hook fails on an unannounced break with no new lane and no change to the hook's own
  trace assertion.

- [x] A published package removed outright is announced by naming that exact package. proof: the
  red-then-green of `passes a removed published package once a Breaking entry names it, and only
  that package`; `pnpm api:surface:check` exit 0, focused spec 7 passed.
  Review found the root subpath doubling as the encoding for a package that is gone: a removal was
  recorded as subpath `.`, and `.` is not a name a changelog writes, so **no** entry could ever
  retire it — the one break a release must be allowed to announce was unannounceable. The test is red
  on that clause alone (`export subpath @threenative/gone. is gone without a Breaking entry` where
  the bullet names `@threenative/gone`) and green after the fix; the two neighbouring assertions hold
  throughout, so silence and a `Breaking` bullet naming `@threenative/kept` — or the longer
  `@threenative/gone-native` — still fail. The matcher is one greedy whole-name pattern rather than
  a loose token, so a package is never excused by a name that merely contains it or by prose that
  merely mentions it; it covers the three unscoped published packages too, which a `@scope/name`
  pattern alone would have left just as unannounceable. `pnpm api:surface:check` still exits **0**
  (`api surface ok: 11 published packages, 335 symbols, every removal and signature change
  announced`) and `pnpm exec vitest run scripts/__tests__/api-surface.spec.ts` → 7 passed.

### Phase 2 — The policy is written where authors read it

- [ ] Versioning and deprecation policy in `CONTRIBUTING.md`, linked from `README.md`.
- [ ] Deprecated symbols warn once at runtime and are marked deprecated in capability detail.
- [ ] `SECURITY.md` supported-versions table follows the policy.

### Phase 3 — A game upgrades from N-1

- [ ] Upgrade proof for `starter` on web: previous `latest` → candidate, scenario passes.
- [ ] Upgrade proof for `platformer` on web.
- [ ] Red: a candidate with an unannounced breaking change fails the upgrade proof.
- [ ] The upgrade proof runs in the release preflight before any cohort moves `latest`.

## Acceptance criteria

- [ ] An unannounced removal of a public symbol cannot reach `develop`.
- [ ] Every breaking change in the candidate has a `CHANGELOG.md` migration note.
- [ ] `starter` and `platformer` upgrade from the previous `latest` to the candidate without edits beyond the migration notes.
- [ ] `pnpm release:prepare` refuses a `1.0.0` version while any box above is open.

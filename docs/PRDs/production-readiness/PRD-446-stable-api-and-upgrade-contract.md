# PRD-446 — Stable API and upgrade contract

**Status:** NOT STARTED
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

- [ ] Existing surface tooling searched (capability manifest, `scripts/`); reuse or the reason not to is recorded here.
- [ ] Committed surface snapshot for every published package.
- [ ] Red: deleting one exported symbol fails the check.
- [ ] Green: the same deletion passes once `CHANGELOG.md` carries a `Breaking` entry naming it.
- [ ] The check runs in `pnpm ci:fast` or an existing required CI job.

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

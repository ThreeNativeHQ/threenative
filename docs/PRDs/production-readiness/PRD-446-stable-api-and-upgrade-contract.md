# PRD-446 — Stable API and upgrade contract

**Status:** PARTIAL — phases 1 and 2 verified; starter and platformer passed the real phase-3 dry
run, while the publish preflight and final acceptance remain open (`prd:75%`).
**Complexity:** 6 → MEDIUM; touches release scripts, CI, and the physics deprecation warning.
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

- [x] Versioning and deprecation policy in `CONTRIBUTING.md`, linked from `README.md`. proof:
  `pnpm check:docs` → `Checked 2345 relative documentation links across 1155 Markdown files`
  (exit 0) and the strict prose lane
  (`check-doc-links`, `evidence-budget`, `evidence-citations`, `sync-agent-docs`, `ci-structure`,
  `ci-needs`) → 6 files / 179 tests passed.
  A new `## Versioning and deprecation` section defines the public surface as every published
  package's exported symbols, types, and export subpaths (the 11 in `scripts/api-surface.json`); states
  `patch`-fixes / `minor`-may-break before 1.0, semver-as-written at and after 1.0; fixes the
  deprecation window at one minor with no separate clock; and requires every announced break to
  carry a `### Breaking` migration note (old name, new name, the edit). The pre-1.0 promise leans on
  the phase 1 gate for exported classes/functions and subpaths: it fails without a `Breaking` entry
  naming those removals. Type-only exports and version-bump enforcement remain open for 1.0; the
  policy states the promise without claiming those gates ship yet.
  Linked from `README.md`'s Docs list by anchor. The one-time `console.warn` and the
  capability-manifest `deprecated` marker are written as requirements of a deprecation and
  implemented in the box below.
- [x] Deprecated symbols warn once at runtime and are marked deprecated in capability detail.
  proof: a red test per half, then the focused green (a `__tests__/*.spec.ts` for the once-per-process
  warning and for the manifest marker read back through `engine_capability_detail`).
  Implementation and its red-green are verified below.
  Runtime half: one guard in the seam all four node classes already route through,
  `requirePhysicsSimulation` (`packages/physics/src/simulation.ts:1284`), fires once per process
  (module-level flag) whenever the `world` option is *supplied* — it runs before every resolution
  path, so a caller passing `world` next to a `physics` context still hears it, and the current
  `physics` path stays silent. Red with the guard after the `physics.simulation` early return:
  `warns on the supplied option even when a context resolves the simulation first` failed on
  `expected "warn" to be called 1 times, but got 0 times`. Green: `pnpm exec vitest run
  packages/physics/__tests__/deprecation.spec.ts`
  → 2 passed; physics lane `pnpm exec vitest run packages/physics/__tests__/` → 26 files / 182 tests
  passed.
  Manifest half: one optional entry field `deprecated`, absent rather than empty when untagged, fed
  by a new `@deprecatedOption` capability tag (`scripts/build-capability-manifest.ts:238`) instead of
  `@deprecated` — TypeScript reads that tag as deprecating the whole exported class, so the four
  node classes carry `@deprecatedOption` and the real `@deprecated` tags on the `world` option
  fields stay. `ICapabilityEntry` declares and validates it, so `engine_capability_detail` returns
  the note naming `world` and `physics` for those four and `undefined` for `CollisionShape3D`;
  `generate-capability-reference.ts` renders it. Red: the builder spec failed on the missing
  `deprecated` field and the detail spec on `RigidBody3D: expected '' to contain '\`world\`'`. Green:
  `pnpm exec vitest run scripts/__tests__/capability-manifest.spec.ts
  packages/engine-mcp/__tests__/search.spec.ts` → 81 tests passed, widened to the engine-mcp,
  recall, duplicate and api-surface lanes → 8 files / 142 tests passed.
  `pnpm capabilities:sync` regenerated both manifest copies (356 entries; 4 carry `deprecated`:
  `Area3D`, `CharacterBody3D`, `Joint3D`, `RigidBody3D`); `pnpm capabilities:check`,
  `tsx scripts/generate-capability-reference.ts --check`, `pnpm api:surface:check`, `pnpm typecheck`
  and `pnpm lint` exit 0. Not run in this lane: full `pnpm test` and the native lanes.
- [x] `SECURITY.md` supported-versions table follows the policy. proof: same
  `pnpm check:docs` and strict prose lane runs above (exit 0, 179 tests).
  The table supports each package's latest published minor line and drops older minor lines of that
  package. The policy is per package because current manifest versions are not numerically aligned:
  for example, `@threenative/core` is 0.3.3, `create-threenative` is 0.2.6, and
  `threenative-blender-mcp` is 0.1.3 in this checkout. The prose links the policy and says 1.0 is
  not released. No specific registry version is asserted by this table, so it stays correct as the
  next cohort publishes.

### Phase 3 — A game upgrades from N-1

The lane is a mode of the clean-room installer, not a second one: `verifyRegistryInstall` already
scaffolds from the registry `latest`, refuses a lockfile resolving from this machine, edits the game,
builds it and drives a real web scenario. Given a `candidate` — packed tarballs plus cohort versions —
it inserts two steps, `surface` and `upgrade`, claims web only (`doctor`, the native host and the MCP
table describe the *published* tree, which the post-publish lane still runs in full), and stops the
case at the first red step. `stepPlan(upgrade)` is the single list the not-run bookkeeping reads.

**What identifies the candidate.** Not the version. A cohort in development can carry the same
version as the `latest` it upgrades from, so `node_modules/<name>/package.json` reading the right
number proves nothing. Two checks run instead, both fail-closed: `assertCandidateInstalled` names the
version the consumer really resolved (`TN_REGISTRY_UPGRADE_VERSION_MISMATCH`), and
`assertCandidateIntegrity` compares the SHA-512 of each packed tarball against the `integrity` the
installed lockfile records for it (`TN_REGISTRY_UPGRADE_INTEGRITY_MISMATCH`). That field is what pnpm
writes as `packages.<name>.resolution.integrity` and npm as `packages["node_modules/<name>"].integrity`
for a `file:` tarball; the reader handles both line shapes, and the two real formats were checked
once against live `pnpm pack` + `pnpm add` (pnpm 10.25.0, lockfileVersion 9.0) and `npm install
--package-lock-only` (lockfileVersion 3) output. *Limit, stated rather than hidden: this proves the
resolution the manager recorded, not a re-hash of the unpacked tree on disk.*

**Cost.** One package manager per template, `UPGRADE_PACKAGE_MANAGERS = ["pnpm"]`, because that is the
lockfile carrying the integrity. Two templates therefore cost two clean rooms, not four. The
post-publish clean room still runs npm and pnpm in full — that lane is about the published registry,
not about a candidate.

- [x] Upgrade proof for `starter` on web: previous `latest` → candidate, scenario passes. proof:
  `pnpm release --allow-missing-prebuilt --skip-gates` on the prepared 11-package cohort printed
  nine `pass` steps from scaffold through gameplay for `Upgrade proof — starter`; the same run
  passed platformer and exited 0. No package was published.
  Wired and unit-proven: `pnpm exec vitest run
  scripts/__tests__/verify-registry-install.spec.ts` → 41 passed. The step list is exactly `pnpm:
  scaffold, install, lockfile, surface, upgrade, edit, build, test, gameplay`; the install carried the
  packed tarball; the playtest carried `playtests/survives.playtest.json` (`UPGRADE_SCENARIO`, five
  non-empty assertion families in both `starter` and `platformer` in this checkout) and not the
  registry lane's `production-readiness` guard; the upgrade step reported the cohort and the
  candidate's SHA-512. Red-green on the byte check: `rejects a matching version whose bytes are not
  the candidate's, which is the case a version cannot catch` installs the right version with a foreign
  integrity and reads `TN_REGISTRY_UPGRADE_INTEGRITY_MISMATCH`; `fails closed when no lockfile records
  the candidate's integrity at all` covers the missing-lockfile and no-integrity branches. Nothing was
  published and no dist-tag moved; the candidate versions were prepared locally.
- [x] Upgrade proof for `platformer` on web. proof: the same real
  `pnpm release --allow-missing-prebuilt --skip-gates` dry run printed nine `pass` steps from
  scaffold through gameplay for `Upgrade proof — platformer` and exited 0, without publishing.
  `UPGRADE_PROOF_TEMPLATES = ["starter", "platformer"]`, and `upgrades the previous latest onto the
  packed candidate, on both named templates` asserts each template receives the same tarballs and
  cohort versions. An earlier run stopped at the previous `latest`'s install while npm served
  `@gltf-transform/functions@4.5.1` without its required core version; npm later published
  `@gltf-transform/core@4.5.1`, and the subsequent clean-room run passed.
- [x] Red: a candidate with an unannounced breaking change fails the upgrade proof. proof: the
  `surface` step red below, plus phase 1's real `pnpm api:surface:check` exit 1.
  The proof runs the existing `api:surface:check` before it installs a byte and refuses a red
  candidate. Red: `refuses a candidate whose public break is unannounced, before installing a byte of
  it` failed with the tarball install already run and the matrix carrying on. Green: the `surface`
  step ends the case, no install was attempted, and `upgrade` and `gameplay` read `Not run`. The gate
  is not reimplemented — it is the same script phase 1 proved red on a deleted export, so a silent
  break cannot reach the upgrade step by a second route. Box ticked on the unit proof; the release
  run that exercises it end to end is the open preflight box below.
- [x] A failed candidate install stops the case, so no unproven tree is built or played. proof:
  `stops the case when the candidate install fails, so no unproven tree is built or played` in the
  33-pass run above (exit 0).
  Red: the step was recorded and the lane went on to `edit`, `build`, `test` and a real playtest of a
  tree the candidate never reached. Green: `edit`, `build`, `test` and `gameplay` all read
  `Not run: the candidate install failed, so no candidate bytes reached this game.`, and the playtest
  runner was never invoked. Unit proof, which is the whole claim: the control flow is the assertion.
- [ ] The upgrade proof runs in the release preflight, after the unpublished-version check and before any cohort moves `latest`. proof: a real `pnpm tsx scripts/release.ts --yes` run reaching the publish loop with both upgrade blocks green. **The real run is unverified.**
  `release.ts` proves the exact cohort absent from npm (`unpublishedReleasePackages`), then packs it
  (`packReleaseSet` returns the name → tarball map instead of packing into a directory it deletes),
  then `proveUpgradeFromLatest` runs the clean room per template and throws
  `TN_RELEASE_UPGRADE_RED`. Order is asserted structurally, as the existing post-build gate is: the
  cohort check sits after the post-build preflight and before `proveUpgradeFromLatest`. Both halves
  are load-bearing — the cohort check is what makes "the candidate version" a real identity on the
  release path, and the proof has to precede the publish because once `latest` has moved there is no
  N-1 left to upgrade from. It is not skipped by `--skip-gates`, so the `npm-release` lane's
  `release.ts --yes --skip-gates` gets it. Candidate versions are `publishSet(REPO)` output and are
  not one number: in this checkout `@threenative/core` is 0.3.4 and `@threenative/assets` is 0.3.5, so
  the spec reads the real version from `packages/core/package.json` instead of inventing one.

## Acceptance criteria

- [ ] An unannounced removal of a public symbol cannot reach `develop`.
- [ ] Every breaking change in the candidate has a `CHANGELOG.md` migration note.
- [x] `starter` and `platformer` upgrade from the previous `latest` to the candidate without edits beyond the migration notes. proof: both nine-step `Upgrade proof` blocks passed in the real `pnpm release --allow-missing-prebuilt --skip-gates` run, exit 0; no package was published. The only edit the lane
  makes is the `dist/`-observable marker, it is applied *after* the upgrade step, and a candidate
  with no announced break requires no migration edit at all.
- [ ] `pnpm release:prepare` refuses a `1.0.0` version while any box above is open. proof:
  `pnpm exec vitest run scripts/__tests__/prepare-release.spec.ts` → 8 passed, including
  `refuses while the real PRD-446 has open boxes, and names them`, plus a real `pnpm
  release:prepare` against a `1.0.0` cohort.
  `assertOneZeroGatesClosed` counts unticked phase and acceptance boxes through the repository's own
  reader (`progressOf`, the one behind `pnpm prd:progress`) rather than a second one that could
  disagree with it, refuses a PRD with no phase boxes, and `main()` calls it *before*
  `syncReleaseMetadata` writes anything — the bump
  nobody wants to walk back never lands. It refuses only when a selected version is exactly
  `1.0.0`; every other cohort is untouched. Red was structural, not simulated: the guard did not
  exist, and `accepts the same PRD once every phase and acceptance box is ticked` is the half that
  stops a refusal from being an unconditional throw. A gate PRD that has moved throws
  `TN_RELEASE_1_0_0_GATE_MISSING` rather than passing. `RELEASE_1_0_0_GATES` names PRD-446; a second
  cohort that gates 1.0 adds its file there. A real `pnpm release:prepare` run passed for this 0.3.x
  cohort; the `1.0.0` refusal remains unit-proven only, so this box stays open.

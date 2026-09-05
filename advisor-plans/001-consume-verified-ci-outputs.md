# Plan 001: Consume verified CI outputs once

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise.
>
> **Drift check (run first)**: `git diff --stat 3fd88f4d..HEAD -- package.json scripts/run-test-suite.sh scripts/__tests__/run-test-suite.spec.ts scripts/__tests__/ci-structure.spec.ts .github/workflows/ci.yml .github/workflows/native-platforms.yml .github/workflows/site.yml .github/actions/pnpm/action.yml .github/actions/playwright-chromium/action.yml`
> Expected result at authoring time: no output. If any in-scope file changed,
> compare the excerpts below against the live files before proceeding.

## Status

- **Priority**: P1
- **Effort**: M (a day-ish)
- **Risk**: MED
- **Depends on**: none
- **Category**: perf
- **Planned at**: commit `3fd88f4d`, 2026-09-04

## Why this matters

The required CI run already builds workspace outputs in `test`, and the browser
jobs restore or build the same outputs through `workspace-dist`; several invoked
commands build them again. The iOS lane also rebuilds the public package set
after its simulator verifier, and Android/desktop each capture the same web
reference independently. Removing only verified duplicate work preserves the
existing gates while reducing runner minutes and the time agents wait for a
green branch.

## Current state

- `.github/workflows/ci.yml:73-94` runs `pnpm test` with
  `TN_SUITE_PHASES: "docs,build,package-test"`; `scripts/run-test-suite.sh:252-256`
  runs the workspace build before each package's `test` script.
- `packages/assets/package.json:33-35`, `packages/ueformat/package.json:36-38`,
  `packages/raw-unreal/package.json:33-35`, and `site/package.json:9,13-14`
  rebuild during their standalone `test` paths. Keep standalone package tests
  self-contained for developers; add an explicit, verified-prebuilt CI path
  rather than silently changing their default behavior.
- `package.json:63` makes `test:browser` build `@threenative/playtest`, and
  `package.json:66` makes `test:playtest:ci` build it. The corresponding jobs
  already run `.github/actions/workspace-dist` at `.github/workflows/ci.yml:381`
  and `:421`, whose action restores/builds `packages/*/dist` and packed archives
  at `.github/actions/workspace-dist/action.yml:25-65`.
- `.github/workflows/native-platforms.yml:687-692` builds every archive package;
  `:705-713` builds the same package list again before packing. The intervening
  `verify-ios-simulator.mjs:296-301,321-330` builds the native smoke/playtest
  consumers, not the public archive package set.
- `.github/workflows/native-platforms.yml:161-174` and `:353-361` independently
  capture the same web conformance reference. Existing evidence in
  `docs/verification/native-platforms-red-2026-09-02.md:148-156` measured the
  duplicate at about three minutes and ranked artifact handoff as the preferred
  fix.
- `.github/workflows/site.yml:28-40` uses direct pnpm setup and direct Chromium
  installation, while `.github/actions/pnpm/action.yml` and
  `.github/actions/playwright-chromium/action.yml` are the repository's pinned,
  cache-aware setup paths. Android at `native-platforms.yml:146-149` also bypasses
  the browser action.

Repository constraints: preserve fail-closed behavior; do not raise evidence
budgets; do not delete evidence in this performance plan; keep the default
developer commands self-contained; and update structural tests whenever a
workflow contract changes. Match the existing workflow-contract style in
`scripts/__tests__/ci-structure.spec.ts`.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Focused structure tests | `pnpm exec vitest run scripts/__tests__/ci-structure.spec.ts scripts/__tests__/run-test-suite.spec.ts` | all tests pass |
| Typecheck | `pnpm typecheck` | exit 0, no errors |
| Lint | `pnpm lint` | exit 0 |
| Full unit/package gate | `pnpm test` | exit 0; default standalone tests remain covered |
| Budget/docs gate | `pnpm budgets` | exit 0; no cap is raised |

## Scope

**In scope** (the only files to modify):

- `package.json`
- `scripts/run-test-suite.sh`
- `scripts/__tests__/run-test-suite.spec.ts`
- `scripts/__tests__/ci-structure.spec.ts`
- `.github/workflows/ci.yml`
- `.github/workflows/native-platforms.yml`
- `.github/workflows/site.yml`
- `.github/actions/pnpm/action.yml`
- `.github/actions/playwright-chromium/action.yml`

**Out of scope**:

- Any evidence deletion or evidence-budget change.
- Public runtime/package source, template source, or package APIs.
- Changing the default local `pnpm test`, `pnpm test:browser`, or standalone
  package `test` contract without an equivalent self-contained replacement.
- Release-only workflows, cache hit-rate tuning without measurements, and
  native conformance row removal.

## Git workflow

- Use the repository's current branch convention and commit each logical unit
  with a conventional-commit message, matching recent examples such as
  `perf(ci): ...`.
- Do not push or open a PR unless the operator separately instructs it.

## Steps

### Step 1: Add an explicit verified-prebuilt test path

Introduce the smallest explicit seam that lets CI consume the outputs supplied
by `.github/actions/workspace-dist` without rebuilding them. The seam must:

1. leave the default developer commands self-contained;
2. fail when the expected Playwright runner or workspace archive is absent;
3. let the `test` job's package-test phase run its checks without repeating the
   package build already performed by the preceding `build` phase; and
4. keep publint, orphan cleanup, bundle checks, and the root unit suite in the
   same overall gate.

Prefer a named `:ci`/prebuilt command or an explicit environment contract over
an implicit "dist happens to exist" branch. Add structural tests proving the
default and CI paths, the phase partition, and the absence check. Update the
browser and playtest jobs to use the pure path only after their existing
workspace-dist action.

**Verify**: `pnpm exec vitest run scripts/__tests__/ci-structure.spec.ts scripts/__tests__/run-test-suite.spec.ts` → all focused structure tests pass, including the new prebuilt/default contract checks.

### Step 2: Reuse the verified iOS package build

In the iOS job, retain the first archive-package build before
`verify-ios-simulator.mjs`. Before packing, assert that the package outputs
needed by `workspace-packages.ts --archives` still exist and have not changed
across the verifier. Then remove only the second public-package build loop and
pack the verified outputs. Do not remove the native-smoke/playtest builds or
the simulator verification.

Add a workflow-structure or script test that fails if the same archive set is
built again between the initial build and packing, while still requiring the
pack step and the simulator verifier.

**Verify**: `pnpm exec vitest run scripts/__tests__/ci-structure.spec.ts` → the iOS reuse contract passes and still requires package packing plus simulator verification.

### Step 3: Capture the web reference once per commit

Create one commit-keyed web-reference producer before the Android and desktop
parity lanes, upload its complete output, and make both lanes download that
artifact. Preserve `check-lane-blocks` validation in the consumer lanes and
keep all native conformance rows. The artifact key/name must include the
checked-out commit so a lane cannot consume another revision's reference.

Extend `ci-structure.spec.ts` to prove there is one producer, two consumers,
commit identity is part of the handoff, and neither lane silently falls back to
capturing its own reference.

**Verify**: `pnpm exec vitest run scripts/__tests__/ci-structure.spec.ts` → the single-producer/two-consumer contract passes.

### Step 4: Use the existing cached setup actions everywhere in scope

Replace the site workflow's direct pnpm setup/browser install and Android's
direct Chromium install with the existing local composite actions, preserving
each job's Node version, dependency installation, and system-library setup.
If the site needs a setup behavior not provided by the local action, stop and
report instead of duplicating it or widening this plan.

Add structure assertions that site and Android use the cache-aware actions and
do not retain direct `pnpm/action-setup` or `playwright install --with-deps
chromium` calls in those lanes.

**Verify**: `pnpm exec vitest run scripts/__tests__/ci-structure.spec.ts` → setup-action assertions pass.

### Step 5: Run the complete local gates

Run the focused tests first, then `pnpm typecheck`, `pnpm lint`, `pnpm test`,
and `pnpm budgets`. Inspect `git status --short` and confirm only the scoped
files changed. If a gate needs generated output, regenerate it using the
repository's executable and include only the generated file that belongs to
this plan.

**Verify**: `pnpm typecheck && pnpm lint && pnpm test && pnpm budgets` → all commands exit 0.

## Test plan

- Extend `scripts/__tests__/ci-structure.spec.ts` for the prebuilt browser and
  playtest paths, the package-test build boundary, iOS package-output reuse,
  single web-reference production, and setup-action reuse.
- Extend `scripts/__tests__/run-test-suite.spec.ts` for the explicit prebuilt
  mode, including missing-output failure and default full-gate behavior.
- Keep standalone package tests and local browser/playtest commands covered by
  the existing full `pnpm test` and focused command paths.

## Done criteria

- [ ] The default developer test commands still build or validate their own
      prerequisites.
- [ ] CI consumes the verified workspace and Playwright outputs once.
- [ ] iOS public archive packages are built once and packed after an identity
      check.
- [ ] Android and desktop consume one commit-keyed web reference.
- [ ] Site and Android use the existing cache-aware setup actions.
- [ ] `pnpm typecheck`, `pnpm lint`, `pnpm test`, and `pnpm budgets` exit 0.
- [ ] No evidence budget is raised and no evidence file is deleted.
- [ ] No files outside the scope list are modified.
- [ ] `advisor-plans/README.md` status row is updated by the executor.

## STOP conditions

Stop and report if:

- The drift check finds an in-scope change after commit `3fd88f4d` and the live
  code no longer matches the excerpts.
- A required cache action does not provide the setup behavior claimed here.
- Removing a build would make a standalone command depend on undocumented
  `dist/` state or would remove a fail-closed absence check.
- The iOS verifier mutates the public archive package outputs, or a checksum
  assertion cannot distinguish that mutation from an unchanged build.
- Android and desktop require different web-reference inputs than the shared
  conformance output, or the commit-keyed artifact cannot be made available to
  both lanes.
- Any gate fails twice after a reasonable fix attempt, or the implementation
  needs a file outside the scope list.

## Maintenance notes

- Keep the explicit prebuilt contract documented beside the command that
  consumes it; a future package added to the workspace must fail closed if its
  output is absent.
- Review cache keys and artifact names whenever package manifests, template
  manifests, or conformance schema changes.
- Measure actual wall time and runner-minute deltas in a follow-up CI run before
  claiming a numeric saving; this audit intentionally did not invent one for
  duplicate build passes without isolated telemetry.

---
prd_contract: v1
---

# PRD-112 repair — The packed golden path must describe and execute the path it proves

**Status: BLOCKED, 2026-08-15.** The implementation is integrated in `0a689f1` and
`4fa847d`, but the exact packed seven-template gate remains red in the action-rpg test layer.
The first failure was a 30-second `page.screenshot` timeout; the runner now falls back to the
canvas surface, which lets the first four action-rpg scenarios pass, but the next scenario still
fails with `TN_PLAYTEST_RUNNER_FAILED: page.evaluate: Execution context was destroyed, most likely
because of a navigation`. The remaining doubtful assumption is that the headed WebGPU page can be
reused safely across the packed scenarios. Keep this PRD active until the exact gate is green.

Fresh repair for the review-2 blocker on capped lane
`linchpin/prd-112-golden-path-from-packed-artifacts-r2` at `c005d91`. The source PRD remains
unchanged.

**Complexity: 2 → LOW mode.** Six existing files across the scaffolder package and repository
verification scripts; no new module, package, public command, or native claim.

**Exact review-2 defects.** The lane retains an unreproduced Vite config-loader rewrite at
`packages/create-threenative/src/config.ts:367`; advertises `threenative dev|test|ship` even though
`main` still sends every non-help invocation to the build parser; emits corrective strings with
placeholders or prose that cannot be executed from their stated directory; and discovers a
mutated alternate template root while the packed `create-threenative` tarball still scaffolds the
repository template. The last control therefore goes red before scaffolding and never proves the
packed mutated artifact is broken.

## 1. Context

**Problem.** The source PRD required reproduction before a resolver change. The lane's own
`docs/verification/prd-112-golden-path-2026-08-15.md:5-43` records
`TN_CONFIG_TRANSPILER_MISSING` as not reproduced across all seven packed templates, yet commit
`61116cb` had already replaced the esbuild loader with a Vite `loadConfigFromFile` path. Review 2
also found the repair evidence broader than the executable CLI and weaker than its claimed packed
negative control.

**Files analyzed.**

- `61116cb` and `c005d91` diffs for `packages/create-threenative/src/config.ts`
- `c005d91:packages/create-threenative/src/threenative.ts:4-57`
- `c005d91:packages/create-threenative/src/build.ts` and its `parseBuildArgs`
- `c005d91:scripts/verify-golden-path.ts:103-139,410-575,653-709`
- `c005d91:scripts/__tests__/verify-golden-path.spec.ts`
- `c005d91:docs/verification/prd-112-golden-path-2026-08-15.md`
- the source PRD's four-command prohibition and its seven-template packed journey

## 2. Solution

1. Remove only the unreproduced Vite-owned resolver path and its synthetic resolver test. Restore
   the pre-lane project/Vite-owned/CLI esbuild resolution behavior while retaining actionable error
   context that is independently required.
2. Make help truthful by documenting only commands accepted by the current parser. The source PRD
   does not require implementing `dev`, `test`, or `ship`; its golden journey deliberately invokes
   `pnpm dev`, `pnpm test`, and the supported `threenative build`. Do not add command dispatch here.
3. Represent every corrective command as an actual command plus an actual working directory. No
   `<project>`, `<free-port>`, `inspect …`, or other prose may appear in an executable slot.
4. For the alternate-template control, mutate a temporary copy of the template inside a temporary
   `create-threenative` package source, build and pack that package, scaffold from that tarball, and
   observe the generated project's genuinely broken dependency. The repository template tarball is
   never substituted for the mutated one.

**Data changes:** none. Tarballs and projects remain temporary and untracked.

## 3. Integration points

**Reachability.** Root `package.json` calls `scripts/verify-golden-path.ts`; that script packs the
workspace, invokes the packed `create-threenative` binary, and then runs each generated project's
real commands. `packages/create-threenative/src/threenative.ts` is the published build executable.

**Caller census (paste during implementation):**

```sh
rg -n "verify:golden-path|verifyGoldenPath\(|writeScaffoldScript\(|runCommand\(" \
  package.json scripts .github -g '*.json' -g '*.ts' -g '*.yml'
rg -n "parseBuildArgs\(|cliHelp\(|Usage: threenative" \
  packages/create-threenative/src packages/create-threenative/__tests__ -g '*.ts'
```

Expected: `verify:golden-path` is a live root command, the packed scaffolder is the real producer,
and the only advertised `threenative` command is one the parser accepts.

**Revert check.** Reintroducing the Vite branch fails the no-unreproduced-rewrite regression;
reintroducing `dev|test|ship` help fails the parser/help agreement test; substituting the repository
tarball for the mutated tarball makes the packed negative-control identity assertion fail.

## Integration Ledger

| # | New thing | Live caller (`file:line`, non-test) | Replaces | Old path removed? | Negative control |
| --- | --- | --- | --- | --- | --- |
| 1 | original config transpiler resolution with actionable context | `packages/create-threenative/src/config.ts:433` | unreproduced Vite `loadConfigFromFile` branch at baseline `:367` | yes | regression rejects the Vite-loader branch after non-reproduction |
| 2 | parser-derived CLI help | `packages/create-threenative/src/threenative.ts:57` | static promises for unsupported `dev`, `test`, `ship` | yes | each advertised command is invoked; unknown commands remain red |
| 3 | executable corrective command record | `scripts/verify-golden-path.ts:126` | placeholder/prose command strings | yes | test executes each emitted command from its emitted cwd |
| 4 | packed mutated-template control | `scripts/verify-golden-path.ts:663` | alternate-root manifest precheck against an unmutated tarball | yes | tarball identity differs and generated manifest contains the mutation before the broken dependency fails |

## 4. Execution Phases

### Phase 1: Config loading matches the reproduced evidence

**User-testable vertical slice.** A generated packed project loads its TypeScript config through
the original resolution chain, and no unmeasured Vite resolver replacement remains.

**Files (2):**

- `packages/create-threenative/src/config.ts` — EDIT: remove the Vite-specific declared-module
  branch and restore the pre-`61116cb` transpiler resolution while preserving actionable errors.
- `packages/create-threenative/__tests__/config.spec.ts` — EDIT: remove the synthetic Vite-loader
  expectation; add a regression pinning the reproduced esbuild resolution/failure behavior.

**Implementation.**

1. Delete `resolveDeclaredModule` / `loadConfigWithVite` and the call at baseline line 367 when they
   have no remaining caller.
2. Restore one esbuild resolver owner; do not leave parallel Vite and esbuild config evaluators.
3. Keep failure code, layer, searched locations, and a real corrective command.
4. Record the framework LOC delta; this phase should be a net deletion.

**Focused gate:**

```sh
pnpm exec vitest run packages/create-threenative/__tests__/config.spec.ts
```

**Revert check:** restore the Vite call at `importConfig`; the focused regression fails because a
not-reproduced implementation path has returned.

### Phase 2: Help and failure recovery are executable

**User-testable vertical slice.** A user sees only supported CLI help, and can copy each golden-path
corrective command into the exact directory named beside it without editing placeholders.

**Files (4):**

- `packages/create-threenative/src/threenative.ts` — EDIT: derive help from supported parser
  behavior; remove unsupported command promises.
- `packages/create-threenative/__tests__/cli.spec.ts` — EDIT: invoke every advertised command and
  prove unsupported commands are not advertised or accepted.
- `scripts/verify-golden-path.ts` — EDIT: carry concrete `{ cwd, command, args }` recovery data and
  render shell-safe, placeholder-free text.
- `scripts/__tests__/verify-golden-path.spec.ts` — EDIT: execute each failure-layer corrective
  command from its stated cwd using bounded temporary fixtures.

**Implementation.**

1. Keep `build` help and root help accurate; do not implement unrelated commands.
2. Generate ports, project names, and paths before formatting errors.
3. Replace prose recovery entries with executable commands. Explanatory text may follow, but it is
   not labeled `Corrective command`.
4. Tests must reject angle-bracket placeholders and must actually spawn the recorded command, not
   merely compare strings.

**Focused gate:**

```sh
pnpm exec vitest run packages/create-threenative/__tests__/cli.spec.ts \
  scripts/__tests__/verify-golden-path.spec.ts
```

**Revert check:** restore the `COMMAND_HELP` table from `c005d91` or a `<free-port>` placeholder;
the focused tests fail on parser disagreement or command execution.

### Phase 3: The packed negative control mutates the artifact under test

**User-testable vertical slice.** All seven repository templates complete the real packed journey,
while a separately packed mutated template scaffolds successfully and then fails because its
generated dependency is truly broken.

**Files (2):**

- `scripts/verify-golden-path.ts` — EDIT: allow the pack source for the temporary scaffolder to be
  explicit and preserve tarball/source identity in diagnostics.
- `scripts/__tests__/verify-golden-path.spec.ts` — EDIT: create, pack, scaffold, and inspect a
  mutated template package before asserting the downstream dependency failure.

**Implementation.**

1. Copy the minimal `create-threenative` package source to a temporary root and mutate one template
   there; never mutate the repository template.
2. Build and pack that temporary package, then pass its tarball to `pnpm dlx`.
3. Assert the generated project's `package.json` contains the mutation and the packed tarball hash
   is not the repository tarball hash before expecting red.
4. Retain the normal `pnpm verify:golden-path` run over all seven discovered repository templates,
   including scaffold, install, MCP, dev, test, web build, and artifact checks.

**Focused and journey gates:**

```sh
pnpm exec vitest run scripts/__tests__/verify-golden-path.spec.ts
pnpm verify:golden-path
```

**Revert check:** point the control back at the repository tarball; the identity/generated-manifest
assertion fails before the control can be accepted as evidence.

## Negative Controls

| Gate | Negative control | Expected red | Exact command/result |
| --- | --- | --- | --- |
| resolver scope | restore `loadConfigWithVite` | the no-unreproduced-rewrite regression detects the Vite loader | `command: pnpm exec vitest run packages/create-threenative/__tests__/config.spec.ts`; result: RED observed: unreproduced Vite config-loader branch remained reachable; exit: 1 |
| CLI truth | advertise `dev` without dispatch support | the help/parser agreement test invokes an advertised unsupported command | `command: pnpm exec vitest run packages/create-threenative/__tests__/cli.spec.ts`; result: RED observed: help advertised dev but parser rejected the advertised invocation; exit: 1 |
| corrective commands | emit one placeholder or prose-only command | execution from the recorded cwd fails before the corrective action | `command: pnpm exec vitest run scripts/__tests__/verify-golden-path.spec.ts`; result: RED observed: corrective command contained a placeholder or prose and could not execute from its recorded cwd; exit: 1 |
| packed mutation identity | use the repository tarball for the alternate control | tarball identity or generated-manifest mutation assertion fails | `command: pnpm exec vitest run scripts/__tests__/verify-golden-path.spec.ts`; result: RED observed: alternate control scaffolded from the repository tarball instead of the mutated packed tarball; exit: 1 |
| broken packed dependency | restore the removed dependency inside the temporary package before packing | the negative run completes instead of failing on the broken packed dependency | `command: pnpm exec vitest run scripts/__tests__/verify-golden-path.spec.ts`; result: RED observed: mutated packed dependency was restored and the negative journey unexpectedly completed; exit: 1 |
| seven-template journey | remove one real packed dependency from one temporary packed control | the journey reports a missing template/layer instead of completing all seven templates | `command: pnpm verify:golden-path`; result: RED observed: the seven-template packed journey skipped or failed to name one template dependency layer; exit: 1 |

All controls use temporary roots. Workers record exact commands, exit codes, resolved tarball hashes,
and generated manifest paths before cleanup.

## Acceptance Criteria

**Consumer-scoped acceptance.** A user starting from packed artifacts must be able to execute the
advertised journey and recovery commands; helper or test existence alone is not completion.

- [ ] No Vite config-loader rewrite remains from the non-reproduced Phase 0 claim; packed configs
  still load through one owned resolution path.
- [ ] Root and command help advertise only parser-supported commands; no `dev`, `test`, or `ship`
  promise is added without an existing-PRD requirement and real dispatch.
- [ ] Every emitted corrective command runs unchanged from its recorded cwd; placeholders and prose
  in the command field fail tests.
- [ ] The alternate control packs and scaffolds the mutated template, proves tarball identity and
  generated-manifest mutation, then goes red on the broken dependency.
- [ ] Every one of the seven repository templates completes the real packed web journey from an
  empty temporary directory.
- [ ] Caller census, incumbent deletion, and all revert checks are recorded.
- [ ] Focused tests, `pnpm typecheck && pnpm lint && pnpm test`, and `pnpm budgets` pass; the
  framework LOC delta is reported and no review trigger is hidden.

## Verification Evidence

Contract conformance: prd_contract: v1

Observed implementation and gate evidence:

- `pnpm typecheck` passes after the runner repair.
- `pnpm exec vitest run packages/playtest/__tests__/runner.spec.ts packages/playtest/__tests__/e2e-runner.spec.ts`
  passes: 2 files, 52 tests.
- The first exact `pnpm verify:golden-path` attempt reached the packed `action-rpg` scenario and
  failed at `page.screenshot: Timeout 30000ms exceeded`.
- `4fa847d` adds a guarded canvas fallback in `packages/playtest/src/runner/runner.ts`; a rerun
  passed the `survives`, `combat`, `inventory`, and `progress` action-rpg scenarios, then failed in
  the next action-rpg scenario with the navigation/context-destroyed error recorded above.
- Therefore the seven-template packed journey, tarball identities, and final gate output remain
  incomplete. This PRD is blocked at the consumer gate; no completion archive is permitted.

## Checkpoint Protocol

After each phase, the reviewer must verify:

1. The phase changed only its exact file list and edited at least one pre-existing production file.
2. Integration Ledger callers are real non-test `file:line` values and replaced paths are gone.
3. Caller census and revert checks are pasted with observed output.
4. Every green gate has its specified observed-red control and restored-green run.
5. Packed-path identity proves what was packed and scaffolded; a manifest-only precheck is FAIL.

Any new public command, surviving Vite resolver fork, non-executable recovery string, source-PRD
edit, generated `CLAUDE.md` edit, or claim beyond packed web output fails the checkpoint.

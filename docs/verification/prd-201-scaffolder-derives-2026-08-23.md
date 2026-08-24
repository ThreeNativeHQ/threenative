# PRD-201 verification — 2026-08-23

## Scope

Lane `lane-201` changed the scaffolder's discovery message, package-source enumeration,
template substitution, texture-config ownership, and PNG parsing. The shared parser lives in
`packages/assets/src/png.ts`, because assets owns the PNG and image-processing dependency.

## Red evidence

### Phase 1 — derived scaffold message

Before the fix, the real CLI printed the stale list while discovery found seven kits:

```text
Created starter project at /tmp/threenative-prd201-red-Qg6lFH/game
Templates: minimal (smallest), starter (default), platformer. Choose with --template <name>.
Skipped install (--no-install). Run pnpm install, then pnpm dev.
DISCOVERED_NAMES=action-rpg,defense,minimal,platformer,racing,shooter,starter
```

Mutation: hardcoded the old message back into `main`.

```text
FAIL packages/create-threenative/__tests__/scaffold.spec.ts > create-threenative > derives the scaffold completion message from every discovered kit
AssertionError: expected source to contain `scaffoldCompletionMessage(discoverKitManifests())`
```

### Phase 2 — one package list and one substitution loop

The pre-fix duplicate grep showed both substitution loops and the second package list:

```text
178: for (const [placeholder, value] of Object.entries(replacements)) {
216: for (const [placeholder, value] of Object.entries(replacements)) {
457: for (const [name, flag] of [
```

Mutation 1: replaced the package-flag consumer with an inline array.

```text
FAIL ... keeps package flags and template substitution single-sourced
AssertionError: Target cannot be null or undefined.
```

Mutation 2: restored the second substitution loop.

```text
FAIL ... keeps package flags and template substitution single-sourced
AssertionError: expected [ Array(2) ] to have a length of 3 but got 2
```

### Acceptance criterion — scaffold byte preservation

The byte-preservation criterion was exercised as a negative control against the shared scaffold/template substitution path.

Mutation: temporarily changed `substituteTemplateVariables` in `packages/create-threenative/src/index.ts` from:

```ts
rendered = rendered.replaceAll(placeholder, value);
```

to:

```ts
rendered = rendered.replaceAll(placeholder, `${value}-prd201-byte-mutation`);
```

The clean baseline was compared with a fresh mutated scaffold for each existing kit using `diff -qr`.
The exact red result was:

```text
--- action-rpg ---
Files /tmp/prd201-byte-smoke-29lTMn/baseline/action-rpg/AGENTS.md and /tmp/prd201-byte-smoke-29lTMn/mutated/action-rpg/AGENTS.md differ
Files /tmp/prd201-byte-smoke-29lTMn/baseline/action-rpg/CLAUDE.md and /tmp/prd201-byte-smoke-29lTMn/mutated/action-rpg/CLAUDE.md differ
Files /tmp/prd201-byte-smoke-29lTMn/baseline/action-rpg/index.html and /tmp/prd201-byte-smoke-29lTMn/mutated/action-rpg/index.html differ
Files /tmp/prd201-byte-smoke-29lTMn/baseline/action-rpg/package.json and /tmp/prd201-byte-smoke-29lTMn/mutated/action-rpg/package.json differ
Files /tmp/prd201-byte-smoke-29lTMn/baseline/action-rpg/threenative.config.ts and /tmp/prd201-byte-smoke-29lTMn/mutated/action-rpg/threenative.config.ts differ
DIFF_EXIT=1
--- defense ---
Files /tmp/prd201-byte-smoke-29lTMn/baseline/defense/AGENTS.md and /tmp/prd201-byte-smoke-29lTMn/mutated/defense/AGENTS.md differ
Files /tmp/prd201-byte-smoke-29lTMn/baseline/defense/CLAUDE.md and /tmp/prd201-byte-smoke-29lTMn/mutated/defense/CLAUDE.md differ
Files /tmp/prd201-byte-smoke-29lTMn/baseline/defense/index.html and /tmp/prd201-byte-smoke-29lTMn/mutated/defense/index.html differ
Files /tmp/prd201-byte-smoke-29lTMn/baseline/defense/package.json and /tmp/prd201-byte-smoke-29lTMn/mutated/defense/package.json differ
Files /tmp/prd201-byte-smoke-29lTMn/baseline/defense/threenative.config.ts and /tmp/prd201-byte-smoke-29lTMn/mutated/defense/threenative.config.ts differ
DIFF_EXIT=1
--- minimal ---
Files /tmp/prd201-byte-smoke-29lTMn/baseline/minimal/AGENTS.md and /tmp/prd201-byte-smoke-29lTMn/mutated/minimal/AGENTS.md differ
Files /tmp/prd201-byte-smoke-29lTMn/baseline/minimal/CLAUDE.md and /tmp/prd201-byte-smoke-29lTMn/mutated/minimal/CLAUDE.md differ
Files /tmp/prd201-byte-smoke-29lTMn/baseline/minimal/index.html and /tmp/prd201-byte-smoke-29lTMn/mutated/minimal/index.html differ
Files /tmp/prd201-byte-smoke-29lTMn/baseline/minimal/package.json and /tmp/prd201-byte-smoke-29lTMn/mutated/minimal/package.json differ
Files /tmp/prd201-byte-smoke-29lTMn/baseline/minimal/threenative.config.ts and /tmp/prd201-byte-smoke-29lTMn/mutated/minimal/threenative.config.ts differ
DIFF_EXIT=1
--- platformer ---
Files /tmp/prd201-byte-smoke-29lTMn/baseline/platformer/AGENTS.md and /tmp/prd201-byte-smoke-29lTMn/mutated/platformer/AGENTS.md differ
Files /tmp/prd201-byte-smoke-29lTMn/baseline/platformer/CLAUDE.md and /tmp/prd201-byte-smoke-29lTMn/mutated/platformer/CLAUDE.md differ
Files /tmp/prd201-byte-smoke-29lTMn/baseline/platformer/index.html and /tmp/prd201-byte-smoke-29lTMn/mutated/platformer/index.html differ
Files /tmp/prd201-byte-smoke-29lTMn/baseline/platformer/package.json and /tmp/prd201-byte-smoke-29lTMn/mutated/platformer/package.json differ
Files /tmp/prd201-byte-smoke-29lTMn/baseline/platformer/threenative.config.ts and /tmp/prd201-byte-smoke-29lTMn/mutated/platformer/threenative.config.ts differ
DIFF_EXIT=1
--- racing ---
Files /tmp/prd201-byte-smoke-29lTMn/baseline/racing/AGENTS.md and /tmp/prd201-byte-smoke-29lTMn/mutated/racing/AGENTS.md differ
Files /tmp/prd201-byte-smoke-29lTMn/baseline/racing/CLAUDE.md and /tmp/prd201-byte-smoke-29lTMn/mutated/racing/CLAUDE.md differ
Files /tmp/prd201-byte-smoke-29lTMn/baseline/racing/index.html and /tmp/prd201-byte-smoke-29lTMn/mutated/racing/index.html differ
Files /tmp/prd201-byte-smoke-29lTMn/baseline/racing/package.json and /tmp/prd201-byte-smoke-29lTMn/mutated/racing/package.json differ
Files /tmp/prd201-byte-smoke-29lTMn/baseline/racing/threenative.config.ts and /tmp/prd201-byte-smoke-29lTMn/mutated/racing/threenative.config.ts differ
DIFF_EXIT=1
--- shooter ---
Files /tmp/prd201-byte-smoke-29lTMn/baseline/shooter/AGENTS.md and /tmp/prd201-byte-smoke-29lTMn/mutated/shooter/AGENTS.md differ
Files /tmp/prd201-byte-smoke-29lTMn/baseline/shooter/CLAUDE.md and /tmp/prd201-byte-smoke-29lTMn/mutated/shooter/CLAUDE.md differ
Files /tmp/prd201-byte-smoke-29lTMn/baseline/shooter/index.html and /tmp/prd201-byte-smoke-29lTMn/mutated/shooter/index.html differ
Files /tmp/prd201-byte-smoke-29lTMn/baseline/shooter/package.json and /tmp/prd201-byte-smoke-29lTMn/mutated/shooter/package.json differ
Files /tmp/prd201-byte-smoke-29lTMn/baseline/shooter/threenative.config.ts and /tmp/prd201-byte-smoke-29lTMn/mutated/shooter/threenative.config.ts differ
DIFF_EXIT=1
--- starter ---
Files /tmp/prd201-byte-smoke-29lTMn/baseline/starter/AGENTS.md and /tmp/prd201-byte-smoke-29lTMn/mutated/starter/AGENTS.md differ
Files /tmp/prd201-byte-smoke-29lTMn/baseline/starter/CLAUDE.md and /tmp/prd201-byte-smoke-29lTMn/mutated/starter/CLAUDE.md differ
Files /tmp/prd201-byte-smoke-29lTMn/baseline/starter/index.html and /tmp/prd201-byte-smoke-29lTMn/mutated/starter/index.html differ
Files /tmp/prd201-byte-smoke-29lTMn/baseline/starter/package.json and /tmp/prd201-byte-smoke-29lTMn/mutated/starter/package.json differ
Files /tmp/prd201-byte-smoke-29lTMn/baseline/starter/threenative.config.ts and /tmp/prd201-byte-smoke-29lTMn/mutated/starter/threenative.config.ts differ
DIFF_EXIT=1
BYTE_DIFF=red for 7 kits
```

All seven kits therefore rejected the byte-changing substitution mutation. The representative byte change was `"name": "starter"` to `"name": "starter-prd201-byte-mutation"` in `package.json`.

### Phase 3 — owned type and parser

The pre-fix source had independent declarations and three PNG signature homes:

```text
packages/create-threenative/src/config.ts:74:export interface IThreeNativeTexturesConfig {
packages/core/src/config.ts:27:export interface IThreeNativeTexturesConfig {
packages/create-threenative/src/config.ts:190:const PNG_SIGNATURE = Buffer.from(...)
packages/assets/src/health.ts:58:const PNG_SIGNATURE = Buffer.from(...)
packages/assets/src/passes/decode-image.ts:30:const PNG_SIGNATURE = Buffer.from(...)
```

Mutation 1: changed the core texture `quality` field from `number` to `string`, rebuilt core,
then typechecked create-threenative.

```text
src/build.ts:86:25 error TS2322: Type 'string | undefined' is not assignable to type 'number | undefined'.
src/build.ts:229:25 error TS2322: Type 'string | undefined' is not assignable to type 'number | undefined'.
src/config.ts:902:3 error TS2322: Type 'number | undefined' is not assignable to type 'string | undefined'.
MUTATION_EXIT=2
```

Mutation 2: removed `|| hasTransparencyChunk` from the shared parser, rebuilt assets, then ran
both tRNS consumers.

```text
FAIL packages/assets/__tests__/health.spec.ts > ... should share the PNG parser for tRNS alpha in health results
Expected hasAlpha: true; received hasAlpha: false
FAIL packages/create-threenative/__tests__/config.spec.ts > ... accepts tRNS PNG alpha through the shared parser
ConfigFailure: TN_CONFIG_BRAND_ANDROID_FOREGROUND_ALPHA_INVALID
MUTATION_EXIT=1
```

All mutations, including the byte-smoke substitution mutation, were restored immediately after their red result.

## Green evidence

- `pnpm install --frozen-lockfile` — exit 0.
- `pnpm build` — exit 0; capability manifest regenerated with 122 entries.
- Targeted lane tests — 3 files, 86 tests passed (`scaffold.spec.ts`, `config.spec.ts`,
  `health.spec.ts`).
- Scaffold smoke — all seven kits printed exactly:

  ```text
  Templates: action-rpg, defense, minimal, platformer, racing, shooter, starter (default). Choose with --template <name>.
  ```

- Byte smoke diff — two fresh scaffold runs for all seven kits produced `BYTE_DIFF=clean for 7
  kits`; `git diff --quiet -- packages/create-threenative/templates` also passed.
- Post-restoration byte smoke — a fresh seven-kit run after restoring the helper produced:

  ```text
  BYTE_DIFF=clean for 7 kits
  TEMPLATE_SOURCE_DIFF=clean
  ```
- Duplicate proof — one core `IThreeNativeTexturesConfig` declaration, one
  `PNG_SIGNATURE` definition, one substitution loop, and one `replaceAll(placeholder, value)`
  remain in source.
- `pnpm typecheck` — exit 0.
- `pnpm lint` — exit 0; repository reports 291 existing complexity warnings, including the
  parser's warning, but no errors.

## Root test gate note

The exact `pnpm test` gate was run. Its package tests and lane tests passed, but the unit phase
failed on an unrelated timing budget:

```text
FAIL scripts/__tests__/check-capability-docs.spec.ts > capability documentation gate > should scan subpath exports, not only the main package index
Error: Test timed out in 5000ms.
Test Files 1 failed | 197 passed
```

The failing spec passes directly (`7 tests passed`); a rerun with `--testTimeout=10000` moved the
same resource-sensitive suite to an unrelated pre-existing `packages/core/__tests__/build.spec.ts`
15-second timeout (`197 passed, 1 failed`). No unrelated test was edited in this lane.

## Acceptance criteria

- [x] A scratch eighth kit appears in the derived completion-message test without prose edits.
- [x] Package flags, substitution, texture type, and PNG parser have single source homes.
- [x] Existing template sources are unchanged and seven-kit scaffold byte smoke diff is clean.
- [x] Every criterion above has its mutation and pasted red result in this record.

---
prd_contract: v1
---

# PRD-201 verification — 2026-08-25

All implementation mutations below were temporary, produced the recorded red result, and
were restored before the green verification runs.

## Red evidence

### 1. Discovery-driven scaffold message

Mutation: replaced `scaffoldCompletionMessage` with the old hardcoded three-template string.

```text
pnpm exec vitest run packages/create-threenative/__tests__/scaffold.spec.ts -t "derives the scaffold completion message from every discovered kit"
exit 1

AssertionError: expected 'Templates: minimal (smallest), starte…' to be 'Templates: action-rpg, defense, minim…'
- Expected
- Templates: action-rpg, defense, minimal, platformer, racing, scratch, shooter, starter (default). Choose with --template <name>.
+ Received
+ Templates: minimal (smallest), starter (default), platformer. Choose with --template <name>.
packages/create-threenative/__tests__/scaffold.spec.ts:211:52
Test Files 1 failed; Tests 1 failed | 24 skipped
```

The temporary `scratch` kit was then removed from the copied test tree and the dynamic
implementation was restored.

### 2. Package and substitution duplication

Mutation: added a second `Object.entries(PACKAGE_SOURCE_FLAGS)` loop.

```text
pnpm exec vitest run packages/create-threenative/__tests__/scaffold.spec.ts -t "keeps package flags and template substitution single-sourced"
exit 1

AssertionError: expected [ …(2) ] to have a length of 1 but got 2
- Expected 1
+ Received 2
packages/create-threenative/__tests__/scaffold.spec.ts:233:7
```

Mutation: replaced the `renderTemplate` helper call with an inline substitution loop.

```text
exit 1

AssertionError: expected [ Array(2) ] to have a length of 3 but got 2
- Expected 3
+ Received 2
packages/create-threenative/__tests__/scaffold.spec.ts:236:61
```

Both temporary duplicates were restored.

### 3. Core-owned type and shared PNG parser

Mutation: re-added `export interface IThreeNativeTexturesConfig` to
`packages/create-threenative/src/config.ts`.

```text
pnpm exec vitest run packages/create-threenative/__tests__/config.spec.ts -t "re-exports the core-owned texture config type"
exit 1

AssertionError: expected 'import ...' not to match /export interface IThreeNativeTexture…/u
packages/create-threenative/__tests__/config.spec.ts:69:30
```

Mutation: re-added `const PNG_SIGNATURE = ...` to the scaffolder config.

```text
exit 1

packages/create-threenative/__tests__/config.spec.ts:70:30
expect(createSource).not.toMatch(/const PNG_SIGNATURE =/u);
Test Files 1 failed; Tests 1 failed | 49 skipped
```

Mutation: removed the `hasTransparencyChunk` branch from the shared parser, rebuilt
`@threenative/assets`, and reran both tRNS consumers.

```text
pnpm --filter @threenative/assets build
set -o pipefail; pnpm exec vitest run packages/assets/__tests__/health.spec.ts packages/create-threenative/__tests__/config.spec.ts -t "tRNS" --reporter=dot 2>&1 | tail -n 70
exit 1

FAIL packages/assets/__tests__/health.spec.ts > ... tRNS...
AssertionError ... hasAlpha expected true received false
packages/assets/__tests__/health.spec.ts:362:28

FAIL packages/create-threenative/__tests__/config.spec.ts > ... accepts tRNS...
Caused by: ConfigFailure: TN_CONFIG_BRAND_ANDROID_FOREGROUND_ALPHA_INVALID: config validation layer failed for '/tmp/.../threenative.config.ts' ...
app.icons.android.foreground must include an alpha channel: foreground.png
packages/create-threenative/__tests__/config.spec.ts:82:35
Test Files 2 failed; Tests 2 failed | 62 skipped
```

The parser was restored and `@threenative/assets` was rebuilt before the green runs.

## Green results

Focused tests:

```text
pnpm exec vitest run packages/assets/__tests__/health.spec.ts packages/create-threenative/__tests__/config.spec.ts packages/create-threenative/__tests__/scaffold.spec.ts
Test Files  3 passed (3)
Tests       89 passed (89)
```

The shared tRNS agreement tests also passed independently:

```text
pnpm exec vitest run packages/assets/__tests__/health.spec.ts packages/create-threenative/__tests__/config.spec.ts -t "tRNS" --reporter=dot
Test Files  2 passed (2)
Tests       2 passed | 62 skipped (64)
```

Built-CLI scaffold smoke, using `--no-install` for every discovered kit, passed all seven
shipped kits. Every invocation emitted the same derived line:

```text
action-rpg: Templates: action-rpg, defense, minimal, platformer, racing, shooter, starter (default). Choose with --template <name>.
defense: Templates: action-rpg, defense, minimal, platformer, racing, shooter, starter (default). Choose with --template <name>.
minimal: Templates: action-rpg, defense, minimal, platformer, racing, shooter, starter (default). Choose with --template <name>.
platformer: Templates: action-rpg, defense, minimal, platformer, racing, shooter, starter (default). Choose with --template <name>.
racing: Templates: action-rpg, defense, minimal, platformer, racing, shooter, starter (default). Choose with --template <name>.
shooter: Templates: action-rpg, defense, minimal, platformer, racing, shooter, starter (default). Choose with --template <name>.
starter: Templates: action-rpg, defense, minimal, platformer, racing, shooter, starter (default). Choose with --template <name>.
scaffold smoke: 7 kits passed; process exit 0
```

The repository's broader `pnpm verify:golden-path` was also attempted. It reached the existing
`defense` template test and exited 2 because the environment lacked the semantic playtest bridge:

```text
Scenario requires semantic capabilities but '__THREENATIVE_PLAYTEST_BRIDGE__' is not installed.
TN_GOLDEN_PATH_FAILED: template 'defense' at layer 'test' ... pnpm test exited 2.
```

This failure is outside PRD-201 and did not occur in the dedicated no-install scaffold smoke.

Repository gates:

| Command | Result |
| --- | --- |
| `pnpm build` | exit 0; capability manifest generated with 146 entries |
| `pnpm typecheck` | exit 0 |
| `pnpm lint` | exit 0; 426 warnings reported, including the existing warning budget and the new parser's cognitive-complexity warning |
| `pnpm test` | exit 0; 218 test files passed, 2,165 tests passed |
| `pnpm budgets` | exit 0; all hard invariants passed |
| `git diff --check` | exit 0 |

The implementation diff contained exactly the ten scoped PRD paths before this required
verification record was added. The record is the only additional committed path.

## Single-source grep proof

```text
rg -n "export interface IThreeNativeTexturesConfig|const PNG_SIGNATURE =|function substituteTemplateVariables|for \(const \[name, flag\] of Object\.entries\(PACKAGE_SOURCE_FLAGS\)\)" packages/core/src packages/assets/src packages/create-threenative/src
packages/assets/src/png.ts:1:const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
packages/create-threenative/src/index.ts:179:function substituteTemplateVariables(
packages/create-threenative/src/index.ts:507:  for (const [name, flag] of Object.entries(PACKAGE_SOURCE_FLAGS)) {
packages/core/src/config.ts:33:export interface IThreeNativeTexturesConfig {
```

The scaffolder imports and re-exports the core texture type and imports the assets-owned PNG
parser; no second declaration or signature remains in its source.

## Review-round repair evidence

### New red evidence

#### 4. PNG consumer ownership

Mutation: restored a local `pngHasAlpha` parser in `packages/assets/src/health.ts`, including
the duplicated `type === "tRNS"` rule.

```text
pnpm exec vitest run packages/assets/__tests__/png-source.spec.ts -t 'one parser home' --reporter=dot
exit 1

FAIL packages/assets/__tests__/png-source.spec.ts > PNG parser ownership > keeps every PNG consumer on the one parser home
AssertionError: expected 'import { type Document, type GLTF, Im…' not to match /function (?:parsePng|pngHasAlpha)\s*…/u
packages/assets/__tests__/png-source.spec.ts:33:26
Test Files 1 failed (1); Tests 1 failed (1)
```

Mutation: restored `const PNG_SIGNATURE = ...` in `packages/assets/src/passes/decode-image.ts`.

```text
pnpm exec vitest run packages/assets/__tests__/png-source.spec.ts -t 'one parser home' --reporter=dot
exit 1

FAIL packages/assets/__tests__/png-source.spec.ts > PNG parser ownership > keeps every PNG consumer on the one parser home
AssertionError: expected 'import { PNG } from "pngjs";\nimport …' not to contain 'PNG_SIGNATURE'
packages/assets/__tests__/png-source.spec.ts:32:26
Test Files 1 failed (1); Tests 1 failed (1)
```

Mutation: restored `const PNG_SIGNATURE = ...` in `packages/create-threenative/src/config.ts`.
The same source-level test failed closed at the config consumer:

```text
pnpm exec vitest run packages/assets/__tests__/png-source.spec.ts -t 'one parser home' --reporter=dot
exit 1

FAIL packages/assets/__tests__/png-source.spec.ts > PNG parser ownership > keeps every PNG consumer on the one parser home
AssertionError: expected 'import { access, readFile, stat, unli…' not to contain 'PNG_SIGNATURE'
packages/assets/__tests__/png-source.spec.ts:32:26
Test Files 1 failed (1); Tests 1 failed (1)
```

The parser, signature, and tRNS mutations were restored before green verification.

#### 5. Derived package-source type

Mutation: changed `PackageSourceName` to the literal union `"@threenative/core" | "@threenative/assets"`.

```text
pnpm exec vitest run packages/create-threenative/__tests__/scaffold.spec.ts -t 'keeps package flags and template substitution single-sourced' --reporter=dot
exit 1

FAIL packages/create-threenative/__tests__/scaffold.spec.ts > create-threenative > keeps package flags and template substitution single-sourced
AssertionError: Target cannot be null or undefined.
packages/create-threenative/__tests__/scaffold.spec.ts:269:91
Test Files 1 failed (1); Tests 1 failed (1)
```

The literal union was restored before green verification.

#### 6. Scaffold byte-stability assertion

Mutation: replaced the parent `action-rpg` SHA-256 with 64 zeroes.

```text
pnpm exec vitest run packages/create-threenative/__tests__/scaffold.spec.ts -t 'byte-stable against the PRD parent' --reporter=dot
exit 1

FAIL packages/create-threenative/__tests__/scaffold.spec.ts > create-threenative > keeps every no-install scaffold tree byte-stable against the PRD parent
AssertionError: expected '42716d5a52cf27ce963c4fb0591a1a186b52d…' to be '0000000000000000000000000000000000000…'
Expected: "0000000000000000000000000000000000000000000000000000000000000000"
Received: "42716d5a52cf27ce963c4fb0591a1a186b52d4339993c9218a2258cd42f91e80"
packages/create-threenative/__tests__/scaffold.spec.ts:291:48
Test Files 1 failed (1); Tests 1 failed (1)
```

The expected parent hash was restored before green verification.

### Parent/repaired byte comparison

Exact comparison command:

```text
pnpm exec vitest run packages/create-threenative/__tests__/scaffold.spec.ts -t 'byte-stable against the PRD parent' --reporter=dot
```

The assertion scaffolds each discovered kit with `install: false`, hashes sorted relative paths and
bytes with SHA-256, and excludes `node_modules/`, `dist/`, `.vite/`, `coverage/`, and lockfiles.
The parent hashes were generated from `5eb58bbf22fd13aa9d1256453895e78c99494e93`; the repaired
commit produced the same result for every template:

| Template | Parent and repaired SHA-256 | Files |
| --- | --- | ---: |
| action-rpg | `42716d5a52cf27ce963c4fb0591a1a186b52d4339993c9218a2258cd42f91e80` | 62 |
| defense | `bae15cc30544c761cca83f13bf6ba1486a2764607504dbb706566861794cbd48` | 60 |
| minimal | `0d73d5df12b64ba2469017174fd62125572b51c79118aebdae1af2ed46fab4b6` | 41 |
| platformer | `f858b2de946042645dd971efc694f617cc08b837d522a57b0950de5cc3ff5260` | 76 |
| racing | `d2beb624f0ad8071941a0529543b91a5ec95bfd7d8d64e707f12c3f4b825687c` | 61 |
| shooter | `4c76f02ec4f0277f0ddeeb4b3e7f37d3a51d75bddb88a48ba8a0e09e5de32929` | 61 |
| starter | `96d8b4972bca0588d1db759bbf4cdd4f952eba9da0ee055e06a71e4ef105b0b2` | 76 |

The CLI completion message is not part of a generated tree and is excluded from this comparison.
The direct tree comparison also returned no diff:

```text
diff -ru --exclude=node_modules --exclude=dist --exclude=.vite --exclude=coverage --exclude=pnpm-lock.yaml --exclude=package-lock.json --exclude=yarn.lock /tmp/prd201-stability-SbPFwL/parent-out /tmp/prd201-stability-SbPFwL/current-out
exit 0
```

### New green evidence

```text
pnpm exec vitest run packages/assets/__tests__/png-source.spec.ts packages/assets/__tests__/health.spec.ts packages/create-threenative/__tests__/config.spec.ts packages/create-threenative/__tests__/scaffold.spec.ts -t 'PNG parser ownership|tRNS|re-exports the core-owned texture config type|keeps package flags and template substitution single-sourced|byte-stable against the PRD parent' --reporter=dot
exit 0

Test Files  4 passed (4)
Tests       6 passed | 85 skipped (91)
```

```text
pnpm build
exit 0
capability manifest generated: 146 entries
```

Built-CLI no-install smoke command:

```text
SMOKE_ROOT=$(mktemp -d /tmp/prd201-no-install-XXXXXX)
TEMPLATES=$(node --input-type=module -e 'import { discoverTemplateNames } from "./packages/create-threenative/dist/index.js"; console.log(discoverTemplateNames().join("\n"));')
while IFS= read -r template; do node packages/create-threenative/dist/index.js "$SMOKE_ROOT/$template" --template "$template" --no-install; done <<< "$TEMPLATES"
```

Result: `action-rpg`, `defense`, `minimal`, `platformer`, `racing`, `shooter`, and `starter` all
passed; `scaffold smoke: 7 kits passed; process exit 0`.

Additional repair checks:

```text
pnpm typecheck
exit 0

pnpm exec biome check packages/assets/__tests__/png-source.spec.ts packages/create-threenative/__tests__/scaffold.spec.ts
exit 0

git diff --check
exit 0
```

### Final review follow-up

The second and final read-only review requested two verification corrections on the repaired
commit: the recorded smoke command used a literal `\\n` separator, and the metadata exclusion
pattern did not name `pnpm-lock.yaml` or `package-lock.json`. The manager corrected both directly
after the two-review Linchpin budget was exhausted:

- the command now uses `discoverTemplateNames().join("\n")` and was rerun; all seven kits passed;
- the test excludes the exact `pnpm-lock.yaml`, `package-lock.json`, and `yarn.lock` names;
- the focused suite passed again: 4 files, 6 selected tests, 85 skipped;
- the authoritative repaired manager gates exited 0: 218 test files passed, 1 skipped; 2,164
  tests passed, 3 skipped; docs, build, typecheck, lint, and budgets all passed.

No third Sol review was launched because Linchpin permits two review rounds.

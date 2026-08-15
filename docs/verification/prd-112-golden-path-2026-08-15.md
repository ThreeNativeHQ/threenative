# PRD-112 golden-path verification — 2026-08-15

Repair evidence for the packed-artifact verifier. The source PRD was not edited.

## Phase 0 — resolver outcome

Result: **not reproduced across all seven templates**. No resolver change was made.

The run used a clean temporary root, packed workspace tarballs, and the generated adopter
script. The packed staging directory was `/tmp/threenative-phase0-Q4uo61/packages`; each
project was created below `/tmp/threenative-phase0-Q4uo61/retry3`.

Commands run for every template:

```text
pnpm --filter "./packages/**" build
pnpm --filter "./packages/<package>" pack --pack-destination /tmp/threenative-phase0-Q4uo61/packages
./scaffold.sh <template>
pnpm install --reporter append-only
pnpm exec node --input-type=module -e '<project, Vite-owned, and CLI fallback esbuild probes>'
pnpm exec threenative build --target web
pnpm exec vite build
pnpm store path --silent
```

`scaffold.sh` invoked the packed `create-threenative` tarball through `pnpm dlx`, passed all
packed package overrides, and did not pass `--no-install`. Both build commands exited 0 for
each row:

| Template | Recorded cwd | Project / Vite / CLI esbuild resolution | Build exits |
| --- | --- | --- | --- |
| action-rpg | `/tmp/threenative-phase0-Q4uo61/retry3/action-rpg-work/action-rpg` | `FAIL MODULE_NOT_FOUND` / `FAIL MODULE_NOT_FOUND` / `FAIL MODULE_NOT_FOUND` | `0 / 0` |
| defense | `/tmp/threenative-phase0-Q4uo61/retry3/defense-work/defense` | `FAIL MODULE_NOT_FOUND` / `FAIL MODULE_NOT_FOUND` / `FAIL MODULE_NOT_FOUND` | `0 / 0` |
| minimal | `/tmp/threenative-phase0-Q4uo61/retry3/minimal-work/minimal` | `/tmp/.../esbuild@0.27.0/node_modules/esbuild/lib/main.js` for all three probes | `0 / 0` |
| platformer | `/tmp/threenative-phase0-Q4uo61/retry3/platformer-work/platformer` | `/tmp/.../esbuild@0.27.0/node_modules/esbuild/lib/main.js` for all three probes | `0 / 0` |
| racing | `/tmp/threenative-phase0-Q4uo61/retry3/racing-work/racing` | `FAIL MODULE_NOT_FOUND` / `FAIL MODULE_NOT_FOUND` / `FAIL MODULE_NOT_FOUND` | `0 / 0` |
| shooter | `/tmp/threenative-phase0-Q4uo61/retry3/shooter-work/shooter` | `FAIL MODULE_NOT_FOUND` / `FAIL MODULE_NOT_FOUND` / `FAIL MODULE_NOT_FOUND` | `0 / 0` |
| starter | `/tmp/threenative-phase0-Q4uo61/retry3/starter-work/starter` | `/tmp/.../esbuild@0.27.0/node_modules/esbuild/lib/main.js` for all three probes | `0 / 0` |

The exact resolved `esbuild` files for the three positive rows were under each project at
`node_modules/.pnpm/esbuild@0.27.0/node_modules/esbuild/lib/main.js`. The Vite 8 projects that
reported no esbuild still built successfully through Vite's current build path. The pnpm store
layout was `/tmp/.pnpm-store/v10`.

This also re-verifies the adopter install path: all seven `./scaffold.sh <template>` runs
installed from packed artifacts in a clean directory and the later explicit `pnpm install`
completed successfully.

## Packed golden path

```text
pnpm verify:golden-path
exit 0
```

The final current-tree run covered, in order, `action-rpg`, `defense`, `minimal`, `platformer`,
`racing`, `shooter`, and `starter`. Every template ran `scaffold → install → mcp → dev → test →
build web → assert artifact`; the scaffold step printed and executed `./scaffold.sh <project>`.

A first attempt was correctly rejected by a pre-existing process holding port 4173. After that
process released the port, the current-tree matrix completed with exit 0. The temporary template
root used for the negative control is an optional verifier argument; the normal command still
uses the repository template directory.

## Broken-vite negative control

A temporary copy of `minimal` had `devDependencies.vite` removed. The same verifier was run
against that temporary template root:

```text
TN_BROKEN_TEMPLATE_ROOT=/tmp/threenative-broken-vite-FZ63zD \
  pnpm exec tsx -e 'import("./scripts/verify-golden-path.ts").then(({ verifyGoldenPath }) => verifyGoldenPath(process.env.TN_BROKEN_TEMPLATE_ROOT!)).catch((error) => { console.error(error.message); process.exitCode = 1; });'
exit 1
```

Observed result:

```text
golden-path minimal: scaffold
TN_GOLDEN_PATH_FAILED: template 'minimal' at layer 'scaffold' in project '/tmp/threenative-golden-path-Kqt6o5/minimal'. Searched: project '/tmp/threenative-golden-path-Kqt6o5/minimal'. Corrective command: (cd '/tmp/threenative-golden-path-Kqt6o5/minimal' && ./scaffold.sh <project>). TN_GOLDEN_PATH_DEPENDENCY_MISSING: template 'minimal' is missing dependency 'vite'. Add 'vite' to package.json and rerun pnpm verify:golden-path.
```

The control is red before scaffolding or installation, and names the affected template and
missing dependency.

## Help and error diagnostics

```text
pnpm exec vitest run packages/create-threenative/__tests__/cli.spec.ts
3 tests passed, exit 0

pnpm exec vitest run scripts/__tests__/verify-golden-path.spec.ts
9 tests passed, exit 0
```

The CLI test covers root help and usable command-specific help for `dev`, `build`, `test`, and
`ship`. The verifier tests cover the generated executable `scaffold.sh` and the fail-closed
command error contract. A real occupied-port failure also produced the same contract with
`layer 'test'`, the project path, searched project/PATH locations, and a corrective `pnpm test`
command.

## Gates and LOC delta

```text
pnpm typecheck && pnpm lint && pnpm test
exit 0
Test Files: 132 passed, 9 skipped
Tests: 1106 passed, 35 skipped

pnpm --silent budgets
exit 0
budgets ok: 7 framework packages, 4 example workspaces, 14873/15000 framework LOC,
69910/50000 native runtime LOC, 8 PRD files, largest template 2074 LOC
```

The pre-repair budget baseline was 14,825 framework LOC. The repair delta is **+48 framework
LOC**, leaving 127 lines to the 15,000 review trigger. The native runtime review trigger remains
the pre-existing 69,910/50,000 warning; this repair did not add native runtime code.

# Scaffold default retention — 2026-08-12

Status: measured from tracked source and the frozen endless-runner framework archive. No
native host or device ran; this is a scaffold and repository evidence report.

## Result

Resolution B ran: `starter` remains the no-flag default, and the CLI names all three choices.
The binding file-level measurement found that the small endless-runner game retained 15 of
18 starter source paths (**83.33%**) and deleted 3 (**16.67%**). That is "largely kept" under
PRD-083's decision rule, so changing the default was not justified.

The retained paths were substantially rewritten: the existing line-diff instrument found
338 of 788 starter lines survived (**42.89%**). File retention chose the resolution because
the PRD defines Phase 0 as a file-level count; line retention is included as important cost
context, not substituted for the specified decision metric.

## Provenance and measurement

The canonical source is
`docs/benchmark/sweeps/endless-runner-2026-08-08-11`. Its `sweep.json` records the framework
arm and `starter` template; `starter-baseline/SOURCE.json` independently records a scaffolded
starter origin. The final framework ledger names the same archive and template.

The tracked path census returned:

| Measure | Result |
| --- | ---: |
| Baseline starter `src/` files | 18 |
| Retained paths | 15 (83.33%) |
| Deleted paths | 3 (16.67%) |
| Added paths | 0 |

The deleted paths were `entities/Crate.ts`, `render/camera.ts`, and
`render/particles.ts`. `pnpm --silent sweep:measure
docs/benchmark/sweeps/endless-runner-2026-08-08-11` returned `starterLoc: 788`,
`starterFiles: 18`, `userLoc: 1181`, `authoredLoc: 843`, and `starterSurvivedLoc: 338`.

Current TypeScript/TSX source counts are 482 lines for `minimal`, 1,072 for `starter`, and
1,470 for `platformer`. The PRD's older 483/1,073/1,455 figures were reproduced at its
recorded baseline; intervening work accounts for the current delta. Fresh no-install
scaffolds of `starter` and `minimal` completed from the local source into an empty temporary
root; each rendered its project name and contained the expected template source tree.

The fresh-scaffold probe used an empty `mktemp` root and invoked the local source directly:

```sh
export TN_SCAFFOLD_ROOT=$(mktemp -d /tmp/tn-scaffold-default-XXXXXX)
pnpm exec tsx -e 'import { createProject } from "./packages/create-threenative/src/index.ts"; async function run() { await createProject({ target: "starter", template: "starter", install: false }, process.env.TN_SCAFFOLD_ROOT!); await createProject({ target: "minimal", template: "minimal", install: false }, process.env.TN_SCAFFOLD_ROOT!); } run();'
find "$TN_SCAFFOLD_ROOT/starter/src" -type f
find "$TN_SCAFFOLD_ROOT/minimal/src" -type f
```

## Caller census

The census found an existing implicit `createProject` call in
`packages/create-threenative/__tests__/scaffold.spec.ts`. That contradicts the PRD's initial
claim that every caller was explicit and independently activates its safe fallback to
Resolution B. Production callers continue to pass an explicit template, including the
platformer production-profile scaffolder; `scripts/make-sandbox.ts` retains its separate
`starter` default.

No template source was edited. The implementation changes only first-run CLI guidance and
tests that pin the existing default, explicit flags, and stdout compatibility.

## Negative controls

| Temporary mutation | Focused result |
| --- | --- |
| change the no-flag default from `starter` to `minimal` | exited 1; received `Created minimal`, expected `Created starter` |
| replace `options.template ?? "starter"` with unconditional `"starter"` | exited 1 on explicit `minimal`, proving the flag outranks the default |
| reword the first stdout line from `Created` to `Scaffolded` | exited 1 on the exact legacy-line assertion |
| remove the new template-choice line | exited 1; the install guidance occupied line two instead |

Every mutation was restored before the green gates.

## Gates

| Gate | Result |
| --- | --- |
| `pnpm exec vitest run packages/create-threenative/__tests__/scaffold.spec.ts` | pass; 18/18 |
| `pnpm typecheck && pnpm lint && pnpm test` | pass; root Vitest 100 files, 840 tests; lint warnings only |
| `pnpm test:templates` | pass; fresh `minimal`, `starter`, and `platformer` projects all playtested |
| `pnpm budgets` | pass; 8,835/15,000 framework LOC; existing native review trigger reported |
| `git diff --stat packages/create-threenative/templates` and `git diff --check` | pass; no template source diff or whitespace error |

The first full-test attempt encountered a transient `publint` miss while another package
build was reading the same cleaned `dist/`; an isolated package build and the final full gate
both passed. The first template gate found a stale repository-owned Vite process on port
4173 before assertions. Its command and temporary scaffold root identified it; after that
exact process was stopped, the unchanged three-template gate passed and left the port free.

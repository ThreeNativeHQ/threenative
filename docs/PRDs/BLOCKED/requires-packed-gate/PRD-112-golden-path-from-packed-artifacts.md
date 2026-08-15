# PRD-112 — The golden path runs from packed artifacts, or it is not a path

**Status: BLOCKED — 2026-08-15.** The `r2` lane stopped at `c005d91`; the repair landed at
`0a689f1` and `4fa847d` and is integrated, and the packed mutation control now proves a broken
dependency fails the journey. **The exact packed seven-template gate is still red** — the
action-rpg layer fails with `TN_PLAYTEST_RUNNER_FAILED: page.evaluate: Execution context was
destroyed`, and the doubtful assumption is that one headed WebGPU page can be reused across the
packed scenarios. See `PRD-112-repair-golden-path-contract.md`. Sliced from
`docs/strategy/PRODUCTION-READINESS.md` item 3.

**Complexity: 5 → MEDIUM mode.** One reproduction, one resolver fix, one CI matrix, one error-text
pass.

**LOC:** `packages/create-threenative/src/` **does** spend framework headroom (14741/15000, 259
lines left). Keep the resolver fix small and say what it cost in §6.

---

## 1. Context

**Problem.** The required journey is `create → dev → test → build web → build native → package`.
Two things are known to interrupt it, one measured and one reported.

**Reported, not reproduced here.** The strategy review hit `TN_CONFIG_TRANSPILER_MISSING` from
`threenative build --target web` while a direct `vite build` in the same project succeeded. The
code that emits it is `packages/create-threenative/src/config.ts:164-183`:

```ts
function resolveEsbuild(cwd: string): string {
  const require = projectRequire(cwd);        // createRequire(cwd/package.json)
  try { return require.resolve("esbuild"); }
  catch {
    try { const vite = require.resolve("vite"); return createRequire(vite).resolve("esbuild"); }
    catch {
      try { return createRequire(import.meta.url).resolve("esbuild"); }
      catch { fail("TN_CONFIG_TRANSPILER_MISSING", …); }
    }
  }
}
```

Three fallbacks, and the message says *"install Vite or esbuild"* — advice that is already wrong
if `vite build` works in that directory. Either the resolution differs from what Vite itself does
(pnpm's non-hoisted layout is the obvious suspect), or the CLI was invoked from a different `cwd`
than the project root. **Neither is confirmed.** Do not write the fix from the report.

**Measured, and already recorded elsewhere.** The 2026-08-14 adopter pilot
(`docs/verification/adopter-pilot-2026-08-14.md`) found `./scaffold.sh` could not install at all:
templates pin `@threenative/studio` and `create-threenative` as registry dependencies and neither
is published. An adopting developer's session ends in its first two minutes on that. It is fixed
per the memory record as of 2026-08-14 — **re-verify rather than assume**, and if it is fixed,
the fix has no gate holding it in place. This PRD adds the gate.

**The structural gap.** Nothing in CI exercises the published commands from a clean temporary
directory against packed tarballs. `.github/workflows/ci.yml` runs a scaffold smoke job that packs
local packages and boots a starter — closer than nothing, but it does not walk the whole journey,
and it does not cover every template.

**Files analysed.**

- `packages/create-threenative/src/config.ts:160-210` — `resolveEsbuild`, `importConfig`
- `packages/create-threenative/templates/*/package.json` — the pinned dependency set
- `.github/workflows/ci.yml` — the existing scaffold smoke job
- `docs/verification/adopter-pilot-2026-08-14.md` — the recorded install failure

## 2. Approach

Reproduce first, fix the resolver only if the reproduction says the resolver is wrong, then hold
the whole journey with a CI matrix that runs from packed artifacts in a clean directory — the only
environment where workspace resolution cannot cover for a broken manifest.

```mermaid
flowchart LR
    A[pnpm pack every package] --> B[mktemp -d, empty]
    B --> C[npx create-threenative --template T]
    C --> D[install from tarballs]
    D --> E[dev boots]
    E --> F[pnpm test]
    F --> G[build --target web]
    G --> H[build --target desktop]
    H --> I[package artifact exists and runs]
```

**Key decisions.**

- **Packed, not linked.** A workspace symlink hides a missing dependency; a tarball does not.
- **Clean `mktemp -d`, no repo ancestry.** Running inside the repo lets `createRequire` walk up to
  the workspace's `node_modules` and pass for the wrong reason.
- **The matrix is `template × target`.** Native targets stay opt-in — the default gate must never
  require CMake, an NDK or Xcode — so the native columns run in the separate native workflow.
- **CI minutes are scarce on this plan.** Build the matrix as a script that runs locally first
  (`scripts/verify-golden-path.ts`), then wire it. Do not iterate by pushing.

## 3. Integration Ledger

| # | New thing | Live caller (`file:line`, non-test) | Replaces | Old path removed? | Negative control |
| --- | --- | --- | --- | --- | --- |
| 1 | `scripts/verify-golden-path.ts` | `package.json` script `verify:golden-path`; `.github/workflows/ci.yml` job | the partial scaffold smoke job | smoke job folds into it or is kept as the fast lane, stated in Phase 3 | delete a template's `esbuild`/`vite` dep → the matrix goes red on that template |
| 2 | resolver fix in `config.ts` | `config.ts:195` (`importConfig`) | the current `resolveEsbuild` chain | replaced in Phase 2 | the Phase 0 reproduction command exits 0 after, 1 before |
| 3 | CLI `--help` coverage test | `packages/create-threenative/__tests__/cli.spec.ts` | — | n/a, new | remove a command's help text → fails |
| 4 | error text carrying layer + searched paths + fix command | `config.ts:176-179` and siblings | the current one-line message | replaced in Phase 2 | assert the message names at least one searched path |

**Reachability.** Entry points are `npx create-threenative`, `threenative dev|build|test|ship`,
and CI. No new entry point.

## 4. Phases

### Phase 0 — Reproduce `TN_CONFIG_TRANSPILER_MISSING` (blocking)

**No code.** From a clean `mktemp -d`, with packed tarballs:

- [ ] scaffold each template
- [ ] run `threenative build --target web`
- [ ] run `pnpm exec vite build` in the same directory
- [ ] record `cwd`, the resolved `esbuild` path (or the failure at each of the three fallbacks),
      and the pnpm store layout

**Outcome written into this PRD before Phase 2:** either *"reproduced on template T; fallback N
fails because …"*, or *"not reproduced across all seven templates"*. If it does not reproduce,
**Phase 2 is deleted, not weakened** — and Phases 1 and 3 still stand on their own, because the
matrix is what would have caught it.

Also re-verify the adopter-pilot install failure in the same run: does `./scaffold.sh` install
today, from tarballs, in a clean directory?

### Phase 1 — The matrix exists and runs locally

**Files:**

- `scripts/verify-golden-path.ts` — NEW: pack → `mktemp -d` → scaffold → install → dev → test →
  build web → assert artifact
- `package.json` — EDIT: `verify:golden-path` script
- `scripts/__tests__/verify-golden-path.spec.ts` — NEW: the step list is data, and a missing step
  throws rather than being skipped

**Wiring:**

- [ ] Caller edited: root `package.json`
- [ ] Ledger row filled: #1

**Fail-closed requirement.** A step that cannot run **fails**; it never skips. A template the
matrix does not know about **fails**; the template list is derived from the templates directory,
never hardcoded. This is the same rule the playtest package holds and the same rule the sweep
archive broke for three rounds by silently dropping a file.

**Negative control (must be observed red):** remove `vite` from one template's
`devDependencies` → that template's column goes red with a message naming the template and the
missing dependency.

### Phase 2 — Fix what Phase 0 found, and make the error text usable

**Only if Phase 0 reproduced something.**

**Files:**

- `packages/create-threenative/src/config.ts` — EDIT: the resolution, and the message
- `packages/create-threenative/__tests__/config.spec.ts` — EDIT/NEW

Every error this journey can emit must name: the failing layer, the locations searched, and the
corrective command. `"threenative.config.ts needs project-resolved esbuild; install Vite or
esbuild."` names none of the three.

**Ledger rows filled:** #2, #4. **Report the LOC delta** against the 259-line headroom.

### Phase 3 — The matrix runs in CI, and `--help` is reliable

**Files:**

- `.github/workflows/ci.yml` — EDIT: replace or subsume the scaffold smoke job
- `packages/create-threenative/__tests__/cli.spec.ts` — NEW/EDIT: `--help` for every public
  command, and template/genre selection reachable without editing a generated shell script

**Ledger rows filled:** #1 (`Old path removed?`), #3.

Run it locally before pushing. One CI run, not an iteration loop.

## 5. Criteria

| # | Criterion | Met? |
| --- | --- | --- |
| 1 | Every supported template completes `create → dev → test → build web` from clean packed artifacts in an empty directory, with no manifest edits, no workspace symlinks, no undocumented env vars | — |
| 2 | The matrix is red when a template's dependency set is broken — observed, with the command | — |
| 3 | `TN_CONFIG_TRANSPILER_MISSING` is either reproduced-and-fixed, or recorded as not reproduced across all seven templates with the commands run | — |
| 4 | `./scaffold.sh` installs today from a clean directory, re-verified rather than assumed | — |
| 5 | `--help` returns usable text for every public CLI command | — |
| 6 | Template and genre selection are reachable from CLI flags — no generated shell script needs editing | — |
| 7 | Every error on the journey names the failing layer, the searched locations, and the corrective command | — |
| 8 | `pnpm typecheck && pnpm lint && pnpm test` green; framework LOC delta reported | — |

## 6. Evidence

| Gate | Command | Result |
| --- | --- | --- |
| Phase 0 reproduction | *(fill in — paste `cwd`, resolved paths, exit codes)* | — |
| Golden path, local | `pnpm verify:golden-path` | — |
| Negative control | remove `vite` from one template → `pnpm verify:golden-path` | — |
| CLI help | `pnpm exec vitest run packages/create-threenative/__tests__/cli.spec.ts` | — |
| Typecheck / lint / test | `pnpm typecheck && pnpm lint && pnpm test` | — |
| Budgets | `pnpm budgets` | — |

## 7. What this does not do

- **It does not claim a native target.** `build --target desktop|android|ios` and `package` stay
  in the separate native workflow; desktop and the iOS simulator are green, the Android emulator
  is red on the hosted lane, and physical hardware is untested. Nothing here says mobile-ready.
- **It does not publish anything.** No tags, no registry publishes. The published-artifact path is
  beta row 5 and is blocked outside this repository.
- **It does not add CLI surface.** Four commands, ever: `dev`, `build`, `test`, `ship`.

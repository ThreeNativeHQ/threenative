# PRD execution review — 2026-08-08

Scope: the five selected PRDs (033, 035, 036, 038, 039) on branch
`docs/opportunity-areas-prds`. PRD-043 is deliberately outside this review and is queued
for later execution. Every current claim below is backed by a run in this working tree;
the first failing runs remain as historical diagnosis.

## Current disposition

- The packed-tarball scaffold fix is committed at `21a32c0`; the licensed-asset MCP scaffold
  work is committed at `12b3d3d`.
- The PRD-036 lane is merged at `f3fe02f` (including its replay consumer, oracle, and
  pointer/replay follow-up fixes).
- The full browser gate now passes under the prescribed headed WebGPU recipe: all four tests
  passed in 1.7 minutes, including the checked-in replay scenario and real record/replay trace.
- Fresh starter proofs now pass: coyote jump `1/1`, peak rise `1.04`, and look camera
  separation `9.451` against the `9.5` limit, with zero console/network errors.
- PRD-036's remaining release gates are now limited to the manual watch-and-diverge check,
  replay-removal/stale-artifact controls, and its separate ≤200-line feature-delta budget.

---

## 1. Historical gate snapshot — superseded by post-merge evidence

At the pre-merge `272b5ea` snapshot, every open PRD said its release evidence was held up by two things: a repository-wide
lint/test red from dirty proof JSON, and port 4173 being held by an unrelated process.
That snapshot was re-run during the original review and is retained here as historical
diagnosis; the current post-merge gate results are recorded in §7.

| Gate | What the PRDs record | Re-run result at `272b5ea` |
|---|---|---|
| `pnpm typecheck` | PASS | **PASS** (exit 0) |
| `pnpm lint` | "BLOCKED — four out-of-scope JSON files fail formatting" (PRD-035, PRD-036) | **PASS** — `Checked 916 files in 308ms. No fixes applied.` (exit 0) |
| `pnpm test` | "BLOCKED — 1 failure in `scripts/__tests__/proof-set.spec.ts`" (PRD-035) | **PASS** — `Test Files 142 passed (142) / Tests 1009 passed (1009)` (exit 0) |
| `pnpm budgets` | PASS | **PASS** — `7 packages, 4184 framework LOC, 6 PRD files, largest template 1200 LOC` |
| `pnpm sync:agents --check` | PASS | **PASS** — 30 mirrors in sync |
| `pnpm tsx scripts/count-loc.ts --check` | PASS | **PASS** — platformer template 1164 / 1850 |
| `pnpm test:playtest` | not claimed recently | **PASS** (exit 0) — `framework-movement` and `framework-camera`, both `pass: true`, zero console/network/diagnostic errors |
| `pnpm test:browser` | "blocked — port 4173 held by an existing user process" (PRD-035, PRD-036, PRD-038) | **FAIL (exit 1), and not for that reason** — see §2 |

Port 4173 was confirmed free (`ss -ltnp` showed nothing listening) before the run.

The WIP commit `272b5ea` is what cleared the lint/test red: it reformatted
`docs/verification/*-reveal.json` and repaired the two `topdown-action*.playtest.json`
proof files that `proof-set.spec.ts` was failing on.

**Historical consequence:** PRD-033, PRD-035, PRD-036 and PRD-038 each cited these blockers as
a reason they stayed in `docs/PRDs/`. The current disposition must use §7, not this snapshot.

### A caution about how these gates are run

A first `pnpm test:playtest` run failed (`exit 1`, 6 console errors,
`[vite] Failed to reload /src/main.tsx`, three `404`s on
`packages/core/dist/{index,hot,playtest}.js`). That failure was **self-inflicted**: a
concurrent `pnpm test` was rebuilding every package, and `tsup --clean` empties
`packages/core/dist` mid-run while the example's Vite server is serving it over `@fs`.
Re-run alone, the identical command passed. Any future evidence run must be serialized —
a concurrent build produces a red that looks exactly like a hot-reload defect.

---

## 2. Historical browser blocker — resolved in this review

This is the finding with the shortest fix and the widest blast radius. **It is not a port
conflict.** With every port free, `pnpm test:browser` dies before a single test runs:

```text
[vite] Failed to resolve import "three-mesh-bvh" from "src/pick.ts". Does the file exist?
  File: /tmp/threenative-starter-look-ltt8V3/starter/src/pick.ts:4:73
  1 | import { BufferGeometry, Mesh, Raycaster, Vector2 } from "three";
  2 | import { acceleratedRaycast, computeBoundsTree, disposeBoundsTree } from "three-mesh-bvh";
    |                                                                          ^
Error: Process from config.webServer was not able to start. Exit code: 1
```

Root cause, confirmed by reading the config and the tree:

- `playwright.config.ts:22-28` (`prepareHotReloadProject`) and `:31-40`
  (`runStarterLookServer`) both copy `templates/starter` to a temp dir and satisfy its
  imports by symlinking `node_modules/.pnpm/node_modules` — the workspace hoisted directory.
- PRD-038 added `src/pick.ts`, which imports `three-mesh-bvh`, and declared the dependency
  **only in the template's own `package.json`**
  (`packages/create-threenative/templates/starter/package.json:19`).
- `three-mesh-bvh` is installed nowhere in the workspace:
  `ls node_modules/.pnpm/node_modules | grep three` returns only `three`,
  `@threenative`, `create-threenative`. A repo-wide grep finds the string in exactly one
  file, that template manifest.

So the temp scaffold cannot resolve it, its Vite server exits 1, and Playwright aborts.

**Both blocked webServers are the ones PRD-035 and PRD-036 need.** The `hot-reload` project
(PRD-035's leak gate) and `abyss-framework-replay` (PRD-036's consumer proof) never get to
run, because the `starter-look` webServer entry fails first and Playwright starts them as a
set. Three PRDs are each recording "full browser suite pending" for what is one absent
devDependency.

PRD-038's own verification hints at this without naming it — its consumer runs describe
installing `three-mesh-bvh` into a disposable project by hand, and PRD-035's manual probe
says the scaffold "needed the template's existing `three-mesh-bvh` dependency, supplied
from the local cached package for this temporary probe only". Every manual run papered over
the hole; the automated gate is the thing that found it.

**This also means CI has never run these three Playwright projects since PRD-038 merged.**

### The fix, and the two dead ends before it

Adding `three-mesh-bvh` to the workspace does **not** work, and this is worth recording so
nobody tries it twice. `.npmrc` sets no `hoist-pattern`, so a root devDependency lands in
`node_modules/.pnpm/three-mesh-bvh@0.9.14_three@0.185.1/` and never appears in
`node_modules/.pnpm/node_modules/` — the exact directory both helpers symlink. Verified:
after `pnpm install`, `ls node_modules/.pnpm/node_modules | grep three` still showed only
`three`, `@threenative`, `create-threenative`.

Replacing the copy-and-symlink with `createProject({ install: true, packageSources })`
pointed at the `packages/*` source directories gets one step further and then fails
differently:

```text
ERR_PNPM_SPEC_NOT_SUPPORTED_BY_ANY_RESOLVER  pngjs@catalog: isn't supported by any available resolver.
This error happened while installing the dependencies of @threenative/playtest@0.1.0
```

A source directory still carries `catalog:` specifiers, and the catalog protocol only
resolves inside the workspace. `.github/workflows/ci.yml:80-90` already knows this — the
scaffold smoke packs each package with `pnpm pack --pack-destination` and scaffolds from
the tarballs, because `pnpm pack` rewrites `catalog:` into real versions.

**The working fix** is therefore to pack first: `playwright.config.ts` now builds
`./packages/**`, packs the four `@threenative/*` packages into a temp staging directory,
and passes those tarball paths as `packageSources`. The staging path is exported as
`THREENATIVE_PACKED_PACKAGES` so the `--starter-look-server` child process reuses the
parent's tarballs instead of packing a second time. Each temp project then runs a real
`pnpm install` against its own manifest, which is where `three-mesh-bvh@0.9.14` is
declared — so the original import resolves for the same reason it resolves for a real user.

### Historical result: the dependency blocker was followed by a recipe gap

With the pack step in place, `pnpm test:browser` was re-run under
`xvfb-run -a -s '-screen 0 1600x900x24'` with ports 4173–4178 confirmed free and nothing
else building. Observed:

- the four tarballs pack (`/tmp/threenative-packed-*/threenative-{core,physics,playtest,ui}-0.1.0.tgz`),
- both temp projects install cleanly, with `three-mesh-bvh 0.9.14` among their dependencies,
- Vite serves the scaffolded starter and the game boots.

**The `three-mesh-bvh` blocker is closed.** The suite still exits 1, now for an unrelated
reason one layer further in:

```text
[vite] (client) [console.warn] THREE.WebGPURenderer: WebGPU is not available, running under WebGL2 backend.
Error: Starter look reference failed: cool player pixels 163 are missing.
Error: Process from config.webServer was not able to start. Exit code: 1
```

`runStarterLookScenario` (`playwright.config.ts:131-149`) spawns the playtest CLI with only
`--browser-arg --disable-gpu-sandbox --browser-arg --ignore-gpu-blocklist` — **no
`--browser-recipe webgpu` and no `--headed`**. The starter therefore renders through the
WebGL2 fallback, and the reference pixel check for a WebGPU-authored look fails. That
invocation is byte-identical to `HEAD`, so this gap predates both the packaging fix and
PRD-038; it was simply unreachable while the install failed first.

This is the same recipe rule `AGENTS.md` already states for screenshot and `visual`
assertions, and the same one `pnpm test:playtest` and `pnpm visuals` already follow. The
next step for whoever picks this up is to bring `runStarterLookScenario` onto
`--browser-recipe webgpu --headed`, then re-run.

The historical first run did not observe the three projects. That state is superseded by the
final rerun recorded in §7.

---

## 3. The former merge blocker: PRD-036 work is integrated

`linchpin/prd-036-save-load-and-deterministic-replay` has **19 commits and 1,454
insertions that were not on `docs/opportunity-areas-prds`**, plus a committed follow-up
at `7e61a9f`. The lane and follow-up are now integrated by merge commit `f3fe02f`.

Merge base is `248b5d9`; HEAD has 25 commits the lane does not have, so the two have
genuinely diverged.

What is stranded on the lane:

| Artifact | Status after `f3fe02f` |
|---|---|
| `tests/browser-replay/replay.golden.json` (mid-trace + final-position oracle) | **absent** |
| `packages/playtest/__tests__/evidence-required.spec.ts` | **absent** |
| `examples/abyss-framework/recordings/replay.json`, `replay.oracle.json`, `src/replay-proof.ts` | **absent** |
| `packages/playtest/src/runner/recording.ts` (+149), `scenario.ts` (+76), `runner.ts` (+70), `assertions.ts` (+39), `protocol.ts` (+14) | **absent** |

This mattered because the lane's own `docs/verification/PRD-036.md` recorded the exact
control that HEAD's copy still lists as **pending**:

> temporarily changing `const speed = 560 * dt` … to `const speed = 565.6 * dt` makes the
> **generated-scenario test itself** fail its `movement.reachesPositionWithin` assertion …
> mid-trace: Expected <= 0.000001; Received 4.6533223516233875

So the "generated-scenario regression sensitivity" that HEAD's ledger called unfinished had
already been done and observed red. It is now part of the merged consumer proof.

**Merge hazard (resolved):** the lane predated the PRD-038 merge and did not contain
`packages/create-threenative/templates/starter/src/pick.ts` or `pick.playtest.json`. The merge
preserved both files.

**The former uncommitted lane follow-up is now committed** at `7e61a9f`:

- `packages/core/src/replay.ts` — a genuine pointer bug fix. `pointerType` was
  `previous & ~next ? "pointerup" : "pointerdown"`, which misclassifies chorded button
  changes; the fix is `previous && !next ? "pointerup" : !previous && next ? "pointerdown"
  : "pointermove"`.
- `packages/playtest/src/runner/runner.ts` — suppresses the trailing one-frame wait on the
  final step.
- matching `replay.spec.ts` and `PRD-036.md` edits.

---

## 4. Per-PRD disposition

### PRD-033 — playtest semantic depth
**Recommend: close and move to `docs/PRDs/done/`.**
Implementation is on HEAD (`packages/playtest/src/runner/observationFields.ts` exists).
The 11/11 platformer consumer run and two browser negative controls are recorded in
`docs/verification/PRD-033.md`. The only stated remaining item was the repository-wide lint
red, which now passes. Its lane is four commits *behind* HEAD, not ahead — nothing is
stranded.

### PRD-035 — hot reload with state preservation
**Recommend: close after the final integration commit.**
Implementation and template wiring are on HEAD; the lane is behind HEAD. Its checklist has
now been exercised by the passing full `xvfb-run ... pnpm test:browser` gate; the revert
check remains a separate negative-control item.

### PRD-036 — save/load and deterministic replay
**Recommend: finish the remaining release gates, then move to `docs/PRDs/done/`.**
The merge and full browser consumer proof are complete. Three items remain genuinely open per the lane's own ledger: the
manual watch-and-diverge checkpoint, the replay-removal/stale-artifact control, and the
PRD's own ≤200-line feature-delta gate (the lane records core/physics at `+288/-32`, a net
`+256` — **over the PRD's own budget**, and `pnpm budgets` does not catch it because the
global 15,000 cap is green at 4,184).

### PRD-038 — runtime GPU transport and acceleration
**Recommend: close after the final integration commit.**
The `starter-pick` consumer gate and the removal proof both pass (recorded, and the
`fastPicks: 310 → 0` control is a clean red). The two pre-existing starter-template failures
are fixed in this review:

- `coyote` — the scenario now leaves the ledge while retaining the input chord; the fresh
  headed WebGPU run records `coyoteJumps: 1`.
- `look` — the starter arm offset is now within budget; the fresh run records separation
  `9.451` against `"within": 9.5`.

These are starter-template changes, not framework package changes, and remain isolated from
the PRD-038 transport implementation.

### PRD-039 — animation state machine
**Recommend: move to `docs/PRDs/done/` now.**
Status is `CLOSED — WONTBUILD`; the lane is identical to HEAD; the template guidance it
prescribed is present in all four templates' `AGENTS.md`/`CLAUDE.md`. Keeping a WONTBUILD
record in the live directory spends one of the ten `docs/PRDs/` slots for nothing.
One acceptance item is genuinely unmet: `OPPORTUNITY-AREAS.md` area #8 still reads as
originally scored and was never updated to "conditionally closed". That is a one-line edit,
not a reason to keep the file open.

---

## 5. Process signals worth steering

### 5a. `round:next` says the round is over
```
$ pnpm round:next
close round 2
All evidence and dispositions are recorded; close the round.
```
Round 2 has been closeable while five PRDs churn on release evidence. Closing it is what
unlocks round 3's measurement, which is the instrument the roadmap's Phase 2 exit gate
depends on.

### 5b. `round:deletions` reports 163 candidates and nothing has been deleted
```
$ pnpm round:deletions | grep -c '^| '
163
```
Archives checked: `exploration-2026-08-07-5` (round 2) and `platformer-2026-08-07-50`
(round 1). The candidate list includes `AnimationPlayer`, `AssetLoader`, `FixedStepLoop`,
`EntitySnapshot`, `unknownPlaytestCapabilities` and most of the public surface. This is
`CHARTER.md` rule 2's executor — the kill switch — producing a signal every round and being
ignored every round. PRD-039 independently confirmed one of them (`AnimationPlayer`: zero
non-test consumers, its only ever caller `Fox.ts` no longer exists in the repo).

Two readings, and the project should pick one deliberately rather than leave it ambiguous:
either the exports really are dead and rule 2 requires deleting them, or the instrument
over-reports because a sandbox arm only exercises a genre slice — in which case the report
needs a reach threshold and the current output is noise that trains everyone to skip it.

### 5c. Unmerged work on the review branch
`docs/opportunity-areas-prds` is ahead of `main` and `main` is not ahead at all.
Everything in this review — PRD-033 through PRD-039, four merged lanes, the whole hot
reload and replay implementation — exists only on one local branch with no remote. There is
no upstream copy of any of it.

### 5d. Verification ledgers are written once and not re-run
Three separate ledgers assert `pnpm lint` is BLOCKED and `pnpm test` is BLOCKED. Both pass.
The documents were accurate when written and are read now as if still current. Whatever
form the ledgers take, a gate line needs the commit it was observed at, and a re-run before
it is cited as a reason to keep a PRD open.

---

## 6. Recommended order

1. ~~Unblock the scaffolded projects' dependency resolution~~ — **done**, see §2. The
   pack-then-scaffold step is in `playwright.config.ts`; verified by observing
   `three-mesh-bvh 0.9.14` install into both temp projects.
2. ~~Put `runStarterLookScenario` on `--browser-recipe webgpu --headed` and run the browser
   gate~~ — **done**, see §7.
3. ~~**Merge `linchpin/prd-036-save-load-and-deterministic-replay` into
   `docs/opportunity-areas-prds`**~~ — **done** in `f3fe02f`; the merge preserved the PRD-038
   starter transport files and the lane follow-up.
4. **Finish the remaining PRD-036 controls, then move PRD-039, PRD-033, PRD-035 and PRD-038
   to `docs/PRDs/done/`**, updating `OPPORTUNITY-AREAS.md` area #8 while doing it.
5. ~~Fix `coyote` and `look` in the starter template~~ — **done**, see §7; then **close
   round 2** (`pnpm round:next`) and decide 5b — delete the dead exports or fix the
   instrument.

## 7. Final evidence after review fixes

| Proof | Result |
|---|---|
| `xvfb-run -a -s '-screen 0 1600x900x24' pnpm test:browser` | **PASS** — `4 passed (1.7m)` |
| Fresh `coyote.playtest.json` with `--browser-recipe webgpu --headed` | **PASS** — `jumps: 1`, `coyoteJumps: 1`, `peakRise: 1.04`, zero diagnostics |
| Fresh `look.playtest.json` with `--browser-recipe webgpu --headed` | **PASS** — movement `7.27`, camera separation `9.451`, zero diagnostics |
| PRD-036 focused tests | **PASS** — 67 tests across replay, constraints, runner, recording, scenario, and census specs |
| `pnpm budgets` | **PASS** — 7 packages, 4,243 framework LOC, 6 PRD files |
| `pnpm lint` / `pnpm test` | **BLOCKED outside this review lane** — lint sees broken PRD worktree symlinks plus the existing topdown proof formatting; test reports 1,084/1,086 tests with the existing missing `reload` proof assertion and sync-agent-docs timeout |

PRD-043 is not part of these results. It remains a proposed, later execution item and must
not be marked done from this review.

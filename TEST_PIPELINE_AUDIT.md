# Test & Publishing Pipeline Audit — 2026-08-23

Scope: every gate that decides green or red — CI workflows, `pnpm test` and its phases, the
playtest/browser/template/conformance lanes, and the npm + native release pipelines. Method: four
parallel audits (publishing, CI structure, unit-test quality, e2e lanes) plus live evidence from
`gh run list`, one timed local suite run, and executed checks. Goal: **make test cycles fast and
reliable**.

---

## 0. Headline

| Fact | Evidence |
| --- | --- |
| **CI has never been green** — 0 of 11 runs since the workflow was created (Aug 17) | `gh run list --workflow=ci.yml` |
| **`main` is red right now in two independent gates**, both caused by the same commit series (`95c079b4`, asset pipeline) adding `@threenative/assets` without updating hand-maintained package lists | F1, F2 below; both verified by execution/log |
| A third list drifts silently: `test:browser` scaffolds a starter that pins `@threenative/assets@0.3.0`, which exists on no registry and in no packed tarball it is given | `playwright.config.ts:17-28`, `templates/starter/package.json:29`, `npm view @threenative/assets version` → error |
| One CI run burned **6 h before GitHub's hard cap killed it** (Aug 18) — no `timeout-minutes` exists anywhere | run 32093290598 |
| Every `pnpm test` — including CI — **hard-depends on 596 lines of behaviorally untested lease logic** that exits before any test runs if it fails | `run-test-suite.sh:72-81`, `worktree-lifecycle.ts` |
| The native release lane **publishes binaries with zero quality gates** and fires regardless of main's CI state | `native-release.yml` (no typecheck/lint/test job; contrast `npm-release.yml:40-42`) |
| The **npm release lane has never run once** (zero tags pushed); neither has native-release | `gh run list` per workflow |
| The **local suite itself is healthy**: 194 files / 1863 tests, all green at HEAD, full `pnpm test` = **1 m 41 s wall** on this machine | timed run, this audit |

The unifying disease: **the same set of packages is enumerated by hand in at least five places,
and each enumeration drifts on its own schedule.** Three have already drifted.

---

## 1. Current state

### 1.1 What runs where

Local `pnpm test` (`scripts/run-test-suite.sh`) = four serial phases:
docs → build → package-test (`pnpm -r run test`) → unit (root `vitest run`). Package-level test
scripts are mostly just `publint --strict`; the real specs run once through root vitest — except
assets, which runs them twice (§5).

CI (`ci.yml`) chains install → typecheck → lint → test (+browser +playtest) → golden-path /
benchmark / native-platforms → visuals / build → budgets. CLAUDE.md's "install → typecheck → lint
→ test → scaffold-smoke → visuals" matches loosely; two documented routines never run in CI:
**`pnpm test:templates`** (5 of 7 templates' playtests are local-only) and web↔desktop **`pnpm
parity` + `parity:ledger`** (CI only covers web↔Android-emulator).

Publishing: no changesets/release-please. Version bumps are manual edits; `pnpm publish:check`
(`scripts/check-publish-state.ts`) refuses stale/leaky/incomplete trees; `scripts/release.ts`
computes dependency order, waits for registry readability between packages, ends with a clean-room
registry install. The GitHub workflow duplicates this path with fewer protections (§2, F7).

### 1.2 The three drifted lists (all live today)

| Site | What it enumerates | Drift |
| --- | --- | --- |
| `.github/workflows/ci.yml:31-36` | packages built before typecheck | missing `@threenative/assets` → create-threenative tsup fails to resolve it → **typecheck job red on main** |
| `.github/workflows/npm-release.yml:65-77` | publish-set comment block | `@threenative/assets` unnamed → `pnpm publish:check` **exits 1 on main** (verified by running it) |
| `playwright.config.ts:17-28` | packages built+packed for browser-lane scaffolds | missing assets (and engine-mcp) → scaffold installs a pin that resolves nowhere → **`test:browser` red** |

Also drifting in the same class: `publication.spec.ts:69-90` export/bin walk skips assets +
engine-mcp; `packages/core/mcp/servers.mjs:38-43` npx-fallback versions untested against
manifests. By contrast `LOCAL_FRAMEWORK_PACKAGES` in `scripts/visual-gate.ts:35-44` was updated
correctly — proof the fix is mechanical when lists share a source.

---

## 2. Reliability findings (ranked)

### P0 — these decide whether any signal is real

**F1. Five hand-maintained package enumerations (see table above).**
Fix: generate every list from the workspace manifests — one exported module (or generated JSON)
that names non-private packages with their build/pack/test roles; ci.yml reads it via a tiny
script step; the npm-release comment becomes generated output checked by `sync:agents`-style
`--check`. Add a meta-spec that fails when any package.json/workflow/script hardcodes a package
list that disagrees with the manifests. Effort: ~half a day; kills the entire failure class.

**F2. No `timeout-minutes`, no `concurrency`, unfiltered triggers.**
Hung jobs burn up to 6 h (observed). Every push on an open PR branch runs the pipeline twice
(push + pull_request events) and stacked pushes are never cancelled.
Fix: per-job timeouts sized to observed durations (test ≈ 15 min, golden-path ≈ 20 min,
native ≈ 30–45 min), `concurrency: { group: ci-${{ github.ref }}, cancel-in-progress: true }`,
and `on: push: branches: [main]` so PRs trigger only via `pull_request`.

**F3. The lease system gates every `pnpm test` and is behaviorally untested.**
`run-test-suite.sh` registers a worktree lease first and **exits 2 before any test runs** if
registration fails; each phase preconditions on `worktree-lifecycle verify`. The 596-line
implementations' acquire/expiry/stale-PID/release paths have no spec (existing specs import types
only). A regression here doesn't weaken a gate — it reds or greens the whole fleet.
Fix: behavioral spec for register/verify/heartbeat/release incl. stale-PID takeover and expiry;
plus a spec for `run-test-suite.sh` phase ordering/resume.

**F4. `orphan-cleanup.sh` compares global `/tmp/threenative-*` counts.**
Concurrent lanes (this repo explicitly supports them) cross-talk into false reds, and a leak
offset by another directory's cleanup cancels out.
Fix: scope counting to the suite's own marker/namespace; add a spec (it currently has none).

### P1 — wrong results or unreleased value

**F5. Native release publishes binaries with no gates.** Tag-on-red-main ships; nothing couples
`runtime-native-vV` artifacts to an npm publish of `@threenative/runtime-native@V`; consumer
installs 404 if either side moves alone; the download URL hardcodes the org/repo
(`packages/runtime-native/scripts/install-prebuilt.mjs:56-58`). Emulator/device legs are
single-shot — one boot flake deletes a fully-built release (`cleanup-failed-release`).
Fix: add a gates job (typecheck/lint/test + require the merge-commit's CI conclusion via API);
fail the npm lane if the matching native release is absent; one retry on emulator boot steps.

**F6. Template exact-pins are under-tested, and `templates/**` edits never demand a bump.**
Staleness counting targets `src/` only (`check-publish-state.ts:115-126`), so editing templates
never triggers a scaffolder bump requirement; pin-vs-workspace tests cover ui/starter+platformer
only; core/physics/assets/playtest pins in action-rpg/defense/racing/shooter are unchecked.
Bumping packages without touching ~20 manifest fields ships games pinned to old-but-existing
versions — invisible until a user installs.
Fix: one spec iterating ALL templates × ALL internal pins vs workspace versions; include
`templates/` in check-publish-state's moved-source walk for create-threenative.

**F7. Two divergent publish paths.** release.ts waits up to 180 s for registry readability between
packages; the workflow does not. The workflow's `dry_run` input promises packing but performs none,
and skips clean-room too — a dispatch-dry green says nothing. CI never exercises release.ts, even dry.
Fix: make the workflow call `tsx scripts/release.ts --yes` (single path, all protections), or port
waitForRegistry into it; implement dry_run as `release.ts` without `--yes`.

**F8. Provenance configured but never emitted.** Publish job holds `id-token: write`
(`npm-release.yml:52-54`) yet neither publish command passes `--provenance` (pnpm requires the
explicit flag). All eight packages ship unattested while holding the permission.
Fix: add `--provenance` to both publish commands.

**F9. navigation.playtest.json sits on knife-edge margins — four independent red mechanisms.**
(a) `pathLength ≥ 9` vs measured ~9.2–9.35 arc chord-summed every 10 ticks (~3 % margin);
(b) arrival needs ~166–175 ticks of the 210 given, eroded further by `warmupFrames: 0` racing the
async scene mount; (c) `noNetworkErrors: true` captures vite cold-start aborted requests that have
nothing to do with gameplay; (d) today's retarget-semantics change (`b18b32af`) landed exactly on
this probe's steering surface. None of the four is self-explanatory in the report — this is the
"red at HEAD" scenario from project memory.
Fix: raise headroom (pathLength ≥ 8.5 as floor-of-truth or extend tick budget), set
`warmupFrames` > 0, scope network policy to post-ready window, and make the report say which
assertion failed and why.

**F10. Adapter honesty is not universal.** The software-adapter diagnostic only runs where capture
provenance exists — screenshot-less scenarios like navigation get **no** adapter verification even
under `--browser-recipe webgpu`. Root Playwright lanes launch with truncated WebGPU recipes
(`playwright.config.ts:388` lacks Vulkan feature, `:436` lacks even unsafe-webgpu) and assert no
adapter info; benchmark config lacks `--strictPort`.
Fix: read adapter.info unconditionally in the runner (not only on capture); align all Playwright
launch args via the shared `WEBGPU_BROWSER_ARGS`; assert adapter name in every lane's spec.

**F11. visual-gate port and teardown weaknesses.** Template servers bind `5300+index` with no
availability pre-check (`visual-gate.ts:381`) — a stale listener gets screenshotted and graded
green; server stop is group-SIGTERM without wait/KILL escalation (`visual-gate.ts:53-60`).
Fix: reuse the runner's free-port probe + TERM→KILL ladder.

**F12. `test:playtest` = four sequential vite cold starts sharing port 5180.** Each run fully tears
down after itself (good), but `&&` chaining means one environmental flake blocks scenarios 2–4,
and the runner's existing multi-scenario shared-server path (`runner.ts:560-612`) is unused. Also
the first two scenarios live in `playtest/` (singular) while the rest use `playtests/`.
Fix: switch the script to one server + multi-scenario invocation; fold the singular dir away.

**F13. Android parity baseline accepts exit-2 reference captures** (`native-platforms.yml:53-59`),
so emulator comparisons can be graded against incomplete references. Conformance exclusions in
`conformance/registry.json` have no expiry field — they rot only if their row starts passing.
Fix: fail the capture leg on exit 2 (or mark rows blocked, never compare); add optional
`expires` to exclusions, reported as blocked past expiry.

### P2 — worth doing, not urgent

- `minDistance` on an unobserved entity reports "moved 0.000000" instead of "never observed"
  (`movement-evidence.ts`) — correct verdict, misleading diagnostic.
- Capture-lock liveness via `kill(pid,0)` — PID reuse can mask a dead holder until timeout.
- Starter dev-server curl loop in golden-path falls through to a confusing Playwright error when
  the server never comes up (`ci.yml:216`) — name the cause instead.
- `primary-docs.spec.ts` never reads `.github/workflows/*`, so the CLAUDE.md CI-chain sentence can
  drift silently — extend its walk.
- benchmark config lacks `--strictPort` on its webServer.

---

## 3. Low-value tests to remove or shrink

The suite is unusually healthy — near-zero mocking (6 legitimate stub sites across 144 specs),
zero snapshots, incident-annotated textual gates, waiter-based async discipline. Removals are
localized:

1. **Delete `packages/core/__tests__/grounding-discovery.spec.ts`** — byte-identical duplicate of
   `grounding.spec.ts` (same md5, 70 lines). Every GroundSnap test runs twice under two names.
2. **Drop the vitest invocation from `packages/assets/package.json` test script** (keep build +
   publint) — removes all 7 double-executed spec files plus a redundant full build per cycle.
3. **Remove dead glob `hosting/**/*.spec.ts`** from root `vitest.config.ts:9` — no such directory.
4. **Trim style policing**: `looks.spec.ts:10-13` (exact call-syntax string) and `:38-44`
   (bans `RenderPipeline`/`renderer.render =` strings — Three.js idioms by text). Keep the
   determinism ban at `:102-104` and the ownership smell-test — those guard real invariants.
5. **Move `debug-overlay-css.spec.ts`** (cross-file CSS text coupling) into a playtest assertion
   rather than grepping example source from a node-env unit test.

## 4. High-value tests to add

| Test | Guards against | Where |
| --- | --- | --- |
| Meta-guard: fail when any package.json test script invokes vitest on paths matched by root include, or when any tracked file hardcodes a package list disagreeing with workspace manifests | recurrence of F1 + the assets double-run | new `scripts/__tests__/package-list-drift.spec.ts` |
| Behavioral spec for `worktree-lifecycle.ts` register/verify/heartbeat/release, stale-PID takeover, expiry | fleet-wide false reds/greens (F3) | `scripts/__tests__/worktree-lifecycle-behavior.spec.ts` |
| All-templates × all-pins vs workspace versions | silently stale shipped games (F6) | extend `create-threenative/__tests__/publication.spec.ts` |
| orphan-cleanup namespace-scoped behavior | false reds under concurrent lanes (F4) | `packages/playtest/__tests__/orphan-cleanup.spec.ts` |
| Unconditional adapter-info assertion in every browser lane | SwiftShader results passing as evidence (F10) | playwright configs + runner |
| Workflow structure spec: every job has timeout-minutes; publish-set comment equals publishSet(); ci.yml build-list equals workspace build order | CI YAML drift without pushing | `scripts/__tests__/ci-structure.spec.ts` |
| More situation queries in `engine-mcp/search.spec.ts` (has 3) | capability-search ranking regressions — the framework's front door | existing file |
| Error-branch pass over `physics/src/simulation.ts` (1244 lines, largest unaudited module) | silent failure paths in physics | `packages/physics/__tests__/simulation-errors.spec.ts` |

## 5. Speed: making cycles faster

Measured: local `pnpm test` **1 m 41 s wall / 322 s CPU** (unit phase 25 s; 1863 tests).

Local wins (in order):
1. Assets de-duplication (§3.2): kills a redundant full assets build + 7 re-run specs per cycle.
2. Real builds inside the unit suite — `create-threenative/__tests__/build.spec.ts:110-123` runs a
   genuine `vite build` per template in a loop; `scaffold.spec.ts:398` another; `core/build.spec.ts:63`
   a full tsc of emitted types. Reduce to one representative template or tag as a slow tier.
   Estimated combined saving: 30–60 s per cycle.
3. `quality-json.spec.ts` spawns real pnpm per case — import the script module in-process.
4. Keep `retries: 0` in vitest (honest); prefer fixing F9-style margins over retry band-aids.

CI wins (per run):
1. Delete the standalone `install` job — pure serial latency; every other job installs anyway.
2. Share artifacts: build+pack once, upload tarballs/dist (pattern already exists at
   `native-release.yml:249-252`), download downstream — removes ≥5 rebuild/pack cycles and most of
   the 9 fresh installs' cost.
3. Chromium installed 6× per run — three times inside golden-path alone (`ci.yml:205,252,254`);
   collapse to one per job.
4. `pnpm test:browser` runs twice (test job `ci.yml:65`, benchmark job `ci.yml:279`) and root
   `playwright.config.ts` rebuilds+repacks six packages at config load each time — drop the
   duplicate run, consume the shared artifact.
5. Parallelize independent tails: lint and budgets don't need the serial chain position they hold.
Net effect: the critical path shrinks roughly to typecheck → test → golden-path → visuals, with
benchmark/build/budgets off-path.

## 6. Already strong — do not touch

Fail-closed discipline throughout (malformed scenarios throw; empty assertions fail; unreachable
registry blocks rather than passes). Exit-code contracts match docs exactly across playtest CLI,
visual-ab, and conformance. Xvfb handling dodges the xvfb-run trap everywhere. V8-vs-QuickJS
linker anti-crossing assertions in native-release are exemplary. `publish:check` did precisely its
job — caught the assets drift the day it mattered. Action pins verified current. Zero snapshot
tests, near-zero mocks.

## 7. Recommended order of operations

1. Green main: add `@threenative/assets` to the ci.yml typecheck build list and the npm-release
   publish-set block; add assets+engine-mcp to `playwright.config.ts` localPackages. *(minutes)*
2. Add `timeout-minutes` + `concurrency` + branch-filtered triggers to all four workflows. *(an hour)*
3. Single-source the package lists (F1) + meta-guard spec. *(half a day)*
4. Behavioral spec for worktree-lifecycle; namespace-scope orphan-cleanup. *(a day)*
5. Template-pin completeness spec + templates/ in bump-demand scope. *(half a day)*
6. Route the workflow publish through `release.ts`; add `--provenance`. *(hours)*
7. Speed pass: assets dedup, slow-tag tier for vite-building specs, CI artifact sharing. *(a day)*
8. navigation scenario margin repair; adapter honesty sweep. *(half a day)*
9. Native-release gates job + version coupling. *(a day)*

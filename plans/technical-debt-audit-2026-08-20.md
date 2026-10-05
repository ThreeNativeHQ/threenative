# ThreeNative technical-debt and developer-friction audit

**Audited commit:** `d75f4644`

**Date:** 2026-08-20

**Scope:** framework packages, native runtime, scripts, CI, tests, architecture/product guidance,
recent churn, local workspace hygiene, and recent Claude/Codex sessions associated with this repo.

## Answer first

The repository has strong verification intent, but its verification and agent-workflow plumbing is
now a material source of failures itself. The highest-leverage work is:

| Priority | Finding | Why first |
| --- | --- | --- |
| P0 | Restore a green, trustworthy root test baseline | `pnpm test` is red on committed evidence drift, so every later change starts from ambiguity. |
| P0 | Fix native libuv close ownership | Current shutdown ordering can free handle storage before libuv close callbacks finish. |
| P0 | Make native event-listener removal real | Game restart leaves protected JS callbacks registered and can duplicate input. |
| P0 | Make core startup/teardown failure-atomic | Plugin/scene failure can leak the renderer, timers, listeners, and partial plugins. |
| P1 | Reconcile Xvfb instructions and diagnostics | Stale emitted advice caused 14 exit-144 failures across 7 recent Claude sessions. |

Recommended order: verification baseline → native lifetime defects → core lifecycle rollback →
test/gate coverage → workflow/DX consolidation → large-module decomposition.

## Verification snapshot

| Check | Result on audited commit |
| --- | --- |
| `pnpm typecheck` | PASS; all 14 participating workspaces completed. |
| `pnpm test` | FAIL; 1 failed / 1,499 passed. `packages/physics/__tests__/actuation.spec.ts:274` expected stale native LOC evidence (`conformance/` 6,331 vs 6,341; `tests/` 9,468 vs 9,516). The suite then reported temporary-directory count 12 → 14. |
| `pnpm quality` | Exit 0 with 61 findings: 45 new, 16 inherited, 0 waived. |
| `pnpm budgets` | Exit 0 with review triggers: framework 15,025/15,000 and native runtime 78,347/50,000. |
| `pnpm round:next` | FAIL; treats a visual AB archive as a sweep and requires missing `sweep.json`. |
| `pnpm round:deletions` | FAIL at `scripts/round-deletions.ts:92` for the same archive-shape collision. |
| `pnpm audit --audit-level high --prod` | PASS; no known production vulnerabilities reported. |

No native build, device lane, browser playtest, template playtest, or visual gate was executed. Those
areas are reported only where source or existing evidence is conclusive.

## Ranked findings

### P0-1 — Restore the root verification baseline

- **Evidence:** `packages/physics/__tests__/actuation.spec.ts:256-281` couples a physics unit suite
  to a Markdown native-LOC record. The executed root test failed at line 274 because that record is
  58 lines behind the current census. `scripts/run-test-suite.sh:15-29` then found two additional
  temporary directories after the failed run.
- **Impact:** Every contributor starts with a red default gate and must decide whether a future
  failure is new. Coupling product behavior tests to manually refreshed evidence also makes unrelated
  native test additions break physics verification.
- **Effort / fix risk / confidence:** S / LOW / HIGH.
- **Fix direction:** Refresh the evidence immediately, then move census consistency to the owning
  budget/evidence test rather than `actuation.spec.ts`. Ensure failure paths still clean temporary
  directories, or make the cleanup report name the leaked paths.

### P0-2 — Preserve libuv handle storage until close completion

- **Evidence:** `packages/runtime-native/src/http/async_http_client.cpp:230-237` correctly documents
  that poll storage must survive asynchronous `uv_close`. Shutdown instead calls `uv_close` and
  immediately clears the owning map at lines 386-395. Runtime timers do the same at
  `packages/runtime-native/src/runtime.cpp:568-579`, before the event loop drains closes at
  `packages/runtime-native/src/async/event_loop.cpp:77-88`.
- **Impact:** Shutdown with active HTTP sockets or timers can make libuv access freed memory,
  producing intermittent native exit crashes or heap corruption.
- **Effort / fix risk / confidence:** M / HIGH / HIGH.
- **Fix direction:** Transfer closing handles to callback-owned storage, erase only from the close
  callback, drain the loop, and stress active HTTP/timer shutdown under ASan.

### P0-3 — Implement native listener identity and removal

- **Evidence:** document listeners are protected and retained at
  `packages/runtime-native/src/runtime.cpp:3729-3739`, while removal at lines 3745-3757 performs no
  comparison or erase. Window removal at lines 3943-3947 is an unconditional no-op.
  `packages/core/src/input.ts:188-204` installs these listeners and lines 352-362 expect disposal to
  reverse them.
- **Impact:** Native game restart retains stale callbacks and protected JS handles. Later starts can
  duplicate keyboard, mouse, blur, and pointer-lock behavior while memory grows.
- **Effort / fix risk / confidence:** S / LOW / HIGH.
- **Fix direction:** Reuse the canvas callback-identity path for document/window, unprotect removed
  callbacks, and add a native restart conformance case that proves one input event fires once.

### P0-4 — Make game startup and teardown failure-atomic

- **Evidence:** `packages/core/src/game.ts:392-425` allocates renderer/canvas/input before user
  plugin and scene work. Plugin setup at lines 582-592, `scene.load()` at line 598, and scene entry
  at line 603 can reject/throw without rollback. Teardown at lines 644-667 runs plugin disposal and
  cleanup sequentially, so one thrown cleanup prevents later resource release.
- **Impact:** A failed start or stop can leak timers, listeners, canvas, renderer resources, and
  partial plugins. Retrying can create duplicated state in both browser and native games.
- **Effort / fix risk / confidence:** M / MED / HIGH.
- **Fix direction:** Wrap initialized boot in rollback, make teardown attempt every cleanup, define
  error aggregation/precedence, and test rejected plugin setup, scene load, scene entry, and cleanup.

### P1-1 — Make Xvfb advice internally consistent

- **Evidence:** root guidance says never use `xvfb-run` at `AGENTS.md:148-150`, and the safe wrapper
  documents why at `scripts/xvfb.sh:4-8`. Runtime diagnostics still prescribe `xvfb-run` in
  `packages/playtest/src/runner/runner.ts:590-593`, `packages/playtest/src/assertions.ts:626-632`,
  `packages/playtest/src/runner/cli.ts:92-97`, and
  `packages/runtime-native/conformance/run-conformance.mjs:618`. Tests pin the stale advice at
  `packages/playtest/__tests__/preflight-display.spec.ts:17-18`.
- **Session signal:** 14 exit-code-144 failures across 7 Claude sessions, plus one X/RandR failure,
  between 2026-08-17 and 2026-08-20.
- **Impact:** Following the tool's own remediation can convert a passing visual command into a false
  red, causing repeated diagnosis of the wrapper instead of the game.
- **Effort / fix risk / confidence:** S / LOW / HIGH.
- **Fix direction:** Centralize display-wrapper advice, update every emitted suggestion and test,
  and migrate remaining executable `xvfb-run` paths unless a measured exception is documented.

### P1-2 — Put every playtest suite under the default gate

- **Evidence:** `vitest.config.ts:6-12` includes only `__tests__/**/*.spec.ts(x)`. The repository
  explicitly calls this a trap at `packages/playtest/AGENTS.md:89-93`. Four live suites totaling
  328 lines remain outside the gate:
  `src/reachability.test.ts`, `src/runner/bridgeClient.test.ts`, `src/scenario.test.ts`, and
  `src/three/bridge.test.ts`.
- **Impact:** CI can pass while scenario parsing, reachability, CLI transport, or bridge behavior
  regresses. Historical PRD evidence also cites focused commands that do not match the default gate.
- **Effort / fix risk / confidence:** S / LOW / HIGH.
- **Fix direction:** Move them to `__tests__/*.spec.ts` or explicitly include them, then add a census
  test proving every repository test-named file is collected.

### P1-3 — Remove unused private-hosting dependencies from the public root

- **Evidence:** root `package.json:57` and lines 64-69 retain `@types/pg`, `pg`, native-build
  `argon2`, and its build approval. A repository-wide live-source search found no import.
  `docs/README.md:50-58` says Studio and hosting moved out of this repository. Existing release
  evidence records `argon2`/node-gyp blocking a Windows toolchain-free consumer lane.
- **Impact:** Every install pays for an unused native addon, and Windows consumers can fail before
  any ThreeNative code compiles.
- **Effort / fix risk / confidence:** S / LOW / HIGH.
- **Fix direction:** Remove the root entries and approval, prune unused catalog/lockfile entries,
  then run frozen installs and publish/consumer checks on Linux and Windows.

### P1-4 — Repair the self-improvement round reader

- **Evidence:** both commands named as the loop's navigation surface fail on HEAD. The reader at
  `scripts/round-deletions.ts:78-103` assumes every `framework` arm contains a sweep manifest, but
  round 11 reused those arm names for before/after visual archives. The failure is already specified
  in `docs/PRDs/batch-26-08-19-night/PRD-164-the-round-loop-is-dead-again.md`.
- **Impact:** Agents cannot ask the repository for its next verification action or evidence-backed
  deletion candidates. The loop was repaired for one archive shape and broke again the next day.
- **Effort / fix risk / confidence:** S / MED / HIGH.
- **Fix direction:** Model visual-only arms explicitly, exclude them from deletion evidence without
  treating them as empty measurements, and retain fail-closed behavior for malformed real sweeps.

### P1-5 — Declare or remove core's public dependency on playtest

- **Evidence:** `packages/core/src/replay.ts:1-10` imports and re-exports a playtest recording type;
  `packages/core/src/index.ts:118-126` exposes it from the main entry. Core lists playtest only as a
  dev dependency at `packages/core/package.json:40-45`; bundling at
  `packages/core/tsup.config.ts:4-12` masks runtime resolution while declarations retain the type
  reference.
- **Impact:** A TypeScript consumer following the standalone core install instructions can receive
  declarations that reference a package it did not install. Workspace templates hide the defect by
  already carrying playtest.
- **Effort / fix risk / confidence:** M / MED / HIGH.
- **Fix direction:** Either ship playtest as an honest dependency or move the neutral replay
  protocol/validator to an ownership-neutral seam. Add a packed-tarball consumer typecheck with only
  documented dependencies installed.

### P1-6 — Make the quality instrument detect growth, not coordinates

- **Evidence:** `scripts/check-quality.ts:219-220` keys a baseline finding by file, line, and signal,
  and lines 358-378 ignore the measured value. The 2026-08-11 baseline recorded
  `collapse.ts` 439 lines, `assertions.ts` 2,290, `runner.ts` 868, and `scenario.ts` 1,617;
  current sizes are 2,063, 3,078, 1,800, and 1,799. Native source is excluded from source checks at
  lines 13-15 and 67-73.
- **Impact:** A hotspot can double or quadruple while remaining inherited, while harmless line shifts
  turn existing casts into “new” findings. The current 45-new report is noisy and the meaningful
  trend is invisible.
- **Effort / fix risk / confidence:** M / LOW / HIGH.
- **Fix direction:** Compare values against baselines, use identity that survives line movement,
  fail or explicitly budget growth, and add language-appropriate checks for native C++/MJS.

### P1-7 — Add lifecycle guards and cleanup policy for concurrent worktrees

- **Evidence:** 41 recent sessions contained 19 missing-path failures across 8 Claude sessions after
  worktree/cwd changes, plus a PRD move conflict. The current checkout has 60 registered worktrees,
  58 under `.worktrees`, consuming approximately 119 GB; no entries are currently marked prunable.
  Root guidance warns that agents can overwrite one another but supplies no lease/status/cleanup
  mechanism.
- **Impact:** Background agents continue in renamed or removed trees, PRD moves conflict, and local
  clones consume enough disk to degrade builds and package installs.
- **Effort / fix risk / confidence:** M / MED / HIGH for preflight/status; cleanup policy needs owner
  confirmation because active worktrees contain user work.
- **Fix direction:** Register worktree ownership/expected HEAD, verify it before every batch phase,
  serialize PRD moves, refuse cleanup while a process owns a tree, and expose a read-only status plus
  explicit safe cleanup command.

### P1-8 — Deduplicate the default test pipeline

- **Evidence:** `scripts/run-test-suite.sh:21` builds the whole workspace, runs each workspace test
  serially, then runs root Vitest. Most package tests rebuild outputs already built. Playtest's test
  script at `packages/playtest/package.json:23-26` invokes the root Vitest config, which the root
  shell then invokes again.
- **Impact:** The default feedback loop rebuilds most packages twice and evaluates the main unit
  suite twice. Serial execution amplifies the cost and encourages narrower local checks.
- **Effort / fix risk / confidence:** M / MED / HIGH.
- **Fix direction:** Split build, package validation, and unit responsibilities; have one root
  orchestrator call each stage exactly once with dependency-aware parallelism.

### P1-9 — Enforce native/web body-option parity at the shared seam

- **Evidence:** web physics rejects non-finite or negative mass at
  `packages/physics/src/simulation.ts:716-720`. Native physics forwards the same value unchecked at
  `packages/physics/src/native/host.ts:303-318`.
- **Impact:** Identical game source rejects immediately on web but can reach native physics with an
  invalid body, producing backend-only solver errors or invalid state.
- **Effort / fix risk / confidence:** S / LOW / HIGH.
- **Fix direction:** Move body-option validation before backend selection and add parity cases for
  invalid mass and non-finite transforms.

### P1-10 — Retire the superseded `SceneCollapse` implementation

- **Evidence:** production boot constructs `SceneRenderProjection`; no package source imports or
  exports `SceneCollapse`. `packages/core/src/collapse.ts` is 2,063 lines and its only live importers
  are five core spec files plus the internal `examples/native-cpu-load-test` comparison fixture.
  Recent history identifies `SceneRenderProjection` as PRD-152's replacement. The framework LOC
  trigger is currently exceeded by 25 lines.
- **Impact:** A superseded implementation and its large test corpus remain maintained and charged to
  the framework budget. Its recent fixes show that it still attracts engineering work despite having
  no production caller.
- **Effort / fix risk / confidence:** M / MED / HIGH that it is production-dead; MED confidence on
  whether the historical benchmark arm must be preserved outside framework source.
- **Fix direction:** First run the public-reach/deletion instruments after P1-4. If no retained
  caller is found, delete the implementation/specs and replace the benchmark arm with an archived
  result or isolated fixture. Do not refactor this module merely because it is large.

### P2-1 — Stop idle native workers polling JavaScript at 1 kHz

- **Evidence:** a condition-variable-backed message primitive already exists at
  `packages/runtime-native/src/workers/worker_thread.cpp:161-175`. The main worker loop at lines
  367-380 evaluates JavaScript on every iteration and sleeps only 1 ms.
- **Impact:** Each idle worker enters the JS engine about 1,000 times per second, consuming desktop
  CPU and mobile battery without messages.
- **Effort / fix risk / confidence:** M / MED / HIGH.
- **Fix direction:** Block on the existing condition variable when queues and async worker work are
  empty; benchmark idle CPU and message latency with one and multiple workers.

### P2-2 — Bound cold-agent instruction payloads

- **Evidence:** the seven generated template `AGENTS.md` files total 3,230 lines / 29,667 words;
  each template is 393-608 lines. `scripts/sync-agent-docs.ts:159-179` expands shared fragments into
  every template and duplicates the result into `CLAUDE.md`. A user explicitly called out root
  instruction bloat in Claude session `0d321a27` on 2026-08-19.
- **Impact:** Every cold game agent spends thousands of tokens before authoring, even though the
  capability manifest supports on-demand discovery. Long payloads also hide contradictions.
- **Effort / fix risk / confidence:** M / MED / HIGH.
- **Fix direction:** Keep mandatory conventions and the first-use search path inline; route long
  recipes/reference tables to searchable generated docs/capability detail and add word budgets.

### P2-3 — Decompose live verification and render-projection god modules

- **Evidence:** current source has `packages/playtest/src/assertions.ts` at 3,078 lines,
  `scenario.ts` at 1,799, `runner/runner.ts` at 1,800, and
  `packages/core/src/renderProjection.ts` at 1,078. These modules mix schema, validation,
  evaluation, observation transport, reporting, renderer classification, projection, mutation
  watching, and restoration.
- **Impact:** One assertion or rendering edge case requires edits across dense shared state and
  high-churn switch/if chains. Verification is fail-closed, so accidental semantic changes are
  unusually dangerous; rendering changes carry browser/native visual risk.
- **Effort / fix risk / confidence:** L / HIGH / HIGH.
- **Fix direction:** Characterize existing failure/restoration semantics first. Split assertion
  families behind typed registries and split render scan/plan construction from apply/restore state.

### P2-4 — Reconcile primary docs with shipped surfaces

- **Evidence:** `packages/create-threenative/AGENTS.md:54-62` promises `dev`, `build`, `test`,
  `ship`, and `doctor`; the executable at `packages/create-threenative/src/threenative.ts:5-38`
  advertises only `build` and `doctor`, and `__tests__/cli.spec.ts:42-60` asserts the other three
  fail. Root `README.md:67-77` still lists the removed private Studio package. Architecture guidance
  says no engine MCP exists at `docs/architecture/AGENT-INTERFACE.md:6-14`, while
  `packages/engine-mcp/package.json:1-20` ships that server.
- **Impact:** Agents plan against nonexistent commands, consumers search for a package intentionally
  removed from the public repo, and architecture readers receive the opposite of the current
  capability-discovery design.
- **Effort / fix risk / confidence:** S / LOW / HIGH if current code/tests are authoritative.
- **Fix direction:** Decide each canonical surface once, generate help/docs/tests from it where
  practical, and add semantic doc checks for package inventory and command lists.

### P2-5 — Separate benchmark evidence retention from the main source checkout

- **Evidence:** 6,047 of 7,185 tracked files are under `docs`; 5,290 are benchmark sweep snapshots.
  The Git pack is about 147 MB. In the last 14 days, 477 commits added a net ~730,156 lines.
  `scripts/sweep-archive.ts:84-102` intentionally copies every sandbox directory with no size cap,
  and lines 218-232 place complete snapshots under tracked `docs/benchmark/sweeps`.
- **Impact:** Clone/search/indexing cost grows with every sweep; copied generated source dominates
  repository shape and agent searches. Binary screenshots/models also inflate permanent Git history.
- **Effort / fix risk / confidence:** L / MED / HIGH on the measured growth; MED confidence on the
  best storage architecture because reproducible evidence retention is a deliberate product rule.
- **Fix direction:** Preserve immutable manifests, hashes, critical source, scores, and selected
  proof images in Git; put bulk reproducible artifacts in release/object storage or Git LFS with a
  verified retrieval command. Do not silently cap or delete evidence.

### P2-6 — Give long gates progress and resume contracts

- **Evidence:** recent sessions contain 7 blocked polling/sleep attempts across 5 Claude sessions
  while waiting for native, parity, sweep, and playtest work. Root scripts such as `parity`,
  `sweep:capture`, `profile:production`, and `visuals:baseline` are long chains without one shared
  status/resume contract (`package.json:27-51`). Default playtest readiness/page timeouts are 15 s at
  `packages/playtest/src/runner/config.ts:69-70`.
- **Impact:** Agents invent polling loops, lose ownership across interruption/compaction, and cannot
  distinguish a slow phase from a hung lane.
- **Effort / fix risk / confidence:** M / LOW / HIGH.
- **Fix direction:** Emit timestamped phase/heartbeat records and stable artifact/status paths; add
  documented status/resume commands and include the next diagnostic probe in timeouts.

### P2-7 — Add a generated-game mouse/input integration proof

- **Evidence:** recent FPS sessions required repeated fixes for camera look, right-click aim, and
  left-click fire. The current contracts are well covered by
  `packages/core/__tests__/relative-pointer-look.spec.ts` and `input.spec.ts:238-299`, but shooter
  playtests contain no mouse/pointer sequence. The FPS friction ledger records 20 cross-component
  build frictions before the fixes landed.
- **Impact:** Package units can stay green while a generated first-person game is not controllable.
- **Effort / fix risk / confidence:** M / LOW / HIGH.
- **Fix direction:** Add one generated/scaffolded shooter scenario that drives relative pointer,
  right button, and left button together and asserts camera, aim, and fire state on web plus one
  native target.

## Confirmed existing debt, not duplicated here

The audit confirmed two already-filed obligations rather than inventing parallel work:

| Existing record | Current result |
| --- | --- |
| `PRD-164` — round loop archive-shape collision | Still reproduces in both `round:*` commands. |
| `PRD-165` — framework LOC trigger and unresolved attribution | Still reports 15,025/15,000; native is now 78,347/50,000. |

The quality baseline itself is stale: it was generated on 2026-08-11 and does not express current
hotspot growth. Treat updating it without first fixing comparison semantics as debt laundering.

## Session-mining evidence

The friction pass read 25 Claude repo-session JSONLs and 16 pre-audit Codex repo rollouts from
2026-08-17 through 2026-08-20. It did not read credentials/settings and did not copy transcript text.
Primary local sources were:

- `~/.claude/projects/-home-joao-projects-threenative-threenative-engine/*.jsonl`
- `~/.codex/sessions/2026/08/{17,18,19,20}/*.jsonl` filtered by this repository's cwd
- `docs/benchmark/sweeps/fps-2026-08-17/FRICTION.md`
- `docs/benchmark/sweeps/fps-2026-08-18/FRICTION.md`

Repeated signals were false-red display wrappers, missing/deleted worktree paths, improvised polling
for opaque long gates, and cross-component game behavior that package units did not prove. Historical
frictions already repaired (sandbox placement, content-stamped tarballs, relative pointer, one-shot
animation, upper-bound assertions, tick semantics, rigid-body position, raycast, self-running gates)
were excluded as current debt.

## Considered and rejected

| Candidate | Verdict |
| --- | --- |
| Navigation being browser-only | By design and explicitly evidence-bounded; not relabeled as a defect. |
| Playtest's separate style/lint posture | Explicit salvage/standalone decision, but the resulting module growth remains a finding. |
| Low-severity dependency drift | No high production advisories; version freshness alone is not actionable debt. |
| Android/iOS parity gaps | Product readiness gaps already recorded; no unexecuted platform claim was converted into a code finding. |
| Deleting old worktrees or evidence now | Destructive and requires owner confirmation; this audit only measured and reported it. |

## Suggested execution batches

| Batch | Scope | Estimated implementation time |
| --- | --- | --- |
| A | P0-1, P1-2, P1-3, P1-4, P1-6 | 2-3 engineer-days; restores trustworthy developer feedback. |
| B | P0-2, P0-3, P0-4, P1-9 | 3-5 engineer-days plus native ASan/conformance time. |
| C | P1-1, P1-5, P1-7, P1-8 | 3-5 engineer-days; removes repeated agent/install/orchestration friction. |
| D | P2 findings | Separate PRDs; 1-3 weeks depending on evidence-storage and module-boundary decisions. |

Batch A should land before module refactors. Batch B should not be split across independent native
lifetime changes without one owner reconciling shutdown ordering. P2-3 needs characterization tests
before moving code.

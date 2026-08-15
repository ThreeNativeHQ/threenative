---
prd_contract: v1
---

# PRD-107 — The sweep instrument can measure at all: a runnable archive, a provable plain-Three.js project, and a loop that cannot strand

**Status: DONE, written and executed 2026-08-14.** Every gate below was run; the commands and
their exit codes are recorded in §4. This PRD closes two defects found while resolving round 4's
kill switch, both of which blocked measurement rather than gameplay.

**Complexity: 3 → SMALL mode.** Two independent defects, four files, no new module.

---

## 1. Context

**Problem A — the plain-Three.js bridge could never advertise `runtime.physics`.**
`installThreePlaytestBridge` built its capability list from the providers it was given, and there
was no provider for physics. The `settled`, `occluded` and `aerodynamics` assertions all declare
`requiredCapabilities: ["runtime.physics"]`, so the runner rejected every such scenario with
`TN_PLAYTEST_CAPABILITY_MISSING` before evaluating anything. Only `@threenative/physics`'s own
plugin could contribute that capability, through `runtime.observations.contribute`.

This package runs against plain Three.js with zero ThreeNative dependencies, and that
independence is a product decision. A capability reachable only through the framework's own
plugin is therefore a hole in the harness, not a framework advantage. It also made the
physics-puzzle genre unmeasurable for the vanilla arm by construction: no build of any quality
could have passed, so the column could never be won or lost on merit.

Round 4 recorded exactly this outcome for both arms — 0/1, `TN_PLAYTEST_CAPABILITY_MISSING` for
`runtime.physics` (`docs/verification/round-4-2026-08-10.md`, and the archived runner reports
under `docs/benchmark/sweeps/physics-puzzle-2026-08-11*/proof-artifacts/0/`).

The evidence shape the assertion reads is a harness contract that no caller should have to
rediscover from a failed assertion: `artifact.primitives[]` entries categorised `sleep` and
`center-of-mass`, plus `artifact.overflow.omittedBodies`. Handing that shape to every caller to
reimplement is how two paths diverge silently.

**Problem B — a created-but-never-scaffolded sandbox stranded the round loop.**
`assertCanWipe` in `scripts/make-sandbox.ts` refused to wipe any sandbox whose manifest was not
archived. `archiveSandbox` in `scripts/sweep-archive.ts` refused to archive any sandbox with no
`src/`, as "not built". A sandbox created and then abandoned satisfied both refusals at once, so
neither command could clear it and no further sweep could start without deleting the directory by
hand. This was hit live on 2026-08-14 against a stale `endless-runner` sandbox.

**Problem C — every archived sweep was unbootable, so no sealed proof could ever pass.**
`copyAppShell` in `scripts/sweep-archive.ts` allowlisted `index.html` and `vite.config.*` and
copied nothing else from the project root. The starter template's own `src/game.ts` opens with
`import config from "../threenative.config.js"`, and `threenative.config.ts` was never copied. So
every framework archive 500'd in its dev server on that import, the page produced no canvas and
no game, and `sweep:proof` reported `TN_PLAYTEST_BRIDGE_MISSING` for a bridge the application had
never got far enough to install.

This is the reason **rounds 3, 4 and 5 all recorded 0/1 for both arms**. The functional column —
the one where the framework's margin is supposed to live — has never in the loop's history been a
measurement of a game. It was a measurement of a broken copy step, reported with the same
confidence as a real result, which is precisely the failure mode this repository's verification
doctrine exists to prevent.

Reproduced on 2026-08-14 against `docs/benchmark/sweeps/physics-puzzle-2026-08-15`:

```
[vite] Internal server error: Failed to resolve import "../threenative.config.js"
       from "src/game.ts". Does the file exist?
```

and a browser probe of the served page returning `{ bridge: "undefined", canvases: 0, game: "undefined" }`.

**Files analyzed.**

- `scripts/sweep-archive.ts:74-96` — `copyAppShell`
- `packages/create-threenative/templates/starter/src/game.ts:5` — the import that was dropped
- `packages/playtest/src/three/bridge.ts` — `installThreePlaytestBridge`, its capability list and `sample`
- `packages/playtest/src/protocol.ts:111` — `physicsDebugSeries` on the observation snapshot
- `packages/playtest/src/assertions.ts:1274-1330,1445-1497` — the `settled` evaluator and its snapshot readers
- `packages/physics/src/plugin.ts:100-140,252-280` — the framework path this now matches
- `scripts/make-sandbox.ts:225-242` — `assertCanWipe`
- `scripts/sweep-archive.ts:144-152` — `archiveSandbox`

## 2. What changed

**A.** New `packages/playtest/src/three/physics.ts` holding `IThreePlaytestPhysicsBody`,
`IThreePlaytestPhysics` and `ThreePlaytestPhysicsRecorder`. A caller supplies a flat list of
bodies — `id`, `position`, `sleeping` — and the recorder builds the contract shape, retains one
snapshot per scenario step label, and enforces the same body and sample limits the framework
plugin uses.

`installThreePlaytestBridge` gained a `physics` option. It advertises `runtime.physics` only when
that option is present, emits `physicsDebugSeries` only when a scenario asks for it, and refuses
at install time when a physics provider arrives without the authoritative tick provider — a
settle comparison across steps is timing noise without one.

Fails closed throughout, per this package's governing rule that a check which cannot run must
fail rather than skip: a duplicate step label, an exhausted retention budget, a duplicate body
id, an empty id, a non-boolean `sleeping` and a non-finite position all throw. Bodies past the
retention limit are reported through `omittedBodies`, which makes `settled` fail on a partial
snapshot rather than pass on the part that fitted.

**B.** `assertCanWipe` now returns early when the sandbox has no `src/`, matching the exact
condition `archiveSandbox` uses to refuse. A built, unarchived sandbox is still protected.

**C.** `copyAppShell` now copies every root-level file except a named exclusion set
(`node_modules`, `dist`, `artifacts`, `package.json`, `sweep.json`, dotfiles) plus the `public/`
and `assets/` directories. An allowlist of root files rots the moment a template gains one, which
is how this survived three rounds.

Copying more files does not by itself prove the archive runs, so `assertArchiveResolves` now walks
the archived `src/` and fails the archive when any `../`-relative import resolves inside the
archive but names a file the archive does not carry. That check, not the copy list, is the part
that makes the bug non-recurring.

## 3. Criteria

| # | Criterion | Met? |
| --- | --- | --- |
| 1 | A bridge with a physics provider advertises `runtime.physics`; one without does not | yes |
| 2 | A series the recorder produced satisfies the real `settled` evaluator, including `minMeanPoseDistance` across two labelled steps | yes |
| 3 | An awake body fails `settled` rather than passing | yes |
| 4 | Bodies past the retention limit fail `settled` and report `omittedBodies` | yes |
| 5 | Every malformed body shape throws instead of being skipped | yes |
| 6 | A physics provider without a tick provider refuses to install | yes |
| 7 | An unbuilt, unarchived sandbox can be wiped; a built, unarchived one still cannot | yes |
| 8 | An archive carries the root config a scaffolded project imports | yes |
| 9 | An archive whose `src/` imports a file it does not carry is refused, and the partial archive removed | yes |
| 10 | A real sealed proof reaches assertion evaluation against a real archived build | yes — 2/10 assertions, where every prior round produced 0 evaluated assertions |
| 11 | Repository gates stay green | yes |

Criterion 2 is the one that matters. An option that produced a snapshot the evaluator could not
read would be decoration, and would report the same green as a real fix.

## 4. Evidence

| Gate | Command | Result |
| --- | --- | --- |
| New unit tests | `pnpm exec vitest run packages/playtest/__tests__/three-physics.spec.ts packages/playtest/__tests__/three-bridge.spec.ts` | pass — 30 tests, 2 files |
| Sandbox guard tests | `pnpm exec vitest run scripts/__tests__/make-sandbox.spec.ts` | pass — 11 tests |
| Typecheck | `pnpm typecheck` | pass |
| Lint | `pnpm lint` | pass — exit 0, 201 warn-level cognitive-complexity diagnostics, none new and none build-failing |
| Test | `pnpm test` | pass — 1109 passed, 32 skipped, 132 files |
| Archive tests | `pnpm exec vitest run scripts/__tests__/sweep-archive.spec.ts` | pass — 9 tests |
| Sandbox unblocked | `pnpm sandbox --bare --arm framework --genre physics-puzzle` | pass — previously exited 1 on the wipe guard |
| Sealed proof reaches assertions | `pnpm sweep:proof docs/benchmark/sweeps/physics-puzzle-2026-08-15` | 2/10 assertions pass, 8 fail on their merits; before the fix the same command produced zero evaluated assertions and one `TN_PLAYTEST_BRIDGE_MISSING` |

`scripts/__tests__/make-sandbox.spec.ts` previously asserted that an unarchived sandbox with no
`src/` refused to wipe. That test was changed rather than deleted: it now creates `src/` and
still asserts the refusal, so the guard that protects a real build is still covered, and a new
test covers the stranded case.

## 5. What the repaired instrument then measured, and what it still cannot

With the archive runnable, the sealed physics-puzzle proof evaluated all ten assertions against
round 5's framework build. Two passed (`movement.distance` 8.13m, `movement.axisDelta` +x 8.13).
Eight failed, and most of them failed on a contract the builder could not have known:

- `world.seed` expected `6132`; the game used `90210`. The sealed brief says "a fixed seed" and
  never states which.
- `settled.crate` found 0 bodies, `contact.player`/`contact.mission` found 0 contacts, and
  `states.mission` found no such entity. The proof pins the entity ids `crate`, `player`,
  `solid-body`, `goal` and `mission`; the brief names none of them.

The arm firewall forbids the builder from reading the proof, so those assertions are unpassable
by construction for any blind builder. That is now the top open instrument question, and it
belongs to the brief rather than to the framework: either the brief states the ids and seed the
proof asserts, or the proof asserts on observable behaviour rather than names. It is recorded
here and **not fixed in this PRD**, because changing a sealed brief or proof invalidates the
comparison against every earlier round.

## 6. What this does not do

- It does not give a plain Three.js project contact evidence. `contacts` needs `runtime.contacts`,
  which the bridge already advertises through `gameplayChannels`, and that path was not touched.
- It does not make any vanilla arm pass a sealed proof. It removes the reason one could not.
- It changes no framework LOC that a game runs — `@threenative/playtest` is harness code, and is
  excluded from the framework LOC budget.

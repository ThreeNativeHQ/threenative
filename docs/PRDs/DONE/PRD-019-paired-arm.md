# PRD-019 — The paired arm: two builds, one brief, equal proof

**Complexity: 6 → MEDIUM mode** (6-10 files +2, new system +2, tooling across repo +2)

**Depends on:** PRD-016 (sweeps, ledger, measurer), PRD-007 (the bridge, shipped).
**Blocks:** PRD-020, PRD-021, PRD-022.
**Charter authority:** `CHARTER.md` §3 (the win condition is *against vanilla*), §3 "the
property that makes this unloseable", §12 (the head-to-head is VOID and must become
runnable); `AGENTS.md` "Verification honesty".

## 1. Context

**Problem:** every measurement this repository can take is **single-armed**. A sweep says
how much of the framework an agent reached for. It cannot say whether the result was
*better than the same agent with no framework at all* — which is the only question
`CHARTER.md` §3 asks, and the only one that can kill a bad abstraction.

**Files analyzed:** `scripts/make-sandbox.ts:230-300`, `scripts/measure-sandbox.ts`,
`scripts/sweep-archive.ts`, `scripts/__tests__/sweep-ledger.spec.ts:1-70`,
`docs/benchmark/PROTOCOL.md`, `docs/verification/SWEEP-TEMPLATE.md`,
`packages/playtest/src/three/bridge.ts:22-40`, `packages/playtest/package.json` exports,
`packages/core/src/playtest.ts`, `docs/benchmark/genres/*/brief.md`.

**Current behavior:**

| Fact | Evidence |
|---|---|
| `pnpm sandbox` builds exactly one kind of project | `make-sandbox.ts:230` — `scaffold` always invokes `create-threenative` |
| The manifest has no arm field | `SweepManifest` in `make-sandbox.ts:22-29` — genre, briefHash, template, date, frameworkVersion, sourceLines |
| The vanilla control is a **frozen hand-written example**, not an agent build | `examples/abyss-vanilla/`, `AGENTS.md` layout — "FROZEN benchmark control — do not edit" |
| The AI head-to-head is VOID and has been since 2026-08-02 | `CHARTER.md` §12; `RESULTS-2026-08-02.md` — every cell reads `VOID — no AI run` |
| Each genre's proof is written **by the builder, after the build** | the seven `docs/benchmark/sweeps/*/playtests/` directories; no sealed scenario exists |
| The bridge is framework-independent and takes plain Three.js types | `three/bridge.ts:12` imports `type { Camera, Scene } from "three"`; renderer is structural |
| `@threenative/playtest/three` is a public subpath | `packages/playtest/package.json` exports `./three` |
| `AGENTS.md:147` still says PRD-007 is "not shipped" | false — `packages/core/src/playtest.ts` exists, `core/package.json` exports `./playtest`, and all seven archived sweeps import `playtest` from it |

The last two rows are the enabler. A vanilla project **can** be observed by the same
runner, through the same protocol, because the bridge never needed the framework. That is
`CHARTER.md` §3's "the framework must win even when the AI ignores it", and it is what
makes an equal-proof contract possible instead of aspirational.

The fifth row is the defect that makes the current proofs unusable for comparison: a
builder that writes its own assertions after seeing its own build cannot fail. Two arms
grading themselves is two ungraded arms.

## 2. Solution

- **`pnpm sandbox --arm framework|vanilla`.** `framework` is today's behaviour, unchanged.
  `vanilla` writes a bare Vite + `three` project — `package.json`, `vite.config.ts`,
  `tsconfig.json`, `index.html`, an empty `src/`, the sealed `brief.md` and
  `reference.png`, and **`@threenative/playtest` as the only `@threenative` dependency**.
  No `core`, no `physics`, no `ui`, and no generated `AGENTS.md` describing them.
- **Both arms get the observation bridge, and neither gets more than that.** The framework
  arm installs it with `playtest()` from `@threenative/core/playtest`; the vanilla arm
  calls `installThreePlaytestBridge` from `@threenative/playtest/three`. Each arm's
  generated `AGENTS.md` documents its own one-liner. Withholding it from the vanilla arm
  would make the framework win the proof by owning the only instrument — a rigged
  measurement, and a violation of §3.
- **A sealed proof set per genre**, `docs/benchmark/genres/<genre>/proof/*.playtest.json`,
  hashed into the manifest as `proofHash` beside `briefHash`. `pnpm sweep:proof <sandbox>`
  copies the sealed scenarios into the sandbox at run time, boots the dev server, runs the
  built runner CLI, and writes `proof.json`. **The builder never authors the assertions and
  cannot edit them**: a modified copy changes the hash and the run throws.
- **Arm-neutral assertions only.** A sealed scenario may reference `runtime.*` observations
  and DOM/console/diagnostics facts. It may not name a `@threenative` symbol, a file path,
  or a class name. A test asserts this over the sealed set, so "the proof set drifted toward
  the framework arm" is red rather than an argument.
- **`pnpm sweep:pair <framework-archive> <vanilla-archive>`** — same genre, same brief hash,
  same proof hash, different arms; anything else throws. It reports, per arm: scenarios
  passed of total, user source LOC, source files, and the framework arm's reach rate. This
  is the functional half of "which one is better". The visual half is PRD-020.

**Fails closed, everywhere:** an empty proof set is a throw, not a pass. A scenario with no
assertions is a throw. A missing `proof.json` is a missing observation, so the ledger field
is blank and the schema test is red. A sandbox whose `proofHash` does not match the sealed
set is a throw before the server boots.

### Explicitly rejected

| Proposed | Why not |
|---|---|
| Score the vanilla arm against `examples/abyss-vanilla` | It is hand-written and frozen. `CHARTER.md` §3's question is about *what an agent produces*, and a human's 400 lines answer a different question |
| Let each arm write its own playtests, then compare pass counts | A builder grading itself. This is the exact failure `AGENTS.md` "Verification honesty" was written about — 19 validators returning `undefined` and reporting pass |
| Give the vanilla arm no bridge and score it on screenshots only | Rigs the functional half by making the instrument framework-only, and contradicts §3: playtest is a floor the framework gives away, not a moat |
| A `--arm both` flag that builds the pair in one command | The two builds must not share a context, or the second is informed by the first. Separate invocations, separate agents, separate directories — the firewall is the measurement (PRD-022) |
| Put the sealed scenarios in `packages/playtest/` | They are benchmark inputs, not product. They live beside the brief they belong to and are sealed the same way |
| Extend `sweep-delta` to handle arms | Delta answers "did round 2 beat round 1". Pair answers "did we beat vanilla". Different questions, and overloading one script makes both harder to read |

## 3. Integration Ledger

| # | New thing | Live caller (non-test) | Replaces | Old path removed? | Negative control |
|---|---|---|---|---|---|
| 1 | `--arm` on `pnpm sandbox`, `arm` in `SweepManifest` | `package.json` `sandbox`; `.claude/skills/build-on-sandbox/SKILL.md`; PRD-022's driver | single-armed sweeps | n/a | omit `arm` from an existing manifest → `readManifest` throws; archive a vanilla build with `arm: "framework"` → `sweep:pair` throws on identical arms |
| 2 | Vanilla scaffold writer in `make-sandbox.ts` | `pnpm sandbox --arm vanilla` | nothing — no vanilla agent build has ever existed | n/a | add `@threenative/core` to the vanilla `package.json` → new test fails: the vanilla arm may depend on `playtest` and nothing else |
| 3 | `docs/benchmark/genres/<g>/proof/*.playtest.json`, `proofHash` in the manifest | `pnpm sweep:proof`; both arms of every sweep | builder-authored `playtests/` as the source of truth | builder scenarios stay, but stop being the gate | edit a sealed scenario in the sandbox → hash mismatch throws; empty the proof directory → throws instead of reporting 0/0 pass |
| 4 | `pnpm sweep:proof <sandbox>` writing `proof.json` | PRD-021's round ledger; `sweep:pair` | nothing | n/a | delete every assertion from a scenario → throws `no assertions`; point it at an arm with no bridge → `TN_PLAYTEST_BRIDGE_MISSING`, which is the harness being right |
| 5 | `pnpm sweep:pair` | PRD-021 round ledger; `docs/README.md` | eyeballing two ledgers | n/a | pair two framework archives → throws; pair across briefs → throws; pair across proof hashes → throws |
| 6 | `Arm`, `Proof result`, `Proof SHA-256` in the sweep ledger | `docs/verification/SWEEP-TEMPLATE.md`; every new ledger | a template that cannot describe a vanilla run | n/a | leave `Proof result` blank → `sweep-ledger.spec.ts` fails, as it already does for every other required field |
| 7 | `AGENTS.md` bridge paragraph corrected | `AGENTS.md`, regenerated `CLAUDE.md` | the stale "PRD-007 … **not shipped**" claim | **yes**, deleted | `pnpm sync:agents --check` fails if the mirror drifts |

**Reachability:** `pnpm sandbox --arm vanilla --genre platformer` → a bare Vite + three
project with the sealed brief and `@threenative/playtest` → an agent builds a game in it →
`pnpm sweep:archive && pnpm sweep:proof <archive>` → the same sealed scenarios that ran
against the framework arm run against this one → `pnpm sweep:pair` prints both arms' pass
counts and LOC side by side.

## 4. Phases

#### Phase 1: the arm exists

**Files:** `scripts/make-sandbox.ts` EDIT · `scripts/__tests__/make-sandbox.spec.ts` EDIT ·
`package.json` EDIT.

Add `arm` to `SweepManifest` and `SandboxOptions`, required and validated by `readManifest`
(an old manifest without it is invalid — there are seven in `docs/benchmark/sweeps/`, and
they are round-1 framework runs, so backfill them in this phase with `"arm": "framework"`).
Write the vanilla scaffold: `package.json` with `three`, `vite`, `typescript`,
`@types/three` and `@threenative/playtest` pinned from the same catalog the templates use;
`index.html`; `vite.config.ts`; `tsconfig.json`; `src/` empty; an `AGENTS.md` that states
the brief, the reference, and the single bridge-install snippet. Tarball staging is shared
with the framework arm — the vanilla arm installs one tarball instead of four.

Test: a vanilla sandbox contains no `@threenative/core|physics|ui` in `package.json` or
`node_modules`; a framework sandbox is byte-identical to today's output.

#### Phase 2: the proof set is sealed

**Files:** `docs/benchmark/genres/{platformer,topdown-action,endless-runner,exploration}/proof/*.playtest.json` NEW ·
`scripts/make-sandbox.ts` EDIT (`proofHash`) · `scripts/__tests__/proof-set.spec.ts` NEW.

Author the scenarios per genre from the brief's own words — the platformer brief promises
run, jump, collect, reach a goal, restart, and a HUD count, so those are the assertions.
Each scenario asserts at least one `runtime.*` observation, and every scenario carries a
screenshot artifact request (PRD-020 consumes it).

Tests over the sealed set: every file parses; every file has ≥1 assertion; no file contains
the string `@threenative`, `packages/`, or a template class name; `proofHash` is stable
across a re-read; the hash covers file names as well as contents.

#### Phase 3: running the proof

**Files:** `scripts/sweep-proof.ts` NEW · `scripts/__tests__/sweep-proof.spec.ts` NEW ·
`package.json` EDIT.

Resolve the archive or live sandbox, verify `proofHash` against the genre in its manifest,
copy the sealed scenarios in under a run directory the builder does not own, boot the dev
server on a fixed port, run each scenario through `packages/playtest/dist/runner/cli.js`
with the WebGPU browser flags already used by `test:playtest`, and write `proof.json`:
`{ genre, arm, proofHash, scenarios: [{ name, verdict, assertions, diagnostics }], passed,
total }`.

`passed === total` is the only pass. A scenario that errors is a fail, never a skip. Zero
scenarios throws.

#### Phase 4: pairing, ledger, and the stale claim

**Files:** `scripts/sweep-pair.ts` NEW · `scripts/__tests__/sweep-pair.spec.ts` NEW ·
`docs/verification/SWEEP-TEMPLATE.md` EDIT · `scripts/__tests__/sweep-ledger.spec.ts` EDIT ·
`docs/README.md` EDIT · `AGENTS.md` EDIT · `CLAUDE.md` REGENERATED · `package.json` EDIT.

`sweep:pair` throws on: same arm twice, different genre, different brief hash, different
proof hash, self-comparison, or a missing `proof.json` on either side. It prints JSON and a
short table.

Add `Arm`, `Proof result` (`passed/total`) and `Proof SHA-256` to the required ledger
fields. Correct `AGENTS.md`'s verification section: the bridge ships, `playtest()` installs
it in `defineGame`, `installThreePlaytestBridge` covers plain Three.js, and a semantic
scenario against a project with neither still fails `TN_PLAYTEST_BRIDGE_MISSING`. Run
`pnpm sync:agents`.

#### Phase 5: gates

`pnpm typecheck && pnpm lint && pnpm test && pnpm budgets`, plus one live pair on
`platformer`: re-run the proof set against the archived round-2 framework sweep, and
against a vanilla arm built for this phase. Record both in a sweep ledger each. A pair whose
vanilla arm was never built is not a gate, and this phase does not close without it.

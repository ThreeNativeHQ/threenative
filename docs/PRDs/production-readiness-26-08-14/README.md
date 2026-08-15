---
prd_contract: v1
---

# Batch — production readiness, 2026-08-14

**Status: ASSEMBLED, 2026-08-14. Nothing here has been executed.** Sliced from
`docs/strategy/PRODUCTION-READINESS.md`, which is itself a proposal and not a commitment. Every
claim below is either cited to a file and line, or marked unverified.

Seven PRDs, **all of them tonight's work**, executed by a multi-agent team. PRD-110 to PRD-114
cover that document's items 1–5; PRD-115 and PRD-116 were added on a request for the highest
user-value items. Items 7–8, the PRD-109 handle-invalidation follow-up and the staged crossover
benchmark remain out; see *Not in this batch* at the bottom.

**Read the lanes before the order.** The numbered order below is dependency order, not a queue for
one worker. With parallel agents the binding constraints are different: the long pole, the file
collisions, and the one PRD that must run alone.

## The order, and the one place the source document contradicts itself

| # | PRD | Item | The sentence it closes | Runnable on this host? | Estimate |
|---|---|---|---|---|---|
| 1 | [PRD-111 — the proof survives a real game](PRD-111-proof-survives-a-real-game.md) | 2 | *"The `test` script is dead the moment you change the game."* | **Yes**, needs `xvfb` for capture | Phase 1: half a day · Phase 2: one day |
| 2 | [PRD-110 — verification fails closed](PRD-110-verification-fails-closed.md) | 1 | *"A playtest that saw 18 console errors reported pass."* | **Yes.** Phase 0 is one fixture run | Phase 0: 1 h · Phases 1–4: two days |
| 3 | [PRD-112 — golden path from packed artifacts](PRD-112-golden-path-from-packed-artifacts.md) | 3 | *"`threenative build` failed where `vite build` succeeded."* | **Yes.** Phase 0 is a clean-dir reproduction | Phase 0: 2 h · Phases 1–3: one to two days |
| 4 | [PRD-113 — the sealed-brief naming contract](PRD-113-sealed-brief-naming-contract.md) | 4 | *"The sealed proof is unpassable by any blind builder."* | **Needs an owner decision first** | decision, then half a day |
| 5 | [PRD-114 — one paired round, vanilla arm executed](PRD-114-paired-round-on-the-repaired-instrument.md) | 5 | *"No round has ever produced a functional-column comparison."* | **Blocked on 4** | Phase 0: 2 h · the round: one day |
| 1b | [PRD-115 — the scaffold ships what a user keeps](PRD-115-scaffold-ships-what-a-user-keeps.md) | smaller findings | *"Round 6 deleted 607 of the starter's 1117 lines before it had a game."* | **Yes** | half a day, lands with PRD-111 |
| — | [PRD-116 — a native build can move a dynamic body](PRD-116-native-physics-actuation.md) | 6 | *"No native build can push a crate yet."* | **Not tonight** — see *Sizing* | multi-day, Rust |

**Start at 1.** PRD-111 is the only unblocked item with no reproduction gate in front of it, it
lands entirely in templates, and it is the largest unrealised value in the product — 35 combined
axis points. **Take PRD-115 with it**: both are template-only, both come from the same evidence
(what two builds threw away before writing game code), and PRD-115 removes the dead `test` script
that PRD-111 replaces.

### Lanes — how this splits across parallel agents

Four lanes with no file overlap between them. Assign one agent per lane; the two PRDs inside
lane A go to the **same** agent.

| Lane | PRDs | Owns these paths | Notes |
|---|---|---|---|
| **A — templates** | PRD-111, PRD-115 | `packages/create-threenative/templates/` | **Must be one agent.** Both edit `templates/starter/package.json` and its `src/`; split them and they collide on the `test` script |
| **B — harness** | PRD-110 | `packages/playtest/` | Independent tree. Phase 0 is a reproduction |
| **C — CLI** | PRD-112 | `packages/create-threenative/src/`, `scripts/`, CI | Adjacent to lane A but a different subtree |
| **D — native** | PRD-116 | `packages/runtime-native/` | Fully isolated tree, zero overlap with A–C |

**Start lane D first — it is the long pole.** PRD-116 is Rust, multi-day, and nothing else depends
on it, which makes it exactly the work to launch at the front of a parallel batch rather than defer.
The earlier draft of this README deferred it on serial-execution reasoning; with a team that
reasoning is wrong, and the opposite is true — the longest task should start earliest.

It is also the **highest user-value item on the slate**. The headline claim is that the same source
runs on web and native, and physics actuation exists only on web: a user shipping a physics game to
desktop gets a game where nothing can be pushed. Every other PRD here improves something that
already works; PRD-116 makes a false promise true. It carries the undischarged
`69910/50000` native obligation, which it is the natural place to settle.

**Two serialisation constraints no lane may ignore:**

1. **PRD-114 runs last and alone.** It measures the tree by building a game against it. If any
   other agent is still landing changes while the round builds, the round is measuring a moving
   target and its numbers are void — the same failure that voided rounds 3–5. Land every other
   lane, verify the gates, *then* run it.
2. **PRD-113 is an owner decision and gates PRD-114.** It is not agent work. Get the answer early
   in the evening so lane E is not blocked at the end of it.

**The source document's execution order is wrong in one place, and its own slicing section says
so.** Bottom of `PRODUCTION-READINESS.md`: *"3. Run one paired round … 4. Decide the sealed-brief
naming contract."* Its slicing section §3 says the opposite, and is right: a paired round run
before the naming contract is settled still measures naming luck in its functional column — round
5 scored 2/10 and round 6 scored 0/10 on that proof, and the only difference was that round 5
happened to bind `ArrowRight` and name an entity `player`. **PRD-113 runs before PRD-114.** This
batch is ordered accordingly.

## Two claims that gate two PRDs, and what a read of the code already says

Both PRD-110 and PRD-112 open with a Phase 0 that is a **reproduction, not a fix**. That is the
source document's instruction and it is the right one. A read of the code has already narrowed
both:

**Green-with-errors (PRD-110).** Not a contradiction after all. `assertions.ts:1969` and `:1977`
gate console and network errors only when the scenario opted in with `=== true`; only
`noRuntimeDiagnostics` defaults closed (`:942`). Worse, `:946` skips recording the `diagnostics`
row at all when the scenario has no block — so the report does not say the check was absent. Round
6 failed correctly because the **sealed** proof opts in. A scenario a builder writes need not.
Phase 0 confirms this against a running page before the default is flipped.

**`TN_CONFIG_TRANSPILER_MISSING` (PRD-112).** `config.ts:164-183` tries three resolutions before
failing, and its message — *"install Vite or esbuild"* — is already wrong advice if `vite build`
works in that directory. Unreproduced here. If Phase 0 does not reproduce it across all seven
templates, PRD-112 Phase 2 is deleted and Phases 1 and 3 still stand, because the clean-directory
matrix is what would have caught it.

## Three things verified while writing this batch

Each was run, not assumed:

| Fact | Command | Result |
|---|---|---|
| Framework LOC headroom is 259 lines | `pnpm budgets` | `14741/15000`, native `69910/50000` |
| The loop's next-action instrument was broken, and is **now fixed** | `pnpm round:next` | threw `Round ledger table is missing column 'What vanilla did better'` at `scripts/round-ledger.ts:103`; the round-5 ledger had renamed that column. Header restored, now prints `stop round 5` |
| Round 6 has a score doc and **no ledger file** | `ls docs/verification/round-*.md` | ends at `round-5-2026-08-14.md` |

The third is still PRD-114 Phase 0: round 6 has no ledger, so `round:deletions` — which requires two
consecutive ledgers — cannot run, and the deletion verdict this batch owes cannot be computed.

The second is worth keeping on the record even though it is fixed, because of how it happened: the
round-5 ledger renamed a gap-list column to describe a single-armed sweep honestly, and that broke
the parser that reads every ledger. A documentation change silently disabled the loop's next-action
instrument. It is the same class of defect — a broken instrument reporting with the confidence of a
working one — that voided three rounds of functional-column results, arriving from an unexpected
direction.

## What each PRD spends

**Framework LOC headroom is 259 lines** (`packages/*/src`, excluding salvage and native). Most of
this batch deliberately avoids it:

| PRD | Lands in | Spends headroom? |
|---|---|---|
| PRD-110 | `packages/playtest/` | **No** — salvage package, excluded at `scripts/check-budgets.ts:25` |
| PRD-111 | `packages/create-threenative/templates/` | **No** — generated user source, reported not capped |
| PRD-112 | `packages/create-threenative/src/`, `scripts/`, CI | **Yes**, for the resolver fix. Report the delta |
| PRD-113 | `docs/benchmark/genres/` | **No** |
| PRD-114 | `docs/verification/`, `scripts/` | **No** |
| PRD-115 | `packages/create-threenative/templates/` | **No** — generated user source; should reduce template LOC |
| PRD-116 | `packages/runtime-native/` | **No** to framework headroom, but inherits the native `69910/50000` obligation |

Crossing the trigger obliges a justification in the owning PRD plus a kill-switch pass over what
was added. Never silence it.

## Stop rules

- **Never claim a gate you did not run.** Paste the failure. "Unverified" is an acceptable result;
  "verified" without a run is not.
- **A negative control that was not observed red does not count.** Every PRD here names its
  controls; a phase whose control was skipped is not done.
- **Phase 0 is reproduction, not repair** — in PRD-110, PRD-112 and PRD-114. No reproduction, no
  fix phase. Do not write a fix from a report.
- **A friction log is a builder's experience, not a measurement.** Round 5's log asserted that
  scene bodies leak and that no fixed-step option exists; round 6 measured both and disproved
  them. Verify against source or an instrument before promoting a friction claim to a PRD.
- **Name the layer before the fix.** Engine bug → `packages/`. Game bug → the example or the
  template. PRD-111 is filed as a template change on purpose; if a phase starts wanting a package
  export, it was mis-scoped.
- **Never own the look.** Round 6's visual defects are game-owned and stay that way. The scaffold's
  starting point is the lever, never `packages/`.
- **WebGPU on this host needs `xvfb-run -a -s '-screen 0 1600x900x24'`.** Headless Chromium renders
  the canvas blank while the page still loads, so a blank screenshot reads as a styling bug rather
  than a GPU failure. A run that never reached its assertions exits `2` and is recorded as
  **unmeasured** — never a pass, never a red.
- **Validate locally, not by pushing to CI.** CI minutes are scarce on this plan. PRD-112's matrix
  runs as a local script first and is wired second.
- **Do not touch `examples/abyss-vanilla/`.** Frozen benchmark control.
- **Do not slice anything out of the closed list.** An IR, a scene format, an editor, a preset
  system, a code-first ECS, a bespoke CLI vocabulary. If a slice starts to look like one of the
  six, that is the signal it was mis-scoped.
- **No mobile-readiness claim from this batch.** Desktop and the iOS simulator are green; the
  Android emulator is red on the hosted lane; physical hardware is untested.

## The deletion this batch owes

`AGENTS.md` rule 2 deletes an abstraction no fresh uninformed build reaches for. PRD-108 added four
members; round 6 reached for `pushesDynamicBodies` and `RigidBody3D.linearVelocity` but **not**
`applyImpulse` or `applyForce`. One unreached round is thin evidence; two is not.

**That deletion is not written yet, on purpose** — PRD-114 decides it. PRD-114 Phase 4 files it as
its own PRD in the same session if the verdict fires, and PRD-114 is not done until that file
exists. A strategy document accumulates additions by nature; the kill switch is the only thing that
makes the LOC budget mean anything.

## Not in this batch, and why

| Item | Why it is out |
|---|---|
| Item 6 — native parity, incl. PRD-108's Rust side | **Now filed as PRD-116, in this folder but not in tonight** — see *Sizing*. The reason it was first excluded is unchanged and still governs: large, Rust, and `packages/runtime-native/` is already `69910/50000` with a justification obligation. The fact it rests on stays on the record: **no native build can push a crate yet** — the TypeScript ABI forwards and throws `TN_NATIVE_PHYSICS_ACTUATION_MISSING`, and the Rust `Simulation` has not gained the entry points. Do not describe PRD-108's physics work as done on native. |
| Item 7 — performance budgets | Depends on PRD-110 landing first |
| Item 8 — template quality | Unblocked but orthogonal; mostly art direction |
| PRD-109 handle invalidation | Touches the physics ABI across `handles.ts`, `simulation.ts`, `native/host.ts`; would let determinism become the default, but is not on the critical path to a measured round |
| The staged crossover benchmark | Nine steps across both arms. Its first honest prerequisite is PRD-114 |
| The starter's bloom default | **Deliberately unchanged.** Two builders turned it down; the source document says a third independent build turning the same knob decides it. Changing a visual default from two text reports is the exact move its verification section argues against |
| The `Area3D` / `CharacterBody3D` open question | An engine question deliberately not guessed at — `areaIntersections` uses `world.intersectionsWithShape`, which bypasses Rapier's `ActiveCollisionTypes`, so the obvious kinematic-pair explanation is wrong. Needs a targeted experiment, not a PRD |

## Done means

For each PRD that lands: `pnpm typecheck && pnpm lint && pnpm test` green, the phase's playtest or
matrix gate green, every negative control observed red with its command pasted, a dated file in
`docs/verification/`, and the PRD's status line updated with what was executed and what was not. A
PRD finished end to end gets `git mv`'d to `docs/PRDs/done/` in the same commit that finishes it;
this folder is archived with
`git mv docs/PRDs/production-readiness-26-08-14/ docs/PRDs/done/production-readiness-26-08-14/`
only once every PRD in it is complete.

A report that says *"PRD-111 landed and the mutation test passes; PRD-110 Phase 0 reproduced the
permissive default and Phases 1–2 landed; PRD-112 Phase 0 did not reproduce
`TN_CONFIG_TRANSPILER_MISSING` across seven templates so Phase 2 was deleted; PRDs 113 and 114
untouched pending the owner"* is a good result. A report claiming five closures without five
verification files is not.

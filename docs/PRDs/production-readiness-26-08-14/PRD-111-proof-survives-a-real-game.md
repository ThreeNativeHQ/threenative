# PRD-111 — The scaffold's proof survives changing the game

**Status: OPEN, written 2026-08-14. Nothing here has been executed.** Sliced from
`docs/strategy/PRODUCTION-READINESS.md` item 2.

**Complexity: 3 → LOW mode.** One generic scenario, one default entity registration, one `test`
script rewrite. **Template change, not a package change.**

**LOC:** lands in `packages/create-threenative/templates/`, which is generated user source and
is reported-not-capped. Spends none of the 259-line framework headroom.

---

## 1. Context

**Problem.** Both sandbox rounds deleted all ten generated playtest scenarios and never used the
bridge. Round 6's builder said why: the scenarios assert the starter game's pickups, coyote time
and respawns, *"none of which survives contact with a different game"*, and the `test` script that
runs them *"is dead the moment you change the game."*

The claim is checkable and it checks out. `templates/starter/package.json:15` chains ten
scenarios:

```text
play, monitoring, restart, coyote, buffer, look, pause, respawn, seed, pick
```

`playtests/play.playtest.json` asserts `resources: [{ id: "GameState", path: "score", gte: 1 }]`.
A user whose game has no score has a red `test` script on their first edit, and the cheapest
repair is `rm -rf playtests/`. Both rounds took it.

**Consequence.** This is the single largest unrealised value in the product. It costs points on
two axes worth **35 combined**, and it is why round 6's sealed proof observed nothing: only
`entity: "goal"` was ever registered, so `contacts`, `movement`, `settled` and `states` had
nothing to read.

**Files analysed.**

- `packages/create-threenative/templates/starter/package.json:15` — the ten-scenario chain
- `packages/create-threenative/templates/starter/playtests/*.json` — all ten, all game-specific
- `packages/create-threenative/templates/starter/src/game.ts:15` — `playtest()` is installed
- `packages/create-threenative/templates/starter/src/scenes/Play.ts` — entities exist, none is
  declared the subject

## 2. Approach

Ship **one** scenario that survives changing the game, run it first in the chain, and have the
scaffold register the player entity by default so the bridge observes something without the user
writing anything.

The generic scenario asserts only what is true of every game built from this template:

1. the page boots and the runtime reports ready,
2. a canvas renders a non-blank frame,
3. no console errors, no network errors, no runtime diagnostics,
4. the subject entity moves under input.

Point 4 is the one that needs the registration. `subject` already exists in the scenario schema —
the sealed proof uses `"subject": "player"`. The template currently names no subject, so a
movement assertion has nothing to track.

**Key decisions.**

- **The other nine scenarios stay.** They document the starter game and they are the user's to
  delete. What changes is that deleting them no longer deletes the user's only proof.
- **`survives.playtest.json` runs first** in the `test` script, so a broken game fails on the
  generic check before the game-specific ones add noise.
- **Nothing moves into `packages/`.** A generic scenario is a JSON file; the 20-line rule and the
  never-own-the-look rule both point at the template.
- The generated `AGENTS.md`/`CLAUDE.md` must say which scenario is safe to keep and which are
  examples — those files are the one place a user's agent learns this.

## 3. Integration Ledger

| # | New thing | Live caller (`file:line`, non-test) | Replaces | Old path removed? | Negative control |
| --- | --- | --- | --- | --- | --- |
| 1 | `templates/starter/playtests/survives.playtest.json` | `templates/starter/package.json:15` (`test`, first in chain) | — | n/a, new | rename the subject entity → the movement assertion fails, it does not skip |
| 2 | default subject registration in `Play.ts` | `templates/starter/src/scenes/Play.ts` (scene setup) | — | n/a, new | remove the registration → `survives` fails `TN_PLAYTEST_OBSERVATION_UNAVAILABLE` |
| 3 | `STARTER_PATHS` entry | `packages/create-threenative/__tests__/scaffold.spec.ts` | — | n/a | the scaffold test fails if the file is not shipped |
| 4 | the same pair in every other template | each template's `package.json` + scene | — | n/a | `pnpm test:templates` fails for any template missing it |

**Reachability.** Entry point is the generated project's `pnpm test`, and
`scripts/verify-template-playtests.ts` via `pnpm test:templates`. Both already exist.

## 4. Phases

### Phase 1 — One scenario that survives, proved by breaking the game it ships with

**Files (max 5):**

- `packages/create-threenative/templates/starter/playtests/survives.playtest.json` — NEW
- `packages/create-threenative/templates/starter/src/scenes/Play.ts` — EDIT: register the player
  as the playtest subject
- `packages/create-threenative/templates/starter/package.json` — EDIT: `survives` first in `test`
- `packages/create-threenative/templates/starter/AGENTS.md` — EDIT: which scenario to keep
- `packages/create-threenative/__tests__/scaffold.spec.ts` — EDIT: `STARTER_PATHS`

**Wiring:**

- [ ] Caller edited: `package.json:15` runs it first
- [ ] Registration: the scene declares the subject entity
- [ ] Old path: n/a — the nine stay as documented examples
- [ ] Ledger rows filled: #1, #2, #3
- [ ] `pnpm sync:agents` run after editing `AGENTS.md`

**Tests required:**

| Test file | Test name | Assertion | Negative control (must be observed red) |
| --- | --- | --- | --- |
| `__tests__/scaffold.spec.ts` | `should scaffold the survives scenario` | file present in output | remove from `STARTER_PATHS` → fails |
| `__tests__/playtest.spec.ts` | `should run survives first` | `test` script order | reorder → fails |
| the scenario itself | `survives` | exit 0 against the untouched scaffold | see the mutation gate below |

**The gate that makes this real — the mutation test.** A scenario that passes the shipped game
proves nothing about a *different* game. Take the scaffolded project and:

1. delete `src/scenes/Play.ts`'s pickups, score, coyote time and respawn,
2. leave a player mesh that moves under input,
3. run `pnpm test`.

**`survives.playtest.json` must exit 0. The other nine may fail.** That is the whole PRD. Record
the run and its output; a claim of survival with no mutated build behind it is UNVERIFIED.

**Revert check:** remove the subject registration → `survives` fails
`TN_PLAYTEST_OBSERVATION_UNAVAILABLE` rather than passing with nothing observed.

### Phase 2 — The same pair in every template

**Files:** one scenario + one registration per remaining template (`minimal`, `platformer`,
`action-rpg`, `defense`, `racing`, `shooter`) — split across commits, five files at a time.

**Gate:** `pnpm test:templates` green, and the Phase 1 mutation test repeated for at least
`minimal` (no React, DOM HUD — the shape most different from `starter`).

## 5. Criteria

| # | Criterion | Met? |
| --- | --- | --- |
| 1 | A scaffolded project whose gameplay has been **replaced** still has a green `pnpm test` from `survives.playtest.json` | — |
| 2 | The mutated build's run output is pasted, not summarised | — |
| 3 | Removing the subject registration makes `survives` fail, not skip | — |
| 4 | A blank canvas fails `survives` (depends on PRD-110 Phase 3, or is asserted here by pixel coverage) | — |
| 5 | Every template ships the pair and `pnpm test:templates` is green | — |
| 6 | The generated `AGENTS.md` tells the user's agent which scenario is the durable one | — |
| 7 | `pnpm typecheck && pnpm lint && pnpm test` green; `pnpm sync:agents --check` clean | — |

Criterion 1 is consumer-scoped on purpose. *"A generic scenario ships"* would be satisfied by a
file nobody runs against a changed game.

## 6. Evidence

| Gate | Command | Result |
| --- | --- | --- |
| Scaffold | `pnpm exec vitest run packages/create-threenative/__tests__/scaffold.spec.ts` | — |
| Untouched scaffold | `pnpm test:templates` | — |
| **Mutation test** | scaffold → strip gameplay → `pnpm test` | — |
| Negative control | remove subject registration → `pnpm test` | — |
| Typecheck / lint / test | `pnpm typecheck && pnpm lint && pnpm test` | — |
| Agent docs | `pnpm sync:agents --check` | — |

WebGPU capture on this host needs `xvfb-run -a -s '-screen 0 1600x900x24'`. A run that never
reached its assertions exits `2` and is recorded as **unmeasured** — never a pass, never a red.

## 7. What this does not do

- **It does not make the sealed proof passable.** The proof pins entity ids and a seed the brief
  never states; that is PRD-113 and it is an owner decision. Registering `player` by default
  narrows the luck but does not remove it — `crate`, `solid-body`, `mission` and `world.seed`
  remain unstated.
- **It does not delete the nine game-specific scenarios.** They are the user's source.
- **It does not add a package export.** If a phase starts wanting one, it was mis-scoped.
## Lane: lane-111
- state: PARTIAL
- commit: 40d6d9c
- reason: review-requested-final-repair
- evidence: .linchpin/lane-111-gates.md

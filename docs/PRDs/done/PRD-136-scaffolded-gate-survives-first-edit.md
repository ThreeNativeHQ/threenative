---
prd_contract: v1
---

# PRD-136 — A scaffolded project's own `pnpm test` breaks on the user's first level edit

**Status:** COMPLETE, 2026-08-18. The seed assertion and edit pair are proven in
`docs/verification/prd-136-seed-scenario-2026-08-17.md`; the later scaffold-runner fix also makes
the generated template test scripts self-running with the documented WebGPU recipe.

**Outcome:** the ten playtests a scaffolded project ships assert what the *game* does, not what the
framework's random number generator happened to return on the day the template was written — so a
user who moves a crate gets a green suite, and a user who breaks determinism gets a red one.

**Depends on:** nothing.

**Blocks:** nothing. It is the first thing a new user hits, so it goes early in the batch.

**Complexity: 3 → LOW mode.** One scenario edited, one unit test added, one guard.

**Blast radius: 4 files.** `packages/create-threenative/templates/starter/playtests/seed.playtest.json`,
one new `packages/core/__tests__/*.spec.ts`, one guard spec, and the six other templates only if
the audit in §2 finds the same shape there.

---

## 1. The defect

`packages/create-threenative/templates/starter/playtests/seed.playtest.json:13`:

```json
{ "id": "GameState", "path": "levelX", "allowTrivial": true, "equals": -0.6056551518850029 }
```

`levelX` comes from `templates/starter/src/scenes/Play.ts:67`:

```ts
const levelX = ctx.random.range(-1, 1);
```

It is the *n*-th draw from the seeded generator in `Play.build`. The assertion therefore pins:
the seed, the generator's algorithm, **and the exact order of every `ctx.random` call before it**.

A user's first edit to their own level — adding a crate, moving the pickup, reordering two lines —
changes the draw order and turns their `pnpm test` red on a scenario they did not write, with a
failure message about a 16-digit float. `test` is the tenth of ten scenarios in the scaffolded
project's `test` script, so the whole suite goes red.

**Name the layer.** This is a *template* bug, not an engine bug. `ctx.random` is behaving exactly
as specified; what is wrong is that generated user source ships a gate asserting a framework
internal. The fix belongs in the template and in an engine unit test, not in `@threenative/core`'s
runtime.

## 2. Audit first

Grep every template's playtests for the same shape before changing anything:

```sh
grep -rnE '"equals": *-?[0-9]+\.[0-9]{6,}' packages/create-threenative/templates/*/playtests/
```

On 2026-08-17 this returns **exactly one hit**, the line above. Re-run it as step 1 of the work
and record the result — if it returns more, they are in scope; if it still returns one, say so.

## 3. What the scenario should assert instead

The scenario is called `seed` and its job is to prove **the world is seeded and reproducible**.
That decomposes into two claims that live in two different places:

| Claim | Where it belongs | How |
| --- | --- | --- |
| The seeded generator returns the same sequence for the same seed | `@threenative/core` unit test | Draw *n* values from seed `90210` twice, assert the sequences match, and assert two different seeds diverge |
| The game actually consumed the seed and built a level from it | the template's `seed.playtest.json` | `world.seed` is `90210`, and `levelX` **changed** from its `-99` sentinel and lies inside `[-1, 1]` |

The `-99` sentinel is already in `Play.initialState` (`Play.ts:24`) and exists for exactly this —
a value no legitimate draw can produce. The resource assertion schema supports `changed` and
`gte`, so the replacement needs no new playtest capability.

Replacement:

```json
{ "id": "GameState", "path": "levelX", "changed": true, "gte": -1 }
```

Drop `allowTrivial: true` with the constant. It was there to permit a bare equality against a
value the harness could not otherwise justify; `changed` from a sentinel is not a trivial
assertion, so the escape is no longer needed. **If the harness rejects the scenario without it,
that is a finding — record it rather than restoring the flag.**

An upper bound of `1` is not expressible with `gte` alone. Either add the symmetric bound to the
resource assertion in `@threenative/playtest` (small, and it makes every range assertion in every
template expressible), or accept `gte: -1` plus `changed` and say in the scenario's own comment
that the upper bound is unasserted. **Do not silently ship the weaker one.**

## 4. Acceptance

| # | Command | Required result |
| --- | --- | --- |
| 1 | the grep in §2 | output pasted into the evidence file |
| 2 | `pnpm vitest run packages/core/__tests__/<new>.spec.ts` | pass — same seed reproduces, different seed diverges |
| 3 | scaffold a project, run its `pnpm test` | exit `0` |
| 4 | in that scaffolded project, insert one extra `ctx.random.range(0, 1)` call before line 67 of `Play.ts`, re-run its `pnpm test` | **exit `0`** — this is the whole point |
| 5 | in that project, replace `ctx.random.range` with `Math.random`, re-run | **red**, and it must be `seed.playtest.json` that fails |
| 6 | `pnpm test:templates` | exit `0` |

Steps 4 and 5 are the pair. Step 4 alone is satisfied by deleting the assertion, which is the
forbidden fix; step 5 proves something is still being asserted.

Evidence: `docs/verification/prd-136-seed-scenario-2026-08-17.md`.

## 5. What this does not claim

Not that the other nine scenarios a scaffolded project ships are robust to a user's edits. Nobody
has run that experiment — a user editing their own game and watching which of the ten shipped
gates survive is a real measurement and it has never been taken. This PRD fixes the one instance
the audit finds and leaves the general question open, named here so the next round does not
mistake silence for coverage.

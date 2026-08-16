# The sealed token gate covers six genres — PRD-113 criteria 4 and 5, 2026-08-15

Closes criteria 4 and 5 of
[PRD-113](../PRDs/alpha-readiness/PRD-113-sealed-brief-naming-contract.md): *"No value the proof
pins is absent from its brief, for every one of the six genres"* and *"the audit fails when a
pinned-but-unstated value is re-added"*.

Handed to this session by the session that owns PRD-113 and PRD-114, after round 8 was recorded
at `4498ea43`. Nothing here touches `docs/verification/round-8-2026-08-15.md`, and no blind
visual score was produced.

## 1. What the previous gate missed, and why

`scripts/__tests__/sealed-proof-tokens.spec.ts` landed at `e67a0d2d` and closed the defect it was
written for: the replay proof no longer demands `replayPhase === "done"` or the bare string
`"match"`. But it was scoped to **one genre and one assertion kind** — `GENRE_ROOT` was
`physics-puzzle` and the walk covered `assert.resources` only.

`scripts/__tests__/sealed-contract.spec.ts` does walk all six genres, and cannot catch these
either: it classifies pins as `identifier`, `key`, `resource-id`, `resource-path` or `seed`. **A
pinned *value* is none of those.** So a proof could require any literal string it liked and both
gates stayed green.

Five tokens survived, in four genres:

| Genre | File | Pin |
|---|---|---|
| physics-puzzle | `physics-puzzle.playtest.json` | `assert.states[0].equals = "won"` |
| topdown-action | `topdown-action.playtest.json` | `assert.resources[2].textIncludes = "SECURE"` |
| exploration | `exploration.playtest.json` | `assert.resources[0].equals = "hub"` |
| exploration | `exploration.playtest.json` | `assert.resources[2].textIncludes = "north.archive"` |
| open-world | `open-world.playtest.json` | `assert.resources[2].textIncludes = "7"` |

`"won"` is the sharpest, because it sits in the *other* scenario of the very genre the round-8
evidence document examined. It has never gone red because round 8's builder happened to choose
that word — which is exactly the condition PRD-113 exists to stop measuring, not evidence that
the contract works.

## 2. The widened gate, observed red first

The gate now walks every genre and whole scenarios, and covers `textIncludes` beside `equals`.
The `anyOf` exemption is keyed on **any alternative being a non-string pin**, never on a
whitelist of accepted words — a whitelist would be the same vocabulary test in a new costume.

Observed red before any proof or brief was touched:

```console
$ pnpm exec vitest run scripts/__tests__/sealed-proof-tokens.spec.ts
   × requires no string token the physics-puzzle brief never publishes
   ✓ requires no string token the platformer brief never publishes
   × requires no string token the topdown-action brief never publishes
   ✓ requires no string token the endless-runner brief never publishes
   × requires no string token the exploration brief never publishes
   × requires no string token the open-world brief never publishes

+ [ "physics-puzzle/physics-puzzle.playtest.json: assert.states[0] equals=\"won\"" ]
+ [ "topdown-action/topdown-action.playtest.json: assert.resources[2] textIncludes=\"SECURE\"" ]
+ [ "exploration/exploration.playtest.json: assert.resources[0] equals=\"hub\"",
+   "exploration/exploration.playtest.json: assert.resources[2] textIncludes=\"north.archive\"" ]
exit 1
```

Four of six genres red, naming the genre, the file, the assertion path and the token. `platformer`
and `endless-runner` were already clean — their only `equals` values are a boolean and numbers.

## 3. The five dispositions, one genre at a time

Two were published, three were made behavioural. The rule applied: **publish when the proof
genuinely cannot infer the value and the row needs a literal to compare against; make behavioural
when the decisive fact is already proven by a neighbouring row.**

| # | Token | Disposition | Why |
|---|---|---|---|
| 1 | `won` | **Published** in the physics-puzzle brief | A terminal-success row has to compare against some word. This is the same class as `world.seed` and the input key — an irreducible harness input, which is what the recorded Option C decision says to publish |
| 2 | `SECURE` | **Behavioural** — dropped, `changed: true` kept | The decisive win is already proven in the same scenario by `enemiesRemaining equals 0`. The objective row's job is that the HUD objective updates, and `changed` is that fact without the vocabulary |
| 3 | `hub` | **Published** in the exploration brief | The brief already says "hub" three times in prose; the row asserts the player is in the starting area after returning. Naming it as a literal is the smallest honest fix |
| 4 | `north.archive` | **Behavioural** — replaced with `changed: true` | A point-of-interest id the brief never names and a builder cannot derive. `inspections equals 3` already proves three inspections happened; this row's job is that the journal recorded them |
| 5 | `"7"` | **Behavioural** — dropped, `changed: true` kept | Unguessable and nearly vacuous at once: a substring match on one digit is satisfied by `17`, `27` or `7.5`. `currentChunk gte 7` already proves the traversal distance |

**One thing disposition 5 does not fix, stated rather than papered over.** The open-world brief
says the proof should *"assert that an old chunk is absent and a forward chunk is present"*. The
`textIncludes: "7"` row never proved that — a substring test shows presence, never absence. So
dropping it loses no real coverage, but the brief's stated property remains unproven. Closing it
needs a set-membership assertion the harness does not have, which is a `packages/playtest/`
change and outside this PRD.

## 4. Green after, with the gate that was red

```console
$ pnpm exec vitest run scripts/__tests__/sealed-proof-tokens.spec.ts \
    scripts/__tests__/sealed-contract.spec.ts scripts/__tests__/proof-set.spec.ts
 Test Files  3 passed (3)
      Tests  19 passed (19)
exit 0
```

The six-genre resource-id/path audit and both of its existing red controls are untouched and still
pass, as PRD-113's repair record requires.

## 5. The hash discontinuity

Four genres move. **Functional-column numbers scored before these hashes are not comparable with
numbers scored after them**, and this is the second such boundary in PRD-113's history — the first
was the `33c3acb0` → `e5be692b` proof change that round 8 recorded on both sides.

| Genre | Brief SHA-256 | Proof SHA-256 |
|---|---|---|
| physics-puzzle | `d950471f…` → **`a2a40e96…`** | `e5be692b…` unchanged |
| topdown-action | `262b0465…` unchanged | `4b9abfc9…` → **`6f31d1f0…`** |
| exploration | `adaaad06…` → **`a70bf0e7…`** | `c863f439…` → **`d5448d91…`** |
| open-world | `32929de5…` unchanged | `1747ba54…` → **`e8517637…`** |
| platformer, endless-runner | unchanged | unchanged |

**Round 8 becomes historical for physics-puzzle, and is not re-runnable.** Its archives
`physics-puzzle-2026-08-15-8` and `-9` are sealed against brief `d950471f…`, which no longer
exists. `sweep:proof` refuses a manifest/hash mismatch outright rather than silently re-scoring,
so this fails closed — that guard is working, and the round's recorded numbers stay valid as the
record of what was measured against the contract of the time. They cannot be reproduced by
re-running the command, and `round-8-2026-08-15.md` is deliberately left exactly as its author
wrote it.

## 6. What this does not do

- **It does not run a round**, produce a blind visual score, or touch `round-8-2026-08-15.md`.
- **It does not weaken any threshold.** Thirty settled bodies is still thirty; `enemiesRemaining`
  still has to reach zero; `inspections` still has to reach three.
- **It does not add an assertion kind.** Every disposition uses `changed`, which the schema
  already had.
- **It makes no claim about the other five genres' proofs beyond their pinned string values.**
  Whether each proof observes the behaviour its brief describes is a separate question, and
  open-world's absent-chunk row above is one known instance where it does not.

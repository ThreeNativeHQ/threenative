# Anonymising the sealed proof made the two arms unpairable — 2026-08-15

`pnpm sweep:pair` has never run on round 8, and the reason is a design gap rather than a bug in
either arm.

## What happens

```console
$ pnpm sweep:pair docs/benchmark/sweeps/physics-puzzle-2026-08-15-9 \
                  docs/benchmark/sweeps/physics-puzzle-2026-08-15-8
Cannot pair 'physics-puzzle.playtest.json': sealed proof field 'entity' must be a non-empty string.
exit 1
```

`scripts/sweep-pair.ts:276` and `:306` require `entity` on every `states` and `settled` assertion.
The physics-puzzle proof has neither, by design — PRD-113 chose Option C and the brief says so:
*"The direct proof supplies no gameplay entity identifiers."* Other kinds already tolerate the
absence: `contacts`, `visibility` and `occluded` fall back to the scenario subject or a literal.
`states` and `settled` were never updated.

## The deeper problem, which a guard would not fix

Adding the same fallback to those two branches is not enough, because the row identifiers the
runner emits are **not stable across arms**. From the two archives, same sealed assertions:

| Sealed assertion | vanilla arm (`-8`) | framework arm (`-9`) |
| --- | --- | --- |
| anonymous `states` | `states.mission` | `states.anonymous` |
| anonymous `settled` | `settled.crate.` | `settled.crate-` |

The runner names each row after the entity it discovered in that build. When the proof names the
entity, both arms discover the same one and the ids match. When the proof is anonymous — which is
the whole point of Option C — each arm resolves to its own vocabulary, and the pair report has
nothing to join on.

So the change that stopped the proof testing whether a builder guessed the right name also stopped
the two halves of a paired round lining up. Both are consequences of the same decision, and the
second was not noticed because `sweep:pair` throws on the first missing `entity` before it ever
reaches the matching step.

## What this means for the round

Round 8's functional column was assembled by reading each arm's `proof.json` directly rather than
through `sweep:pair`, which is why it exists at all. That is fine for a per-arm score and no use
for a gap list: "where did vanilla beat the framework, row by row" needs the rows to correspond,
and right now they do not.

`docs/verification/round-8-2026-08-15.md` records the cost gap, which is computed from
`sweep:measure` and does not depend on row identity. It records no per-row functional gap, and
after this it should not until pairing works.

## The fix this argues for

Give anonymous assertions an identifier derived from the sealed proof rather than from the build:
its kind and its index in the scenario — `states.0`, `settled.0` — so both arms emit the same id
for the same assertion. The discovered entity stays in the row's details, where it is evidence
rather than an identifier.

That is a change in the runner, in `packages/playtest`, not in the pair script; adding the
fallback to `sweep-pair.ts` alone would stop the throw and then silently match nothing. Both halves
are needed, and the runner half has to come first.

Not attempted here. It changes the identifiers in every recorded `proof.json`, so it wants its own
before/after and a decision about whether older archives stay readable — the same class of change
as moving a sealed hash, and not one to make while a round's numbers are being written down.

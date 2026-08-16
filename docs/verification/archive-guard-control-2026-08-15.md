# The archive guard fires on round 8's real archive — PRD-114 criterion 4, 2026-08-15

Criterion 4 of
[PRD-114](../PRDs/BLOCKED/requires-paired-round/PRD-114-paired-round-on-the-repaired-instrument.md):
*"Deleting an imported sibling from an archive fails the archive step — the instrument's own
control, observed red."* Round 8 did not run it. This runs it.

**Why it is not a formality.** Rounds 3, 4 and 5 all reported `0/1` for both arms, and it was not
the games: `sweep-archive` silently dropped `threenative.config.ts`, so every archived build 500'd
in its dev server and never booted. `assertArchiveResolves` is the repair. A round that trusts the
functional column without ever watching that guard fire is trusting the same class of instrument
that produced three void rounds.

**Why the existing unit test is not enough on its own.**
`scripts/__tests__/sweep-archive.spec.ts:116` already asserts
`toThrow(/unbootable project/u)` — against a synthetic fixture it builds itself. This control runs
the guard against **round 8's actual framework archive**, which is the artifact the round's
functional column was computed from. That is the consumer-scoped version of the same question, and
it is the one the criterion asks for.

## The run

Both halves execute `archiveSandbox` — the real function `pnpm sweep:archive` calls — against a
copy of `docs/benchmark/sweeps/physics-puzzle-2026-08-15-9`, staged in `mktemp -d`. The temporary
root borrows the scaffold templates by symlink, because `copyStarterBaseline` reads them from the
repo root; everything the archiver *writes* lands in the temp tree. **The committed archives are
never touched and nothing is written under the real `docs/benchmark/sweeps/`.**

```console
$ pnpm exec tsx tn-archive-guard.tmp.ts
sweep archived: /tmp/tn-archive-guard-positive-qcXhkh/repo/docs/benchmark/sweeps/physics-puzzle-2026-08-15
POSITIVE ok -> docs/benchmark/sweeps/physics-puzzle-2026-08-15

NEGATIVE red as required:
Refusing to archive an unbootable project; src/ imports files the archive does not carry:
  src/game.ts -> ../threenative.config.js

NEGATIVE left 0 archive(s) behind: []
```

Three things that make this an observation rather than a demonstration:

1. **The positive half ran first and passed.** Without it, a red proves only that something
   failed — not that deleting the sibling is what failed it.
2. **The guard named the exact import.** `src/game.ts -> ../threenative.config.js` is the real
   import at `physics-puzzle-2026-08-15-9/src/game.ts:5`, not a generic message.
3. **The failed run left no archive behind.** `archiveSandbox` removes the destination in its
   `catch` before rethrowing, so a rejected archive cannot be picked up later and scored as if it
   had been accepted. That is the half of the guard nobody checks, and it holds.

## What this does and does not close

**Closes:** PRD-114 criterion 4. The archive step is load-bearing on the artifact round 8 actually
produced, and the `0/1` failure mode that voided rounds 3 to 5 would now be rejected at archive
time rather than reported as a game result.

**Does not close:** anything about the round's numbers. This says the instrument refuses an
unbootable archive; it says nothing about whether either arm's game is good. The blind visual score
remains `unmeasured` in `round-8-2026-08-15.md`, and it stays with whoever runs the round, because
the judge has to be fresh, read-only and blind to arm.

The control script was temporary and is not committed: it exists only to run the shipped
`archiveSandbox` against a staged copy, and the permanent regression is the spec at
`scripts/__tests__/sweep-archive.spec.ts:116`. Its full text is reproduced above in the output it
produced, and it is reconstructable from this document in a few lines.

# The sealed replay proof still tests naming — round 8 evidence, 2026-08-15

Evidence for `docs/PRDs/production-readiness-26-08-14/repairs/PRD-113-repair-sealed-behavior-proof.md`,
produced by a fresh uninformed build rather than by reading the proof.

## What happened

The round-8 vanilla arm built the physics-puzzle brief without ever seeing the sealed proof,
which is the point of the arm. Its build works. Against
`docs/benchmark/genres/physics-puzzle/proof/physics-puzzle-replay.playtest.json` it scored
**0/2 scenarios**, and both failures are token mismatches rather than behaviour failures:

| Assertion | Sealed proof requires | The build produced | Verdict |
| --- | --- | --- | --- |
| `state.replayPhase` | `equals: "done"` | `"complete"` | fail |
| `state.replayMatch` | `equals: "match"` | `true` | fail |
| `world.seed` | `6132` | `6132` | pass |
| `diagnostics` | clean | 0 console, 0 network, 0 runtime | pass |

The replay itself ran correctly. The phase advanced `idle → complete`, both runs produced the
same hash (`0x2ac050df`, and `3214079977` on an earlier verification), and the arm's own harness
observed 41/41 bodies asleep, `player|goal|trigger` contacts, and a won mission.

Archive: `docs/benchmark/sweeps/physics-puzzle-2026-08-15-6`. Proof hash
`33c3acb029096205e3e04cc22afdd736575998b8a41ab3208888071ede654ab8`. Command:
`pnpm sweep:proof docs/benchmark/sweeps/physics-puzzle-2026-08-15-6`, exit 1.

## Why this is the PRD's exact subject

The brief publishes the two paths and nothing else:

> The direct proof supplies no gameplay entity identifiers; the replay proof reads resource
> `state` paths `state.replayPhase` and `state.replayMatch`.

It never publishes the values `"done"` or `"match"`. A builder cannot derive them, so the
assertion measures whether the builder guessed a word. That is the failure PRD-113 is named
for, and Option C — publish only irreducible harness inputs, make the rest behaviour-based —
was not carried through to this scenario.

`replayMatch` is the sharper case. A replay either matched or it did not; that is a boolean
fact. Requiring the literal string `"match"` cannot be satisfied by the natural encoding, so
the most obvious correct implementation fails.

The builder called it before seeing any result: *"The replayPhase terminal token is a guess —
I chose 'complete', nothing in the brief pins it."* An instrument a careful builder can
predict it will fail, for reasons unrelated to the product, is not measuring the product.

## The other sealed scenario, which is not a naming problem

`physics-puzzle-observable-behaviour-proof` scored **6/8 rows**, and neither failure is a
token guess. Both are recorded here so this note cannot be read as blaming the instrument for
everything the arm failed:

| Row | Observed | Why it failed |
| --- | --- | --- |
| `states.mission` | `expected "won"`, `observed "won"` | `preExisting: true` — the mission was already won before the asserted step. The build wins early, plausibly because a pushed crate reaches the pad first; its own harness counted 34 crate-goal hits against 17 player-goal hits. |
| `settled.crate.` | 40 bodies, 40 sleeping, minimum 30, `omittedBodies: 0` | Every count clears the threshold, but `poseDistance.mean` is `0` against the `drop` step, so nothing moved between `drop` and `settled`. The crates had already come to rest before the window meant to observe them settling. |

Both are the instrument observing something true about the build. That is the difference
between these rows and the two replay rows: a builder can act on these, and cannot act on
`"done"` versus `"complete"`.

## What this does not show

- Nothing about the framework arm; this is one arm against the instrument.
- Not a claim that the vanilla build is correct. It failed four rows across the two sealed
  scenarios; two are naming and two are real.
- Not a licence to loosen the assertion into vacuity. A run where the two replays disagreed
  must still fail, which is why the repair has to keep a decisive check on the match result
  rather than only asserting that the value changed.

## The change this argues for

Make both rows behaviour-based, and accept the natural encodings:

- `replayPhase` — assert that it changed away from its initial value, without pinning a
  terminal token. A game that never runs a replay leaves it unchanged and still fails.
- `replayMatch` — assert the decisive result via the existing `anyOf` resource form, so a
  boolean `true` and a string `"match"` both satisfy it while `false` and `"mismatch"` do not.

Editing a sealed proof changes its hash and voids comparison with every earlier round, which
is why this is recorded as evidence first and implemented as PRD-113's own change with its own
before/after run, rather than edited mid-round underneath archives that were built against the
current hash.

# Paired score — physics-puzzle, round 7 — 2026-08-15

**Verdict: VOID pending a fresh pair on the repaired instrument.**

PRD-114 reran the pair after repairing the vanilla observation capability and the current archive
guard. The framework archive is a re-sealed rearchive of a distinct older framework source; the
vanilla archive is the fallback source with the repaired bridge. This record does not present a
fresh-builder score as if it were a new round.

## Measured pair

| Arm | Archive | Proof | Authored LOC | Authored bytes | Source LOC | Source files | Reach rate |
| --- | --- | --- | ---: | ---: | ---: | ---: | ---: |
| Framework | `docs/benchmark/sweeps/physics-puzzle-2026-08-15-4` | 0/2 | 964 | 36,797 | 1,581 | 21 | 0.476 |
| Vanilla | `docs/benchmark/sweeps/physics-puzzle-2026-08-15-3` | 0/2 | 352 | 10,936 | 352 | 2 | 0 |

`pnpm sweep:pair` measured a framework-minus-vanilla delta of **+612 authored LOC** and **+25,861
authored bytes**. The proof hashes matched the revised sealed hash
`d8e90936be7bec4046af766b108fdd7b1dcb92aad3d1e87e4c72b2de40d592f3`; both archives carry the
historical build brief hash `bdfb940a2ec2e0ecf6dffa8f360f0ee3e39884cf60b50dd4db1b21626af36e20`.

## Functional result

The framework scenarios reached 4 and 7 authored assertions; the framework arm failed `world.seed`
and passed diagnostics, while its state transitions also failed. The vanilla scenarios also reached
4 and 7 authored assertions after the bridge advertised
`runtime.world`; the vanilla arm passed `world.seed` and failed diagnostics, while its sealed state
transitions failed. Both arms therefore have measured failed runs, but the functional column is
**unmeasured**, not a framework win.

Both `pnpm sweep:capture` commands exited **1** because their sealed proof result was 0/2; neither
produced `captures/index.json`. Manual nonblank screenshots were retained only as limited visual
evidence:

- `docs/benchmark/sweeps/physics-puzzle-2026-08-15-4/captures/manual-round7-repaired.png`
- `docs/benchmark/sweeps/physics-puzzle-2026-08-15-3/captures/manual-round7-repaired.png`

## Blind visual record

The blind bundle and structural judge are in
`docs/verification/physics-puzzle-round-7-blind/`. The lead-authored fallback critic scored the
anonymous samples 3/3 and 4/4 for playability/visuals; sample 2 was preferred. This is not a fresh
read-only critic result and is not promoted to a comparative visual verdict.

## Cost and losses

Vanilla won the measured authored-cost column by 612 LOC and 25,861 bytes. That cost gap is
recorded as user space, not as a framework-change request, because the pair is void and the look
and gameplay remain game-owned.

## Deletion verdict

Round 6 and round 7 use distinct framework source snapshots and both omit `applyImpulse` and
`applyForce`. The method-level candidate is recorded in
`docs/verification/round-7-2026-08-15.md`; PRD-117 remains open because the repaired round is a
replay/rearchive, not an independent fresh uninformed build.

## Supersession

Round 6's `Vanilla (estimate): 58/100` is superseded by these executed archive measurements. It
must not be reused as a quality score: round 7 has measured cost and failed proof outcomes, but no
fair functional or fresh visual comparison.

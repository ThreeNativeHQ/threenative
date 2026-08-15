# Improvement round ledger — contract replay — 2026-08-15

| Genre | Historical archive | Repaired archive | Superseded proof SHA-256 | Current proof SHA-256 | Positive direct rows | Negative direct rows |
| --- | --- | --- | --- | --- | --- | --- |
| physics-puzzle | `docs/benchmark/sweeps/physics-puzzle-2026-08-15-2` | `docs/benchmark/sweeps/physics-puzzle-2026-08-15-4` | `a778a22b8b311d427343970008f9d22ffb3a1e2fb59043ca2bcbb998ca16d36f` | `33c3acb029096205e3e04cc22afdd736575998b8a41ab3208888071ede654ab8` | 1/6 diagnostic replay | 2/6 diagnostic replay |

The current physics brief SHA-256 is
`d950471f7bfc7e68778711ff44438f55022b769b9ffa0d26776252c8414d5935`.
The committed `-4` and `-5` manifests still carry the superseded `a778…` proof hash, so both
committed replay commands stop at the hash gate with exit `1`. No archive was edited in this
lane.

For behavior discrimination only, manifest-only diagnostic copies of those committed archives
were resealed to `33c3…`; both reached assertions and returned exit `1`. The six direct rows are
movement, blocking contact, pass-through, goal contact, settled bodies, and terminal state after
contact. The positive archive passed only blocking contact; the gutted archive passed movement
and blocking contact. These are failure observations, not positive claims.

All pre-change functional numbers remain historical and explicitly non-comparable with this
contract. The six-genre resource-id/path audit and its red controls remain intact.
The paired round was subsequently recorded in `docs/verification/round-7-2026-08-15.md`.

## Notes

- This ledger is the contract-replay record consumed by `pnpm round:deletions`; the paired round
  carries the current stop condition and deletion disposition.

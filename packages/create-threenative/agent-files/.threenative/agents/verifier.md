# ThreeNative verifier

This is the canonical verifier contract for a generated ThreeNative project. It is explicitly
read-only: inspect and run evidence without editing the consumer tree. The root `AGENTS.md`
remains the authoritative framework contract; this file defines independent verification and its
terminal outcomes.

## Read-only verification

- Inspect the requested player-visible outcome, the diff, the claimed evidence, and the relevant
  acceptance test.
- Rerun the narrowest meaningful typecheck, build, or playtest. Record the exact command and
  result.
- Try one negative control or adversarial path when practical.
- Distinguish behavioural proof from screenshot or other presentation evidence.
- Identify the exact failing gate, missing observation, or evidence path. Never repair the result.

Do not edit, write, delete, reset, commit, or otherwise mutate the project. If a gate would write
outputs, use its disposable output location or report that the observation was unavailable. A
missing observation is not evidence of success.

## Terminal outcomes

Return exactly one of these three outcomes with exact evidence:

- `PASS` — the requested outcome and its meaningful evidence were observed.
- `REQUEST_CHANGES` — a gate or adversarial check disproved the claim.
- `NOT_OBSERVED` — the required observation could not be made or the evidence is insufficient.

A seeded-red gate must produce `REQUEST_CHANGES` or `NOT_OBSERVED`, never `PASS`. The verifier
must not edit or certify release readiness; it reports findings for the builder.

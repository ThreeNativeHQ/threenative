# Gauntlet charter — ThreeNative self-improvement round 2

## Goal

Run a third-genre exploration brief through isolated framework and vanilla builders, then
turn only evidence-backed cross-genre savings into the smallest justified framework or
user-space change. The long-term bar remains a 50% framework/vanilla user-LOC ratio.

## Constraints

- Keep Godot/Three.js vocabulary and the existing package count.
- Do not move materials, lighting, camera framing, or post-processing into a package.
- Do not weaken sealed benchmark assertions or claim a WebGPU capture result from a WebGL run.
- Builders work in separate sandboxes and never see the other arm, sealed proofs, or ledger.
- The lead agent does not write game code; a fresh read-only critic judges the images.

## Quality bar

The framework arm must match or exceed the vanilla arm on sealed functional proof, blind
visual score, and user source LOC. Reach rate is recorded but never gated. Every claim needs
an archived proof, guarded capture, pair report, and fresh blind critic output. Any proposed
framework reduction must be reusable across genres, save more than 20 caller lines, and leave
materials, lighting, camera framing, post-processing, and gameplay policy in user source.

## Baseline evidence

- Frozen Abyss control: framework 402 normalized LOC versus vanilla 473 (85.0%); the target is
  237 LOC or lower.
- The arm census classifies framework look plus game code alone at 301 LOC, so no honest
  reduction may hide those 301 lines in a package.
- Existing platformer pair: framework 726 LOC versus vanilla 769 (94.4%), both sealed proofs
  pass, framework wins the blind visual comparison.
- Existing top-down action pair: framework 1606 LOC versus vanilla 1620 (99.1%), both sealed
  proofs pass, and both visual loops are readable.
- This round must use fresh exploration builder contexts; prior archives are comparison data.

## Evidence method

1. `pnpm sweep:proof <framework-archive>` and `pnpm sweep:proof <vanilla-archive>`.
2. `pnpm sweep:capture <archive>` for both archives under headed/Xvfb WebGPU flags.
3. Fresh blind critic plus `pnpm sweep:judge <bundle> --input <critic.json>`.
4. `pnpm sweep:pair <framework-archive> <vanilla-archive>` and the round ledger.
5. `pnpm typecheck && pnpm lint && pnpm test && pnpm budgets`.

## Budget and termination

No bounded user budget was stated. Continue until the acceptance evidence is green, a
verified environment blocker prevents it, or a fresh critic finds that the abstraction does
not improve the bar. Do not invent a fixed round count.

# Gauntlet charter — ThreeNative self-improvement round 1

## Goal

Run the same platformer brief through isolated framework and vanilla builders, then turn
every evidence-backed vanilla win into the smallest justified framework or user-space
change.

## Constraints

- Keep Godot/Three.js vocabulary and the existing package count.
- Do not move materials, lighting, camera framing, or post-processing into a package.
- Do not weaken sealed benchmark assertions or claim a WebGPU capture result from a WebGL run.
- Builders work in separate sandboxes and never see the other arm, sealed proofs, or ledger.
- The lead agent does not write game code; a fresh read-only critic judges the images.

## Quality bar

The framework arm must match or exceed the vanilla arm on sealed functional proof, blind
visual score, and user source LOC. Reach rate is recorded but never gated. Every claim needs
an archived proof, guarded capture, pair report, and fresh blind critic output.

## Baseline evidence

- Existing archived platformer baseline: framework and vanilla both pass 2/2 sealed scenarios;
  framework uses 1,073 user LOC and vanilla uses 176.
- The headed capture guard accepts four non-blank frames for each archived arm.
- Fresh blind instrument result: vanilla sample playability 4 / visuals 3; framework sample
  playability 3 / visuals 4. The framework wins the visual signal; vanilla wins playability.
- The pair is baseline evidence only; this round must use two fresh builder contexts.

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

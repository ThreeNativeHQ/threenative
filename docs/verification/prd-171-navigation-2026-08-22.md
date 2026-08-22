# PRD-171 — navigation single-compute and motion-gated crowd sync

Date: 2026-08-22. Machine lanes: vitest (node), one browser playtest attempt.

## What changed

- `NavigationAgent3D.setTargetPosition` computes `computePath` exactly once per retarget and
  derives both the stored path and reachability from that result. Same-poly targets keep their
  end-point judgment; cross-poly targets keep the final-waypoint judgment — each rule preserved
  from the double-compute version it replaced.
- `isTargetReachable(position?)` keeps its standalone contract unchanged.
- `syncCrowd()` on agent and obstacle teleports only when the object moved since the last sync
  (NaN-initialized scalars make the first sync localise). **Teleport drops the crowd agent's move
  state**, so a mover re-sends its target in the same sync — the pair is atomic, which the old
  every-frame version achieved by doing both unconditionally. Stationary agents/obstacles now pay
  zero boundary calls per frame.

## Negative controls (observed red before the fix)

| Mutation | Result |
|---|---|
| double compute restored | `computes the path once per retarget` failed: spy counted 2 |
| unconditional sync restored | `crowd sync leaves a stationary agent alone...` failed: teleports grew while stationary |

Both live in `packages/physics/__tests__/navigation-agent.spec.ts`.

## Gates

- `pnpm exec tsc --noEmit -p packages/physics` — clean.
- `pnpm exec vitest run --config vitest.config.ts packages/physics` — **138 passed / 138**,
  including the crowd-separation test (`should keep two agents from occupying the same point`),
  which first caught the non-atomic teleport/target pair above and was the reason the re-request
  rides along with every teleport.

## Browser regression row — recorded UNVERIFIED-PREEXISTING

`examples/abyss-framework/playtests/navigation.playtest.json` fails on this machine **identically
with and without this change** (verified by stashing `packages/physics/src/navigation` and
rerunning): `navigator` accumulates path length 0.000000 against a required 9, plus WebGPU
`OperationError: Instance dropped in popErrorScope` console noise. The identical red at HEAD means
this work neither caused nor worsens it; root-causing it is separate work. One environment note
for whoever reruns it: vite v8 here binds `::1` only, so the server command needs
`--host 127.0.0.1` for the runner's probe to connect — without it the run dies earlier as
`TN_PLAYTEST_SERVER_FAILED`.

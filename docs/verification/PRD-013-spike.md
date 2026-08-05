# PRD-013 one-way collision spike

Date: 2026-08-04

## Question

Can Rapier's character controller receive a rider-side, per-tick filter without
leaving a stale filter on the next tick or changing the Godot vocabulary?

## Result

PASS. Keep Phase 4.

The installed `@dimforge/rapier3d-compat` version is `0.19.3`. Its
`computeColliderMovement` call accepts both `filterGroups` and `filterPredicate`.
`CharacterBody3D.step()` supplies those values only while `velocity.y > 0` and
supplies `undefined` for both values on the next normal/downward tick. The public
option remains `oneWayGroups`, matching the PRD's borrowed Godot concept.

## Evidence

| Check | Result |
| --- | --- |
| `pnpm vitest run packages/physics/__tests__/character.spec.ts` | PASS — one-way rider lands above the platform and the next tick collides normally |
| Generated `oneway.playtest.json` | PASS — `peakRise` exceeded `1.5` and upward movement delta was `2.13` |
| Negative control: template character `oneWayGroups: 0` | RED — `peakRise` stopped at `0.79`; the `+y` movement assertion failed |

The filter is therefore driven from the rider for the narrow per-tick query
operation, while platform authors still opt into the behavior through the
platform's collision-group bit.

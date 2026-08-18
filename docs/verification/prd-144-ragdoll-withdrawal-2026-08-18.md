# PRD-144 withdrawal — 2026-08-18

PRD-143 landed first and its hinged-door behavior passed through the integrated desktop target.
The PRD-144 kill switch then compared the same five-bone chain in two forms, using the repository
Biome normalizer:

| Version | Raw non-empty lines | Normalised lines |
|---|---:|---:|
| Hand-rolled `Joint3D` + `RigidBody3D` | 39 | 43 |
| Proposed `PhysicalBone3D` + `PhysicalBoneSimulator3D` usage | 18 | 46 |

The class-shaped usage was three normalized lines larger, so the proposed abstraction was
withdrawn. No ragdoll classes, playtest, or new framework package were added. A game that needs a
ragdoll can compose the shipped physics primitives and keep its own bone selection, masses, limits,
and death impulse.

Evidence:

- `pnpm tsx scripts/count-loc.ts` — exit 0; existing platformer template total: 1,559 LOC.
- `pnpm tsx examples/native-smoke/.tmp-prd144-loc.ts` — hand-rolled `43`, class-shaped `46`.
- Temporary comparison sources were removed after measurement.

The PRD is archived at [`PRD-144-ragdoll.md`](../PRDs/done/PRD-144-ragdoll.md).

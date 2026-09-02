# PRD-315 Phase 5 — the animals face travel and route around water

**Where**: the coordinator's worktree of the sandbox, `sandbox-prd315/wildwood` on branch
`prd315-coordinator` at `2204041`, on engine `main` `072fee0b` (core tarball `main3-03a9f51d0240`,
playtest `main2-cd2e1f7abc39`, assets `main-3ae23b50fee7`, CLI `main-716908753e7a`). The other
lane still owns `sandbox/wildwood`; this branch merges into it when that lane is idle.

**Scenario**: `playtests/animals-navigation.playtest.json`, 4,500 ticks (75 simulated seconds):
detail tier, wander, a walk toward the fox to trigger a flee, settle, wander again — in short
wait steps so the asynchronous detail tier is not starved by the tick loop. Browser WebGPU on
`nvidia | turing` under the private display, `?lowtier&spawn=22,6,-0.8`, engine runner.

## Green run

```text
pass true  frames 4500
ok  animalsNavigating        5 -> 5     every ground animal has an agent on the land region
ok  animalsForwardSamples    2062 -> 11737
ok  animalsForwardAgreement  1.0 -> 1.0  (dot(model forward, displacement) >= 0.9 on every moving frame)
ok  animalsWaterOverlaps     0 -> 0
ok  animalsTargetsReached    3 -> 19
ok  diagnostics              0 console errors, 0 network errors, runtime ready
TN_NAV_REGION_BAKED triangles=62065 of 72200
```

## What it took, in order

1. `TN_ANIMALS_SPAWN_START` with no `TN_ANIMALS_LIVE` inside the run: 4,500 ticks stepped as fast
   as the machine allows starved the asynchronous GLB loads. Sixteen 90-tick waits instead of one
   600-tick wait let the detail tier land.
2. `[animals] wolf idle: MISSING (ANIM_Fox_IdleBreathe)` and the same for every doe semantic: the
   wolf and doe specs spread the fox's and the stag's clip names, which those GLBs do not carry.
   Spelled out with their own prefixes.
3. `TN_ANIMALS_WATER:stag state=flee at 32.4,5.7 target=42.6,-1.9`: 30 wet frames. The straight
   line to a reachable target crosses an 18 cm-deep strip of the pond's basin; a stag at 12 m/s
   with a 6 rad/s steer has a two-metre turning radius and cut the shore corner the path went
   around. Shore margin 0.45 m → 0.9 m of height (a few metres of dry band on that basin) and a
   10 rad/s bolt steer: 0 wet frames on the next two runs.
4. `animalsTargetsReached` was already 3 at the first snapshot (the animals wander from spawn), so
   the floor is 10 with a triviality reason and `changed` proves arrivals during the run.

## Negative controls

Recorded in `## Controls` below when the background runs finish; the rows the PRD asks for are a
180° fox (forward agreement must fail) and no navmesh (water overlaps must fail).

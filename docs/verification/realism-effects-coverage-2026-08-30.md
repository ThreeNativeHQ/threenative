# Realism effects coverage — 2026-08-30

The source inventory is the 14-name `realism-effects` export set. The coverage validator found 13
covered equivalents and one explicit exclusion. A covered row names its upstream or template source
and its capability-manifest situation; the exclusion names a dated evidence record.

| `realism-effects` export | Equivalent here | Where it comes from |
| --- | --- | --- |
| `SSGIEffect` | `SSGINode` | `three/examples/jsm/tsl/display/SSGINode.js` |
| `SSREffect` | `SSRNode` | `three/examples/jsm/tsl/display/SSRNode.js` |
| `TRAAEffect` | `TRAANode` | `three/examples/jsm/tsl/display/TRAANode.js` |
| `TemporalReprojectPass` | `TemporalReprojectNode` | `three/examples/jsm/tsl/display/TemporalReprojectNode.js` |
| `PoissonDenoisePass` | `DenoiseNode`, `RecurrentDenoiseNode` | `three/examples/jsm/tsl/display` |
| `MotionBlurEffect` | `motionBlur` | `three/examples/jsm/tsl/display/MotionBlur.js` |
| `SharpnessEffect` | `SharpenNode` | `three/examples/jsm/tsl/display/SharpenNode.js` |
| `VelocityPass` | `velocity`, `VelocityNode` | `three/src/nodes/accessors/VelocityNode.js` |
| `VelocityDepthNormalPass` | `mrt`, `depth`, `normal` | `three/src/nodes` |
| `TAAPass` | `SSAAPassNode`, `TRAANode` | `three/examples/jsm/tsl/display` |
| `HBAOEffect` | not covered | No pinned HBAO implementation is available for the required blind GTAO comparison. |
| `LensDistortionEffect` | `lensDistortion` | `packages/create-threenative/templates/starter/src/render/effects/lensDistortion.ts` |
| `SparkleEffect` | `sparkle` | `packages/create-threenative/templates/starter/src/render/effects/sparkle.ts` |
| `GradualBackgroundEffect` | `gradualBackground` | `packages/create-threenative/templates/starter/src/render/effects/gradualBackground.ts` |

Validation evidence:

```text
pnpm exec tsx -e '...validateRealismEffectsCoverage(...)'
validation=[]
pnpm exec tsx scripts/build-capability-manifest.ts
capability manifest generated: 190 entries
```

`HBAOEffect` is not counted as a platform row. Its dated decision and required follow-up are in
[`realism-effects-ao-2026-08-30.md`](realism-effects-ao-2026-08-30.md).

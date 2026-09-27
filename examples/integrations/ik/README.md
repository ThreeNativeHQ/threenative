# Constrained skeletal animation

An opt-in adapter using actual `closed-chain-ik/core`; no URDF, workers, renderer or second animation loop.

```sh
cd examples/integrations/ik
npm install --ignore-scripts
npm test
```

```ts
const ik = new ConstrainedIK({
  root: shoulder,
  joints: [{bone: shoulder, axes: ['x','y','z'], min: [-1,-1,-1], max: [1,1,1]}],
  effectors: [{bone: hand}], iterations: 32,
  positionTolerance: 0.005, rotationTolerance: 0.01,
});
// After the existing animation update:
const report = ik.update([{position: grip.getWorldPosition(scratch).toArray()}]);
ik.dispose(); // scene teardown
```

Targets are world-space metres and optional quaternions. Limits are offsets relative to the authored pose supplied this frame, not absolute anatomical limits. Reapply the animation pose before solving to prevent unintended accumulation. Direct Bone hierarchies with positive uniform scales are admitted; shear, reflections, singular transforms, malformed targets and mismatched orientation contracts fail explicitly. No bone translation/root-motion controller is installed. Solver failures restore the original pose. Reports measure the actual post-blend residual even for blend=0 and unreachable targets.

## Supported transforms and limits

- Direct `Bone` hierarchies under any rigid or positive-uniform-scale parent. Shear, reflection, non-uniform or singular scale throws before the pose is touched.
- Rotational joints only: each joint has ordered `x`/`y`/`z` offsets, limited relative to the animation pose supplied this call. The solver never translates a bone, so bone lengths hold (measured drift under 1e-15 m).
- Position and optional orientation goals per effector; a goal's quaternion must match its effector's `orientation` contract.
- Iterations 1-128. Unreachable goals return finite residuals and `converged: false`; they never throw.
- A donor DoF that starts exactly on its limit stays locked; author the rest pose inside the limits.
- CPU cost: about 0.25 ms per solve for a 9-bone, two-effector loop on a desktop CPU; Three's CCD is about 14 µs, but it has no orientation goal.

## Admission evidence

`tests/admission.test.mjs` holds a closed loop: both hands on one rigid rifle, sharing the spine and chest, swept over 20 aim frames. With 32 iterations for every arm, 5 mm / 0.01 rad tolerances:

| arm | worst hand error | worst hand rotation | median solve |
| --- | --- | --- | --- |
| closed-chain-ik (this adapter) | 1.6 mm | 0.0094 rad | ~250 µs |
| Three CCD, two chains sharing spine/chest | 15 mm | 1.05 rad | 14 µs |
| `attachToBone`-style rifle on the right hand + CCD left hand | 209 mm | 0.56 rad | 3 µs |

Only the adapter meets both tolerances on every frame; the test fails if a baseline ever does.

## Dependency audit

The donor is pinned to commit 38a7e273082311e69c84c35a7c8f64e510e188a5 (Apache-2.0) and locked in `package-lock.json`. `closed-chain-ik/core` imports only gl-matrix 3.4.4, linear-solve 1.2.1 and svd-js 1.1.1 (all MIT). npm also installs the donor's peer `urdf-loader` 0.13.1 (Apache-2.0), but the core subpath never imports it and no built bundle contains it. No demo code or assets were copied. The tests need Node 22.16 or later for `--experimental-strip-types`.

Ordinary games do not import this example. `examples/constrained-ik` is the running game that proves it on web, desktop native and Android.

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

The donor is pinned to inspected source commit 38a7e273082311e69c84c35a7c8f64e510e188a5, whose core export exists. The executable integration suite invokes the real donor and Three CCD baseline. A genuinely coupled mechanical fixture and comparative performance admission remain open.

Executed locally: 9 numerical contract tests passed after the failing baseline; the dependency-free module passes strict TypeScript 5.8.3. Real donor tests and the full dependency-backed build are not claimed: downloads are unavailable in the sandbox. The dedicated Integration ik workflow runs the default build and both suites; GPU/native/mobile proof remains separate. Keep draft, generate/review the lockfile and test inside the framework's patched runtime before admission.

The donor retains Apache-2.0 and Three retains MIT notices as dependencies. No demo code or assets were copied. Ordinary games do not import this example.

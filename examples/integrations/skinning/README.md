# Experimental WebGPU animated instances

Selective per-instance bone palettes and stable slot/history management, not an InstancedMesh2 WebGL transplant. No renderer patch, core dependency, Three upgrade or extra frame loop.

```sh
cd examples/integrations/skinning
npm install --ignore-scripts
npm test
```

```ts
const crowd = new AnimatedInstances({
  source: skinnedMesh, material: gameOwnedNodeMaterial, capacity: 128,
  byteBudget: 32 * 1024 * 1024,
  maxStorageBufferBindingSize: device.limits.maxStorageBufferBindingSize,
});
const handle = crowd.add(skinnedMesh, instanceTransform);
scene.add(crowd.mesh);
// After existing animation updates, before all passes:
crowd.setPose(handle, skinnedMesh);
crowd.setTransform(handle, instanceTransform);
crowd.prepare(renderFrameId);
```

Instances share geometry/bone ordering but snapshot independent poses. Bone matrices are normalized through the skin bind transform. Generation-tagged handles reject stale writes. Previous-frame history follows logical slots, not compact draw indices; new instances do not inherit old motion. All passes for a frame share one idempotent snapshot. CPU storage and actual GPU binding limits are bounded. Finite values that overflow Float32 fail before writes.

The shader uses Mesh plus InstancedBufferGeometry and TSL storage nodes, avoiding a second InstancedMesh transform. It supplies previous deformed positions for temporal consumers. On-demand CPU raycasting reports logical instance ids plus generations. It does not CPU-deform geometry every frame.

Deliberate limits: all instances are submitted to every pass (no camera-specific culling); one supplied node material; no morphs, tangents, nonuniform/reflected/sheared transforms or pre-existing deformation. Actual shader compilation, shadow/velocity correctness, driver limits, GPU resource release and native behavior remain qualification gates. No performance improvement is claimed. The PRD's paired benchmark is required before core adoption.

Executed locally: 13 CPU palette/reference tests, including an observed failing Float32-overflow regression, now pass. The pure module passes strict TypeScript 5.8.3. Real Three/picking tests and full dependency build are written but unrun locally because downloads are unavailable. Integration skinning executes both suites and strict build on PR changes. Generate/review a lockfile and qualify in the actual framework-patched runtime before merging. No upstream demo code/assets are copied; Three.js remains an MIT dependency.

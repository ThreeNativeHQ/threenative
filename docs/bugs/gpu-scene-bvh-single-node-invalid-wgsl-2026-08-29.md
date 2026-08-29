# `GPUSceneBVH` over a small scene generates invalid WGSL — 2026-08-29

**Status:** open, named defect. Found from outside the monorepo, in a sandbox game that installed
the published tarballs, so it is what a user's agent hits.

**Layer:** engine (`packages/core/src/gpu-scene-bvh.ts`) and its documented usage. The game code
that trips it is correct: it is the same shape as
[`examples/prd140-picking/src/render/gpu-scene-bvh.ts`](../../examples/prd140-picking/src/render/gpu-scene-bvh.ts).

**Evidence status: reproduced first-hand**, 2026-08-29, in
`sandbox/mined-features` on `@threenative/core` packed from `646213d9`. Headed Chromium, WebGPU
recipe, hardware adapter.

## What happens

A scene whose traceable meshes are three `PlaneGeometry` quads packs **six triangles**, which the
SAH build resolves to a **single BVH node**. Three.js then emits the `bvh.nodes` storage node as a
pointer to one struct rather than to an array, and the upstream query's signature no longer
matches:

```
THREE.WebGPURenderer: Uncaptured WebGPU GPUValidationError: Error while parsing WGSL:
:321:72 error: type mismatch for argument 3 in call to 'beaconGroundHit',
expected 'ptr<storage, array<BVHNode>, read>', got 'ptr<storage, BVHNode, read>'
  if ( beaconGroundHit( &NodeBuffer_1420.value, &NodeBuffer_1423.value, &NodeBuffer_1421, nodeVar1 ) ) {
                                                                        ^^^^^^^^^^^^^^^^
```

The fragment shader module is then invalid, so the render pipeline, the command buffer and the
queue submit all fail in cascade — nine console errors per frame from one cause. Note the two
sibling arguments **do** get `.value`; only the node buffer does not.

Replacing the three planes with three `BoxGeometry` posts takes the pack to 36 triangles, the tree
to more than one node, and the shader compiles. Nothing else changed.

## Why it is worth a filing

The failure names neither `GPUSceneBVH` nor the real cause. An agent reading it sees a WGSL type
error inside its own `wgslFn`, and the obvious next move — simplify the scene until it works — is
exactly backwards, because simplifying makes the tree smaller. The in-repo example never hits it:
its proof scene is two glTF nodes plus a two-material `InstancedMesh`, comfortably above the
threshold, so the boundary is invisible from inside this repository.

`triangleCount` and `objectCount` are already public, so the class can see the condition it is
about to generate a broken shader for.

## Second sharp edge in the same class, same session

`GPUSceneBVH` packs **world-space** triangles, but at scene-build time nothing has rendered yet, so
world matrices are still stale. Without an explicit `ctx.scene.updateMatrixWorld(true)` before
construction, every selected mesh packs at its unparented local position: the snapshot is silently
wrong, `triangleCount` is correct, and no error is raised anywhere. The only symptom is a ray query
that misses everything.

Both edges are documented in the sandbox game's `brief.md`, but a game should not have to learn
them by losing an afternoon.

## Suggested dispositions, not a repair commitment

1. Fail closed, or warn once, when a snapshot packs to a single BVH node — the constructor already
   knows `triangleCount`.
2. Call `updateMatrixWorld` on the selected subtrees inside `rebuild()`/construction, or state the
   requirement in the class's `@constraint` so it reaches `capabilities.json`.

# ThreeNative integration notes

## What can move into ThreeNative unchanged

The following modules contain no browser or Three.js dependency and can be placed in an engine package immediately:

- `src/core/PhysicalPagePool.js`
- `src/core/DirectionalClipmap.js`
- `src/core/ReceiverDemandPass.js`
- `src/core/ShadowInvalidationTracker.js`

They define stable virtual page addresses, clip windows, physical residency, LRU eviction, page demand, and selective invalidation.

## Renderer service boundary

`src/render/VirtualShadowMap.js` is a renderer service adapter around upstream Three.js public APIs. It owns the physical depth atlas, page-table texture, page camera, update scheduling, render budget, and diagnostics. It does not patch Three.js and does not read a built-in directional shadow texture.

A ThreeNative service wrapper can expose this shape:

```ts
interface DirectionalVirtualShadowService {
  trackCaster(object: THREE.Object3D): string;
  untrackCaster(objectOrId: THREE.Object3D | string): boolean;
  update(frame: number): VirtualShadowStats;
  invalidateAll(): number;
  setDebugMode(mode: 'normal' | 'pages' | 'shadow' | 'residency'): void;
  dispose(): void;
}
```

Generated scene code creates materials through `createVirtualShadowMaterial()` or through a later ThreeNative material hook that injects the same uniforms and lookup functions into standard materials.

## WebGPU upgrade path

The current sandbox renderer targets WebGL2 because that is the deterministic browser backend available for screenshot validation. The production WebGPU path should replace only receiver demand and, optionally, page-table updates:

1. Render or reuse the camera depth buffer.
2. Dispatch a compute pass that reconstructs visible world positions.
3. Atomically mark virtual pages in a demand bitset.
4. Compact marked pages into the request list.
5. Feed those addresses into the existing `PhysicalPagePool` and invalidation flow.
6. Render dirty physical pages and sample them through the same virtual addressing contract.

The page key format, clipmap snapping, LRU policy, dirty state, render budget, hierarchical fallback, and diagnostics remain portable.

## Current limitations

This is a directional-light vertical slice, not a complete reproduction of every Unreal Engine VSM optimization. It uses CPU screen-space ground rays plus visible bounds for demand instead of a GPU depth/compute pass. Point lights, spot lights, Nanite cluster binning, SMRT, and static/dynamic dual caches are intentionally deferred.

The included offline proof uses Three.js r160. The implementation is built on stable public WebGLRenderer, WebGLRenderTarget, DataTexture, OrthographicCamera, and ShaderMaterial APIs; validate against ThreeNative's pinned Three.js revision before merging.

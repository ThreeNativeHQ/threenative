# Three.js Virtual Shadow Map Vertical Slice — Design

**Status:** Approved by the implementation request on 2026-09-01.

## Goal

Build a runnable Three.js prototype for ThreeNative that demonstrates the core mechanism behind Unreal Engine Virtual Shadow Maps: camera-centered directional-light clipmaps, fixed-size virtual pages, a bounded physical page atlas, cache reuse, selective invalidation, and hierarchical fallback.

This project deliberately does **not** relabel Three.js Variance Shadow Mapping or ordinary cascaded shadow maps as Unreal VSM. It implements real virtual-to-physical page indirection and renders only resident pages.

## Honest scope

The sandbox vertical slice targets WebGL2 through upstream Three.js so it can run in the available Chromium sandbox and remain easy to port into ThreeNative. Page demand is generated from screen-space receiver rays plus visible caster/receiver bounds on the CPU. Unreal's production implementation uses a GPU depth-buffer/compute marking path; that later backend can replace demand generation without replacing the page cache, page table, atlas, invalidation, or sampling interfaces built here.

Included:

- One directional light.
- Four camera-centered clip levels.
- Eight by eight virtual pages per clip level.
- 128 by 128 texels per virtual page.
- A bounded 12 by 12 physical-page atlas.
- Light-space page snapping.
- Deterministic LRU allocation and eviction.
- Pinned coarse fallback pages.
- Per-page dirty state and render budget.
- World-bounds-to-page selective invalidation.
- GPU page-table texture and atlas sampling.
- Three-by-three PCF that safely crosses virtual page boundaries.
- Coarser-level fallback when a requested page is absent.
- Normal and depth bias controls.
- Runtime statistics and page/clip debug visualization.
- Side-by-side comparison with a conventional single Three.js shadow map.
- Standalone HTML build, automated screenshots, and runtime proof JSON.

Deferred:

- GPU depth-prepass page marking.
- Point and spot lights.
- Nanite-cluster caster binning.
- Static/dynamic dual page caches.
- SMRT ray sampling and production contact hardening.
- WebGPU/TSL-specific node integration.

## Architecture

### Core modules

`PhysicalPagePool` owns a fixed number of atlas slots. A page key is `<clipLevel>:<absolutePageX>:<absolutePageY>`. Allocation reuses resident pages and otherwise consumes a free slot or evicts the least-recently-used unpinned page that is not protected during the current frame.

`DirectionalClipmap` converts world points and bounds into light-space virtual page addresses. Clip windows are centered on the active camera and snapped to whole page increments, so sub-page camera motion does not remap every page.

`ReceiverDemandPass` samples rays across the camera viewport, intersects the scene receiver plane, adds visible object bounds, and emits prioritized page requests. The coarsest active clip window is pinned as a guaranteed fallback.

`ShadowInvalidationTracker` compares tracked caster world bounds between frames. It invalidates only pages overlapped by the previous and current bounds. A light-direction change invalidates all resident pages.

### GPU resources

`VirtualShadowMap` owns:

- One RGBA shadow atlas render target sized `pageSize * atlasPagesPerAxis`.
- One RGBA unsigned-byte `DataTexture` page table sized `(virtualPagesPerAxis²) × clipLevels`.
- One orthographic light camera reused for each rendered page.
- One packed-depth override material.
- Shared uniforms consumed by every `VirtualShadowMaterial`.

The page-table entry stores physical slot X, physical slot Y, valid, and dirty/debug state. Current clip-window minima are uniforms; the shader converts an absolute light-space page coordinate to a page-table texel.

### Sampling

The fragment shader:

1. Chooses a clip level from camera-relative light-space distance.
2. Computes the absolute virtual page for the receiver.
3. Fetches that page's physical atlas slot.
4. Falls back through coarser levels when the page is absent.
5. Compares packed atlas depth with receiver light depth.
6. Applies a 3×3 PCF kernel. Every tap recomputes its virtual address, so filtering across a page edge samples the neighboring virtual page instead of leaking into an unrelated physical slot.

### Demo and proof

The comparison page renders the same long architectural avenue twice:

- Left: one conventional 1024×1024 PCF soft directional shadow map.
- Right: the virtual page system.

The debug page overlays clip level, virtual-page boundaries, physical atlas residency, and statistics. The invalidation page moves one tracked caster and records the number of pages dirtied and rerendered.

## Public API

```js
const vsm = new VirtualShadowMap(THREE, renderer, scene, {
  camera,
  lightDirection: new THREE.Vector3(0.55, 1.0, 0.35).normalize(),
  pageSize: 128,
  virtualPagesPerAxis: 8,
  atlasPagesPerAxis: 12,
  clipExtents: [18, 42, 90, 180],
  renderBudget: 24,
});

vsm.trackCaster(mesh);
vsm.update(frameNumber);
mesh.material = createVirtualShadowMaterial(THREE, vsm.uniforms, options);
```

The class does not fork or patch Three.js. ThreeNative can expose it as an optional renderer service and swap only the demand backend for WebGPU later.

## Failure behavior

- Atlas exhaustion evicts only unpinned, unprotected LRU pages.
- If no slot is evictable, the page request is skipped and `overflow` increases.
- Missing fine pages sample the first valid coarser level.
- Missing all levels returns lit rather than corrupting unrelated atlas data.
- Unsupported WebGL2 produces an explicit runtime error.

## Verification

Automated unit tests cover page allocation, LRU behavior, clip snapping, page addressing, demand stability, coarse pinning, and selective invalidation. Source-contract tests require a packed-depth atlas, page-table texture, scissor-page rendering, hierarchical shader fallback, and runtime proof marker.

Runtime capture must report no console or page errors, nonzero requested/resident/rendered pages, a valid page table, a bounded atlas, and cache reuse after warm-up. Screenshots must visibly contain cast shadows in both near and far sections of the virtual-shadow scene.

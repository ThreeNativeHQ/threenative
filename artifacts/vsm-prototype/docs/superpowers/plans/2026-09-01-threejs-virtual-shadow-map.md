# Three.js Virtual Shadow Map Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Build and prove a runnable Unreal-inspired virtualized directional shadow-map vertical slice for Three.js and ThreeNative.

**Architecture:** Pure deterministic core modules calculate clipmap addresses, demand, residency, and invalidation. A Three.js WebGL2 renderer layer maps those virtual pages into a packed-depth atlas and exposes a page-table texture sampled by a custom lit material with page-safe PCF and coarse fallback. A deterministic comparison/demo shell produces runtime proof and screenshots.

**Tech Stack:** JavaScript ES modules, Node.js built-in test runner, Three.js r160 vendored for offline sandbox rendering, WebGL2/GLSL 3, Python Playwright capture through Chromium/Xvfb.

**Spec:** `docs/superpowers/specs/2026-09-01-threejs-virtual-shadow-map-design.md`

**Status:** Implemented and verified in the sandbox.

## Global Constraints

- Directional light only for this vertical slice.
- Exactly 128×128 texels per virtual page in the default profile.
- Default virtual layout is 8×8 pages for each of four clip levels.
- Default physical atlas is bounded to 12×12 pages.
- No Three.js source fork or renderer monkey patch.
- Missing fine pages must fall back to a resident coarser clip level.
- Filtering taps crossing a page boundary must perform a new virtual-page lookup.
- Page demand is CPU receiver sampling in this WebGL2 prototype; do not claim GPU depth-buffer request parity with Unreal.
- Runtime proof must expose requested, resident, rendered, cached, invalidated, evicted, overflow, reuse ratio, and atlas/page dimensions.

---

### Task 1: Deterministic physical page residency

**Files:**
- Create: `package.json`
- Create: `src/core/PhysicalPagePool.js`
- Test: `test/physical-page-pool.test.js`

**Interfaces:**
- Produces: `PhysicalPagePool`, `makePageKey(level, x, y)`, `parsePageKey(key)`.
- `PhysicalPagePool.allocate(key, { frame, pinned, protectedKeys })` returns `{ entry, reused, evictedKey }` or `null`.
- `PhysicalPagePool.markDirty(key)`, `markAllDirty()`, `touch(key, frame)`, `release(key)`, `entries()`.

- [x] **Step 1: Add the package test command and write failing pool tests**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { PhysicalPagePool, makePageKey } from '../src/core/PhysicalPagePool.js';

test('reuses a resident page without allocating a second slot', () => {
  const pool = new PhysicalPagePool({ pagesPerAxis: 2 });
  const key = makePageKey(0, 3, -2);
  const first = pool.allocate(key, { frame: 1 });
  const second = pool.allocate(key, { frame: 2 });
  assert.equal(second.reused, true);
  assert.equal(second.entry.slot, first.entry.slot);
  assert.equal(pool.size, 1);
});

test('evicts the least recently used unpinned unprotected page', () => {
  const pool = new PhysicalPagePool({ pagesPerAxis: 2 });
  const a = makePageKey(0, 0, 0);
  const b = makePageKey(0, 1, 0);
  const c = makePageKey(0, 2, 0);
  const d = makePageKey(0, 3, 0);
  const e = makePageKey(0, 4, 0);
  pool.allocate(a, { frame: 1, pinned: true });
  pool.allocate(b, { frame: 2 });
  pool.allocate(c, { frame: 3 });
  pool.allocate(d, { frame: 4 });
  const result = pool.allocate(e, { frame: 5, protectedKeys: new Set([b]) });
  assert.equal(result.evictedKey, c);
  assert.equal(pool.has(a), true);
  assert.equal(pool.has(b), true);
});
```

- [x] **Step 2: Run the tests and verify import failure**

Run: `node --test test/physical-page-pool.test.js`

Expected: FAIL because `src/core/PhysicalPagePool.js` does not exist.

- [x] **Step 3: Implement the fixed-capacity slot pool**

Implement constructor validation, deterministic slot coordinates, page-key helpers, resident reuse, LRU eviction ordered by `lastUsedFrame` then slot number, pin/protection checks, dirty tracking, and cumulative eviction/overflow counters.

- [x] **Step 4: Run the focused and full tests**

Run: `node --test test/physical-page-pool.test.js && node --test`

Expected: PASS with zero failures.

- [x] **Step 5: Commit**

```bash
git add package.json src/core/PhysicalPagePool.js test/physical-page-pool.test.js
git commit -m "feat: add bounded virtual shadow page pool"
```

### Task 2: Clipmap addressing, snapping, demand, and invalidation

**Files:**
- Create: `src/core/DirectionalClipmap.js`
- Create: `src/core/ReceiverDemandPass.js`
- Create: `src/core/ShadowInvalidationTracker.js`
- Test: `test/directional-clipmap.test.js`
- Test: `test/receiver-demand.test.js`
- Test: `test/shadow-invalidation.test.js`

**Interfaces:**
- Consumes: `makePageKey()` from Task 1.
- Produces: `DirectionalClipmap` with `updateCenter(worldPoint)`, `worldToPage(worldPoint, level)`, `pageBounds(level, x, y)`, `boundsToPageKeys(bounds, level)`, `getWindow(level)`.
- Produces: `ReceiverDemandPass.collect({ camera, receiverPlaneY, visibleBounds, clipmap })` returning sorted `{ key, level, x, y, priority, pinned }[]`.
- Produces: `ShadowInvalidationTracker.update(id, bounds)`, `remove(id)`, and `consumeInvalidatedKeys()`.

- [x] **Step 1: Write failing clipmap tests**

Tests require an orthonormal light basis, stable page keys for camera movement smaller than one page, a remap after crossing a page boundary, and exact page ranges for a light-space rectangle.

- [x] **Step 2: Run clipmap tests and verify failure because the module is missing**

Run: `node --test test/directional-clipmap.test.js`

Expected: FAIL on module resolution.

- [x] **Step 3: Implement dependency-free vector math and directional clipmaps**

Use plain `{x,y,z}` inputs. Build `basisU`, `basisV`, and normalized `basisW` from the supplied light direction. Store each clip center as absolute page coordinates and expose current minimum page coordinates for the GPU table.

- [x] **Step 4: Run clipmap tests until green**

Run: `node --test test/directional-clipmap.test.js`

Expected: PASS.

- [x] **Step 5: Write failing receiver-demand tests**

Use a fake camera adapter exposing `sampleGroundPoints(columns, rows, planeY)` and visible bounds. Assert deduplication, fine-level priority near the camera, neighbor padding, and that every coarsest-window page is marked pinned.

- [x] **Step 6: Implement the deterministic demand collector**

Collect sampled receiver points, camera ground position, and visible-bounds corners. Request a one-page guard band at the selected level. Add all pages in the coarsest current window as pinned fallback requests. Sort by pinned coarse first, then level, priority, X, and Y.

- [x] **Step 7: Write failing invalidation tests**

Track one caster, move its bounds across one virtual-page boundary, and assert that only the union of old/new overlapped keys is returned. Verify no invalidation for unchanged bounds and all tracked coverage after `invalidateAll()`.

- [x] **Step 8: Implement selective bounds invalidation**

Keep an immutable copy of each tracked AABB. Project old and new corners through every clip level and deduplicate keys in a `Set`.

- [x] **Step 9: Run all core tests and commit**

Run: `node --test`

```bash
git add src/core test/directional-clipmap.test.js test/receiver-demand.test.js test/shadow-invalidation.test.js
git commit -m "feat: add directional clipmap demand and invalidation"
```

### Task 3: Virtual depth atlas and shader sampling

**Files:**
- Create: `src/render/VirtualShadowMap.js`
- Create: `src/render/VirtualShadowMaterial.js`
- Test: `test/render-contract.test.js`

**Interfaces:**
- Consumes: every core interface from Tasks 1–2.
- Produces: `VirtualShadowMap(THREE, renderer, scene, options)` with `update(frame)`, `trackCaster(object)`, `invalidateAll()`, `setDebugMode(mode)`, `getStats()`, and `dispose()`.
- Produces: `createVirtualShadowMaterial(THREE, sharedUniforms, options)`.

- [x] **Step 1: Write failing source-contract tests**

Read the source files and require these concrete mechanisms:

```js
assert.match(vsmSource, /new THREE\.WebGLRenderTarget/);
assert.match(vsmSource, /RGBADepthPacking/);
assert.match(vsmSource, /setScissor/);
assert.match(vsmSource, /DataTexture/);
assert.match(materialSource, /texelFetch\s*\(/);
assert.match(materialSource, /unpackRGBAToDepth/);
assert.match(materialSource, /for\s*\(\s*int fallback/);
assert.match(materialSource, /lookupVirtualPage/);
```

Also reject `DirectionalLight.shadow.map` as the virtual system's sampling source and reject `VSMShadowMap` to prevent confusing Three.js Variance Shadow Mapping with virtual pages.

- [x] **Step 2: Run the contract test and verify missing-module failure**

Run: `node --test test/render-contract.test.js`

Expected: FAIL because render modules do not exist.

- [x] **Step 3: Implement `VirtualShadowMap` resource ownership and page rendering**

Create the atlas render target, byte page-table texture, orthographic page camera, packed-depth override material, clipmap/demand/pool instances, shared uniforms, and caster tracking. During `update(frame)`:

1. Snap clip centers from the active camera.
2. Collect requests and protect their keys.
3. Apply pending invalidations to resident entries.
4. Allocate requested pages and count cache hits.
5. Render at most `renderBudget` dirty pages with viewport/scissor set to each physical slot.
6. Restore renderer state exactly.
7. Rebuild current clip-window page-table texels and mark the texture dirty.
8. Publish stable statistics.

- [x] **Step 4: Implement the GLSL 3 virtual-shadow material**

The shader must choose a clip level, perform page-table `texelFetch`, compute atlas UV from physical slot plus local virtual-page UV, unpack depth, compare with bias, loop through coarser levels on miss, and evaluate a 3×3 PCF kernel where every tap calls the virtual lookup again.

- [x] **Step 5: Run all tests and commit**

Run: `node --test`

```bash
git add src/render test/render-contract.test.js
git commit -m "feat: render and sample virtual shadow atlas pages"
```

### Task 4: Deterministic Three.js comparison scene and diagnostics

**Files:**
- Create: `vendor/three.module.js`
- Create: `src/demo/createAvenueScene.js`
- Create: `src/demo/createStockShadowView.js`
- Create: `src/demo/createVirtualShadowView.js`
- Create: `src/demo/boot.js`
- Create: `src/demo/ui.js`
- Create: `index.html`
- Create: `styles.css`
- Test: `test/demo-contract.test.js`

**Interfaces:**
- Produces: `boot(THREE, config)` resolving after both renderers have drawn stable frames.
- Produces browser markers `window.__TN_VSM_READY__`, `window.__TN_VSM_ERROR__`, and `window.__TN_VSM_DEBUG__`.

- [x] **Step 1: Write failing demo-contract tests**

Require two independent render views, a long scene with near and far casters, a conventional 1024² PCF soft map on the comparison side, a virtual-shadow update loop, statistics labels, debug-mode query/config handling, and the three browser markers.

- [x] **Step 2: Verify the demo test fails because files are absent**

Run: `node --test test/demo-contract.test.js`

- [x] **Step 3: Copy the vendored Three.js r160 module and license notice**

Copy the already materialized MIT-licensed module from the offline sandbox dependency. Record the exact revision in `THIRD_PARTY_NOTICES.md`.

- [x] **Step 4: Build one reusable architectural avenue generator**

Create deterministic primitive geometry: a long ground receiver, terraces, stairs, columns, beams, obelisks, trees, boulders, and repeated distant structures. Return caster lists and a named movable caster. Use one geometry/material cache per scene.

- [x] **Step 5: Build the stock and virtual views**

The stock view uses `PCFSoftShadowMap`, one 1024×1024 directional map, and the same camera composition. The virtual view replaces built-in shadows with `VirtualShadowMap` materials and registers all casters.

- [x] **Step 6: Add the comparison/debug UI and deterministic frame loop**

Modes:

- `comparison`: side-by-side stock and virtual output.
- `debug`: full-width virtual output with clip/page color overlay and atlas residency map.
- `invalidation`: move the named caster through a page boundary, then freeze and expose invalidation statistics.

- [x] **Step 7: Run tests and commit**

Run: `node --test`

```bash
git add vendor src/demo index.html styles.css THIRD_PARTY_NOTICES.md test/demo-contract.test.js
git commit -m "feat: add virtual shadow comparison and debug demo"
```

### Task 5: Standalone build, automated runtime proof, and screenshots

**Files:**
- Create: `scripts/build_standalone.py`
- Create: `scripts/capture.py`
- Create: `scripts/verify_runtime.py`
- Create: `THREENATIVE_INTEGRATION.md`
- Modify: `README.md`
- Generate: `standalone.html`
- Generate: `report/comparison.png`
- Generate: `report/virtual-pages-debug.png`
- Generate: `report/cache-invalidation.png`
- Generate: `report/runtime-proof.json`
- Test: `test/build-contract.test.js`

**Interfaces:**
- `python3 scripts/build_standalone.py` emits a self-contained HTML file.
- `python3 scripts/capture.py --mode <mode> --output <path>` launches local Chromium/Xvfb through CDP and stores PNG plus JSON diagnostics.
- `python3 scripts/verify_runtime.py` validates all capture diagnostics.

- [x] **Step 1: Write failing build-contract tests**

Require build/capture commands in `package.json`, embedded Three.js and application modules in the standalone builder, mode/config injection, runtime-marker waiting, browser console/page-error capture, and proof-field validation.

- [x] **Step 2: Run tests and verify failure**

Run: `node --test test/build-contract.test.js`

- [x] **Step 3: Implement the standalone module bundler**

Bundle the vendored Three.js source as a Blob URL. Transform local relative imports into Blob URLs in dependency order, then import `boot.js`. Inline CSS and HTML shell. Preserve source strings for readable browser errors.

- [x] **Step 4: Implement deterministic capture and proof validation**

Reuse the verified Chromium/Xvfb/CDP pattern available in the sandbox. Capture 1600×900 comparison, 1600×900 debug, and 1600×900 invalidation images. Wait for `__TN_VSM_READY__`, reject any runtime error, and write a combined proof JSON.

- [x] **Step 5: Document exact ThreeNative integration boundaries**

Explain the current WebGL2 adapter, shared core modules, renderer service wrapper, generated material hook, and how a future WebGPU demand pass replaces only `ReceiverDemandPass`.

- [x] **Step 6: Build, capture, verify, and commit**

Run:

```bash
node --test
python3 scripts/build_standalone.py
python3 scripts/capture.py --mode comparison --output report/comparison.png
python3 scripts/capture.py --mode debug --output report/virtual-pages-debug.png
python3 scripts/capture.py --mode invalidation --output report/cache-invalidation.png
python3 scripts/verify_runtime.py
```

```bash
git add README.md THREENATIVE_INTEGRATION.md scripts standalone.html report test/build-contract.test.js package.json
git commit -m "test: capture and verify virtual shadow runtime proof"
```

### Task 6: Final verification and release archive

**Files:**
- Generate: `/mnt/data/threenative-virtual-shadow-map.zip`

**Interfaces:**
- Produces a ZIP containing source, tests, docs, standalone demo, proof JSON, and screenshots, excluding `.git` and transient Python caches.

- [x] **Step 1: Run the complete automated test suite**

Run: `node --test`

Expected: all tests pass with zero failures.

- [x] **Step 2: Rebuild and verify runtime proof from a clean generated standalone**

Run: `rm -f standalone.html && python3 scripts/build_standalone.py && python3 scripts/verify_runtime.py`

Expected: all three capture JSON files report no console errors and satisfy proof thresholds.

- [x] **Step 3: Inspect image dimensions and nonblank pixel variance**

Run a Python/Pillow check requiring every PNG to be 1600×900 and to contain substantial luminance variance.

- [x] **Step 4: Check repository status and recent commits**

Run: `git status --short && git log --oneline -6`

Expected: clean working tree and feature commits present.

- [x] **Step 5: Create and test the ZIP archive**

Run:

```bash
cd /mnt/data
rm -f threenative-virtual-shadow-map.zip
zip -qr threenative-virtual-shadow-map.zip threenative-virtual-shadow-map \
  -x 'threenative-virtual-shadow-map/.git/*' \
     'threenative-virtual-shadow-map/__pycache__/*'
unzip -t threenative-virtual-shadow-map.zip
```

Expected: archive integrity check reports no errors.

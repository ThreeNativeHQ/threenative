# PRD-253 Phase 0 residency census — 2026-08-30

## Verdict

**BLOCKED. No product code shipped.** A real authored subject is decisively memory-, triangle- and
hitch-bound in browser WebGPU, so Kill A does not fire. Phase 0 nevertheless requires the same
load-all census on native desktop and that lane did not reach the playtest bridge after three
repair attempts. The PRD cannot proceed or decline until a portable detached consumer supplies the
missing native rows. Kill B and all later phases remain unexecuted.

The detached consumer remains at
`/home/joao/projects/threenative/sandbox-runs/prd253-phase0-20260830/bistro-load-all`.
It is outside this repository and maps upstream mechanisms to the candidate and game-owned rules in
its `README.md`. It typechecks, builds for web, passes its browser playtest, and has an observed
mutation-to-red. It is not archived as a completed sandbox proof because native is still red.

## Pinned primary sources

| Source | Pinned commit | Licence evidence | Inspected mechanism |
| --- | --- | --- | --- |
| `NASA-AMMOS/3DTilesRendererJS` | `870df8656c4d37a57a9eb798cfb326fe14f79f72` | `LICENSE`, Apache-2.0, SHA-256 `12ab00e5637ce70e16be1f6693dfa5f9b7a4fe0f5f976a0329477d0c32d53e86` | `src/core/renderer/utilities/LRUCache.js:21`, `PriorityQueue.js:43`, `TilesRendererBase.js:1560` (`AbortController`), and `tiles/traverseFunctions.js:187,420,477` (screen error and parent-until-children refinement) |
| `zeux/meshoptimizer` v1.1 | `dc9d09ed83e1004aef47a1c3c597e0ec64848a37` | `LICENSE.md`, MIT, SHA-256 `f03037ca7bad1e3eb7f4a63fa6084a8baabd5ba30d3c239a9a7f35705d873e26` | `js/meshopt_simplifier.js:390` exposes `simplifyWithAttributes`; `js/meshopt_clusterizer.js` exposes meshlet construction/bounds; C returns measured error at `src/simplifier.cpp:2621-2639` |
| `zeux/niagara_bistro` | `2bdb6a410f8ebd475d3737e7c8e038ed2b00b02e` | `LICENSE`, MIT | Authored Amazon Lumberyard Bistro derivative used only as detached test content |

The workspace installs `meshoptimizer@1.1.1`. Its package exports both `./simplifier` and
`./clusterizer`; current `packages/assets/src/passes/model.ts` imports only `MeshoptDecoder` and
`MeshoptEncoder`. Phase 2 therefore has reachable JS bindings but no existing ThreeNative caller.

## Subject integrity and preparation

The pinned Bistro graph contains one scene, 6,006 nodes, 551 meshes/primitives, 254 materials,
686 image records, 343 selected textures and 1,753,630 authored triangles. The checkout is 2.3 GB
excluding `.git`; `bistro.gltf` SHA-256 begins `c0972d6c`, and `bistro.bin` begins `5fb11a1d`.

The repository tracks BC7 DDS images but its glTF selects 343 PNG counterparts that are absent.
The detached preparation decoded each selected DDS to a same-path PNG while preserving image
dimensions. Geometry, nodes, materials and texture selection were not rewritten; the original git
checkout remained clean. The resulting selected delivery set is 1,266,447,212 bytes across the
glTF, two buffers and 343 images.

## Browser WebGPU load-all measurement

The passing run used Chromium WebGPU, headed at 1280×720 and resolution scale 1. Capture provenance
named an NVIDIA Turing adapter with the Vulkan WebGPU path. The committed scenario sampled 642
frames and reported no console, network or runtime diagnostics.

| Channel | Load-all result | Measurement note |
| --- | ---: | --- |
| Startup to first interactive frame | 4,854.2 ms | second green run; first run was 6,651.9 ms |
| Decoded resident CPU bytes | 2,339,481,722 | unique geometry array buffers plus decoded RGBA texture pixels |
| Estimated resident GPU bytes | 3,087,422,245 | geometry plus decoded texture pixels with full mip-chain factor; estimate, not driver allocation telemetry |
| Frame p50 | 14.0 ms | consumer rAF/update timestamp series after load |
| Frame p95 | 34.4 ms | same series |
| Hitch max | 822.2 ms | same series; engine logs also showed larger first-compile stalls outside the settled series |
| Network/disk bytes | 1,266,447,212 | exact unique selected resource bytes |
| Visible triangles | 4,371,768 | renderer observation at the fixed camera; exceeds authored count because visible repeated nodes draw shared primitives multiple times |
| Steady draw calls | 745 | direct renderer series after projection settled; startup maximum was 3,238 |

A process sample at 169 seconds observed 1,465,076 KiB RSS in the Chromium renderer and
1,897,692 KiB RSS in its GPU process. It is a point sample, not a high-water mark, so it does not
replace the decoded-resident calculation above.

The screenshot was inspected after copying it to a unique filename to defeat viewer caching. It
shows the Bistro street/building geometry against the game-owned sky; the temporary lighting
overexposes the specular workflow but does not hide the loaded scene.

**Mutation-to-red:** changing only the telemetry assignment from `renderer.info.render.triangles`
to `0` left the renderer's direct 4,371,768-triangle observation intact and failed only
`resource.state.visibleTriangles` with `TN_PLAYTEST_RESOURCE_ASSERTION_FAILED`. Restoring the line
restored the green run.

## Abyss browser control

The existing `examples/abyss-framework/playtests/frame-budget.playtest.json` ran unchanged on the
same named adapter and viewport. It passed with 109 samples: 183,855 triangles, 22 draws and render
p95 2.7 ms. The control has no resident-byte or startup telemetry, so those mandatory channels are
**unavailable**, not zero. Its playtest artifacts are in `artifacts/prd253-control-frame/`.

## Native desktop stop

`pnpm native:build` completed a V8 13.1 + Dawn host at
`packages/runtime-native/build/tn-linux/mystral`. The consumer's portable JS bundle also built, but
the packed consumer path initially lacked a published `prebuilt/linux-x64/threenative-runtime`.
Three repair attempts then stopped under the repository rule:

1. build the in-repo native host after the consumer package reported its missing prebuilt;
2. replace the unsupported scenario-runner `--host-arg` assumption with an executable wrapper;
3. diagnose the remaining bridge-missing result under the supported Xvfb wrapper.

The third probe named the cause:

```text
[error] TN_NATIVE_START_FAILED:File read error: Failed to open file: /bistro/bistro.gltf
```

The doubtful assumption is that browser root-relative asset URLs are portable to the native file
loader. A rerun must use one consumer source path that resolves from both browser and staged-native
roots, then execute all nine channels above on desktop. Until then desktop is **UNVERIFIED**.

## Stale Phase 0 assumptions

The PRD says to extend `scripts/asset-cost-census.ts`, but that file does not exist at baseline
`b453e2a55ba0c8f1dc76096694fdd592f54dde79`. Only the older prose record
`docs/verification/asset-cost-census-2026-08-22.md` remains. Consequently the required
`scripts/__tests__/residency-census.spec.ts` tests were not added around a nonexistent incumbent
instrument. The unblock must either restore that executable with its fail-closed tests or amend the
PRD to name the existing playtest/runtime channels as the canonical census.

## What unblocks Phase 0

1. Make the detached Bistro consumer use one asset URL that loads on browser and staged Linux native.
2. Run the same fail-closed scenario on native desktop and inspect its capture.
3. Measure every control channel or explicitly amend the checkpoint contract before rerunning.
4. Execute the Kill-B portable-code versus framework-code LOC/safety estimate.

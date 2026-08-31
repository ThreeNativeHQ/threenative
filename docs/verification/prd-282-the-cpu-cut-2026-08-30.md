# PRD-282 — the cut is chosen on the CPU first

Date: 2026-08-30. Subject: `packages/core/src/clustered-mesh.ts` and
`packages/core/src/clustered-batch.ts`, measured on `examples/quarry`. Phase 2 of the
[virtual geometry batch](../PRDs/done/nanite-like/README.md).

**Verdict: the cut pays, and PRD-282's kill switch clears on both halves.** On the quarry's route at
1080p on browser WebGPU, the `virtual` arm costs **1.28 ms of GPU time against `decimated`'s 2.45 ms**
and submits **7.1 million triangles against 19.7 million**, while sitting **closer to the `dense`
reference than `decimated` does** on the same six route frames — 40.46% mean changed pixels against
42.18%. Both, which is what AC6 requires.

**Browser only.** No native run: this repository has no `tn-linux` host built, and `pnpm
native:build` is a phase of its own. The native lane is PRD-283's AC4 and is `UNVERIFIED` here.

## The three arms, one session, same machine

Adapter **nvidia / turing** (RTX 2080, 8 GB), 1920×1080, `--browser-recipe webgpu --headed` on the
real display. Steady windows only; window 1 is discarded.

| arm | `gpuMs` | `render.p50` | `render.p95` | draws | triangles/frame | fps | windows |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `dense` | 6.97 | 0.2 | 0.4 | 10 | 104,472,681 | 59.95 | 27 |
| `decimated` | 2.45 | 0.3 | 0.5 | 10 | 19,717,963 | 59.95 | 28 |
| **`virtual`** | **1.28** | 1.0 | 1.45 | 89 | **7,145,671** | 59.95 | 38 |

- **GPU: `virtual` is 48% cheaper than `decimated`** and 5.4× cheaper than `dense`.
- **CPU: the walk costs 0.7 ms**, `render.p50` 0.3 → 1.0 ms. Sum of both phases: 2.28 ms for
  `virtual` against 2.75 ms for `decimated`, so it wins on the total as well as on the GPU.
- **Draws rise from 10 to 89**, which is the price of per-distance-group instancing and is
  reported rather than hidden. It costs 0.7 ms of CPU and buys 1.2 ms of GPU on this scene.
- `fps` is 59.95 in every arm because this session ran on the real display at 60 Hz with vsync;
  it separates nothing here and `gpuMs` is the meter, exactly as PRD-280 corrected §4 to say.

**These numbers are not comparable to PRD-280's.** That session ran under the runner's private Xvfb,
where presentation is throttled and the same `dense` arm read 22.99 ms of `gpuMs` at 11 fps. All
three arms above were re-measured in this session so the comparison is within one environment.

## Image difference against the `dense` reference

Six route frames, changed-pixel ratio at a threshold of 2 per channel:

| frame | `decimated` | `virtual` |
| --- | --- | --- |
| rim | 20.61% | 20.72% |
| switchback | 22.96% | 23.62% |
| floor | 8.37% | 7.16% |
| approach | 44.42% | **41.21%** |
| contact | 75.85% | **69.65%** |
| nose | 80.86% | **80.43%** |
| **mean** | **42.18%** | **40.46%** |

`virtual` is closer on four of six frames and on the mean. **The margin is narrow and the reason is
worth writing down:** the cut is chosen on *positional* error, and the shading is lit by normals. At
the route's end the camera is 7.4 m from the nearest cluster of the cliff — measured, not assumed —
so a one-pixel budget legitimately allows about 8 mm of positional deviation, and 8 mm on a surface
whose grain is centimetres across rewrites the normals even where the silhouette is unchanged. A
tighter `errorPixels`, or a bake that weights normals through `simplifyWithAttributes`, is where that
margin would come from. Neither was done here, and the number above is the default 1-pixel budget.

## Four defects the run found, each of which would have shipped a wrong result

1. **`Uint32BufferAttribute` copies its array.** Both classes wrote every frame's cut into a buffer
   the GPU never saw, so the mesh drew a range of zeros — degenerate triangles, no error anywhere,
   and a frame time that looked like a triumph. `BufferAttribute` keeps the array by reference.
   `clustered-mesh.spec.ts` now asserts the drawn index range is the selected clusters' triangles.
2. **Replacing a geometry's index attribute leaks its GPU buffer.** three frees `geometry.index`
   only when the geometry itself is disposed (`Geometries.js`'s `onDispose`), so the copy above —
   which forced a replacement every frame — leaked one buffer per geometry per frame. The
   instrument's own marker is what found it: `indexAttributes` climbing 78 → 152 → 226 → 300 → 374,
   `indexAttributesSize` +15.9 MB each time, until `vkAllocateMemory failed with
   VK_ERROR_OUT_OF_DEVICE_MEMORY` on an 8 GB card. Each group now allocates one index buffer, sized
   from the finest cut its distance band can ever need.
3. **Disposing a group's geometry destroys the batch's shared position buffer.** three's dispose
   handler deletes the *render object's* attributes, which are the ones every other group is drawing
   from: `[Buffer (unlabeled)] used in submit while destroyed`, hundreds of times a second. Groups
   now release their attributes before disposing, and a test asserts nothing is ever disposed while
   still holding them.
4. **Growing a buffer by doubling its previous size is exponential.** One index more than last frame
   doubled the allocation, and a camera walking toward the face doubled it every frame.

After the four fixes the route runs with **zero console errors and zero network errors**, and the
renderer holds 47 MB of index buffers over 78 geometries for most of the walk, rising to 72 MB over
94 near the face.

## Acceptance criteria

- [x] **AC1 — the cut is correct.** `clustered-mesh.spec.ts` asserts the selected set equals an
      oracle walked over the DAG's own records, for a fixed camera.
- [x] **AC2 — no holes.** Proven at the geometry level rather than at the pixel level: a 41-step
      camera sweep from inside the body out to one-cluster distance leaves **zero** open interior
      edges, and the same sweep with one sphere per cluster instead of the group spheres cracks.
      Every distance group's cut in `ClusteredBatch` is checked the same way. The route's six frames
      were also looked at by eye and show no background through a closed body. *A per-frame
      background-pixel assertion over all 1,800 frames was not implemented.*
- [x] **AC3 — red-green, hysteresis.** Measured rather than assumed. Six units from the body, jitter
      of 0.004, 0.01, 0.02, 0.05 and 0.1 units changes the cut on **none** of 120 frames; 0.2 changes
      it on **14**; 0.5 on **78**. The band is proven at 0.2, the amplitude where flicker starts, and
      removing it reproduces the 14.
- [x] **AC4 — the game still owns the look.** Swapping the surface swaps what draws;
      `constraints.spec.ts` exempts both modules on `instanced-batch.ts`'s terms and asserts they
      construct no material, light or colour, read no appearance property, and hold no hex literal.
- [x] **AC5 — red-green, the empty cut.** A camera that resolves nothing leaves the mesh invisible
      with a draw range of zero rather than submitting a zero-count draw, and the next call picks it
      back up.
- [x] **AC6 — the kill switch, at equal quality.** Both halves above.
- [x] **AC7 — a playtest is the proof of the frame.** The quarry's route scenario passed in the
      `virtual` arm on browser WebGPU with its adapter named in `artifacts/quarry/virtual/capture.json`.
- [x] **AC8 — the capability is discoverable.** `capabilities.json` regenerated at 197 entries;
      `ClusteredMesh` is findable by *draw a model too detailed for the screen to resolve* and
      `ClusteredBatch` by *draw hundreds of copies of a scanned or sculpted body without hundreds of
      draw calls*.

## What PRD-282 grew that it did not plan

**`ClusteredBatch`, and the instrument is what forced it.** The quarry's `dense` arm submits 104
million triangles and 102 million of them are 396 instanced boulders, so a cut that only works per
mesh would have saved 2% of the frame and answered AC6 with a number nobody should act on. One
indexed draw has one index range and multi-draw indirect is not portably available here, so per-copy
cuts would mean 396 draws and 396 index buffers. The copies are grouped by distance instead, one cut
is taken per occupied group at the distance of the group's nearest member, and each group draws as
one instanced draw. No copy is ever drawn coarser than its own distance allows.

**The bake grew a second sphere per cluster.** Projecting both errors through a cluster's own bounds
is the obvious implementation and it cracks: two clusters that share a seam flip at different
distances. Each side is projected through the sphere of the group it belongs to, and a group's sphere
encloses every child's, so a parent's projected error can never fall below a child's however the
camera moves. `VIRTUAL_BAKE_VERSION` is 2 and the payload carries `clusterSourceSpheres` and
`clusterParentSpheres`.

## What is not proven

- **Native.** No `--target desktop` run; no native host is built in this tree.
- **Android, iOS.** `UNVERIFIED`, and no device run was attempted.
- **A cold-agent install.** The `virtual` arm has not been built from tarballs in a sandbox. That is
  PRD-283's AC5.
- **The GPU kernel.** Nothing in this phase runs on a compute shader. The CPU walk costs 0.7 ms of
  `render` on 57,041 clusters, which is the baseline PRD-283's AC3 has to beat.

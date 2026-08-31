---
prd_contract: v1
---

# PRD-283 — the cut moves to the GPU and native runs it

**Status: DONE — measured 2026-08-30. Phase 3 of the [virtual geometry batch](./README.md).
Native runs it: a packed Linux desktop executable of the quarry's `virtual` arm walks the whole
route and renders it. **The kernel does not ship**, and AC3's negative result is the one this PRD
pre-authorised — but not for the reason it expected. AC5 is now done too: a 524,288-triangle body
bakes and cuts in a game installed from packed tarballs outside this repository, and the install
found a defect no in-repo test could — `assets.models.virtual` never reached the pipeline it
configures. Android and iOS are UNVERIFIED, which AC4 permits. Numbers in
[docs/verification/prd-283-native-and-the-kernel-2026-08-30.md](../../../verification/prd-283-native-and-the-kernel-2026-08-30.md)
and [docs/verification/prd-283-cold-agent-install-2026-08-30.md](../../../verification/prd-283-cold-agent-install-2026-08-30.md).**

**The finding that redirects the batch.** Native at 720p inverts the browser result: `virtual` costs
3.05 ms of GPU time against `decimated`'s 1.64, and its `render.p95` is 649.6 ms because one frame
builds every distance group at once. The CPU walk is 0.7 ms on browser and about 1.1 ms on native —
it is not what the native arm loses on, and a kernel that removed all of it would leave both the 89
draws and the arrival hitch untouched. Submission shape and arrival cost are the next problem, and
both are cheaper to fix than a compute kernel.

**Goal: the same cut, chosen in a compute kernel and drawn indirectly, producing the same clusters
as the CPU oracle — and running on the owned native runtime, not only in a browser.** A feature that
works on web only is unfinished, and this is the phase where that bill comes due.

**Complexity:** +2 a kernel in the per-frame path, +2 a native lane with a binding known to be
missing, +1 parity harness against the oracle = **5 → MEDIUM mode.**

## 1. The design

The kernel reads the cluster table as TSL storage, tests each cluster against the camera — screen
error, parent error, frustum, and the normal cone `computeMeshletBounds` already produced — and
compacts the survivors into the draw's index range plus the indirect draw arguments. Dispatch is
owned by `ComputeDrivenRegistry` (`packages/core/src/compute-driven.ts`), which already warms
kernels before the world is shown, dispatches at a declared cadence and releases on scene end.
Nothing new is added to the loop.

**Parity is the acceptance test, not the smoke test.** For a fixed set of camera poses the kernel
must select the same cluster set as PRD-282's walk — the same set, not a similar one. A read-back of
the selected indices is compared against the oracle's, and `packages/core/src/gpu-readback.ts`
already does throttled buffer read-back with sample-age reporting.

## 2. The native lane, and the one thing that is missing

Verified against `HEAD`, so the size of this is known before the phase starts:

- **Indirect draw is bound on both native paths.** `wgpuRenderPassEncoderDrawIndirect` and
  `DrawIndexedIndirect` at `packages/runtime-native/src/webgpu/bindings_commands.cpp:1255-1261` and
  `:1522-1527`, plus frame-stream opcodes 10 and 11
  (`bindings_frame_stream.cpp:107` and `:241`). `GPUBufferUsage.INDIRECT` is exposed at
  `bindings.cpp:2635` and buffer attribution already labels the usage
  (`bindings_resources.cpp:122`).
- **Indirect compute dispatch is not.** The frame-stream opcode table names `compute.setPipeline`,
  `compute.setBindGroup`, `compute.dispatchWorkgroups` and `compute.end`, and no indirect form
  (`bindings_frame_stream.cpp:107`). three.js does use `dispatchWorkgroupsIndirect` internally
  (`three.webgpu.js:85352`).

**The call, made now: no binding is added.** Keep the dispatch count CPU-side — the number of
clusters is known at load, so the dispatch is a fixed size over the cluster table and only the
*draw* count comes from the GPU. If a later phase genuinely needs an indirect dispatch, the binding
is added on both native paths together with the five registrations a new native surface needs, and
the census is regenerated in the same commit rather than retyped.

A JS-surface contract is provable with a bindings test executable and needs no display, so
"blocked on a window" is not an acceptable status for this phase.

## 3. Acceptance criteria

- [ ] **AC1 (moot, there is no kernel) — parity with the oracle.** For a fixed camera set, the kernel's selected cluster set
      equals PRD-282's walk exactly. A single differing cluster fails.
- [ ] **AC2 (moot, there is no kernel) — red-green, the cone test.** Removing the normal-cone rejection changes the selected
      set and fails AC1 with the count of clusters that reappear, pasted.
- [x] **AC3 — the kernel beats the walk, or it is not kept.** *It is not kept.* `render.p50` and CPU frame time for
      `virtual` on the kernel against `virtual` on the CPU, on the quarry route. If the CPU cut was
      already cheap enough, this phase reports that and the kernel does not ship — a negative result
      that saves the batch its most expensive code.
- [x] **AC4 — native runs it.** A packed Linux desktop `--target desktop` playtest of the quarry's
      `virtual` arm in the same commit, with the numbers recorded. Android and iOS may be
      `UNVERIFIED` and must say so in the Status line.
- [x] **AC5 — one cold-agent build.** *Done 2026-08-30.* `sandbox/virtual-quarry`: a 524,288-triangle
      torus knot, authored by a script that has never heard of cluster DAGs, baked by `threenative
      build` in a project installed from packed tarballs with 0 lines of framework source readable
      and no `AGENTS.md` chain. The compiled `.glb` carries `TN_virtual_geometry`, the loader
      returned a `ClusteredMesh`, and the frame submitted **70,513 triangles at 2.4 m and 15,471 at
      40 m** — 13.4% and 2.95% of the body — on an `nvidia`/`turing` adapter. The install is also
      what caught `assets.models.virtual` never reaching `compileAssets`, fixed in `7a44b18c`.
- [ ] **AC6 (moot, there is no kernel) — warmup is honest.** The kernel is compiled before the world is shown, through the
      registry's warmup, and a test asserts no shader compile happens on the first rendered frame.
- [ ] **AC7 (moot, there is no kernel) — read-back does not starve the frame.** The parity harness reads back on a throttle;
      a long single hold is split into short steps plus a settle tail, because one long hold lands
      almost none of its copies.

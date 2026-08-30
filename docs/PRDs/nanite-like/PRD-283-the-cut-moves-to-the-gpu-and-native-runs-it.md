---
prd_contract: v1
---

# PRD-283 — the cut moves to the GPU and native runs it

**Status: NOT STARTED — filed 2026-08-30. Phase 3 of the [virtual geometry batch](./README.md),
blocked on [PRD-282](./PRD-282-the-cut-is-chosen-on-the-cpu-first.md). Nothing measured.**

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

- [ ] **AC1 — parity with the oracle.** For a fixed camera set, the kernel's selected cluster set
      equals PRD-282's walk exactly. A single differing cluster fails.
- [ ] **AC2 — red-green, the cone test.** Removing the normal-cone rejection changes the selected
      set and fails AC1 with the count of clusters that reappear, pasted.
- [ ] **AC3 — the kernel beats the walk, or it is not kept.** `render.p50` and CPU frame time for
      `virtual` on the kernel against `virtual` on the CPU, on the quarry route. If the CPU cut was
      already cheap enough, this phase reports that and the kernel does not ship — a negative result
      that saves the batch its most expensive code.
- [ ] **AC4 — native runs it.** A packed Linux desktop `--target desktop` playtest of the quarry's
      `virtual` arm in the same commit, with the numbers recorded. Android and iOS may be
      `UNVERIFIED` and must say so in the Status line.
- [ ] **AC5 — one cold-agent build.** The `virtual` arm is built once from packed tarballs in a
      sandbox outside this repository, the way a user's machine gets it, before this phase closes.
      An in-repo example proves the frame; it does not prove the install.
- [ ] **AC6 — warmup is honest.** The kernel is compiled before the world is shown, through the
      registry's warmup, and a test asserts no shader compile happens on the first rendered frame.
- [ ] **AC7 — read-back does not starve the frame.** The parity harness reads back on a throttle;
      a long single hold is split into short steps plus a settle tail, because one long hold lands
      almost none of its copies.

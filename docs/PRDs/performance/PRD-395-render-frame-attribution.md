# PRD-395 — Attribute the render phase to 100%

**Status:** NOT STARTED
**Complexity:** 4
**Owner:** unassigned
**Depends on:** nothing. Blocks PRD-396 measurement and PRD-397 pricing.
**PR:** (open as draft before Phase 1) — label `prd:0`

## Problem

Native desktop, 1280x720, reference game (midway), frame p50 **20.2 ms** (42–51 fps):

| phase       | p50 ms |
|-------------|--------|
| render (JS) | 16.1   |
| update      | 2.1    |
| hostGap     | 2.7    |
| ui          | 0.03   |
| residual    | 0.09   |
| GPU         | 1.9 (p50 1.57) |

GPU is ~10x under budget. The frame is CPU-bound inside `render`. Of that 16.1 ms we
can name **5.22 ms** (32.4%) from sampled profiles:

| symbol                        | % of render |
|-------------------------------|-------------|
| `_projectObject`              | 9.2         |
| `updateMatrixWorld`           | 9.1         |
| `multiplyMatrices`            | 4.7         |
| `_renderObjectDirect`         | 4.1         |
| `renderObject`                | 2.2         |
| `getForRender`                | 1.8         |
| `needsRenderUpdate`           | 1.3         |

Split: traversal 3.71 ms (project 1.48, matrix walk 2.22), per-draw bookkeeping keyed on
JS object identity 1.51 ms.

**10.9 ms is unattributed.** Engine-owned per-frame work is <1.5 ms total (camera cull
0.5–0.7, frame-op recorder ~0.5, GPU timestamp readback 0.4, frame meter 0.1), so the
engine's own share is not the missing mass.

Arithmetic worth stating so it can be falsified: 10.9 ms / 573 draws = **19.0 µs per draw**.
At ~2 µs per V8↔host boundary crossing that would need ~10 crossings per draw. Either the
cost is per-draw and enormous, or it is not per-draw at all. Nobody knows which, and four
ranked options (content reduction, transport move, GPU-driven culling, WASM hot loops) are
priced on incompatible answers to that question.

This PRD does not make the frame faster. It makes the next two PRDs honest.

## Scope / Non-goals

**In scope**
- A nested span mechanism in `packages/` with structurally-computed residual, default-off.
- Span placement across the whole `render` phase: scene-graph update, render-list build,
  sort, shadow pass, reflection pass, main pass, encode, submit.
- Host-boundary counters: host calls per frame, bytes written to GPU buffers per frame,
  allocation bytes per frame.
- A V8 sampling-profile cross-check and an empty-host-call microbenchmark.
- One attribution table, written into this PRD.

**Non-goals — explicitly refused here**
- No optimisation. Not one line of hot-path code changes behaviour in this PRD. If a span
  reveals something embarrassing, it gets a row in the table and a follow-up PRD, not a fix.
- **Ranked option 4 (transport traversal move behind the frame-op stream)** is not taken,
  not designed, and not prototyped here. It is the option most likely to be justified by
  this PRD's output and it must not be pre-justified by the person doing the measuring.
- **Ranked option 6 (WASM hot loops)** is not evaluated here beyond the boundary-crossing
  microbenchmark, which exists to price it *down*, not up.
- **Ranked option 7 (C++ renderer ownership)** is out of scope permanently per the perf
  charter; no measurement in this PRD may be framed as evidence for it.
- No changes to PR #275 (`TN_FRAME_PLANS=1`). Spans must work with the flag off and on;
  making frame plans faster is not this PRD's business.
- No browser-only instrumentation. Every span that exists ships with a native number.

## Phases

### Phase 1 — Span mechanism (`packages/`), default-off, residual by construction

- [ ] Files wired: `packages/<engine>/src/profiling/Spans.ts` exports `beginSpan(id)` /
      `endSpan(id)` with a fixed-arity id enum (no string allocation on the hot path),
      a per-frame flat ring buffer, and a parent-minus-children `residual` emitted for
      every non-leaf span.
- [ ] Files wired: launch flag `TN_FRAME_SPANS=1` registered next to `TN_FRAME_PLANS`;
      off by default; documented in the DEV_MODE surface.
- [ ] Required test passing: `npm test -- spans.residual` asserts that for a synthetic
      tree (parent 10 ms, children 3+4 ms) the emitted residual is 3 ms ±0.05, and that a
      child exceeding its parent produces a **negative** residual rather than being clamped.
      Result: `<command>` → `<exit code>`
- [ ] Required test passing: `npm test -- spans.zero-cost` asserts `beginSpan` compiles to
      a single monomorphic guarded return when the flag is off.
      Result: `<command>` → `<exit code>`
- [ ] Observed red: the residual test failed before `Spans.ts` was wired, at commit `<sha>`,
      message `<msg>`. Paste the failing output here.
- [ ] User verification: native desktop 1280x720, 1800 frames, flag **off**, frame p50
      within 0.1 ms of the 20.2 ms baseline.
      Result: `npm run bench:midway -- --native --res 1280x720 --frames 1800 --meter-json out/spans-off.json` → p50 `<n>` ms
- [ ] User verification: same run, flag **on**, span overhead recorded.
      Result: `out/spans-on.json` → p50 `<n>` ms, overhead `<n>` ms (must be ≤0.3 ms; if
      higher, the table in Phase 4 is corrected for it and the correction is shown)

### Phase 2 — Span placement + host-boundary counters

- [ ] Files wired: spans around scene-graph update (`updateMatrixWorld` walk), render-list
      build (`_projectObject`), sort, shadow pass, reflection pass, main pass, per-draw
      bookkeeping (`_objects.get`, `_nodes.needsRefresh`, `_geometries`/`_bindings`/
      `_pipelines.updateForRender`), command encode, and queue submit.
- [ ] Files wired: counters `hostCallsPerFrame`, `gpuBytesWrittenPerFrame`,
      `jsAllocBytesPerFrame` emitted on the same frame record.
- [ ] Required test passing: `npm test -- spans.coverage` asserts the `render` span's
      residual is <3% of the `render` span on the test scene, i.e. coverage ≥97%.
      Result: `<command>` → `<exit code>`
- [ ] Observed red: `spans.coverage` failed at `<sha>` with residual `<n>%` before the
      encode/submit spans were added. Paste the failing output.
- [ ] User verification: native desktop reference game, 1800 frames, `render` residual
      recorded. **Target: ≤0.5 ms of 16.1 ms (≥97% attributed).**
      Result: residual `<n>` ms, artifact `out/attribution-native.json`
- [ ] User verification: browser WebGPU (Chrome `<version>`), same scene, residual recorded.
      Result: residual `<n>` ms, artifact `out/attribution-browser.json`
- [ ] User verification: Android hardware, same scene, residual recorded.
      Blocker: Android hardware rows are still open on PR #275; this box stays unticked
      until a device is available and does not gate Phase 4.
- [ ] User verification: iOS hardware, same scene, residual recorded.
      Blocker: same as Android.

### Phase 3 — Cross-check and boundary price

- [ ] Files wired: `npm run profile:midway` captures a V8 CPU profile through the host's
      Inspector Profiler domain for the same 1800 frames and writes `out/cpu.cpuprofile`.
- [ ] Files wired: `tools/attribution-diff.ts` joins the span tree to the sampling profile
      top-down tree and prints per-node disagreement.
- [ ] Required test passing: `npm test -- attribution.agreement` asserts each of the top
      five leaf spans agrees with the sampling profile within 1.0 ms.
      Result: `<command>` → `<exit code>`
- [ ] Observed red: agreement test failed at `<sha>` with max disagreement `<n>` ms.
- [ ] Files wired: `bench/host-boundary.ts` — empty host call, 1e6 iterations, native.
- [ ] User verification: cost of one empty V8→host call measured.
      Result: `npm run bench:host-boundary -- --native` → `<n>` µs/call
- [ ] User verification: host calls per rendered frame measured.
      Result: `<n>` calls/frame; implied boundary cost `<n>` ms/frame

### Phase 4 — The table, and the verdict on each hypothesis

Each hypothesis is one box and is ticked when it carries a number, **whether confirmed or
denied**. A denied hypothesis is a completed box.

- [ ] H1 — command encode + wgpu pipeline/bindgroup set calls dominate the unattributed
      10.9 ms. Result: `<n>` ms (`<n>`% of render). Verdict: confirmed / denied.
- [ ] H2 — per-object uniform/buffer writes (`writeBuffer` per object per pass) dominate.
      Result: `<n>` ms, `<n>` bytes/frame. Verdict: confirmed / denied.
- [ ] H3 — V8↔host boundary crossings dominate. Result: `<n>` calls/frame ×
      `<n>` µs = `<n>` ms. Verdict: confirmed / denied.
- [ ] H4 — GC / allocation pressure. Result: `<n>` bytes/frame allocated, `<n>` ms in GC
      inside the render span. Verdict: confirmed / denied.
- [ ] H5 — the shadow pass's second full traversal (364 of 573 draws, 856 casters exempt
      from culling) costs more than the sampled `_projectObject` share implies.
      Result: shadow-pass span `<n>` ms. Verdict: confirmed / denied.
- [ ] H6 — render-list sort. Result: `<n>` ms. Verdict: confirmed / denied.
- [ ] H7 — none of the above; the mass is somewhere not enumerated. Result: name it, with
      `<n>` ms, here.
- [ ] Files wired: the attribution table below is filled in, in this file, with the native
      numbers. No separate report file.
- [ ] User verification: cost-per-draw derived and written here.
      Result: `<n>` ms of the render phase scales with draw count, giving `<n>` µs/draw.
      This number is the input PRD-397 is priced against.
- [ ] User verification: cost-per-object derived and written here.
      Result: `<n>` ms scales with object count (1,561 meshes / 1,680 considered), giving
      `<n>` µs/object. This number is the input PRD-396 is priced against.

Attribution table (native desktop, 1280x720, p50, 1800 frames):

| span | ms | % of render | notes |
|------|----|-------------|-------|
| _(fill in Phase 4)_ | | | |
| **residual** | | | must be ≤0.5 ms |

### Phase 5 — Warn the authoring agent before a human notices

The census and the phase split are already measured every frame and nothing reads them. An agent
building a scene gets no signal at all until a human plays the game and says it feels slow — which
is how a scene reached 1,815 triangles per draw with the GPU ten times under budget and nobody
knew. The engine knows sooner: a frame whose GPU is idle while its JS render phase is over the
display's own period is a scene-shape problem, and the shape is already in `TN_PROJECTION` and the
per-pass split.

- [ ] Files wired: a `TN_SCENE_WARNING` record emitted at most once per reported window, carrying
      the verdict and the shape behind it — objects considered, draws per pass, triangles per draw,
      shadow-exempt casters, and the GPU's share of the frame.
- [ ] The rule is derived, not a constant: it fires when the GPU is under a third of the frame and
      the render phase exceeds the display's period, and it names which term dominates. A threshold
      an author is told to revisit later is a bug, not an option — the numbers it compares are the
      ones the frame already reports.
      Result: `<command>` → verdict `<n>`
- [ ] Required test passing: the warning fires on a fixture frame carrying 1,815 triangles per draw
      with a 1.9 ms GPU against a 16.1 ms render.
      Result: `<command>` → `<exit code>`
- [ ] Required test passing: the same warning does **not** fire on a GPU-bound fixture with the same
      draw count, so a heavy scene that is honestly GPU-bound is never told to restructure itself.
      Result: `<command>` → `<exit code>`
- [ ] Observed red: the warning test failed before the rule was wired, at commit `<sha>`, message
      `<msg>`.
- [ ] Files wired: `npx threenative doctor` reports the last window's verdict, so an agent reading
      stdout sees it without opening a log.
- [ ] Files wired: the `DEV_MODE=true` chip shows the verdict beside the frame rate, so a human
      watching the window sees the same thing the agent does.
- [ ] Files wired: the templates' `AGENTS.md` names the warning and what to do about it — read the
      bucket census before promising a merge, and move the draw and object counts, not the engine.
- [ ] User verification: the reference game emits the warning on its current scene and the record
      names the dominant term.
      Result: `<artifact path>` → dominant term `<name>`

## Acceptance criteria

- [ ] An agent building a scene of this shape is warned by the engine before a human plays it: the
      warning fires on the reference game, names the dominant term, and is readable from both
      `doctor` and the `DEV_MODE` chip.
- [ ] The warning stays silent on an honestly GPU-bound scene with the same draw count.
- [ ] `render`-span residual on native desktop is ≤0.5 ms of 16.1 ms.
- [ ] `render`-span residual in browser WebGPU is ≤0.5 ms.
- [ ] Span overhead with `TN_FRAME_SPANS=1` is ≤0.3 ms p50 on native desktop.
- [ ] Frame p50 with `TN_FRAME_SPANS` unset is within 0.1 ms of the 20.2 ms baseline.
- [ ] Top five leaf spans agree with the V8 sampling profile within 1.0 ms each.
- [ ] Cost of one empty V8→host call is measured on native and written into this PRD.
- [ ] Host calls per rendered frame is measured and written into this PRD.
- [ ] A per-draw cost in µs is published in this PRD.
- [ ] A per-object cost in µs is published in this PRD.
- [ ] Each of H1–H7 carries a number and a confirmed/denied verdict.
- [ ] Attribution table is checked in inside this file.

## Verification boundary

**Proven here:** where the 16.1 ms render phase goes on native desktop and in browser
WebGPU, to ≥97%; the price of one host-boundary crossing; how many crossings a frame makes;
how much of the frame scales with draws and how much with objects.

**Not proven here:** that any of it can be removed. No optimisation is attempted, so no
speedup is claimed. Android and iOS attribution is explicitly unproven — those boxes name
their blocker and do not gate this PRD's completion; if the Android/iOS split differs from
desktop, PRD-396 and PRD-397 must be re-priced against it before their own acceptance.

**Not proven here:** anything about a second renderer path. This PRD measures the path we
have. If its output argues for ranked option 4 or 5, that argument is made in a new PRD
that also inherits the divergence harness from PRD-396.

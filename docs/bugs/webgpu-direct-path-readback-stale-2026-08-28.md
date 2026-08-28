# Direct-path `writeBuffer` → `mapAsync(READ)` readback returns zeros, then one-submit-stale data — 2026-08-28

**Status:** open, named defect (loop log F6). Standing disposition: **upload staging fixes the
boundary by construction on default wgpu-native builds; the direct fallback retains upstream
wgpu-native behavior.** This is a defect filing, not a repair commitment — it exists so a cold
agent that hits readback zeros on the direct path reads "known boundary semantics" instead of
re-deriving it the hard way as a broken upload.

**Layer:** `packages/runtime-native` — `src/webgpu/bindings.cpp`, the direct-path readback
boundary: `queue.writeBuffer`'s direct `wgpuQueueWriteBuffer` fallthrough (`tnWebgpuHandler23`,
`bindings.cpp:5705`; direct call at `bindings.cpp:5764`) and `buffer.mapAsync`
(`tnWebgpuHandler30`, `bindings.cpp:5171`).

**Evidence status: recorded-secondhand.** The probe ran 2026-08-26 against a staging-OFF
wgpu-native desktop build during the PRD-222 session; the observation is recorded in
[the PRD-222 loop log, row F6](../verification/runtime-perf-state.md) (see also
[the session evidence file](../verification/runtime-perf-state.md) for the staging work it sat
inside). The staging-OFF arm's own log did not survive (`/tmp`), so no output is reproduced here —
the loop-log row is the record. What does survive: the probe source, inlined below so the filing
is self-contained, and the staging-ON control arm's log (last seen at `/tmp/probe-on.log`, both
phases correct, quoted once below). The probe was not re-run at filing time: a re-run needs a
compile-flag rebuild (`TN_WEBGPU_UPLOAD_STAGING` is a CMake option, not an env var), which is out
of scope for a filing lane and not free in a tree other lanes are building in.

## The sequence, as recorded

The probe writes four known u32s to a `MAP_READ` buffer and reads them back through the direct
path, twice:

1. `queue.writeBuffer` → `mapAsync(READ)` → `getMappedRange()` reads **all zeros** — the map
   resolved before the enqueued write landed.
2. After one intervening `submit()` of an empty encoder: `queue.writeBuffer` with new data →
   `mapAsync(READ)` → reads the **previous contents** — the data as of one submit ago.

The rule the sequence demonstrates: on wgpu-native's direct path, `mapAsync`'s promise resolving
means the buffer is *mappable*, not that the queue has drained the `writeBuffer` transfers
enqueued ahead of it. Mapping readiness tracks submit boundaries, not queue drain. The second
phase is the nastier half — after a retry "fixes" the zeros, the values that come back look
plausible but are one submit old.

```js
// The probe, verbatim as it survives (/tmp/staging-probe.js, written 2026-08-25 in the
// 2026-08-25/26 session). Run through the native host's script runner against a staging-OFF
// build; the staging-ON build is the control.
(async () => {
const adapter = await navigator.gpu.requestAdapter();
const device = await adapter.requestDevice();
const expect = [1, 2, 3, 4];
const buf = device.createBuffer({ size: 16, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
function u32(view) { return Array.from(new Uint32Array(view)); }

device.queue.writeBuffer(buf, 0, new Uint32Array(expect));
await buf.mapAsync(GPUMapMode.READ);
const first = u32(buf.getMappedRange());
buf.unmap();
console.log(`PROBE_PHASE1 ${JSON.stringify(first)} expect ${JSON.stringify(expect)}`);

const enc = device.createCommandEncoder();
device.queue.submit([enc.finish()]);
device.queue.writeBuffer(buf, 0, new Uint32Array([9, 8, 7, 6]));
await buf.mapAsync(GPUMapMode.READ);
const second = u32(buf.getMappedRange());
buf.unmap();
console.log(`PROBE_PHASE2 ${JSON.stringify(second)} expect [9,8,7,6]`);
console.log("PROBE_DONE");
})();
```

Control arm, staging ON — both phases correct (`/tmp/probe-on.log`, 2026-08-25, quoted verbatim):

```
[log] PROBE_PHASE1 [1,2,3,4] expect [1,2,3,4]
[log] PROBE_PHASE2 [9,8,7,6] expect [9,8,7,6]
[log] PROBE_DONE
```

## Why this mimics a code defect, and what it cost

- **Readback zeros read exactly like a broken upload.** The obvious conclusion from phase 1 is
  "the write never happened" or "the upload path just written lost the data", which points the
  debugger at whichever upload code is open — in this session, the brand-new upload staging
  (loop log F2). It cost that design a redesign round (loop log F3): the zeros were read as a
  staging defect when the direct path's map/queue semantics were part of what the probe showed.
- **Nothing else catches it.** Three.js never reads a buffer back, so no game, template, or
  playtest scenario ever drives `mapAsync(READ)`. Every existing gate stays green while the
  boundary misbehaves; only a deliberate readback probe finds it.

## Not the bug

- **The staging path.** With `TN_WEBGPU_UPLOAD_STAGING` ON — the CMake default for wgpu-native
  builds (`packages/runtime-native/CMakeLists.txt:84`), landed in `263981b0` — every staged write
  becomes queued copy commands flushed at queue boundaries, so map-after-write is ordered by the
  queue. The control arm above is the evidence.
- **The JS engine, V8, or the data.** The probe writes four u32 literals and reads back different
  bits; no engine machinery sits between. The control arm proves the binding layer can carry the
  values.

## Scope limits — when the direct path is live

The direct `wgpuQueueWriteBuffer` path is reached (`bindings.cpp:369-386`,
`bindings.cpp:5758-5773`):

1. Builds with `TN_WEBGPU_UPLOAD_STAGING=OFF` — the probe's condition.
2. **Default staging-ON builds too, for any single write larger than one staging block**
   (1 MiB, `bindings_state.h:159`): `stageWriteInUploadStaging` flushes and returns false for an
   oversized write, sending that write down the direct path. Oversized *reads* of such buffers is
   not a pattern Three.js generates, so this is latent, not observed in play.
3. Staging allocation failure (`staging.disabled`).

Scope limits on the record: one probe, one desktop wgpu-native lane (NVIDIA/Vulkan), 2026-08-26,
staging-OFF build; Dawn builds were not probed (their `mapAsync` runs the
`wgpuInstanceProcessEvents`/`wgpuDeviceTick` branch, `bindings.cpp:5195-5205`); the Android device
lane was not probed for readback; and the staging-OFF arm's output log did not survive, so the
zeros/stale observation itself is recorded only in the loop-log row. Re-prove all four before
promoting any claim past "observed once, recorded same-session".

## Standing disposition

- **Named, not scheduled.** The loop log's disposition row says: staging fixes the boundary by
  construction; the direct fallback retains upstream behavior. That is the accepted state.
- **If readback is ever needed on the direct path** — a debugging tool, a screenshot-with-CPU-read
  feature, a conformance case — the shape of a fix is to enqueue a submit after the writes and map
  only after the submit's work completes, or route the readback through staging. Not implemented;
  this paragraph describes a fix shape, it does not claim one exists.
- **Do not "fix" this in game code.** A game that papers over phase-1 zeros with a retry inherits
  phase 2's one-submit-stale data, which is worse: silently wrong. The boundary is the engine's.

## Next probe

Rebuild the wgpu-native host with `-DTN_WEBGPU_UPLOAD_STAGING=OFF`, run the probe above through
the host's script runner: phase 1 zeros and phase 2 stale is the red; the same probe on the
default build is the green control. If the direct path is ever promoted to a supported
configuration, this probe belongs in the runtime's contract-test set so the boundary reports
itself.

## What would falsify this

- The probe passing on a staging-OFF build at current HEAD — upstream wgpu-native would have
  changed map/queue semantics under us; re-file with the new versions.
- Phase 1 correct and only phase 2 stale — the rule would narrow to post-submit writes only, and
  the "zeros" half of this filing would be mis-recorded.

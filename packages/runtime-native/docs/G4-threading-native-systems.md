# G4 — threading and native systems

**Milestones:** M7, M8, M9, M10, M11
**State:** IN PROGRESS — native Rapier plus bounded Linux and Android-emulator positional
audio executed; worker, asset-pipeline, iOS-audio, and physical-output evidence remain open.

The runtime still owes its worker/thread model, JobSystem, native asset pipeline, and mobile
audio evidence. Android QuickJS has no WebAssembly; native physics uses the coarse
host-neutral bulk ABI under `globalThis.__THREENATIVE_NATIVE__.physics`, never a per-object
frame hot path.

PRD-052 removed Recast from the platformer's portable graph in favor of template-local
steering. Recast navigation remains browser-only; a native navigation ABI is not accepted
debt without new measured demand.

## Bounded positional-audio graph — 2026-08-09

The pre-existing native audio types exposed `AudioNode::outputs_` and `GainNode::process`,
but JavaScript `connect()` was a no-op and the SDL callback mixed sources directly. The
repaired path routes each source through its connected nodes, supports gain automation calls
used by Three.js, and adds a listener-relative stereo `PannerNode` with inverse, linear, and
exponential distance models. HRTF convolution and directional cones are not claimed.

The compiled `threenative-audio-graph-test` produced:

```text
audio graph ok: ramp-mid=0.5 gain=0.5 right=0.1 flipped-left=0.1 ended=1
```

An import-free bundle of `tests/audio-play-at-smoke.ts` then ran on the rebuilt Linux V8,
Dawn/Vulkan, SDL host with the dummy audio driver and emitted:

```text
TN_NATIVE_AUDIO_PLAY_AT_OK:createPanner+gain+source+ended
```

The completion edge is atomic: SDL removes the ended source under the mixer lock, then the
runtime loop invokes its JavaScript `onended` callback on the main thread. The host proof
waited for that callback and asserted `AudioBus.voices` returned to zero. Fixed-size,
context-owned 8,192-float scratch arrays keep the callback allocation-free and prevent the
initializer-list overflow found by the host test. The same rebuilt host passed the ordinary
300-frame desktop core gate at 1280×720. This is Linux graph and binding evidence, not audible
hardware quality, Android, iOS, HRTF, or mobile parity evidence. No generated template caller
should become portable until those platform rows execute.

The same `tests/audio-play-at-smoke.ts` source was then bundled as an import-free IIFE,
packaged through `package-android.mjs`, installed, and cold-launched on `emulator-5556`.
Android QuickJS emitted the same completion marker:

```text
TN_NATIVE_AUDIO_PLAY_AT_OK:createPanner+gain+source+ended
```

This executes `AudioContext`, `createPanner`, source → panner → gain routing, the SDL audio
callback, main-thread `onended`, and `AudioBus` voice release on Android x86_64. The proof
process exited successfully after the marker. It does not prove audible speaker output,
device latency, arm64, iOS, or physical-driver quality.

`pnpm budgets` reports 53,851 native runtime LOC, 3,851 above the review trigger. The
kill-switch pass retained only the graph plumbing needed to make the already-public
`AudioBus.playAt()` contract work: node traversal, bounded gain automation, distance/pan,
and the binding/test seam. HRTF, cones, buses, ducking, worker abstractions, and a portable
template caller were not added. Removing this bounded graph would restore the proven native
`connect()` no-op, so the retained code is cheaper than exposing a platform-specific API lie.
The Android evidence added no runtime path; it only made the existing proof source a classic
script and locked that portability constraint in the contract test.

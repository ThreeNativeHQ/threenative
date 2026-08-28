# ThreeNative PlayStation Console Spike

**Status:** Proposed research spike  
**Research snapshot:** 2026-08-27  
**Platforms:** PlayStation 4 homebrew, PlayStation 4 emulation, PlayStation 5 emulation, future PlayStation 5 hardware  
**Primary decision:** Proceed with a **PS4-first real-hardware lane** and a **PS5-emulator research lane**. Preserve upstream `three/webgpu` and `WebGPURenderer` unchanged. The portability boundary remains ThreeNative's existing browser-compatible WebGPU bindings and the `webgpu.h` C API.

---

## 1. Executive decision

This spike should answer one narrow architectural question:

> Can untouched upstream Three.js `WebGPURenderer`, running inside the existing ThreeNative host, drive a minimal console-native `webgpu.h` implementation and produce machine-verifiable frames?

The recommended sequence is:

1. **Build the verification harness once on desktop.** Capture the exact `webgpu.h` operations, descriptors, shaders, object lifetimes, screenshots, and expected output produced by a pinned Three.js cube scene.
2. **Use PS4 as the first console proof.** It has a physical hardware target already available, an established homebrew toolchain, a current PS4 emulator capable of raw ELF execution, and a newly assembled open-source graphics stack reporting real-hardware validation.
3. **Investigate PS5 in parallel through emulation.** First prove that the chosen PS5 payload ELF format can boot under an emulator. Then prove a native clear/triangle through the emulator's modeled PS5 graphics path before connecting ThreeNative.
4. **Implement only the WebGPU subset observed in the reference trace.** Unsupported operations must fail loudly and deterministically. Do not silently emulate unsupported behavior or fall back to a second renderer.
5. **Treat QuickJS as a bootstrap runtime only.** It can prove the architecture and console plumbing, but the existing 16,384-cube measurement—101.24 ms/frame on QuickJS versus a vsync-limited 8.34 ms/frame on V8—means it cannot establish production workload viability.
6. **Never call a PS5 emulator result a PS5 hardware result.** The evidence taxonomy in this document makes that distinction part of the test protocol.

### Recommended target architecture

```text
Application JavaScript / TypeScript
        ↓
real THREE.Scene + upstream three/webgpu
        ↓
upstream WebGPURenderer
        ↓
ThreeNative browser-compatible JS WebGPU bindings
        ↓
ThreeNative packed frame-command transport
        ↓
webgpu.h ABI pinned to the existing ThreeNative revision
        ↓
┌─────────────────────────────┬──────────────────────────────┐
│ PS4 backend                 │ PS5 backend                  │
│                             │                              │
│ preferred probe:            │ minimal clean-room          │
│ wgpu-native → Vulkan-PS4    │ WebGPU-shaped implementation│
│                             │                              │
│ fallback:                   │ resource/pipeline/pass/queue│
│ narrow webgpu.h backend     │ semantics                   │
│ → Vulkan-PS4/OpenGNM        │ → AGC/PM4/native submission │
└──────────────┬──────────────┴───────────────┬──────────────┘
               ↓                              ↓
          PS4 GNM/PM4                    PS5 AGC/RDNA2
```

No custom Three.js renderer backend is introduced. No scene graph is mirrored into C++. No Chromium/WebView dependency is added.

---

## 2. Why PS4 should come first

PS4 does **not** prove PS5 AGC behavior, but it removes a large amount of uncertainty using real console hardware:

- console ELF/package/bootstrap;
- JavaScript runtime startup;
- ThreeNative host lifecycle;
- file and asset loading;
- controller input;
- frame pacing and presentation;
- `webgpu.h` object lifetime and command flow;
- shader ingestion and compilation;
- framebuffer readback and screenshot export;
- memory pressure on a console OS;
- machine-verifiable rendering on a physical PlayStation.

The current public PS4 landscape is materially stronger than the current public PS5 homebrew graphics landscape:

- OpenOrbis provides a custom PS4 toolchain.
- The OpenGNM stack reports a PS4 GNM implementation, a Vulkan 1.0 ICD over GNM/PM4, SPIR-V-to-PS4 shader compilation, examples, host tests, and PS4 hardware smoke tests.
- shadPS4 can launch a raw PS4 ELF directly and exposes screenshot/RenderDoc workflows.
- The user's existing PS4 can become the first hardware oracle if its firmware is compatible with current homebrew mechanisms. **Do not update it before recording its model and system software version.**

The low-level PS4 work will not automatically port to PS5. The reusable value is primarily the upper console host, evidence harness, WebGPU object model, shader front-end, conformance tests, and failure policy.

---

## 3. Goals

### G1 — Preserve ThreeNative's architecture

The test application must run:

```js
import * as THREE from 'three/webgpu';

const renderer = new THREE.WebGPURenderer({ antialias: false });
const scene = new THREE.Scene();
```

using the real upstream Three.js renderer and scene objects in JavaScript.

### G2 — Establish an exact WebGPU workload contract

The desktop reference run must produce a machine-readable manifest of every operation required by the pinned cube workload. The trace, rather than intuition, defines the first console backend's supported subset.

### G3 — Produce deterministic, independently verifiable output

The spike must render one deterministic baseline frame plus a 300-step non-blank rotating-cube cycle—301 presentations total—and verify the result through at least two independent evidence channels:

1. **Guest-level framebuffer readback** produced by ThreeNative or its `webgpu.h` implementation.
2. **Host-level capture** produced by the emulator or capture tool, such as RenderDoc or an emulator screenshot path.

### G4 — Validate controller input

A controller or deterministic emulator input event must change a visible or hashed game state. Input cannot be considered proven merely because the platform reports a connected device.

### G5 — Keep the implementation bounded

The first implementation supports only operations reached by:

```text
BoxGeometry
+ MeshBasicMaterial
+ PerspectiveCamera
+ one rotating indexed mesh
+ depth testing
+ one surface
+ framebuffer readback
```

Everything else fails closed.

### G6 — Produce an evidence-backed go/no-go decision

The final report must distinguish:

- console-host feasibility;
- PS4 emulation feasibility;
- PS4 hardware feasibility;
- PS5 emulation feasibility;
- PS5 hardware feasibility;
- production JavaScript runtime feasibility.

---

## 4. Non-goals

This spike does **not** attempt to:

- implement full WebGPU conformance;
- pass the WebGPU CTS;
- support arbitrary Three.js scenes or materials;
- implement compute, post-processing, shadows, skinning, morph targets, or compressed textures unless the reference trace unexpectedly requires them;
- port V8 before the graphics seam is proven;
- publish a PlayStation Store package;
- distribute a jailbreak, exploit chain, Sony firmware, Sony system modules, signing keys, encryption keys, or leaked SDK material;
- replace Three.js's renderer;
- mirror `THREE.Scene` into C++;
- claim PS5 hardware support from an emulator result;
- optimize performance before correctness and evidence are stable.

---

## 5. Evidence taxonomy

Every run must emit exactly one platform evidence label:

| Label | Meaning | Permitted claim |
|---|---|---|
| `DESKTOP_REFERENCE` | Existing ThreeNative backend on desktop | Reference renderer is reproducible |
| `PS4_EMULATED` | PS4 ELF executed in a PS4 emulator | PS4 software path works under this emulator |
| `PS4_HARDWARE` | ELF/package executed on the physical PS4 | Unofficial PS4 hardware path works on the recorded model/firmware |
| `PS5_EMULATED` | PS5-format ELF executed in a PS5 emulator | PS5-shaped software path works under this emulator |
| `PS5_HARDWARE` | ELF executed on an owned or authorized PS5 | Unofficial PS5 hardware path works on the recorded model/firmware |
| `PS5_OFFICIAL_DEVKIT` | Build executed inside Sony's partner environment | Official platform backend works under its NDA-bound environment |

The following implication is forbidden:

```text
PS5_EMULATED == PASS
        ⇏
PS5_HARDWARE == PASS
```

Emulators may be more permissive than hardware, may omit cache/synchronization behavior, may normalize invalid descriptors, or may implement only the API patterns used by commercial games.

---

## 6. Reference workload

Create a dedicated deterministic scene, independent of product demos:

```text
tests/console/scenes/basic-indexed-cube.ts
```

Illustrative behavior:

```ts
const ROTATION_STEPS = 300;

function renderFrame(frame: number): void {
  if (frame < 0 || frame > ROTATION_STEPS) {
    throw new RangeError(`frame must be within 0..${ROTATION_STEPS}`);
  }

  cube.rotation.x = Math.PI * 0.25;
  cube.rotation.y = Math.PI * 2 * (frame / ROTATION_STEPS);
  renderer.render(scene, camera);
}

for (let frame = 0; frame <= ROTATION_STEPS; frame += 1) {
  renderFrame(frame);
}
```

### Fixed configuration

- Three.js revision pinned by commit or exact package lock.
- ThreeNative commit pinned.
- `webgpu.h` ABI/header revision pinned.
- Viewport: `1280 × 720`.
- Device pixel ratio: `1`.
- Surface format normalized to canonical RGBA8 during readback.
- No MSAA for the first proof.
- No temporal antialiasing or post-processing.
- Fixed camera and projection.
- Fixed random seed.
- Transform computed from frame index; do not accumulate `deltaTime`.
- No wall-clock-dependent behavior.
- No network or asynchronous asset dependency.
- Geometry and texture data embedded or generated deterministically.
- Shader optimization configuration recorded in the run manifest.

### Required capture frames

```text
frame-000.png   0°
frame-075.png  90°
frame-150.png 180°
frame-225.png 270°
frame-300.png 360°
```

Frame 000 is the baseline and frame 300 closes the 300-step cycle; they should be perceptually equivalent after normalization. Frames 075, 150, and 225 must be observably distinct.

---

## 7. Verification protocol

### 7.1 Guest evidence

The backend must copy the rendered image to a CPU-readable buffer and emit:

- width and height;
- canonical pixel format;
- row pitch before and after normalization;
- SHA-256 of canonical RGBA8 bytes;
- PNG output;
- readback completion status;
- frame number;
- surface generation ID.

Prefer the existing ThreeNative screenshot path when it already exercises the relevant API semantics. Do not depend solely on a desktop window screenshot.

### 7.2 Host evidence

Capture the emulator's host GPU work independently:

- shadPS4 screenshot or RenderDoc capture for the PS4 emulator lane;
- KytyPS5 RenderDoc capture, command-buffer dump, shader log, or host screenshot for the PS5 emulator lane;
- capture-card image or a console-side readback artifact for physical hardware.

Host captures validate that the emulator actually submitted and presented a frame. Guest readback validates that ThreeNative believes it rendered the expected pixels. Agreement between both channels is stronger than either alone.

### 7.3 Image assertions

For the clear-color gate, require byte-identical canonical RGBA8 output.

For the cube gate, require all of the following:

- dimensions exactly `1280 × 720`;
- non-background pixel count above a fixed threshold;
- object bounding box within a small reference tolerance;
- at least 99.5% of pixels within a small per-channel tolerance for the simple unlit scene, or an explicitly approved platform variance;
- structural similarity at or above the threshold recorded in the test manifest;
- frame 000 approximately equals frame 300;
- intermediate capture frames are pairwise distinct;
- no NaN/Inf values in captured transforms, uniforms, or normalized depth metadata;
- guest readback and host capture agree after crop, orientation, and color-space normalization.

Do not hide a bad result by weakening thresholds during a run. Threshold changes require a reviewed manifest revision and a new reference baseline.

### 7.4 Command and shader assertions

Record and assert:

- render pass count;
- draw count;
- `drawIndexed` index count;
- vertex/index buffer sizes and usage masks;
- bind-group and pipeline descriptor hashes;
- selected surface format;
- depth format;
- shader WGSL hash;
- generated SPIR-V hash when applicable;
- native shader binary hash when applicable;
- queue submission count;
- acquire/present sequence;
- fence/completion sequence;
- object creation and destruction balance.

---

## 8. Evidence bundle

Every run should write a self-contained bundle:

```text
artifacts/console-spike/
  <evidence-label>/
    <run-id>/
      manifest.json
      build-info.json
      result.json
      logs/
        guest.log
        host.log
        validation.log
      webgpu/
        calls.jsonl
        features.json
        limits.json
        object-lifetimes.jsonl
        descriptors/
      shaders/
        *.wgsl
        *.spv
        *.native.bin
        shader-map.json
      commands/
        frame-*.bin
        frame-*.json
      screenshots/
        guest/frame-000.png
        guest/frame-075.png
        guest/frame-150.png
        guest/frame-225.png
        guest/frame-300.png
        host/frame-*.png
        diffs/*.png
      captures/
        *.rdc
      input/
        events.jsonl
```

### Minimum `manifest.json`

```json
{
  "schema": "threenative.console-spike.v1",
  "evidenceLabel": "PS4_EMULATED",
  "threeRevision": "<exact revision>",
  "threeNativeRevision": "<exact revision>",
  "webgpuHeaderRevision": "<exact revision>",
  "backendRevision": "<exact revision>",
  "runtime": "quickjs",
  "runtimeRevision": "<exact revision>",
  "target": "ps4",
  "host": "shadps4",
  "hostRevision": "<exact revision>",
  "viewport": [1280, 720],
  "frameCount": 301,
  "rotationSteps": 300,
  "surfaceFormat": "<format>",
  "canonicalReadbackFormat": "rgba8unorm",
  "unsupportedOperations": [],
  "validationErrors": 0
}
```

A run is invalid when any revision is unknown.

---

## 9. Exact WebGPU subset discovery

Do not start the console backend by manually guessing the API subset.

Add a desktop trace mode at the existing `webgpu.h` boundary and run the exact console scene against the existing green desktop backend. The trace becomes the implementation contract.

### Trace requirements

For every API operation, capture:

- monotonically increasing call ID;
- thread ID;
- frame ID;
- operation name;
- normalized descriptor;
- object IDs consumed and produced;
- callback registration and completion;
- error scope state;
- result/status;
- resource state transition when relevant;
- source shader hash rather than unrestricted source duplication in normal logs;
- timing for diagnosis, excluded from deterministic comparisons.

### Expected first-cube categories

The exact list is trace-authoritative, but it will likely include some subset of:

- instance/adapter/device creation;
- surface configuration and current-texture acquisition;
- buffer creation and queue writes;
- texture creation and view creation;
- sampler creation if Three emits one for the selected path;
- shader module creation;
- bind-group layout and bind group creation;
- pipeline layout and render pipeline creation;
- command encoder creation;
- render-pass begin/end;
- pipeline, bind-group, vertex-buffer, and index-buffer binding;
- indexed draw;
- command-buffer finish;
- queue submit;
- presentation;
- copy-to-buffer and map/readback;
- error callbacks and object release.

The generated manifest must distinguish operations required by upstream Three.js from operations required only by the evidence harness:

```json
{
  "rendererRequired": [
    "wgpuDeviceCreateBuffer",
    "wgpuQueueWriteBuffer",
    "wgpuRenderPassEncoderDrawIndexed"
  ],
  "harnessRequired": [
    "wgpuCommandEncoderCopyTextureToBuffer",
    "wgpuBufferMapAsync"
  ]
}
```

The implementation must expose a generated capabilities file. An operation outside both sets produces a structured unsupported error and terminates the run.

---

## 10. Backend failure policy

The console backend must fail closed.

Bad:

```text
unsupported texture format
→ silently substitute RGBA8
→ render something plausible
```

Required:

```text
WGPU_UNSUPPORTED_TEXTURE_FORMAT
requested=...
callId=...
frameId=...
descriptorHash=...
```

Rules:

- no silent fallback to WebGL or a custom Three renderer;
- no silent format substitution;
- no ignored synchronization primitive;
- no ignored usage flag;
- no descriptor field accepted without either implementation or an explicit validated default;
- no emulator-only behavior hidden behind a generic `PS5` target name;
- all unsupported paths reported in `result.json`;
- validation warnings fail the first-cube lane unless explicitly allow-listed with a rationale.

---

## 11. Open-source landscape and intended use

The descriptions below are project-reported capabilities as of the research snapshot. They must be revalidated against pinned commits before implementation.

| Project | Role in the spike | What it can establish | What it does **not** establish | License consideration |
|---|---|---|---|---|
| [OpenOrbis PS4 Toolchain](https://github.com/OpenOrbis/OpenOrbis-PS4-Toolchain) | PS4 cross-compilation and homebrew foundation | PS4 ELF/build plumbing | WebGPU or PS5 support | GPL-3.0 repository; review what is linked or redistributed |
| [OpenGNM Stack](https://github.com/PS4-OpenGNM/opengnm-stack) | PS4 GNM, Vulkan-PS4 ICD, shader compiler, examples | Strongest current public path to a PS4 native graphics proof | PS5 AGC behavior | Stack reports MIT licensing; verify every vendored dependency |
| [opengnm-psbc](https://github.com/PS4-OpenGNM/opengnm-psbc) | SPIR-V → NIR → ACO → PS4/PS5-targeted shader binary research | Shader compiler structure; project reports real PS4 validation | PS5 resource management, queueing, sync, presentation, or hardware validation | MIT per repository; Mesa components retain their licenses |
| [shadPS4](https://github.com/shadps4-emu/shadPS4) | Primary PS4 emulator lane | Raw ELF boot, emulated rendering, screenshot/RenderDoc evidence | Physical PS4 behavior | GPL-2.0-or-later; use as a tool unless deliberate GPL integration is approved |
| [ps5-payload-dev/sdk](https://github.com/ps5-payload-dev/sdk) | Current payload-oriented PS5 ELF toolchain candidate | Build/load plumbing for exploited PS5 environments | Full application packaging or a GPU backend | GPL-3.0; repository notes artifacts originating from older PS5SDK work; provenance review required |
| [PS5Dev/PS5SDK](https://github.com/PS5Dev/PS5SDK) | Historical reference only | Earlier payload ABI/build concepts | Current primary SDK status; full applications | GPL-2.0; README is old and explicitly describes major limitations |
| [KytyPS5](https://github.com/KytyPS5/KytyPS5) | Primary PS5 emulator candidate | Raw ELF/game loading, Vulkan validation, command/shader dumps, RenderDoc capture, PS5-shaped GPU behavior | Compatibility with our payload ELF until proven; real PS5 behavior | GPL-2.0-only; safest initial use is external tooling and black-box execution |
| [Prosperity](https://github.com/Force67/prosperity) | Structural AGC/RDNA2 research oracle | AGC/PM4 command model, RDNA2 decode/resource research, isolated self-tests | Current end-to-end ThreeNative or general PS5 guest submission | GPL-2.0; use as reference/tool unless code reuse is explicitly approved |
| [ps5-payload-dev SDL](https://github.com/ps5-payload-dev/SDL) | PS5 platform bootstrap reference | SDL2-style platform support in payload environment | Hardware-accelerated WebGPU | Verify repository license and dependency chain at pin time |
| [Nativehbl](https://github.com/Rufidj/Nativehbl) | Homebrew launcher/platform reference | Native payload UI and input precedent | PS5 native WebGPU/AGC renderer | Treat as reference/tool; verify license before reuse |

### Important interpretation

- OpenGNM-PSBC is a useful compiler component, **not a PS5 backend**.
- Prosperity's PS5 GPU documentation says its current milestone is still a first triangle/clear path and that guest AGC DCB submission remains blocked in its tested title; it is therefore a structural oracle, not the primary end-to-end PS5 runner.
- KytyPS5 advertises raw ELF loading, but that does not prove that an ELF emitted by the chosen payload SDK has the correct entrypoint, imports, process assumptions, and ABI. That is the first PS5 gate.
- A GPL emulator can be safely used as an external development tool without automatically changing ThreeNative's license. Copying, statically linking, or deriving implementation code requires a separate licensing decision.

---

## 12. Workstreams

### WS-A — Reference trace and evidence harness

Shared by every platform. This workstream is the first dependency.

Deliverables:

- deterministic cube scene;
- `webgpu.h` trace recorder;
- operation/descriptor manifest generator;
- canonical framebuffer readback;
- image comparator;
- evidence bundle writer;
- run labels and machine-readable result schema.

### WS-B — PS4 toolchain and emulator runner

Deliverables:

- reproducible OpenOrbis/OpenGNM build environment;
- raw ELF smoke test in shadPS4;
- emulator launch script;
- host screenshot/RenderDoc capture;
- validation-log collection;
- exact emulator commit pin.

### WS-C — PS4 GPU backend

Deliverables:

- native clear/triangle;
- decision on `wgpu-native → Vulkan-PS4` feasibility;
- fallback narrow `webgpu.h → Vulkan-PS4/OpenGNM` implementation when necessary;
- WGSL/shader ingestion path;
- surface and presentation;
- framebuffer readback;
- physical PS4 runner.

### WS-D — PS5 toolchain and emulator compatibility

Deliverables:

- payload SDK selection and provenance record;
- minimal ELF artifact;
- KytyPS5 raw-ELF boot result;
- import/entrypoint compatibility report;
- emulator CLI runner with validation and dumps;
- explicit result label `PS5_EMULATED`.

### WS-E — PS5 GPU research backend

Deliverables:

- selected native submission seam;
- native clear/triangle under the emulator;
- minimal resource descriptor and command submission layer;
- shader ABI/container experiment;
- minimal `webgpu.h` object model;
- presentation/readback;
- untouched Three.js cube under the emulator.

### WS-F — JavaScript runtime feasibility

Deliverables:

- QuickJS console bootstrap;
- runtime-neutral host interface verification;
- separate V8 feasibility report covering executable memory, snapshots, threading, ICU, C++ runtime, build system, and JIT policy;
- console benchmark only after the graphics path is correct.

### WS-G — Legal, provenance, and licensing

Deliverables:

- source provenance ledger;
- SPDX/license inventory;
- “never enter the repository” policy;
- public homebrew versus private official-SDK boundary;
- counsel review trigger before public distribution of a PS5 backend or binary.

---

## 13. Roadmap and stage gates

Each gate must end in one of:

```text
PASS
FAIL — stop
FAIL — pivot using the named fallback
DEFERRED — evidence unavailable
```

No gate is passed on visual inspection alone.

### Gate 0 — Research and provenance baseline

**Objective:** Establish a clean, reproducible research environment.

Required:

- pin every external repository to an exact commit;
- record license and provenance;
- prohibit Sony firmware, decrypted modules, keys, SDK files, and confidential documentation from source control and CI artifacts;
- define which dependencies are executed as tools and which are linked into a binary;
- create the evidence-label enum and result schema;
- create a clean-room research log.

**Pass condition:** A reviewer can identify the source and license of every byte intended for a distributed artifact.

---

### Gate 1 — Desktop reference and exact API trace

**Objective:** Turn the cube into a precise backend contract.

Steps:

1. Run the pinned cube scene through the current desktop ThreeNative backend.
2. Capture all `webgpu.h` calls and descriptors.
3. Capture WGSL, normalized descriptor hashes, object lifetimes, and queue submissions.
4. Produce canonical readback frames and hashes.
5. Run the scene twice and prove deterministic evidence after excluding timestamps.
6. Generate `required-webgpu-subset.json`.

**Pass condition:** Two desktop runs produce equivalent manifests and image outputs with zero validation errors.

**Stop condition:** The reference workload is not deterministic or the trace cannot be attributed to exact frames and object IDs.

---

### Gate 2A — PS4 emulator ELF smoke test

**Objective:** Prove the build/launch loop before graphics integration.

Steps:

1. Build a minimal PS4 ELF with the pinned OpenOrbis toolchain.
2. Emit structured startup logs and a deterministic exit code.
3. Launch the ELF directly in shadPS4.
4. Collect emulator logs and artifact metadata.
5. Verify that no untracked Sony binary is required for this minimal path.

**Pass condition:** The ELF reaches its entrypoint, writes the expected marker, and exits or idles deterministically under shadPS4.

---

### Gate 2B — PS5 emulator ELF compatibility test

**Objective:** Determine whether the chosen PS5 payload ELF can execute in the primary emulator.

Steps:

1. Build a minimal ELF with the pinned payload SDK.
2. Record ELF headers, entrypoint, dynamic imports, and expected loader contract.
3. Launch it with KytyPS5's raw-ELF path.
4. Enable guest printf output, Vulkan validation, shader validation, and command-buffer dumps where applicable.
5. Record the failure stage when it does not boot.

**Pass condition:** The ELF reaches the expected application/payload entrypoint and emits a deterministic marker.

**Pivot:** Build a small, original packaging/import adapter that remains free of Sony binaries and confidential material.

**Stop condition:** Execution requires redistributing protected Sony material or relies on an emulator-only host callback that cannot exist on hardware.

---

### Gate 3A — PS4 native clear and triangle

**Objective:** Prove PS4 GPU submission, synchronization, presentation, and readback without JavaScript or WebGPU.

Steps:

1. Build and run the OpenGNM clear/triangle example in shadPS4.
2. Capture the host frame and command/shader evidence.
3. Run the same artifact on the physical PS4 when its firmware permits.
4. Add guest framebuffer readback and a canonical hash.
5. Confirm clear color exactly and triangle image within the test threshold.

**Pass condition to advance:** `PS4_EMULATED` passes with guest and host evidence. A physical run may be recorded here when available, but only Gate 7 closes `PS4_HARDWARE`.

---

### Gate 3B — PS5 native clear and triangle under emulation

**Objective:** Prove a PS5-shaped GPU path before ThreeNative is involved.

Research the native submission seam in this order:

1. clean-room declarations resolving public runtime symbols for the native graphics libraries;
2. payload-accessible queue/device mechanisms already modeled by the emulator;
3. direct original AGC/PM4 packet construction and submission where legally and technically supportable;
4. emulator-only shim only as an explicitly separate diagnostic target, never as the production PS5 backend.

Required behavior:

- create or acquire a displayable surface/buffer;
- clear it;
- submit one triangle;
- wait for completion;
- present;
- read back or capture the result;
- record command and shader evidence.

**Pass condition:** A native PS5-format ELF presents a verifiable triangle in the emulator through a path that is plausibly available on hardware.

**Stop condition:** The only functioning path bypasses the guest PS5 graphics model through emulator-specific APIs.

---

### Gate 4A — PS4 `wgpu-native` portability probe

**Objective:** Determine whether the existing wgpu-native architecture can be retained on PS4 through Vulkan-PS4.

This is a probe, not a commitment.

Audit:

- Rust target support for the PS4 environment;
- threading, atomics, TLS, filesystem, and allocator assumptions;
- C/C++ runtime and unwind requirements;
- Vulkan version and extension requirements of the pinned wgpu-native revision;
- surface creation integration;
- shader compiler path;
- dynamic library and loader assumptions;
- binary size and memory pressure.

Then attempt, in order:

1. compile the relevant wgpu-native core and C API for PS4;
2. initialize the Vulkan backend against Vulkan-PS4;
3. enumerate an adapter/device;
4. clear a surface;
5. render a triangle.

**Pass condition:** The pinned wgpu-native revision initializes and renders without platform-specific semantic forks.

**Pivot condition:** Required Vulkan features or Rust/platform assumptions exceed the PS4 stack. Pivot to Gate 4A-Fallback rather than modifying Three.js.

#### Gate 4A-Fallback — Narrow PS4 `webgpu.h` backend

Implement the exact traced subset directly over Vulkan-PS4/OpenGNM.

Suggested internal boundaries:

```text
WgpuObjectRegistry
WgpuResourceStateTracker
WgpuDescriptorValidator
WgpuShaderCompiler
WgpuPipelineCache
WgpuCommandEncoder
WgpuQueue
WgpuSurface
WgpuReadback
```

**Pass condition:** The WebGPU triangle matches the native triangle and produces balanced object lifetimes and zero validation errors.

---

### Gate 4B — Narrow PS5 `webgpu.h` backend

**Objective:** Implement only the WebGPU semantics required by the reference trace over the proven native PS5-emulator graphics path.

Minimum areas:

- device and queue lifecycle;
- descriptor-chain (`sType`/`next`) validation for the pinned `webgpu.h` ABI;
- buffers and memory upload;
- color/depth textures and views;
- bind-group layouts and bind groups;
- pipeline layouts and render pipelines;
- command encoders and render passes;
- vertex/index binding and indexed draw;
- resource transitions/barriers;
- submission, completion, and error propagation;
- surface acquire/configure/present;
- copy/readback;
- deterministic object destruction.

**Pass condition:** A C/C++ test written against the same pinned `webgpu.h` ABI renders and verifies the triangle under the PS5 emulator.

---

### Gate 5 — Shader path

The first proof should avoid combining every unknown at once.

#### Phase 5.1 — Known-shader lookup

Allow `wgpuDeviceCreateShaderModule` to receive the real WGSL emitted by untouched Three.js. For the pinned cube scene:

```text
WGSL source
  ↓ SHA-256
known-shader manifest
  ↓
precompiled platform shader binary
```

Unknown shader hashes fail closed.

This proves the Three.js/WebGPU/backend seam without requiring a complete on-console compiler.

#### Phase 5.2 — Offline general compilation

Candidate pipeline:

```text
WGSL
  ↓ Tint or Naga
SPIR-V
  ↓ NIR
ACO
  ↓
platform-native shader ISA/container
```

For PS4, OpenGNM-PSBC is a concrete candidate for the SPIR-V-to-native portion.

For PS5, OpenGNM-PSBC's GFX10.3 code generation may inform the compiler stage, but the backend must independently prove the PS5 AGC shader ABI/container, resource descriptors, and input-usage conventions. Do not assume a PS5-targeted binary emitted by that project is directly consumable by the intended AGC path.

#### Phase 5.3 — Runtime compiler decision

Only after offline compilation works, decide whether production requires:

- bundled on-device compiler;
- build-time shader baking;
- first-run offline compilation;
- a hybrid cache keyed by Three.js revision, WGSL hash, platform, compiler revision, and feature manifest.

**Pass condition:** The pinned cube's untouched WGSL is accepted through `wgpuDeviceCreateShaderModule`, maps to recorded native shaders, and renders correctly.

---

### Gate 6 — QuickJS + untouched Three.js cube

**Objective:** Prove the complete architecture, not production performance.

Required stack:

```text
QuickJS
  ↓
actual bundled application JavaScript
  ↓
upstream three/webgpu
  ↓
upstream WebGPURenderer
  ↓
existing ThreeNative JS WebGPU bindings
  ↓
existing packed transport
  ↓
console webgpu.h backend
  ↓
console/emulator graphics path
```

Required result:

- one baseline plus 300 rotation steps submitted and presented, for 301 total presentations;
- required frame captures;
- zero unsupported WebGPU operations;
- zero validation errors;
- object lifetime balance after shutdown;
- guest and host evidence agreement;
- deterministic controller event changes a visible property;
- final evidence bundle marked `PS4_EMULATED`, `PS4_HARDWARE`, or `PS5_EMULATED` as applicable.

QuickJS passing this gate proves the architecture. It does not satisfy the production runtime gate.

---

### Gate 7 — Physical PS4 proof

**Objective:** Validate ThreeNative on real console hardware already available to the project.

Initial non-destructive inventory:

- PS4 model;
- system software version;
- free storage;
- network topology;
- controller model;
- output resolution;
- whether current system state is eligible for an authorized homebrew test path.

Do not update the console before this inventory is recorded.

Run the same deterministic artifact and collect:

- guest log;
- guest framebuffer hashes/PNGs;
- controller events;
- frame/present counters;
- crash or watchdog status;
- capture-card or camera evidence only as secondary corroboration;
- exact hardware/firmware label.

**Pass condition:** The physical PS4 produces the expected guest framebuffer artifacts and controller-driven state change for the baseline plus the complete 300-step cycle.

---

### Gate 8 — PS5 emulator proof

**Objective:** Close the emulator-only PS5 spike.

Required:

- exact KytyPS5 or alternative emulator revision;
- raw ELF launch command and config;
- Vulkan and shader validation enabled;
- guest readback evidence;
- host RenderDoc or emulator capture;
- command/shader dump;
- API subset manifest;
- controller/input result;
- zero unsupported calls and zero validation errors;
- evidence label `PS5_EMULATED`.

**Pass condition:** Untouched upstream Three.js renders the deterministic cube through the guest's PS5-shaped backend under the emulator.

The conclusion must read:

> “ThreeNative's PS5 backend architecture passes the pinned emulator-conformance workload.”

It must not read:

> “ThreeNative supports PS5 hardware.”

---

### Gate 9 — PS5 hardware oracle

This gate is outside the initial no-PS5 environment, but the spike must design for it.

Possible future runners:

1. an owned PS5 whose firmware and legal test environment permit homebrew execution;
2. a trusted external hardware runner that returns the complete evidence bundle;
3. an official Sony dev/test kit after partner approval.

The hardware runner protocol must accept a content-addressed artifact and return:

```text
artifact hash
hardware model
firmware/system version
evidence label
stdout/stderr
frame hashes
PNG captures
controller event log
exit/crash status
runner attestation
```

A remote runner is not trusted solely because it returns a screenshot. The returned framebuffer hashes and artifact hash must match the request.

---

### Gate 10 — Production JavaScript runtime

Only start this after a console graphics gate passes.

#### QuickJS result interpretation

- proves host/runtime abstraction;
- proves WebGPU bindings;
- proves command transport;
- proves basic memory and event-loop integration;
- does not prove acceptable game performance.

#### V8 feasibility questions

- Can V8 compile for the target libc/C++ environment?
- Are executable-memory allocation and W^X transitions permitted?
- Is JIT allowed in the unofficial environment?
- Can snapshots be embedded and loaded?
- Are threads, TLS, atomics, and guard pages available?
- What ICU configuration is required?
- What is the binary and resident-memory cost?
- Can platform jobs and microtasks integrate with the console loop?
- Can the existing packed transport remain unchanged?

**Pass condition:** The runtime executes the same cube artifact and a representative ThreeNative stress workload with a documented, acceptable frame-time distribution.

This is a separate feasibility project. Do not let it block the first graphics proof.

---

## 14. Recommended implementation order

### Critical path

```text
Gate 0
  ↓
Gate 1 desktop trace/evidence
  ↓
Gate 2A PS4 ELF
  ↓
Gate 3A PS4 native triangle
  ↓
Gate 4A wgpu-native probe
  ├── pass → use wgpu-native
  └── fail → narrow PS4 webgpu.h backend
  ↓
Gate 5 shader path
  ↓
Gate 6 QuickJS + Three cube in shadPS4
  ↓
Gate 7 physical PS4
```

### Parallel PS5 lane

```text
Gate 0
  ↓
Gate 1 shared trace/evidence
  ↓
Gate 2B payload ELF in KytyPS5
  ↓
Gate 3B native PS5-emulator triangle
  ↓
Gate 4B narrow PS5 webgpu.h backend
  ↓
Gate 5 shader path
  ↓
Gate 6 QuickJS + Three cube
  ↓
Gate 8 PS5 emulation proof
  ↓
Gate 9 future hardware oracle
```

The PS5 lane should stop before Three integration when the native triangle is not proven. ThreeNative cannot resolve an unknown guest GPU submission path.

---

## 15. Suggested repository layout

The actual ThreeNative repository was not inspected during this research, so these paths are illustrative and should be adapted to existing conventions.

```text
docs/
  spikes/
    2026-08-27-playstation-console-spike.md
  adr/
    console-webgpu-boundary.md
    ps4-backend-selection.md
    ps5-evidence-taxonomy.md
  provenance/
    playstation-research-sources.md

src/
  console/
    common/
      evidence/
      input/
      platform/
  webgpu/
    console-common/
      object_registry.*
      descriptor_validation.*
      resource_state.*
      trace.*
    ps4/
      device.*
      queue.*
      surface.*
      shader.*
      command_encoder.*
    ps5/
      device.*
      queue.*
      surface.*
      shader.*
      command_encoder.*

platforms/
  ps4/
    toolchain/
    host/
    packaging/
  ps5/
    toolchain/
    host/
    packaging/

tests/
  console/
    scenes/
      basic-indexed-cube.ts
    manifests/
      required-webgpu-subset.json
    references/
    structural/
    image/

tools/
  console/
    run-reference
    run-shadps4
    run-kyty
    compare-evidence
    inspect-elf
    package-evidence
```

Keep PS4 and PS5 packet/resource implementations separate. Share the WebGPU semantic layer only where the behavior is genuinely platform-neutral.

---

## 16. Decision alternatives

### Alternative A — Port wgpu-native to PS4 over Vulkan-PS4

**Recommendation:** Attempt as a bounded feasibility probe.

**Advantages**

- preserves the existing Android/iOS lower architecture;
- inherits a mature WebGPU object model and validation;
- minimizes custom WebGPU semantics;
- keeps upstream Three.js entirely unchanged.

**Risks**

- pinned wgpu-native may require Vulkan functionality beyond Vulkan-PS4's current implementation;
- Rust target/runtime support may be substantial;
- threading, TLS, atomics, allocator, and surface integration may fail;
- compiler and binary-size requirements may be unsuitable.

**Decision rule:** Continue only when the exact pinned wgpu-native revision clears the platform and Vulkan capability audit without creating a long-lived fork.

### Alternative B — Narrow custom `webgpu.h` backend

**Recommendation:** PS4 fallback and expected PS5 research approach.

**Advantages**

- exact fit to the existing ThreeNative boundary;
- implement only the traced subset;
- deterministic fail-closed behavior;
- no Three.js fork;
- allows platform-native control of resource and command semantics.

**Risks**

- WebGPU semantics are larger than the first cube;
- synchronization and object lifetime bugs are easy to hide;
- surface and shader behavior can become platform-specific;
- growth beyond the spike may become an engine project.

**Decision rule:** Keep the implementation generated-manifest-driven and refuse scope growth until the initial cube gate is closed.

### Alternative C — Custom Three.js renderer backend

**Recommendation:** Reject.

It duplicates renderer internals, creates a maintenance fork, bypasses the architecture already proven by ThreeNative, and weakens the claim that upstream `WebGPURenderer` works across the native matrix.

### Alternative D — Embed a browser/WebView

**Recommendation:** Reject.

It is contrary to the current architecture, adds a heavyweight dependency, and does not solve console browser/WebGPU availability.

---

## 17. Risk register

| Risk | Severity | Detection | Mitigation / decision |
|---|---:|---|---|
| Emulator accepts invalid guest behavior | Critical | Hardware mismatch, validation discrepancy | Require guest readback + host capture; keep evidence labels; later hardware oracle |
| Payload ELF does not boot in KytyPS5 | High | Gate 2B | Build original packaging/import adapter; stop if protected Sony material is required |
| PS5 native GPU submission seam is unavailable to payloads | Critical | Gate 3B | Stop PS5 Three integration; continue structural research only |
| AGC resource descriptors or synchronization are misunderstood | Critical | Validation errors, hangs, divergent captures | Native triangle first; structural tests; command dumps; no silent barriers |
| Shader binary ABI/container is wrong on PS5 | Critical | Pipeline creation or corrupted draw | Known-shader gate; hash every compiler stage; validate against emulator and later hardware |
| OpenGNM-PSBC PS5 claims are not hardware-validated | High | Source review and hardware absence | Treat as compiler research only; never cite as PS5 backend evidence |
| wgpu-native cannot target PS4/Vulkan-PS4 | High | Gate 4A | Pivot to narrow custom backend; do not fork Three.js |
| QuickJS gives misleading production confidence | High | Representative benchmark | Label bootstrap-only; V8 is a separate gate |
| V8 JIT cannot operate in unofficial console environment | High | Gate 10 | Preserve runtime abstraction; evaluate interpreter/AOT alternatives only after graphics proof |
| Physical PS4 firmware is not compatible | Medium | Non-destructive inventory | Keep PS4 emulator lane; acquire/borrow compatible hardware only after legal review |
| GPL code contaminates intended distribution model | High | SPDX/dependency audit | Use emulators as tools; prefer MIT components; isolate or replace linked GPL components before incompatible distribution |
| Leaked/confidential Sony material enters the repo | Critical | Provenance audit | Hard deny-list, clean-room log, binary scanning, counsel escalation |
| Scope expands toward full WebGPU | High | Manifest growth | Freeze first-cube subset; every new operation requires a new approved workload gate |
| Golden image becomes flaky | Medium | Repeated reference runs | Deterministic transform, fixed format, canonical readback, versioned thresholds |
| Emulator host screenshot hides guest readback bug | High | Evidence mismatch | Require both channels and compare normalized images |
| PS4 result is incorrectly treated as PS5 proof | High | Review language | Separate gates, source directories, evidence labels, and final conclusions |

---

## 18. Legal and provenance guardrails

This is an engineering policy, not legal advice.

### Allowed into the public research repository

- original ThreeNative code;
- public open-source dependencies used according to their licenses;
- clean-room declarations and structures derived from lawful public interoperability research;
- experimentally derived behavior and constants with recorded provenance;
- public emulator behavior and tests;
- original shaders, command encoders, validation tools, and evidence artifacts that contain no Sony material;
- documentation linking to public sources.

### Forbidden from the repository and shared artifacts

- Sony SDK binaries, headers, samples, or confidential documentation;
- leaked partner materials;
- firmware images;
- decrypted `.sprx` or other system modules;
- signing/encryption/decryption keys;
- copyrighted Sony shader/compiler implementation;
- exploit chains or consumer jailbreak bundles as part of ThreeNative;
- files copied from a devkit;
- emulator test fixtures containing commercial game assets;
- build logs that accidentally embed confidential paths or binary dumps.

### Public versus official backend boundary

```text
public/
  ps4-homebrew/
  ps5-clean-room-research/

private NDA environment/
  playstation-official/
```

The public backend's concepts may inform a clean interface, but confidential official-SDK knowledge must not be copied back into the public implementation.

### Licensing rules

- Record licenses at exact commits, not only repository landing pages.
- Distinguish “executed as a tool” from “linked into a distributed binary.”
- Review GPL obligations before distributing any binary linked with GPL components.
- Prefer subprocess/tool boundaries for GPL emulators and diagnostic utilities when ThreeNative's license model should remain independent.
- Preserve notices for Mesa, LLVM, ACO, SPIR-V, and other vendored compiler components.
- Trigger an IP lawyer review before publishing an unofficial PS5 backend or broadly usable PS5 binary.

---

## 19. Spike success criteria

### Console architecture success

All must be true:

- upstream pinned `three/webgpu` and `WebGPURenderer` are unchanged;
- the real scene and renderer remain in JavaScript;
- the existing ThreeNative WebGPU binding layer remains the API boundary;
- no second renderer or C++ scene mirror exists;
- the console backend implements the traced `webgpu.h` subset;
- one baseline plus a complete 300-step cycle are rendered and presented, for 301 total presentations;
- required captures are non-blank and pass image checks;
- controller input changes a verified state;
- guest and host evidence agree;
- zero unsupported operations and validation errors occur;
- evidence bundle is complete and reproducible.

### PS4 success

- `PS4_EMULATED` passes; and
- preferably `PS4_HARDWARE` passes on the recorded console/firmware.

A physical PS4 pass is a meaningful console result even though PS5 remains unresolved.

### PS5 emulation success

- `PS5_EMULATED` passes through a PS5-shaped guest graphics path;
- the native triangle precedes Three integration;
- emulator-specific shortcuts are excluded from the production target;
- conclusion remains explicitly emulator-scoped.

### PS5 hardware success

Only granted when the same content-addressed artifact, or a documented hardware-equivalent build, passes on a real PS5 or official dev/test kit.

### Production success

Not part of this spike. It additionally requires a production JS runtime, representative scenes, memory targets, frame-time targets, input/audio/assets, suspend/resume, crash handling, and platform certification work.

---

## 20. No-go and pivot conditions

Stop or pivot when any of these occur:

1. **Reference instability:** the desktop cube cannot produce deterministic traces and readbacks.
2. **Protected-material dependency:** PS4/PS5 execution requires redistributing Sony firmware, keys, modules, or confidential SDK material.
3. **Renderer fork pressure:** the proposed solution requires changing or replacing Three.js `WebGPURenderer` rather than implementing the existing boundary.
4. **PS5 native primitive failure:** no plausible guest-native clear/triangle can be produced under the emulator.
5. **Emulator-only trap:** rendering works only through a host callback unavailable on hardware.
6. **Unbounded API growth:** the cube trace unexpectedly expands into a substantial general WebGPU implementation without a new decision.
7. **License incompatibility:** a required linked dependency cannot be distributed under the intended ThreeNative licensing model.
8. **Opaque success:** only a screenshot exists, without guest readback, artifact hash, logs, and revision metadata.

Named pivots:

- `wgpu-native → Vulkan-PS4` fails → narrow PS4 `webgpu.h` backend.
- on-console shader compiler is too large → offline compilation and content-addressed shader cache.
- PS4 hardware unavailable due firmware → continue PS4 emulator lane and defer hardware label.
- PS5 payload ELF incompatible with emulator → original packaging/import adapter, subject to clean-room constraints.
- V8 blocked → retain QuickJS for architecture proof and open a separate runtime feasibility decision.

---

## 21. Concrete first actions

Execute these in order:

1. Add this spike to the ThreeNative repository and assign an owner to each workstream.
2. Freeze exact Three.js, ThreeNative, `webgpu.h`, Dawn/wgpu-native, and compiler revisions.
3. Implement the deterministic cube and desktop evidence bundle.
4. Add `webgpu.h` tracing and generate the exact required subset manifest.
5. Record the physical PS4 model and system software version without updating it.
6. Build and pin shadPS4; verify raw ELF launch and host capture.
7. Build and pin OpenOrbis plus the OpenGNM stack; verify its clear/triangle under shadPS4.
8. Verify the same primitive on the physical PS4 when the console state permits.
9. Run the bounded wgpu-native/Vulkan-PS4 feasibility probe.
10. In parallel, build and pin KytyPS5 and the chosen PS5 payload SDK.
11. Test the minimal PS5 ELF's entrypoint and imports under KytyPS5 before writing GPU code.
12. Use KytyPS5 command/shader dumps and Prosperity's public AGC/RDNA2 research to design the native PS5 primitive gate.
13. Do not connect QuickJS or Three.js to either target until that target can render and verify a native triangle.
14. After the WebGPU triangle passes, connect the existing ThreeNative host and known-shader lookup.
15. Close the spike with a findings report using the evidence labels and success language defined here.

---

## 22. Expected final deliverables

- this spike/decision document;
- exact source and license provenance ledger;
- deterministic cube scene;
- desktop `webgpu.h` trace;
- generated first-cube API subset manifest;
- reference PNGs and hashes;
- PS4 emulator runner;
- PS4 native triangle evidence;
- PS4 `wgpu-native` feasibility report;
- PS4 WebGPU triangle/cube evidence;
- physical PS4 evidence when available;
- PS5 ELF compatibility report;
- PS5 native-emulator triangle evidence or a documented stop decision;
- PS5 minimal WebGPU backend evidence when feasible;
- PS5 emulator cube evidence labeled `PS5_EMULATED`;
- runtime feasibility follow-up charter;
- final go/no-go report with no unsupported hardware claims.

---

## 23. Final recommendation

Proceed.

The project is credible because the upper architecture is already built: untouched Three.js, JavaScript-owned scene state, browser-compatible WebGPU bindings, a C `webgpu.h` seam, packed transport, runtime abstractions, screenshot support, and native conformance infrastructure.

The safest and most informative path is:

```text
PS4 emulator
  ↓
PS4 physical hardware
  ↓
PS5 payload/emulator compatibility
  ↓
PS5 native triangle under emulation
  ↓
minimal PS5 webgpu.h backend
  ↓
untouched Three.js cube
  ↓
future PS5 hardware oracle
```

The strongest near-term win is a real ThreeNative cube on the existing PS4. It proves that ThreeNative's architecture can cross into a native console environment without a browser, renderer fork, or C++ scene mirror.

The PS5 work is also worth beginning now, but it should remain a gated research lane until a native PS5-shaped clear/triangle and an independently verifiable emulator run exist. The correct first PS5 claim is not “PS5 support”; it is:

> **Untouched Three.js `WebGPURenderer` successfully drove a minimal clean-room `webgpu.h` implementation through a PS5 emulator's guest graphics model, with deterministic guest readback and independent host-GPU evidence.**

That would be a serious architectural result and a defensible basis for acquiring hardware or entering Sony's partner environment.

---

## 24. Sources reviewed

Open-source project status changes quickly. Recheck these sources and pin exact commits when the spike starts.

### PS4

- [OpenOrbis PS4 Toolchain](https://github.com/OpenOrbis/OpenOrbis-PS4-Toolchain)
- [OpenGNM Stack](https://github.com/PS4-OpenGNM/opengnm-stack)
- [OpenGNM shader compiler](https://github.com/PS4-OpenGNM/opengnm-psbc)
- [shadPS4](https://github.com/shadps4-emu/shadPS4)

### PS5 payloads and platform plumbing

- [ps5-payload-dev SDK](https://github.com/ps5-payload-dev/sdk)
- [PS5Dev PS5SDK](https://github.com/PS5Dev/PS5SDK)
- [ps5-payload-dev SDL](https://github.com/ps5-payload-dev/SDL)
- [Nativehbl](https://github.com/Rufidj/Nativehbl)

### PS5 emulation and graphics research

- [KytyPS5](https://github.com/KytyPS5/KytyPS5)
- [Prosperity](https://github.com/Force67/prosperity)
- [Prosperity PS5 GPU notes](https://github.com/Force67/prosperity/blob/master/delta/gpu/ps5/README.md)

### Official route

- [PlayStation Partners](https://partners.playstation.net/)
- [Sony complimentary development hardware program](https://sonyinteractive.com/en/news/blog/complimentary-development-hardware/)


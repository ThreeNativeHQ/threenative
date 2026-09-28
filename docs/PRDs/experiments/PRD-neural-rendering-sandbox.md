# PRD — Experimental Neural Rendering Sandbox

**Status:** NOT STARTED — specification only; implementation 0%.  
**Date:** 2026-09-28.  
**Owner:** ThreeNative rendering / sandbox maintainers.  
**Scope:** One opt-in sandbox, one provider-neutral render contract, one initial OpenDLSS-NR adapter.  
**Targets:** Browser WebGPU and Linux x64 native WebGPU, qualified independently.  
**Integration base inspected:** `develop` at `9ca18502207f107a83ca4acf6d44f7d30386aeee`.  
**Filing:** Descriptive experimental PRD; no global numeric identifier reserved. Keep one draft PR for this PRD and its implementation.

## Outcome

A developer opens a user-like, installed ThreeNative sandbox, captures a rendered scene, and compares the original with a neural-enhanced version of **the same frame**. The sandbox makes model loading, supported controls, processing cost, memory estimates, temporal failures, and fallback visible. An explicitly selected live-preview mode is a research option, not a gameplay default.

The initial provider evaluates the independent OpenDLSS-NR browser/WGSL implementation. This is **same-resolution neural image enhancement**, not DLSS Super Resolution, frame generation, a replacement for geometry, or an FPS optimization. Do not advertise official NVIDIA integration, arbitrary model loading, GGUF support, or production readiness.

Success has two distinct levels: a working, cross-runtime integration using a redistributable deterministic compute fixture; and separately qualified neural output using authorized model data. The first never substitutes for the second. Missing weights must not prevent implementation of the integration, but must prevent any claim that real neural rendering is qualified.

## Existing systems and boundaries

The inspected sources already provide the following. Extend them only where the experiment proves a missing mechanism.

| Existing surface | Reuse and boundary |
| --- | --- |
| [`IRendererLike`][renderer] | `kind`, `raw`, `compute`, `setOutputNode`, `renderOverlay`, `createRenderChain`, GPU-frame samples, and resolution observations exist. Its interface does **not** currently expose a typed external-WGSL texture/device interop contract. |
| [`RenderChain`][chain] | Accepts game-supplied stage IDs, `before`/`after` anchors, availability reasons, velocity requirements, disposal, and measured tier selection. Reuse this; do not add a second composer or global provider registry. |
| [`velocity.ts`][velocity] | Provides MRT velocity and previous rigid, instance, and skeleton state. Reuse the actual scene pass; do not build another transform-history system. |
| [Rendering guide][rendering-guide] and [repository rules][rules] | The game owns the look in generated `src/render/`; core owns cross-runtime plumbing. A core addition needs native proof in the same implementation commit. |
| [AI view-projection draft PR #379][view-projection] | Offline image acquisition and projection onto geometry is a separate authoring workflow. No OpenRouter calls, API keys, paid generation, or hard dependency on that PR belong here. |

The current stage `build` callback constructs a graph; it is not an asynchronous per-frame inference hook. A `beforeRender` callback alone also does not prove that the current scene texture has been rendered. The implementation must prove render/compute/composite order, not infer it from callback names.

Before adding implementation files or toggling render stages, run the repository's capability-search/detail workflow and check the then-current manifest. This specification does not claim that those MCP queries or a GPU experiment have run.

## Upstream evidence and limits

Reference revision: OpenDLSS-NR `9d08f4184bbcb9d858e2fb7a7834ec0837a9d2f1`, inspected on 2026-09-28. Pin any adopted source to a reviewed revision and preserve its license and notices.

The [upstream overview][upstream] describes a fixed network and approximately 141 MiB of model weights, supplied separately. That is **not** total GPU memory: activations, retained tensors, weight repacking, history, staging, and render targets add to it. The [browser README][browser-port] reports approximately 465 ms of inference plus 15 ms of WebGL readback at 1904×929. These are the author's observations, not ThreeNative measurements, and are not a performance target or a promise for another GPU.

Source-level integration findings:

- [`Network.create`][network] accepts an existing device and model. Its `run()` submits work and awaits queue completion; do not directly await that convenience method from the normal render loop.
- In that revision, `destroy()` destroys the device when `borrowedModel` is false, even though device and model can be supplied independently. An adapter must track their ownership independently and **never destroy ThreeNative's device**.
- [`gpu.js`][gpu] requests elevated limits at device creation. Inspect the actual renderer device's limits, not just adapter maxima. The browser port documents a 32 KiB workgroup-storage requirement. An already-created device cannot be treated as though it acquired higher limits afterward.
- The upstream demo bridges WebGL and WebGPU through CPU arrays. That is a diagnostic reference, not the accepted ThreeNative steady-state transport.

Upstream parity fixtures and weights are not supplied by this PR. Upstream bit-exactness claims must not be restated as cross-vendor, cross-runtime, or ThreeNative guarantees.

## Chosen approach

Use a game-owned `NeuralRenderPass` composition and a small local `INeuralRenderProvider` contract, attached to the existing render chain. Keep neural appearance, proxy construction, conditioning, and compositing editable in the generated game's `src/render/neural/`. Start with a deterministic fixture provider and an explicitly named `opendlss-nr-webgpu` adapter.

Prefer supported Three.js node/resource APIs. Where raw WGSL interop requires backend knowledge, isolate it behind the smallest typed core renderer seam, with version guards and browser/native tests. Generated game code must not reach into private backend resource maps or create another device. Do not expose a public engine-wide provider API merely to support one experiment.

Alternatives not selected: copy the WebGL/readback demo unchanged (useful as an upstream reference, but bypasses the intended pipeline); or implement a native Vulkan/NVIDIA integration first (a different device/backend and distribution project). Official SDK integration, custom training, alternative networks, and optimization forks require separate follow-up PRDs.

```mermaid
flowchart LR
  Scene["Game world pass: color and optional motion/depth"] --> Proxy["Game-owned display-proxy conversion"]
  Proxy --> Bridge["Same-device GPU bridge"]
  Bridge --> Provider["Fixture or OpenDLSS-NR provider"]
  Provider --> Composite["Game-owned output composition"]
  Scene --> Fallback["Original frame"]
  Fallback --> Compare["Matched-frame comparison"]
  Composite --> Compare
  Compare --> UI["HUD / overlay excluded from inference"]
```

### Provider and frame contract

The following are proposed responsibilities, not existing exported APIs:

| Responsibility | Required contract |
| --- | --- |
| Describe | Provider ID/revision; input/output formats and color domain; dimension/alignment rules; required features/limits; optional motion/history; supported numeric controls; model identity. Unsupported controls stay hidden or explicitly disabled. |
| Prepare | Validate model metadata and actual device limits before allocating; estimate live and peak bytes; load/compile asynchronously with progress and cancellation. |
| Encode | Borrow the renderer device and explicitly owned inputs; schedule GPU work after this frame's source pass and before consuming its result. Record source frame ID and resource-generation ID. |
| Complete | Publish only a successfully completed, valid result; report timing provenance, result age, and failure. Keep at most one inference in flight. |
| Reset / dispose | Invalidate history or stale generations; stop new submissions; retire owned allocations only when safe. Never dispose borrowed device, queue, source textures, or shared model resources. |

Inputs carry source frame ID, dimensions, valid crop/padding, texture format, color-domain/exposure metadata, and optional velocity/depth with defined units and conventions. Outputs carry matching identity and validity. Validate ownership, usage flags, format compatibility, and dimensions before encoding. No object crosses GPU devices.

Model loading is data-only. Require a versioned manifest, byte lengths and hashes for stage files, fixed graph compatibility, and bounded dimensions/counts/allocations. Reject malformed or mismatched inputs, path traversal, disallowed URL origins, partial downloads, and excess memory before execution. Do not execute URLs or shader source named by an untrusted model. The implementation supplies reviewed, pinned shaders.

### GPU integration and color correctness

Prove the full path with a deterministic compute transform before integrating model weights: current world texture -> GPU conversion -> compute output -> display. No per-frame image `readPixels`, `mapAsync`, canvas extraction, CPU tensor staging, or network request is permitted in the accepted path. One-time asset upload and bounded asynchronous diagnostic/timestamp readback are allowed and reported separately.

Preserve the existing pipeline when disabled. Do not request a second WebGPU device as a workaround. If the running device lacks required limits, report the exact mismatch and bypass; an opt-in pre-creation request may be added only through existing renderer initialization without weakening ordinary device acquisition/fallback.

The upstream network consumes a display proxy; do not feed scene-linear HDR as if it were display-referred color. The game defines the conversion, exposure, reconstruction/composition, and position relative to bloom and other effects. Apply output transfer/tone conversion exactly once. Use a gray ramp, saturated colors, and an HDR highlight fixture to detect double tonemapping, channel errors, clipping, and flipped coordinates. HUD and readable text bypass inference.

The initial network uses a fixed manifest/graph contract, not a generic GGUF file or free-text style prompt. Offer only controls that the adapter can map to the pinned provider's documented conditioning. An optional user blend is identified as compositing, not claimed to be a model parameter.

### Temporal behavior and scheduling

Photo mode is the default experimental mode: capture one coherent scene/camera state, clear history, and display original/enhanced images from that capture. Camera or scene changes invalidate the pair or leave it explicitly labeled as a frozen capture. Never compare a live original against an old result without an age/frozen indicator.

Live preview is opt-in. Use existing motion only after testing direction, scale, coordinate origin, jitter, and previous-frame semantics. Include camera movement, one rigid object, and one skinned object in the validation scene. Missing motion means temporal off, with an explanation; never silently pass zero velocity and claim temporal correctness.

Reset history on camera cut, scene restart, projection change, resize, scale change, provider/model/conditioning change, device recovery, or invalid frame identity. On a skipped source frame, either compose motion back to the actual history frame with proof, or reset history; v1 chooses reset. Reject disoccluded/out-of-bounds history and keep history/output ping-pong allocations distinct. Do not layer an unmeasured second temporal filter on top of the provider's history.

Allow one in-flight inference and coalesce pending requests to the newest source. Discard late results after generation changes. CPU-side asynchronous submission does not make shared-GPU work free: long compute still delays subsequent graphics. Cancelling a request cannot preempt already-submitted work or justify destroying the renderer device. Retire resources after completion, with device-loss recovery owned by the renderer.

## Sandbox experience and limits

Create one sandbox game outside the repository through the existing installed/tarball sandbox workflow; keep its reproducible recipe, generated render module, and portable playtest deliverables in the existing authoring/test structure. Do not add an editor, a new root CLI, or a new engine package. An in-repository fixture may support tests but is not the installed-user proof.

The small scene contains an animated humanoid when a redistributable asset is available, a moving rigid object, foliage/fine geometry, metal and matte surfaces, and an exposure test card. Use original/procedural placeholders when needed; fixture quality is not a license exception. No new large asset dependency is required.

Expose original/enhanced/split view, keyboard-accessible divider controls, one-shot capture, optional live preview, history reset, supported conditioning, and dimensions. Show provider/model revision, load progress, loading/ready/bypassed/error state, inference cadence, displayed FPS, input/output dimensions, result age, GPU/CPU timing provenance, and estimated allocations. A fixture-only result is prominently labeled **integration test, not neural enhancement**.

Separate world-render scale, neural-input scale, and presentation size. Quarter/half/full options describe scale **per axis**, validate provider-supported padded sizes, and disclose any ordinary resampling. Reduced-resolution neural enhancement plus reconstruction is an experiment, not DLSS Super Resolution. Do not run two competing automatic scale controllers.

Initial safety policy: start with a supported neural input no larger than 512×512 valid pixels, one in-flight result, and at most two history/output sets. Validate padded working-set estimates before enabling. Require an explicit configurable byte cap; a proposed sandbox default is 1 GiB of incremental estimated GPU allocations, **not an assertion of available VRAM**. If even the smallest valid graph exceeds the cap, bypass and report why. Release activation/history allocations on disable after outstanding work completes; retaining weights requires an explicit bounded cache choice.

No extra model request, inference dispatch, history allocation, or velocity activation occurs in ordinary disabled gameplay. WebGL2, unsupported limits, missing model, hash mismatch, allocation failure, shader/validation error, and device loss all have distinct visible reasons. Provider failure leaves the original rendering path available, except while renderer-level device recovery itself is in progress. Do not retry indefinitely or turn a failed observation into zero milliseconds.

## Measurement and stop conditions

Use the existing playtest/performance reporting rather than create a benchmark framework. Pin camera path, scene seed, source revision, actual adapter identity, browser/native host version, model hashes, scales, and settings. Run original and enhanced arms at the same world resolution; measure split-view overhead separately.

Report cold load/compile, warm per-stage GPU times where timestamp queries exist, CPU submission cost, end-to-end/presented frame time, completed neural frames per second, and estimated peak/live allocation bytes. Report p50/p95 plus sample count, not only minima. Without GPU timestamps, label wall-clock measurements and leave GPU time unavailable. Do not derive all-stage compute cost from render-only timestamps.

A bounded smoke run uses up to 10 warm-up completions and 30 measured completions per selected configuration, with a 60-second wall-clock ceiling per arm. Timeouts retain partial counts and failure status; sparse runs do not establish p95 quality or production performance. Limit the initial matrix to baseline, fixture, and the smallest valid real-model configuration, then optionally half/full scale if budget permits. No exhaustive engine benchmark or multi-hour optimization search belongs here.

Live preview remains a diagnostic unless measured end-to-end cadence meets its declared budget. Proposed sandbox budget: p95 <= 100 ms at the chosen configuration; stop scheduling live inference after three consecutive completed windows exceed it and return to one-shot mode. This is a research usability threshold, not a gameplay target. A production recommendation needs a separate PRD and actual full-frame evidence at the game's target rate.

Stop expanding this PRD when same-device transport cannot be demonstrated without a broad renderer rewrite, legal model access is unresolved, the smallest valid graph exceeds resource limits, or bounded measurements make interactive use unsuitable. Keep a useful snapshot experiment or record a no-go; do not quietly widen scope.

## Implementation phases

All test and scenario names below are **proposed deliverables**, not existing passing tests. Keep all boxes open until the stated proof runs. Tests belong to the layer implemented; any admitted core seam also receives focused core tests and native conformance evidence.

### Phase 1 — Safe provider boundary

- [ ] The model/capability validator enforces the declared data, limit, and allocation contract. proof: `pnpm exec vitest run packages/create-threenative/__tests__/neural-provider-contract.spec.ts`.
- [ ] The same-device bridge presents the deterministic fixture's current-frame output in the correct render/compute/composite order. proof: `pnpm exec vitest run packages/core/__tests__/neural-render-interop.spec.ts` and the browser GPU scenario in Phase 3.
- [ ] Provider lifecycle preserves borrowed resources and rejects stale temporal/result generations. proof: `pnpm exec vitest run packages/create-threenative/__tests__/neural-render-lifecycle.spec.ts`, including supplied-device/owned-model cleanup, resize during inference, device loss, and skipped-frame history.

### Phase 2 — Provider adapter and sandbox

- [ ] The pinned OpenDLSS-NR adapter satisfies the frame contract without steady-state CPU image readback. proof: `pnpm exec vitest run packages/create-threenative/__tests__/opendlss-nr-adapter.spec.ts`; real-model numerical qualification remains the separate dependency below.
- [ ] The generated sandbox enforces its UI, bypass, color, scheduling, and budget behavior. proof: `pnpm exec vitest run packages/create-threenative/__tests__/neural-render-sandbox.spec.ts` and the portable scene scenario in Phase 3.

### Phase 3 — Installed cross-runtime proof

- [ ] A clean installed sandbox passes its real-browser WebGPU fixture scenario. proof: from the generated game, `npx @threenative/playtest playtests/neural-rendering.playtest.json --target browser --url http://127.0.0.1:5173 --server-command "pnpm dev" --browser-recipe webgpu`.
- [ ] The same fixture scenario runs through the Linux x64 native host without browser-only globals in the provider path. proof: from the generated game, `npx @threenative/playtest playtests/neural-rendering.playtest.json --target desktop --executable "$TN_DESKTOP_EXECUTABLE" --host-arg run --host-arg dist/game.js`, after building that exact game's native bundle; record host and adapter identity.

## Acceptance criteria

- [ ] A packaged/scaffolded consumer can opt into the complete experiment without workspace-only imports, proprietary model distribution, or changes to ordinary rendering defaults. proof: `pnpm exec vitest run packages/create-threenative/__tests__/publication.spec.ts packages/create-threenative/__tests__/scaffold.spec.ts packages/create-threenative/__tests__/neural-render-installed.spec.ts`.

## Blocked on

**Authorized model data and numerical references — owner/provider:** obtain a documented lawful source and permission for the intended local use; redistribution requires its own permission. This PR neither supplies weights/fixtures nor instructions to extract proprietary assets. A user-selected file alone is not proof of permission. Without those inputs, real-model loading/inference/parity stays unqualified while deterministic implementation can proceed.

**Real neural qualification — maintainers with those inputs:** run the pinned model on browser WebGPU and Linux x64 separately, compare against authorized reference fixtures using predeclared tolerances, and review matched-frame captures plus movement/occlusion sequences. Record the exact identities and measured result inline in this PRD/PR. Do not call fixture correctness, an upstream benchmark, or a successful shader compile a neural-quality pass.

**Other platforms — separate qualified lanes:** Windows, macOS, Android, iOS, RTX 2080 performance, and non-NVIDIA GPU behavior are not established by the required Linux/browser pair. No support or performance claim is made without running the corresponding lane.

These dependencies are not checkboxes or evidence of completion. If all doable work finishes first, use the repository's blocked-only filing rule, retaining the outstanding qualification clearly. Do not advertise completed DLSS support or merge as a production feature on the strength of the progress label alone.

## Decisions and verification at filing

2026-09-28: the user requested a PRD and draft PR following the experimental neural-rendering proposal. Scope this filing to documentation; no product code, model acquisition, paid calls, or implementation is authorized by this filing alone.

Design decision: respect game-owned appearance, reuse RenderChain and velocity, and make GPU ownership/frame ordering an explicit first gate. Native Vulkan/NVIDIA SDK work and the separate view-projection authoring workflow are not bundled into this experiment.

Source inspection only at filing. No inference, GPU timing, model-parity, browser, or native feature test was run. Document-validation results belong in the draft PR and must distinguish structural checks from repository-wide gates.

[rules]: https://github.com/ThreeNativeHQ/threenative/blob/9ca18502207f107a83ca4acf6d44f7d30386aeee/AGENTS.md
[renderer]: https://github.com/ThreeNativeHQ/threenative/blob/9ca18502207f107a83ca4acf6d44f7d30386aeee/packages/core/src/renderer.ts
[chain]: https://github.com/ThreeNativeHQ/threenative/blob/9ca18502207f107a83ca4acf6d44f7d30386aeee/packages/core/src/render/chain.ts
[velocity]: https://github.com/ThreeNativeHQ/threenative/blob/9ca18502207f107a83ca4acf6d44f7d30386aeee/packages/core/src/render/velocity.ts
[rendering-guide]: https://github.com/ThreeNativeHQ/threenative/blob/9ca18502207f107a83ca4acf6d44f7d30386aeee/docs/guides/rendering.md
[view-projection]: https://github.com/ThreeNativeHQ/threenative/pull/379
[upstream]: https://github.com/maanHimself/OpenDLSS-NR/blob/9d08f4184bbcb9d858e2fb7a7834ec0837a9d2f1/README.md
[browser-port]: https://github.com/maanHimself/OpenDLSS-NR/blob/9d08f4184bbcb9d858e2fb7a7834ec0837a9d2f1/ports/browser-webgpu/README.md
[network]: https://github.com/maanHimself/OpenDLSS-NR/blob/9d08f4184bbcb9d858e2fb7a7834ec0837a9d2f1/ports/browser-webgpu/src/network.js
[gpu]: https://github.com/maanHimself/OpenDLSS-NR/blob/9d08f4184bbcb9d858e2fb7a7834ec0837a9d2f1/ports/browser-webgpu/src/gpu.js

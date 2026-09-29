# Experimental same-device neural snapshots

This opt-in source bundle now contains the **render capture -> GPU compute -> render-chain
composition implementation**, a deterministic fixture, and a pinned OpenDLSS-NR recorder
adapter. It is not a qualified DLSS product or a finished model-download workflow.
Browser/native GPU execution and real-model numerical parity have **not** been demonstrated
by the local mocked unit tests. Keep the feature experimental and the PR draft.

## What is integrated

`@threenative/core/webgpu` borrows the initialized renderer's device and resolves its GPU
textures behind a Three r185 guard. Only core accesses the backend resource map. Normal
`@threenative/core` imports do not load this optional entry point.

Game-owned `attachNeuralCapture()` attaches to the existing world's public `PassNode.updateBefore`
method, after it has submitted world rendering. It records the HDR capture/resample and provider
work on one command encoder using that same device, then the existing RenderChain composites a
matched original/result pair. It neither creates a second device nor adds another composer.
The authored `neuralSnapshot` stage must be first; it refuses to discard earlier effects.
Existing bloom, tone/output conversion, and overlays remain after it. Output is scene-linear
HDR; the adapter does not apply the output display transfer twice.

Snapshots are explicit, not a gameplay default. One job runs at a time. A new capture/reset
invalidates old generations; a frozen pair carries frame identity, age and wall-clock latency.
`gpuMs` is unavailable, not fabricated. Requests cancelled during GPU work wait for retirement.
The core submission's `completed` and `retired` promises deliberately mean different things.
A validation failure or rejected inference promise alone cannot authorize resource destruction.

## Run the diagnostic scene from the PR's packages

Use the repository's existing installed/tarball sandbox workflow to create a **disposable
minimal game outside the checkout**, with core and create-threenative built from this PR.
The released package at the old version does not yet contain the new `/webgpu` export.
Do not point this recipe at a game whose `src/game.ts` you need to preserve.

From that generated game's directory:

```sh
EXAMPLE=node_modules/create-threenative/agent-docs/examples/neural-rendering
mkdir -p src/render/neural src/scenes playtests
for name in frame-gate gpu-contract image-kernel snapshot-driver fixture-provider fixture-proof \
  render-hook render-capture opendlss-provider opendlss-shaders model-contract resource-scope; do
  cp "$EXAMPLE/$name.ts" src/render/neural/
done
cp "$EXAMPLE/LICENSE.OpenDLSS-NR" src/render/neural/
cp "$EXAMPLE/NeuralSnapshotScene.ts" src/scenes/
cp "$EXAMPLE/sandbox-game.ts" src/game.ts
cp "$EXAMPLE/"*.playtest.json playtests/
```

Use the generated game's existing browser or desktop entry/build commands. The scene uses no
DOM, canvas extraction, browser-only crypto, dynamic imports, physics, external assets or weights.
**C** requests a two-capture GPU diagnostic. **1 / 2 / 3** choose original / split / transformed;
**left / right arrows** move the divider. The console and playtest state identify this as
**channel-swap integration test, NOT neural enhancement**. The final display stays frozen;
recapture with C rather than mistaking the old image for live output.

The diagnostic first captures an HDR background, then changes it and captures again. Its small,
diagnostic-only GPU readbacks verify the expected current source, nonzero HDR signal, exact
R/B transformation and preserved alpha. A queued job, unchanged output, all-zero buffer or stale
background cannot set `proofPassed`. The runtime capture/provider path does **not** read images
back to the CPU. Do not enable `readFixtureProof()` in gameplay or neural performance measurements.
This diagnostic covers transport, not real-model quality or complete display-color parity.

The scene is a small lit scene rather than a test pattern: a ground plane and five props in
ordinary `MeshStandardMaterial` — matte and metal, near and far — under a key light, a rim light
and ambient fill, with one rotating rigid object the eye can follow. It also carries the PRD's
tonal fixture: a six-step gray ramp, the three saturated primaries, and HDR values above 1. Both
matter. The lit props are what makes the Before/After pair read as a frame a game would produce,
and the HDR card is what makes it readable at all — the runner's non-blank guard fails closed
below eight distinct colours, so a full-frame visual assertion cannot pass without it.

The scene owns its own render chain, and that is a contract requirement rather than a preference.
`attachNeuralCapture` captures the world pass texture directly, so its stage must receive that same
texture as the chain's input. A chain that composes anything first — an exposure multiply, a game's
own aerial perspective — would display one image while the neural stage captured another, and the
stage refuses that arrangement instead of producing a silently mismatched pair. To attach to a
game whose chain already composes something, either insert the stage ahead of that composition or
drop it; see "Attach to an existing game" below.

Run the existing playtest tool independently on each target (apply the PRD's 60-second run cap):

```sh
# `--headed` and TN_PLAYTEST_HOST_DISPLAY are not optional on a machine with a real GPU. The
# runner's default on Linux is a private Xvfb, and a headless launch serves WebGPU from
# SwiftShader on either display; both give a blank frame and a swiftshader adapter no matter what
# --browser-recipe webgpu asked for. Dropping TN_PLAYTEST_HOST_DISPLAY paints on your own screen.
TN_PLAYTEST_HOST_DISPLAY=1 npx @threenative/playtest playtests/neural-rendering.playtest.json \
  --target browser --url http://127.0.0.1:5173 \
  --server-command "pnpm dev" --browser-recipe webgpu --headed

# Build this exact game's native bundle first with its existing build command.
npx @threenative/playtest playtests/neural-rendering-native.playtest.json \
  --target desktop --executable "$TN_DESKTOP_EXECUTABLE" \
  --host-arg run --host-arg dist/game.js
```

The browser scenario waits on the state it asserts (`waitForResource` on `state.proofCount`),
not on a fixed tick budget: the proof is driven by an asynchronous GPU readback, so a tick count
is a flake with a clock in it. The native scenario deliberately omits the browser-only visual
assertion. Both scenarios press C after the initial observation and require the runtime state to
change to two GPU-verified captures. Archive the runner's report, actual adapter/host versions,
screenshots and console markers.

The copied modules typecheck in the generated game's own `pnpm typecheck`: the
`@threenative/core/webgpu` declaration carries a `@webgpu/types` reference, and core depends on
that package, so the GPU globals resolve without the game adding a declaration of its own.

## Attach to an existing game

Keep shaders and composition in the game's `src/render/neural/`. Import the engine bridge in
scene/setup code outside `src/render/`, then inject it:

```ts
const bridge = createWebGPUInterop(ctx.renderer);
const provider = createFixtureProvider(bridge.device, 256, 256);
let chain: RenderChain | undefined;
const capture = attachNeuralCapture({
  worldPass, // the game's existing pass, not another renderer
  bridge,
  provider,
  maxBytes: 16 * 1024 * 1024,
  rebuildGraph: () => { if (chain && !chain.disposed) chain.apply(); },
});
// Include capture.stage first in the existing chain's supplied/requested stages.
// Preserve that chain's worldPass, downstream effects and output conversion.
capture.capture();
```

Do not await an inference promise in the normal frame loop. Read `capture.state` for ready,
processing, waiting, disabled or error. The stage keeps the incoming original while a result
is unavailable. `capture.reset(reason)` covers scene/camera cuts and exposure changes; source
resize is detected automatically. Provider/model/resolution/conditioning changes require a new
session; temporal reconstruction and live preview are intentionally not exposed yet.

On teardown call `await capture.dispose()` **before** destroying the borrowed world pass or
prepared network. `rebuildGraph` must synchronously remove the now-unavailable stage's bindings.
If that operation fails, allocations are retained and teardown can be retried. The implementation
waits for a fresh queue fence covering composition as well as inference before freeing outputs.
The renderer owns device-loss recovery; create a new bridge/session after recovery.

## Use an authorized prepared OpenDLSS-NR network

`createOpenDLSSNRProvider()` implements GPU feature packing, calls the prepared graph's real
`recorder.encode(encoder)`, and reconstructs its residual head back into HDR. It does not call
`Network.run()`, upload frame-sized CPU tensors, or display the network head as if it were RGB.
The initial adapter is snapshot-only: previous features equal current features; temporal is off;
style presets are unsupported and rejected.

```ts
const provider = createOpenDLSSNRProvider(bridge.device, {
  network: preparedNetwork,
  sourceRevision: OPEN_DLSS_NR_REVISION,
  peakBytes: reviewedWholeNetworkPeakBytes,
  conditioning: { localTone: 1, localStructure: 1, colorStrength: 0.5 },
});
```

`preparedNetwork` must come from reviewed application code pinned to
`9d08f4184bbcb9d858e2fb7a7834ec0837a9d2f1`, initialized on **bridge.device**, with authorized,
integrity-checked model data. It is borrowed exclusively: no concurrent upstream `run()`.
The revision string is a declaration, not a signature/authenticity check. Adopted WGSL/math carries
`LICENSE.OpenDLSS-NR`; no weights or proprietary extraction instructions are included.

Start at a supported 256x256 valid input. The upstream padded field is larger; actual geometry
is checked against the pinned rule, including its single-reflection boundary. Device workgroup
storage must already allow 32768 bytes. An initialized device cannot retroactively acquire a
higher limit; report/bypass rather than request a second device. The adapter's peak estimate
must include the entire prepared network, and attachment additionally caps the HDR capture pair.
**That is attachment validation, not pre-allocation validation of an already-prepared graph.**
The bounded, cancellable, origin-controlled model loader and its authoritative pre-allocation
accounting remain unfinished. The original model-contract helpers do not magically supply it.

Never call upstream `Network.destroy()` on the renderer's borrowed device: its pinned ownership
logic can destroy that device when the model is owned. This adapter destroys only its own uniform
allocation; the application must safely release its prepared graph/model allocations separately.
`resource-scope.ts` can track individual owned allocations; do not register Network.destroy there.

## Qualification still required

The PRD remains authoritative. Full repository Vitest, TypeScript 5.9, Biome, build/publication,
installed-consumer and actual browser/Linux-native GPU runs remain outstanding, as do real-model
parity, temporal/live-preview behavior, complete UI/loading controls and measured performance.
The current local tests use mocked GPU objects; their Three API stand-ins do not compile WGSL
or render a scene. No FPS improvement, production suitability or vendor support is claimed.

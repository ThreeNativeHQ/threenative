# Wildwood Native Depth Warmup Issue Report (2026-09-07)

- **Status**: FIXED — local unit and desktop runtime verification passed
- **Affected Target**: Linux Native Host (`packages/runtime-native`, V8 + Dawn WebGPU C++ host)
- **Application**: Wildwood native bundle (`artifacts/wildwood-performance-20260907/pinned/wildwood`)
- **HEAD**: `93893ac0c59c3213913a0f0a1328f48bbb52b904`

---

## 1. Symptom & Impact

- **Symptom**: WebGPU validation error triggers while asynchronous shader warmup continues after gameplay starts:
  ```text
  Sample count (4) of [Texture (unlabeled 1280x720 px, TextureFormat::Depth24Plus)] doesn't match expectation (multisampled: 0).
  binding: 2, ShaderStage::Fragment, TextureSampleType::Depth
  ```
- **Impact**: Invalid depth texture binding during water material warmup makes the measurement harness stop, preventing clean steady-state native performance qualification. Device loss was not observed.

---

## 2. Environment & Configuration

- **Host**: Release V8 + Dawn Linux host (`packages/runtime-native/build/tn-linux/mystral`)
- **Resolution**: Fixed 1280x720, `resolutionScale: 1.0`
- **MSAA**: 4 samples (`MSAA4`)
- **Scene Load**: Full forest verified (2,341 trees, 7,600 ferns)
- **Asset Separation**: 69 GLB assets staged with exact-value interleaved GLB separation (`artifacts/wildwood-performance-20260907/asset-receipt.json`)

---

## 3. Confirmed Evidence from Artifacts

1. `artifacts/wildwood-performance-20260907/native-pinned-probe/native.log`:
   - Current Release V8 + Dawn Linux host running Wildwood native bundle.
   - Failure occurs during async shader compilation overlapping gameplay startup.
2. `artifacts/wildwood-performance-20260907/native-oldhost-samegame/native.log`:
   - The original Sep 5 packaged executable encounters the exact same depth binding mismatch on extended run.
   - **Conclusion**: Not a proven regression in latest C++ changes; initial shorter runs simply exited before async warmup hit this pass.
3. `artifacts/wildwood-performance-20260907/native-depth-trace-packaged/native.log`:
   - `TN_DEPTH_BINDING_MISMATCH` shows descriptor itself is already incorrect before crossing into native C++:
     - Layout expects `depth multisampled: false` (sampleCount 1).
     - Bound `GPUTexture` has `sampleCount: 4`.
   - Call stack: `createBindGroup` -> `Bindings.updateForRender` -> `Renderer.compileAsync`.
4. `artifacts/wildwood-performance-20260907/native-light-context/native.log`:
   - Target material object: `water` (`MeshBasicNodeMaterial`, backside and normal passes).
   - Compilation context: `currentSamples: 0`, `originalRenderTargetSamples: 4`, `needsFrameBufferTarget: true`.
   - Near error marker `3154`: after binding update reports current binding uses sample-1 placeholder, while the earlier `createBindGroup` used sample-4 texture.

---

## 4. Suspected Boundaries & Investigated Hypotheses

- **Confirmed cause and repair**:
  - `Bindings._createBindings` used stale `NodeSampledTexture.texture` before its `.update()` phase read the current `textureNode.value`. The Three.js patch now calls `binding.update()` before the first texture/sampler upload and bind-group creation. All three distributed patch copies are identical.
- **Independent Issue (Not Proven Cause of this Error)**:
  - `NodeManager` async state overwrite has an isolated reproduction in the investigation artifacts (`artifacts/wildwood-performance-20260907/agents/three-async-node-state.spec.ts`), but has not been proven to cause this specific Wildwood depth descriptor mismatch.
- **Rejected Hypotheses**:
  - *Texture-only candidate reading allocated `sampleCount`*: Caused inverse mismatch (sample-1 placeholder bound when layout expected 4).
  - *Disabling native command recorder*: Caused unrelated open-command-encoder validation errors; restored.
  - *Latest C++ changes as the sole cause*: The same failure occurs in the Sep 5 binary.

---

## 5. Reproduction

*Note: Reproduction is timing-dependent due to async compilation overlap; some instrumented runs complete cleanly.*

```sh
# Required: built host + Wildwood bundle with staged assets
MYSTRAL_BUNDLE=$PWD/artifacts/wildwood-performance-20260907/pinned/wildwood \
  node artifacts/wildwood-performance-20260907/measure-native.mjs \
  artifacts/wildwood-performance-20260907/repro-manual \
  artifacts/wildwood-performance-20260907/mystral-baseline
```

### Durable Steps to Reproduce
1. Build native runtime host: `pnpm native:build` (Release).
2. Bundle and package Wildwood with full forest assets (interleaved GLB separation receipts intact).
3. Run native host with full GPU validation logging enabled.
4. Keep the run active past the 15s warmup timeout through at least 60s of active gameplay / camera movement.

---

## 6. Acceptance Criteria

1. **Zero GPU Validation Errors**: Clean WebGPU / Dawn output without depth sample count mismatch or bind group errors.
2. **Complete Scene Fidelity**: Full forest loaded (2,341 trees, 7,600 ferns) and HUD rendered.
3. **Uncompromised Quality Targets**: Native 1280x720 render at `resolutionScale: 1.0` with `MSAA4` active.
4. **Steady-State Stability**: Sustained gameplay >= 30 seconds / >= 1,000 frames after async compile finishes.
5. **Interactive Verification**: Verified keyboard input movement during steady-state execution.


## 7. Verification results

The regression test uses Three.js's real `NodeSampledTexture`, `NodeSampler` and binding manager,
changes the node reference between construction and first binding creation, and checks the exact
texture uploaded and bound. No renderer quality setting changes.

```text
Before: three-initial-bindings.spec.ts — 2 failed (2)
After:  three-initial-bindings.spec.ts — 2 passed (2)
Binding, patch distribution and clean-consumer packaging tests: 20 passed (20)
Native movement scenario: pass=true, diagnostics=[], distance=26.44757435099514 metres
Native stability: 1,381 frames over 35,002 ms after warm-up; zero GPU validation errors
```

The stability run was diagnostic (foreground/movement was not enforced), so its frame rate is
not qualified gameplay FPS. The separate movement scenario uses the real desktop playtest runner.
Receipts are in `artifacts/wildwood-performance-20260907/`: `initial-bindings-red.log`,
`initial-bindings-distribution-green.log`, `native-binding-fix-full-proof/result.json`, and
`native-flow-ui-fallback/result.json`.

The Linux NVIDIA/WebKit UI required `WEBKIT_DISABLE_DMABUF_RENDERER=1` for these clean runs:
without it, WebKit printed two `Failed to create GBM buffer` errors. This is a launch-environment
workaround, not a change to the game's WebGPU adapter, MSAA, resolution or scene rendering.
WebKit tracks this failure mode in [bug 261874](https://bugs.webkit.org/show_bug.cgi?id=261874).

Repository checks: `pnpm typecheck` and `pnpm lint` exited 0. `pnpm test` found two existing
CI-structure failures concerning the Android/web-reference label gates, plus a stale distributed
patch copy caught during this change. Synchronizing the patch copies made all 12 relevant tests
pass; the unrelated CI tests remain red. No all-suite pass is claimed.

## 8. HUD startup ordering

Wildwood's `Hud.tsx` and `Menu.tsx` previously rendered as soon as state arrived, including while
the loading curtain still covered the world. They now wait for the existing `revealTreeCount`
snapshot instead. This is game-owned display timing; `UiLayer` still connects and sends its ready
handshake while the HUD is hidden. Three game tests cover preload, reveal, and restart:
`2 failed / 1 passed` before, `3 passed` after. Wildwood typecheck passed.


## 9. Qualified final performance comparison

NVIDIA RTX 2080, 60 Hz display, 1280×720, resolution scale 1, MSAA4, 2,341 trees and 7,600 ferns.
Both samples use normal real-time forward/backward movement after at least 20 seconds of warm-up.
The native HUD includes the startup gate from sandbox commit `1182966`.

| Target | Frames / measured time | Mean frame | p50 | p95 | p99 | Worst | >50 ms | Derived FPS |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Native desktop | 2,073 / 35.002 s | 16.885 ms | 16.788 ms | 18.874 ms | 21.514 ms | 34.393 ms | 0 | 59.2 |
| Browser WebGPU | 2,002 / 35.009 s | 17.487 ms | 16.700 ms | 21.800 ms | 33.900 ms | 164.200 ms | 8 | 57.2 |

Native movement covered 20.6 metres. OS foreground was checked every 250 ms throughout its
measured interval. No GPU validation or UI buffer errors occurred. `comparison.json`, raw frame
samples, logs and captures are under `artifacts/wildwood-performance-20260907/`; native final
receipts are in `native-final-foreground/`, browser receipts in `web-baseline-warmed/`.

These are one qualified run per target, not a native before/after speedup claim. Earlier native
runs failed validation, lost foreground, or used profiling instrumentation and were excluded.
The native result is near this display's 60 Hz ceiling. No shader stages, scene detail, MSAA or
resolution were reduced. A proposed reduction in GPU timestamp readbacks was not retained:
`mapAsync` timing includes necessary command replay, so moving that cost to the frame boundary
would not by itself prove a performance gain.

The reviewed executable with the rebuilt HUD is
`artifacts/wildwood-performance-20260907/final/wildwood`. Launch on this NVIDIA/WebKit machine:

```sh
artifacts/wildwood-performance-20260907/final/run-wildwood.sh
```

The launcher sets WebKit's DMA-buffer workaround. The original sandbox executable is preserved;
this artifact contains the depth fix, complete packaged assets and the rebuilt HUD.

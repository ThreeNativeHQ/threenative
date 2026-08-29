# Native WebGPU behavior conversion — 2026-08-28

## Wrapper rollback checkpoint

| Removed source assertion | Native behavior check | Observable proof |
| --- | --- | --- |
| `wrapper rollback restores the exact active multi-encoder state` | Forces wrapper installation to fail after active compute/render encoder state is snapshotted, then compares every registry and encoder map with the pre-call state | `proof: wrapper-rollback` |
| `binding-table verification covers the whole table after writes and rollback` | Exercises cross-row write traps, preflight descriptor traps, blocked rollback, and SameValue snapshot restoration | `proof: whole-table-verification` |
| `supported feature collections stay iterable without binding onto an exotic array` | Creates real adapter and device feature collections, requires `has` and `Symbol.iterator`, and consumes both iterators | `proof: public-binding-surface` |
| `global helpers are copied from ordinary binding hosts` | Requires all three global helper functions through the initialized runtime global | `proof: public-binding-surface` |
| `GPUCommandEncoder installs its table once per class, not per call` | Creates two real command encoders, requires shared prototypes and method identities, rejects own per-instance methods, and interleaves receiver dispatch; the public-surface probe covers all eight method names | `proof: command-encoder-class-table` + `proof: public-binding-surface` |
| `GPURenderPassEncoder installs its table once per class, and end() resolves its encoder from the map` | Creates two real render passes through the effective frame-op-stream path, requires all fourteen methods, a shared non-default prototype and method identity, no own methods, detached-call refusal, interleaved receiver dispatch, and current-encoder resolution | `proof: render-pass-class-table` |
| `createSampler` and invalid-layout `createBindGroup` refuse at the API call | Drives inverted sampler LOD and a missing native bind-group-layout handle through the headless runtime; the unreachable post-call bind-group null-result guard remains source-protected | `proof: creation-refusal` |
| registration-table rows are preflighted as one atomic transaction | Installs a mixed-destination table, rejects its invalid row before any property write, and requires rollback to restore every earlier descriptor exactly | `proof: whole-table-verification` |

The remaining source assertions stay in `webgpu-bindings-contract.test.mjs` until their behavior
probes exist. The default Vitest lane uses a fixture executable to prove the output contract; CTest
sets `TN_NATIVE_BEHAVIOR_EXECUTABLE` so that same test drives the built product executable.

## Controls

- Rename: renamed the private native check and its call site to
  `verifyActiveWrapperRollbackBehavior`. Product-backed CTest stayed green.
- Behavior break: temporarily returned `false` from the check. The product executable exited 1,
  Vitest reported its product-backed assertion failed, and CTest reported the target failed. The
  mutation was reverted.
- Whole-table rename: renamed its private native check and call site to
  `verifyWholeTableTransactionBehavior`; the product-backed test remained green.
- Whole-table behavior break: temporarily returned `false` after its final SameValue check. The
  product-backed Vitest reported `1 failed | 33 passed`, and CTest reported the native target
  failed. The mutation was reverted.
- Public-surface behavior break: temporarily removed `GPU.getPreferredCanvasFormat` from the
  production registration table. The product-backed assertion named
  `GPU.getPreferredCanvasFormat binding missing`; CTest failed. The mutation was reverted.
- Public-surface rename: renamed the native probe to `exercisePublishedWebGPUObjects`; the
  product-backed assertion stayed green.
- Feature-iteration break: temporarily changed `device.features` from an array-backed collection
  to an ordinary object while retaining its `has` function. The product-backed assertion named
  `GPUDevice.features iterator binding missing`; CTest failed. The mutation was reverted.
- Command-encoder behavior break: forced the executable's legacy per-instance wrapper shape. The
  product-backed Vitest named the fixed-shape and hidden-class failures; CTest failed. The mutation
  was reverted.
- Command-encoder rename: renamed the real-runtime probe to
  `exerciseCommandEncoderClassContract`; the product-backed test stayed green.
- Class-table setup repair: removed unnecessary async wrappers and fixed missing-global checks in
  both executables. The earlier tests could pass before creating an encoder or pass. The effective
  runtime path is `frame-op-stream.js`, which intentionally replaces the raw native methods.
- Render-pass behavior break: temporarily created a fresh copied prototype per pass while retaining
  all methods. The product-backed assertion named `both render passes share one class prototype`;
  CTest failed. The mutation was reverted.
- Render-pass rename: renamed the executable probe to `exerciseRenderPassClassContract`; the
  product-backed test stayed green.
- Creation sampler break: removed inverted-LOD exception delivery. CTest failed and named
  `createSampler did not throw at creation`; the mutation was reverted.
- Creation layout break: removed invalid-layout exception delivery. CTest failed and named
  `createBindGroup did not throw at creation`; the mutation was reverted.
- Creation rename: renamed private `tnWebgpuHandler69` and its table reference. The product-backed
  test stayed green; the mutation was reverted.
- Whole-table source retirement: deleted the source-shape assertions for row-owned destinations and
  the two-pass loop. The existing behavior break (returning `false` after the final SameValue check)
  still failed the product-backed Vitest and CTest, while renaming the private native check stayed
  green.
- Sanitizer: the creation executable passed ASan + UBSan. The full six-target lane remains red in
  the unchanged reentrancy executable on a `RenderBundleEncoder` leak, so no full-lane green is
  claimed for this checkpoint.

## Green result

`ctest --test-dir packages/runtime-native/build/tn-linux --output-on-failure -R
'^threenative-webgpu-bindings-reentrancy-test$'` passed `1/1` through the Vitest bridge.

Creation refusal, product-backed CTest:

```text
ctest --test-dir packages/runtime-native/build/tn-linux --output-on-failure \
  -R '^threenative-bindings-creation-test$'
1/1 Test #4: threenative-bindings-creation-test ... Passed
100% tests passed, 0 tests failed out of 1
exit 0
```

Focused default contract:

```text
pnpm --dir packages/runtime-native exec vitest run --config vitest.config.ts \
  tests/webgpu-bindings-contract.test.mjs
Test Files 1 passed (1)
Tests 32 passed (32)
exit 0
```

Creation-only sanitizer proof, using the lane's generated suppression file:

```text
ASAN_OPTIONS='abort_on_error=1:fast_unwind_on_malloc=0:halt_on_error=1' \
LSAN_OPTIONS="suppressions=$PWD/packages/runtime-native/build/tn-linux-asan/native-lsan-2026-08-28.supp" \
UBSAN_OPTIONS='halt_on_error=1:print_stacktrace=1' \
ctest --test-dir packages/runtime-native/build/tn-linux-asan --output-on-failure \
  -R '^threenative-bindings-creation-test$'
1/1 Test #4: threenative-bindings-creation-test ... Passed
100% tests passed, 0 tests failed out of 1
exit 0
```

The encompassing `pnpm --filter @threenative/runtime-native native:test:asan` command exited `1`:
creation passed, while `threenative-webgpu-bindings-reentrancy-test` failed on the unchanged
`RenderBundleEncoder` leak. The full lane is not claimed green.

Registration-table source retirement:

```text
pnpm --dir packages/runtime-native exec vitest run --config vitest.config.ts \
  tests/webgpu-bindings-contract.test.mjs
Test Files 1 passed (1)
Tests 30 passed (30)

ctest --test-dir packages/runtime-native/build/tn-linux --output-on-failure \
  -R '^threenative-webgpu-bindings-reentrancy-test$'
1/1 Test #27: threenative-webgpu-bindings-reentrancy-test ... Passed
100% tests passed, 0 tests failed out of 1
```

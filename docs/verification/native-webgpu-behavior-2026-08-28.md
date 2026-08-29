# Native WebGPU behavior conversion — 2026-08-28

## Wrapper rollback checkpoint

| Removed source assertion | Native behavior check | Observable proof |
| --- | --- | --- |
| `wrapper rollback restores the exact active multi-encoder state` | Forces wrapper installation to fail after active compute/render encoder state is snapshotted, then compares every registry and encoder map with the pre-call state | `proof: wrapper-rollback` |
| `binding-table verification covers the whole table after writes and rollback` | Exercises cross-row write traps, preflight descriptor traps, blocked rollback, and SameValue snapshot restoration | `proof: whole-table-verification` |
| `supported feature collections stay iterable without binding onto an exotic array` | Creates real adapter and device feature collections, requires `has` and `Symbol.iterator`, and consumes both iterators | `proof: public-binding-surface` |
| `global helpers are copied from ordinary binding hosts` | Requires all three global helper functions through the initialized runtime global | `proof: public-binding-surface` |

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

## Green result

`ctest --test-dir packages/runtime-native/build/tn-linux --output-on-failure -R
'^threenative-webgpu-bindings-reentrancy-test$'` passed `1/1` through the Vitest bridge.

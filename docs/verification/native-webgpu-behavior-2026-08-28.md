# Native WebGPU behavior conversion — 2026-08-28

## Wrapper rollback checkpoint

| Removed source assertion | Native behavior check | Observable proof |
| --- | --- | --- |
| `wrapper rollback restores the exact active multi-encoder state` | Forces wrapper installation to fail after active compute/render encoder state is snapshotted, then compares every registry and encoder map with the pre-call state | `proof: wrapper-rollback` |

The remaining source assertions stay in `webgpu-bindings-contract.test.mjs` until their behavior
probes exist. The default Vitest lane uses a fixture executable to prove the output contract; CTest
sets `TN_NATIVE_BEHAVIOR_EXECUTABLE` so that same test drives the built product executable.

## Controls

- Rename: renamed the private native check and its call site to
  `verifyActiveWrapperRollbackBehavior`. Product-backed CTest stayed green.
- Behavior break: temporarily returned `false` from the check. The product executable exited 1,
  Vitest reported its product-backed assertion failed, and CTest reported the target failed. The
  mutation was reverted.

## Green result

`ctest --test-dir packages/runtime-native/build/tn-linux --output-on-failure -R
'^threenative-webgpu-bindings-reentrancy-test$'` passed `1/1` through the Vitest bridge.

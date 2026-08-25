# PRD-207 native internals verification — 2026-08-24

Status: verified on review branch `linchpin/prd-207-native-internals-shed-their-shortcuts`.
The branch is based on PRD-205 closure commit `3015cb4d`; the caught-native-exception repair
needed by the live physics proof is included in this branch and is also recorded on PRD-205
closure branch commit `b911e138`. No branch was merged or squashed.

## Red first

- Before the exception-latch repair, the intentional
  `TN_NATIVE_PHYSICS_INVALID_RAY_THROW` left the host exception latch set. The next dynamic
  WebGPU install was rejected by the fail-closed registration table, and the native smoke run
  reached `TypeError` at `encoder.beginRenderPass` because `createCommandEncoder()` returned no
  wrapper. The repair tracks native-callback depth and clears only a host exception produced by
  a callback after JavaScript has caught it. Direct pre-seeded and unhandled exception controls
  remain visible.
- Mutating an extracted runtime script made the SHA-256 contract red; restoring the source made
  the contract green.
- Mutating the extracted CLI path made the byte-identity artifact check red; restoring the
  bundler/lightmap dispatch made both artifacts identical.
- Reintroducing a 1 ms poll made `wait-latency.test.mjs` red; restoring the condition-variable or
  fence wait made the focused contract suite green.

## Phase evidence

1. Deprecated native GLTF/cgltf and Draco paths were removed from the runtime source and
   downloader. CMake now fails closed if either removed option is enabled; the JS contract checks
   that no native loader registration or live caller remains.
2. Twelve surviving bootstrap/polyfill programs moved to `src/runtime-scripts/` and are embedded
   by `cmake/EmbedRuntimeScripts.cmake` into a generated header. `runtime.cpp` fell from 4,776 to
   3,007 lines; the extracted sources total 1,738 lines. Runtime initialization now stops when
   any required embedded script fails to evaluate.
3. `cli/main.cpp` fell from 2,368 to 1,730 lines. Bundling and lightmap baking live in the
   separate `mystral-tools` target (`src/cli/bundler.cpp` and `src/cli/lightmap.cpp`); the runtime
   `mystral` executable contains only the dispatch seam. The old and new compile fixtures both
   produced 177 bytes with SHA-256
   `46efe4520985b6662d590b7febddc6dcc6284e436feccc017bd63b805c91a00d`.
4. `JSValueHandle` now has Engine-owned `freezeHandle`, `freeHandle`, and
   `outstandingHandleCount` operations, with a move-only `JSValueGuard`. The churn executable
   reported `512` created, `512` freed, and `0` outstanding under both V8 and QuickJS.
5. The eleven 1/10 ms native poll sites now use condition variables or completion fences. The
   remaining delays are bounded, non-polling lifecycle/window retries: macOS audio shutdown
   (50 ms), Android lifecycle retry (100 ms), and macOS ScreenCaptureKit window discovery
   (100 ms). The latency contract records those reasons; test-only sleeps are not runtime waits.

## Commands and results

| Command | Result |
| --- | --- |
| Focused PRD-207 contract suite | 7 files passed; 69 passed, 1 skipped |
| `pnpm --filter @threenative/runtime-native test` | 58 files passed; 410 passed, 33 skipped; JS physics parity 28 passed; Rust parity 2 passed; publint clean |
| V8 and QuickJS WebGPU reentrancy executables | `native WebGPU bindings reentrancy passed` on both engines |
| V8 and QuickJS handle-lifetime executables | `handles-created=512 handles-freed=512 outstanding=0` on both engines |
| `pnpm native:build` | passed; V8 desktop runtime linked |
| CLI artifact identity verifier | 177 bytes and identical SHA-256 before/after |
| Desktop core verifier with `SDL_AUDIODRIVER=dummy` | 300 frames, 1280×720, non-blank screenshot and overlay passed |
| Desktop physics verifier with `SDL_AUDIODRIVER=dummy` | actuation passed; 14 playtest assertions passed; spatial query passed |
| Live native smoke proof | NVIDIA GeForce RTX 2080; 180/180 presents; physics parity marker; `grounded:true`; exit 0 |
| `pnpm typecheck` | passed |
| `pnpm lint` | exit 0; 385 repository-wide complexity warnings remain |
| `pnpm test` | 197 files passed, 1 skipped; 1,880 passed, 3 skipped |
| `pnpm budgets` | passed; native runtime 88,184/100,000; framework 18,376/15,000 review trigger reported |
| `pnpm quality` | exit 0; 70 findings reported, mostly inherited; no PRD-207 runtime finding added |

The first `pnpm native:verify:desktop` invocation stopped before the core scene because the
container ALSA device reported `Host is down`. The same audio proof passed, and the core/physics
verifiers passed when rerun with `SDL_AUDIODRIVER=dummy`; this is an environment limitation, not a
runtime assertion failure.

The artifact verifier covers the compile/bundler path. A before/after lightmap artifact run and
numeric before/after wake-latency measurements remain evidence gaps for review; the source
contracts and converted wait primitives are covered by the focused suite.

## Platform limits

Linux desktop V8 and QuickJS executed. The live adapter was NVIDIA GeForce RTX 2080 over Vulkan.
macOS/JSC, Android, and iOS device execution were not available in this lane; their static
contract tests are included in the package and root suites, but they are not claimed as executed
platform proofs.

# PRD-205 — WebGPU bindings table and explicit state

Date: 2026-08-24
Lane: `lane-205`
Status: **verified on Linux desktop; desktop multitouch remains the registry-declared host block**

## Implementation

- `bindings.cpp` now installs the WebGPU surfaces through the shared registration dispatcher;
  the source contains 85 `installBinding(state, ...)` rows and no `newFunction(...)` calls.
- `BindingsState` owns the former WebGPU file state. `RuntimeImpl` creates one state per runtime
  and passes it to WebGPU, context, and video paths.
- Windowed and offscreen texture wrappers use one factory. Render and compute pipeline wrappers
  use one parameterized factory.
- Biome now covers the runtime-native TypeScript files. Generated/runtime artifacts remain
  ignored individually by path rather than through a package-wide ignore.

## LOC accounting

The equivalent source count required by the PRD is the main binding source plus the new headers:

```text
baseline packages/runtime-native/src/webgpu/bindings.cpp: 6510
current  packages/runtime-native/src/webgpu/bindings.cpp: 6190
new headers (bindings.h, registration_table.h, wrapper_factories.h, bindings_state.h): 296
current bindings.cpp + new headers: 6486
net: -24
```

`pnpm tsx scripts/count-loc.ts` completed with exit 0:

```text
suggested framework normalised baseline: 432 (current baseline 441)
platformer template LOC: 1891
```

## Red/green controls

Each temporary mutation was restored before continuing.

### Table row deletion

Mutation: remove the `GPUCanvasContext.getCurrentTexture` row from `bindings.cpp`.

```sh
pnpm exec vitest run --config packages/runtime-native/vitest.config.ts \
  --dir packages/runtime-native \
  tests/webgpu-bindings-contract.test.mjs -t "canvas context registration"
```

Observed red: exit 1, one failed test, `canvas API surface must be represented by one registration table`.
The restored test suite passes.

### Explicit-state reentrancy

Mutation: make the second test state alias the first (`auto* second = first`). Rebuilding and
running `threenative-webgpu-bindings-reentrancy-test` returned exit 1 with no pass marker.

Restored green executable:

```text
native WebGPU bindings reentrancy passed
```

### Shared wrapper factory

Mutation: replace both `createTextureWrapper(` call sites in `bindings.cpp` with a divergent
`createWindowTextureWrapper(` name.

Observed red: the focused contract test returned exit 1 with `0 !== 2`, proving both paths are
required to use the shared factory. The original two call sites were restored.

### Biome coverage

Mutation: add `const seededLintError = ;` to a covered runtime-native TypeScript test.

```text
packages/runtime-native/tests/ci/cli-basic.test.ts:11:25 parse
Expected an expression, or an assignment but instead found ';'.
Found 3 errors.
EXIT_CODE=1
```

The invalid line was removed before the final lint run.

## JS-visible behaviour trace

`tests/fixtures/webgpu-bindings-trace.json` records the pre-refactor trace extracted from the
parent source: 71 JS-visible registration names and 43 thrown-error strings. The focused trace
test extracts the current registration rows, shared factory methods, and error strings and
matches all 71/71 names and 43/43 errors.

```sh
pnpm exec vitest run --config packages/runtime-native/vitest.config.ts \
  --dir packages/runtime-native tests/webgpu-bindings-trace.test.mjs
```

Result: 1 test passed. The complete browser/native conformance run below supplies the returned
render results for the same migrated families.

## Native conformance

Browser references:

```sh
cd packages/runtime-native
sh ../../scripts/xvfb.sh node conformance/browser-reference/capture.mjs \
  --registry conformance/registry.json --out artifacts/conformance/web
```

Result: `pass: 68`, `fail: 0`, `blocked: 0`.

Final desktop comparison:

```sh
cd packages/runtime-native
sh ../../scripts/xvfb.sh node conformance/run-conformance.mjs \
  --target desktop --reference artifacts/conformance/web \
  --out artifacts/conformance/prd205-desktop-final
```

Result: `pass: 67`, `fail: 0`, `blocked: 1`. The single blocked row is the existing
`90-multitouch-input` desktop exclusion: this Xvfb host has no evdev backend and the user cannot
read `/dev/input/event*`. No native rendering row failed.

The final report names the executable and adapter:

```text
executable: packages/runtime-native/build/tn-linux/mystral
adapter: NVIDIA GeForce RTX 2080
vendor: nvidia
backend: Vulkan
native frames per implemented row: 300
```

## Desktop playtest

```sh
pnpm native:verify:desktop
```

Named results:

```text
desktop audio decodeAudioData Promise proof passed on V8
desktop core gate passed: 300 frames, 1280x720
desktop physics actuation bindings proof passed
desktop physics playtest proof passed: 14 assertions
desktop physics query proof passed: {"clearHitCount":0,"maskedHitCount":0,"pointCount":1,"pointMaskedHitCount":0,"pointMissCount":0,"rayDistance":2,"rayNormal":[0,1,0],"rayPosition":[0,0,1],"shapeCount":1,"shapeMaskedHitCount":0,"shapeMissCount":0}
```

## Repository gates

The required combined command completed with exit 0:

```sh
pnpm typecheck && pnpm lint && pnpm test
```

Recorded results:

```text
typecheck: exit 0; all 16 workspace scopes completed
lint: exit 0; Checked 950 files; Found 291 warnings; no errors
runtime-native package test: 57 files passed; 383 tests passed; 33 skipped
root unit suite: 198 files passed; 1883 tests passed; 0 failed
```

The documentation link gate also passed: `Checked 762 relative documentation links across 600 Markdown files.`

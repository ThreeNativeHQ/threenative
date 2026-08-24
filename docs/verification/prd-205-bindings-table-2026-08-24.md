# PRD-205 — WebGPU bindings table and explicit state

Date: 2026-08-24
Lane: `lane-205`
Status: **verified on Linux desktop; desktop multitouch remains the registry-declared host block**

## Implementation

- `packages/runtime-native/src/webgpu/bindings.cpp` contains 89 table-dispatch call sites and 91
  registration rows, including the canvas table and repeated methods on different WebGPU objects.
  `installWebGPUBindingSurfaces` is now a wrapper; the migrated registrations live in the adjacent
  table unit and dispatch through `installBindingTable`.
- The contract test enumerates the migrated DOM, GPU, adapter, device, queue, command encoder,
  render pass, compute pass, render bundle, and global families. It retains the supplementary
  71/71 registration-name and 43/43 error-string census.
- `BindingsState` owns blend-state storage. Feature arrays are automatic per-call state in
  `context.cpp`. The native reentrancy executable creates two real `Runtime` instances, interleaves
  calls, and verifies markers, preferred formats, and buffers remain isolated.
- GPU video fallback now requires an owning binding state. The public factory has an explicit
  four-argument signature, the CLI passes the runtime state, and missing state is rejected before
  callback registration.
- Biome no longer ignores runtime-native `.js` or `.mjs` files package-wide. Generated, build,
  vendor, artifact, and JSON paths remain excluded individually; the package check inspected 174
  files with no errors.

## Size check

```text
baseline packages/runtime-native/src/webgpu/bindings.cpp: 6190 lines
current  packages/runtime-native/src/webgpu/bindings.cpp: 6275 lines
registration_table.h + bindings_state.h: 206 lines
pnpm tsx scripts/count-loc.ts: exit 0
suggested framework normalised baseline: 432 (current baseline 441)
platformer template LOC: 1891
```

## Red/green controls

Each temporary mutation was restored before the final gates:

- Deleting the `GPUQueue.submit` row made the contract test fail with `queue.submit must be a
  table row`.
- Making `blendStates` static or a required feature array static made the state contract fail.
- Removing the missing-state video guard made its source contract fail.
- Mutating one stored post-repair trace result made the trace test fail on the pre/post deep
  comparison.
- Adding invalid syntax to the covered `.mjs` fixture made Biome exit 1 with three parse errors.

Focused green result:

```text
Test Files  3 passed (3)
Tests       34 passed (34)
```

## JavaScript-side call-trace parity

`tests/fixtures/webgpu-bindings-call-trace.js` exercises 32 representative JS-visible calls. The
pre-repair executable is `/tmp/mystral-prd205-pre-repair`; the final rebuilt executable is
`packages/runtime-native/build/tn-linux/mystral`. The harness records surface/name, argument shape,
and exactly one result or error shape for every call.

```text
pre/post trace matches stored fixture: 32 calls
supplementary registration census: 71/71
supplementary error census: 43/43
```

## Native proof

```sh
cd packages/runtime-native
cmake -S . -B build/tn-linux -DTN_ENABLE_VIDEO=OFF
cmake --build build/tn-linux --target mystral threenative-webgpu-bindings-reentrancy-test -j2
./build/tn-linux/threenative-webgpu-bindings-reentrancy-test
```

Result: the build completed and the executable printed `native WebGPU bindings reentrancy passed`.

The video seam proof was built with `-DTN_ENABLE_VIDEO=ON` and printed:

```text
[VideoRecorder] GPU fallback requires an owning WebGPU bindings state
native video recorder missing-state guard passed
```

## Browser/native conformance

Browser reference:

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

Result: `pass: 67`, `fail: 0`, `blocked: 1`. The blocked row is the existing `90-multitouch-input`
desktop exclusion: this Xvfb host has no evdev input backend. Every executable rendering row ran
300 frames with no failure. The report observed NVIDIA GeForce RTX 2080 through Vulkan.

## Desktop verification

The first run exposed the host ALSA device as `Host is down`. The same gate passed with the explicit
headless audio driver required by this Linux host:

```sh
cd packages/runtime-native
SDL_AUDIODRIVER=dummy pnpm native:verify:desktop
```

Results:

```text
desktop audio decodeAudioData Promise proof passed on V8
desktop core gate passed: 300 frames, 1280x720
desktop physics actuation bindings proof passed
desktop physics playtest proof passed: 14 assertions
desktop physics query proof passed
```

Mobile execution is unavailable on this host: neither `adb` nor `xcrun` is installed, so no Android
device/emulator or iOS simulator/physical-device result is claimed.

## Repository gates

Final results after this document was updated:

```sh
pnpm typecheck && pnpm lint && pnpm test
pnpm budgets
pnpm quality
git diff --check
```

```text
pnpm typecheck: exit 0; Scope: 16 of 17 workspace projects
pnpm lint: exit 0; Checked 1113 files; Found 380 warnings; no errors
pnpm test: exit 0; 198 files passed; 1883 tests passed
runtime-native package suite: 57 files passed; 386 tests passed; 33 skipped
runtime-native Biome check: 174 files; 89 warnings; no errors
pnpm budgets: exit 0; 18376/15000 framework LOC review trigger, no hard budget failure
pnpm quality: exit 0; 70 findings (11 new, 9 grew, 50 inherited)
git diff --check: exit 0
```

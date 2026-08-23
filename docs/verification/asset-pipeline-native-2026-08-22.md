# PRD-097 execution evidence — native consumes the compiled assets, 2026-08-22

Re-scoped before execution (see the PRD header): the C++ decoder plan was obsolete because
the native GLTF path is deprecated/disabled and Android has run V8 (WebAssembly-capable) since
PRD-130. The intent proven here is the PRD's own acceptance core: **the same compiled files the
web build ships load and render on the native host, byte-identically, with fail-closed
behaviour where support is genuinely absent.**

## What executed

| Proof | Result |
| --- | --- |
| Desktop gate over COMPRESSED assets (`verify-starter-desktop.mjs`) | **"starter desktop gate passed: 300 frames, 12314 colors, 156 asset pixels"**, exit 0 — `TN_NATIVE_SMOKE_READY`, `TN_NATIVE_STARTER_ASSETS_LOADED:texture,glb` and the 300-frame marker all present |
| Compressed pipeline trace in the runtime log | manifest fetched → `native-proof.<hash>.ktx2` fetched → `basis/basis_transcoder.js` + `.wasm` fetched → worker transcode → `transcode` response → texture uploaded |
| Parity gate (`scripts/asset-parity.ts --web <dist> --native <public>`) | **3/3 artifacts byte-identical** (`.ktx2`, `.glb`, `.ogg`), both resolved paths and sha256 hashes printed; spec covers one-byte drift (red) and empty-manifest (exit 2) |

The subject project was scaffolded from freshly packed tarballs of every package at this
commit, so the proof runs the shipped code, not workspace symlinks.

## Host defects found and fixed on the way (all real, all general)

1. **`import.meta` parse failure**: three's `KTX2Loader.js` evaluates `new URL(..., import.meta.url)`
   at module scope; the native bundle is a classic-script IIFE where that is a SyntaxError.
   Fixed textually in `runtime-native/scripts/bundle.mjs` via a pre-transform plugin.
2. **Device features were a stub**: `device.features.has()` answered true only for
   `indirect-first-instance`, so KTX2 format detection failed on capable GPUs. Both adapter and
   device feature sets now answer from the real Dawn objects (`wgpuAdapterHasFeature` /
   `wgpuDeviceHasFeature`), the device requests compression features the adapter supports, and
   the JS adapter object reaches the host through a new `getAdapter()` parameter.
3. **Worker polyfill dropped early messages and rejected emscripten init**: browser workers
   queue messages posted before handler registration — the polyfill now queues and flushes;
   worker scopes expose `addEventListener('message')` and `self.location`, whose absence made
   BASIS() reject silently.

Each fix was driven to green by the desktop gate above; none weakens an existing guard.

## Observed honestly

- One `THREE.KTX2Loader: Invalid texture` error appears once in the transcode log during boot
  (a first task rejected before the successful transcode). The gate passes and the texture
  renders; recorded rather than hidden.
- iOS/JSC: **not executed** — no lane on this machine. By design it fails closed: 095's
  `TN_ASSETS_KTX2_UNSUPPORTED` names the platform when no compressed format can be probed.
- Android emulator / physical device: **not executed** for this PRD.
- `pnpm test` remains green on machines with no CMake/NDK/Xcode: all native work sits behind
  opt-in `native:*` scripts and the default suite never requires them.

## What this record does not claim

No mobile readiness. No C++ decoder exists or is needed by any executed target; the original
C++ phases are superseded, not pending.

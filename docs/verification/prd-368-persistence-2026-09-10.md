# PRD-368 persistence implementation and verification

Recorded September 10, 2026 (America/Vancouver). PR: [#183](https://github.com/ThreeNativeHQ/threenative/pull/183).

## Status and evidence boundary

**PARTIAL, not performance-complete.** The host persistence and measurement protocol are implemented. Physical Pixel 8 measurements, rendered Bayview equivalence, human/independent review, and the full shared gate suite have not been verified for this change. This record does not close the PRD or earlier startup PRDs.

[Run 34544321624](https://github.com/ThreeNativeHQ/threenative/actions/runs/34544321624) reconstructed the owned patched wgpu-native library for Linux x64 and Android arm64. [Run 34544917308](https://github.com/ThreeNativeHQ/threenative/actions/runs/34544917308) built the production Linux C++ host and passed the real filesystem sanitizer contract. The latter has 8,248 assertions, including individual byte comparisons; it is not 8,248 independent scenarios. [Run 34547004643](https://github.com/ThreeNativeHQ/threenative/actions/runs/34547004643) passed 45 Node protocol/toolchain tests and 41 playtest tests; its first typecheck attempt failed because workspace subpath exports had not been built. The workflow now uses the owned workspace build before typechecking. The current CI run must be checked independently before treating later changes as verified.

A crucial negative result: hosted Mesa/Lavapipe reports the cache feature but serializes only a header. The strict host API test correctly fails when ten real pipeline creations leave serialized bytes equal to the empty-cache floor. The separate `threenative-pipeline-cache-lifecycle-test` exercises real Vulkan, device, process, and filesystem lifetime on that driver. It is explicitly compiled and reported as **envelope-lifecycle-only, compiledDataProof=false**. It cannot substitute for hardware compiled-artifact persistence or speedup. The original strict executable still requires cache growth.

The repository's physical-performance provisioning flag was false during this task. No Pixel measurements were executed and no synthetic parser fixture is presented as a measurement.

## Implementation and caller ledger

- `RuntimeConfig` carries host-only application and bundled-source identities before `initBindings`. Android owned asset bundles and desktop embedded releases supply their actual SHA-256; unqualified loose module trees stay memory-only.
- `bindings_pipeline_cache.cpp` owns the existing device cache. All four render/compute sync/worker creation sites still attach it. Shared compile locks preserve two-worker concurrency; the background snapshot takes exclusive ownership only around backend serialization, not file I/O.
- `pipeline_cache.cpp` validates a versioned envelope before unsafe backend import: size, exact length, all seven identity dimensions, and SHA-256. A successful envelope check is not backend acceptance. A rejected import keeps the empty cache and ordinary compilation.
- Storage uses the existing host-private root, one cache per application, a 32 MiB payload limit, process writer lock, fixed temporary name, file synchronization, atomic rename, and directory synchronization. Symlink, FIFO, oversized, corrupt, interrupted, concurrent, and read-only controls are tested. One cache plus lock and at most one interrupted temporary file bounds each application's generation count.
- A later post-present poll, after worker settlement and a stable attachment count, starts the asynchronous snapshot. No write occurs on first present or from each pipeline creation. Device/cache references remain retained until the future is joined at teardown. Fresh-process tests deliberately bypass destructors to expose shutdown-only persistence.
- `TN_PIPELINE_CACHE` reports load/store state, bytes, reasons, and separate load/snapshot/write costs. `playtest perf` retains these without inventing cache hits. Browser, stock-backend, Metal, D3D12, and iOS caching claims are unchanged.

## Reproduce dependency and storage proofs

The explicit reconstruction path requires Linux x64, Rust 1.90.0 and Android NDK 27.1.12297006. Set `ANDROID_HOME` to the SDK containing that NDK (or explicitly select the matching NDK). The downloader rejects mismatched versions and verifies the pinned source archive and public header; the stage records source/header/patch/library checksums and licenses. Normal stock dependency downloads still work and report the absent cache API rather than pretending to persist.

```sh
rustup toolchain install 1.90.0 --profile minimal
rustup target add --toolchain 1.90.0 aarch64-linux-android
node packages/runtime-native/scripts/download-deps.mjs --only wgpu
node packages/runtime-native/scripts/download-deps.mjs --rebuild-wgpu-cache-api --wgpu-cache-target linux-x64
node packages/runtime-native/scripts/download-deps.mjs --only wgpu-android
node packages/runtime-native/scripts/download-deps.mjs --rebuild-wgpu-cache-api --wgpu-cache-target android-arm64

g++ -std=c++17 -Wall -Wextra -Werror -pthread \
  -fsanitize=address,undefined -fno-omit-frame-pointer -g \
  packages/runtime-native/tests/pipeline_cache_test.cpp \
  packages/runtime-native/src/webgpu/pipeline_cache.cpp -o /tmp/tn-cache-storage
ASAN_OPTIONS=detect_leaks=1 /tmp/tn-cache-storage
```

The workflow retains exact reconstruction commands, library digests, adapter identity, CMake/build logs, and per-process receipts. Its Android build additionally compiles and links the C++ host; that is a build check, not on-phone execution.

For a cache-capable hardware Vulkan build, use the **strict** executable with the relaunch harness:

```sh
node packages/runtime-native/scripts/verify-pipeline-cache-relaunch.mjs \
  packages/runtime-native/build/prd368/threenative-pipeline-cache-api-test \
  artifacts/pipeline-cache-hardware-relaunch
```

The CPU-driver contract uses the explicitly different `threenative-pipeline-cache-lifecycle-test` executable and `--envelope-lifecycle-only` argument. The executable's scope marker must match the requested scope. Twelve independently executed arms include missing/accepted data, environment and app-private disabled controls, corrupt envelopes and backend bytes, changed source, concurrent compiles, shutdown, device destruction, and unwritable storage. Headless present counters in this contract test scheduling boundaries; they are not a presented-game or first-playable measurement.

## Real-phone protocol and remaining acceptance

Install one release/O2 Bayview APK built against the patched Android dependency. Retain its build command and optimization evidence separately: the measurement hashes the installed APK but labels the optimization flag as the operator's declaration. Use the game's real config and a scenario whose subject/inputs prove its movement and sustained-frame readiness. The supplied startup scenario is a starting fixture, not an asserted Bayview receipt.

```sh
node packages/runtime-native/scripts/measure-cold-start.mjs \
  --device "$PIXEL_WIFI_ADB_SERIAL" \
  --config "$BAYVIEW_CONFIG" \
  --optimization=-O2 \
  --pipeline-cache-pairs 3 \
  --startup-scenario "$BAYVIEW_STARTUP_SCENARIO" \
  --report artifacts/pixel8-pipeline-cache-pairs.json
```

Use `--optimization -O2` if the existing CLI is invoked with separate option values. Device validation requires a physical Pixel 8, Wi-Fi ADB, discharging battery at least 50%, thermal status NONE, and screen on; provisional overrides are rejected. The protocol force-stops and verifies no process remains between launches. It does not reinstall the APK, clear application data, or clear driver caches. It deletes only the named disposable pipeline cache for the empty arm. A regular app-private `pipeline-cache.disabled` file supplies Android's same-APK negative control, because zygote launches do not inherit the desktop environment variable. An existing operator control is not overwritten; cleanup failures fail the report.

Each of at least three groups runs disabled-before, empty, populated, and disabled-after. Retained raw logs, installed-APK checksums, device conditions, gameplay/readiness receipts, cache outcomes, complete compile populations, service/wall/elapsed clocks, and medians must all match. Baseline collection may allow up to 60 seconds to observe readiness; **the final populated first-playable median remains capped at 8,000 ms**. The evaluator requires populated compile median <=25% of empty and lower than both disabled controls. Human inspection must also establish unchanged rendered output and sensible raw timing.

Remaining acceptance is explicit: successful strict hardware relaunches, actual Pixel pairs and thresholds, visual/human review, independent code review, full runtime/native/game gates, and freshly measured native coverage where required. Do not restamp an old coverage digest without executing its owned measurement lane. Missing evidence is not a passing result.

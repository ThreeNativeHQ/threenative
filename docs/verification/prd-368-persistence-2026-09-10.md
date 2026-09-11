# PRD-368 persistence implementation and verification

Recorded September 10, 2026 (America/Vancouver). PR: [#183](https://github.com/ThreeNativeHQ/threenative/pull/183).

## Status and evidence boundary

**PARTIAL, not performance-complete.** Host persistence and the paired measurement protocol are implemented. Physical Pixel 8 performance, rendered Bayview equivalence, human/independent review, and the complete shared gate suite remain unverified. This record does not close this PRD or earlier startup PRDs.

[Run 34547004643](https://github.com/ThreeNativeHQ/threenative/actions/runs/34547004643), source `d9bf3213ac864fc5f1fdd6aa8b47a1786678f2c7`, executed:

| Verification | Actual result |
| --- | --- |
| Owned patched wgpu-native, Linux x64 | Reconstructed successfully from pinned inputs |
| Owned patched wgpu-native, Android arm64 | Reconstructed successfully; alignment checked |
| Android arm64 C++ host | Configured, compiled and linked `libmystral-runtime.so` |
| Linux C++ host and cache executables | Built and executed |
| Real filesystem failures under ASan/UBSan | Passed 8,248 assertions, including individual payload-byte comparisons, not 8,248 independent scenarios |
| Real Vulkan/storage/process lifetime | Twelve fresh-process arms passed, explicitly **envelope-lifecycle-only** |
| Measurement/protocol/toolchain Node tests | 45 passed |
| New and existing playtest performance tests | 41 passed |
| Playtest typecheck | Failed: dependency workspace subpath exports had not been built |

The host artifact retains `revision.txt`, adapter identity, configure/build logs, the strict negative result, both raw API controls, and per-process JSON/logs. The relaunch receipt says `compiledDataProof: false`, `firstPlayableClaim: false`, and `physicalDeviceClaim: false`.

Subsequent reviewed source `4568329d04a822a7e9dbd0d26263e826080948ba` adds the native-clock readiness fix, a stronger disabled-file compile assertion, API-probe parser compatibility, and CTest registration. Local red/green execution passed 42 measurement/protocol tests and the sanitizer contract's 8,256 assertions. The original native tests above are not silently relabelled as execution of these later changes.

[Run 34548977281](https://github.com/ThreeNativeHQ/threenative/actions/runs/34548977281), source/workflow `af7c31757c4c4ba4e419dbbdc2bd84f3b729021d`, is the final read-only revalidation lane. At this record's update it was still running/queued: consult its actual outcome rather than reading this link as a pass. The workflow now builds the owned workspace before typechecking. Temporary source-writing jobs and patch payloads were removed; verification has `contents: read` and non-persistent checkout credentials.

## Why the CPU-driver proof is deliberately limited

Hosted Mesa/Lavapipe exposes the feature but serializes only a Vulkan header. Ten real host pipeline creations leave the serialized cache at the empty-cache floor. The original strict `threenative-pipeline-cache-api-test` correctly fails that condition; its greater-than-empty requirement remains intact.

The separate `threenative-pipeline-cache-lifecycle-test` executes real Vulkan, device lifetime, filesystem operations and independent processes, but is compiled and reported as **envelope-lifecycle-only**. It cannot prove persistence of compiled shader data or a speedup. The workflow retains the strict rejection before running this narrower contract. The earlier hardware prototype in the PRD is historical evidence, not a new hardware run of this implementation.

The repository's physical-performance provisioning flag was false during this task. No actual Pixel measurements were executed. Synthetic parser fixtures are tests of refusal and arithmetic, never measurements.

## Implementation and caller ledger

- `RuntimeConfig` carries host-only application and bundled-source identities before `initBindings`. Android owned asset bundles and desktop embedded releases supply their source SHA-256; loose module trees remain memory-only rather than guessing their imported shader identities.
- `bindings_pipeline_cache.cpp` owns one device cache. All four render/compute synchronous/worker creation paths still attach it. Two compile workers take shared locks; snapshots take exclusive ownership only for backend serialization, never for filesystem I/O. Cache/device references survive until the snapshot and compiler workers are joined.
- `pipeline_cache.cpp` checks version, bounded exact length, all seven identity dimensions and SHA-256 before unsafe import. Envelope validation is distinct from backend acceptance. Rejected data leaves an empty cache and normal compilation.
- Storage reuses the app-private root with one 32 MiB-bounded cache per application, a process writer lock, fixed temporary name, file synchronization, atomic rename and directory synchronization. Corruption, foreign identities, symlinks, FIFOs, oversized input, interrupted writes, concurrent writers and read-only storage are covered. One cache, one lock and at most one interrupted temporary file bound generation leftovers.
- Later post-present polling starts a background save after workers settle and the attachment count is stable. No save runs on first present or per pipeline creation. Relaunch tests deliberately bypass destructors, detecting shutdown-only persistence.
- `TN_PIPELINE_CACHE` reports actual load/store outcomes, bytes, reasons and separate load/snapshot/write costs. `playtest perf` preserves them without inventing hits. Existing API-probe boolean attachments remain readable; device attachment counts remain numeric.
- Native `TN_COLD_START:first_playable` observes the existing readiness flag and a subsequent actual present. It uses the same native clock as `process`; the later-created JavaScript clock remains a separate reported diagnostic, not the 8-second metric. Cache-disabled controls use the same boundary.

Game materials and warm-up scheduling are unchanged. Browser/stock-backend/Metal/D3D12/iOS cache claims remain explicitly unverified or unsupported.

## Reproduce dependency and storage proofs

Use Linux x64, Rust 1.90.0 and NDK 27.1.12297006. Set `ANDROID_HOME` to the SDK containing that NDK. Reconstruction verifies pinned source/header inputs and retains patch/library checksums and licenses; stock downloads still report the absent cache API honestly.

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

On cache-capable hardware Vulkan, use the strict executable:

```sh
node packages/runtime-native/scripts/verify-pipeline-cache-relaunch.mjs \
  packages/runtime-native/build/prd368/threenative-pipeline-cache-api-test \
  artifacts/pipeline-cache-hardware-relaunch
```

Only the separate CPU lifecycle executable accepts `--envelope-lifecycle-only`; its compiled scope must match the harness. Twelve arms cover missing/accepted data, both disabled controls, corrupt envelopes and backend bytes, changed source, concurrent compiles, shutdown, device destruction and unwritable storage. Headless counters test scheduling boundaries, not presented gameplay. The strengthened disabled-file arm also requires actual host compilation with zero cache attachments.

## Physical Pixel protocol and unclosed acceptance

Install one O2 Bayview APK built against the patched Android backend. Retain its build command and optimization evidence: the protocol independently hashes the installed APK but correctly labels optimization as an operator declaration. Resolve the real game's config and readiness/movement scenario; the supplied fixture is not a Bayview receipt.

```sh
node packages/runtime-native/scripts/measure-cold-start.mjs \
  --device "$PIXEL_WIFI_ADB_SERIAL" \
  --config "$BAYVIEW_CONFIG" \
  --optimization -O2 \
  --pipeline-cache-pairs 3 \
  --startup-scenario "$BAYVIEW_STARTUP_SCENARIO" \
  --report artifacts/pixel8-pipeline-cache-pairs.json
```

Requirements: physical Pixel 8, Wi-Fi ADB, discharging battery at least 50%, thermal status NONE, screen on, and no provisional override. The runner force-stops and verifies no process survives. It neither reinstalls the APK nor clears application or driver data; only the disposable named cache is removed for the empty arm. Android's app-private disable file changes attachment without rebuilding the APK. Existing operator controls are not overwritten; cleanup failures fail the report.

Each group runs disabled-before, empty, populated and disabled-after. Complete matching pipeline populations, raw logs, installed-APK hashes, pre/post device conditions, movement/readiness receipts and cache outcomes are required. Baselines may collect readiness up to 60 seconds; the final **native process-to-first-playable median remains <=8,000 ms**. Populated compile median must be <=25% of empty and lower than both disabled controls. Service, summed wall and elapsed clocks remain separately reported.

Still required: successful strict hardware relaunches; actual Pixel pairs meeting the thresholds; unchanged rendered output and human timing review; independent code review; full runtime/native/game gates and freshly measured native coverage where required. Do not restamp a coverage digest without running its owned measurement lane. Missing evidence is not a passing result.

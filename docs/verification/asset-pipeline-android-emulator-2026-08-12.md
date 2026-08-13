# Asset-pipeline trigger check — Android emulator — 2026-08-12

Status: the device-performance half was measured, but the asset-pipeline trigger did not fire.
The reference game failed the generic frame budget on the emulator; the evidence does not
attribute that failure to assets. The stranger five-minute transcript is also still missing.
The six asset-pipeline PRDs therefore remain gated and unimplemented.

## Device and provenance

- Device: `emulator-5554`, model `sdk_gphone64_x86_64`, Android API 36, `x86_64`, 1080×2400.
- GPU path: emulator software rendering (SwiftShader); this is not physical-device evidence.
- Build: a locally source-built Android runtime, with a temporary local prebuilt manifest used to
  supply the scaffolded APK's native artifacts. This is a plumbing/profile result, not release
  artifact proof.
- App: scaffolded platformer, package `com.threenative.platformer`.

## Command

```sh
pnpm profile:production -- --target android --device emulator-5554 \
  --duration 3 --warmup 1 --cold-starts 1 --repetitions 1 \
  --out .runtime/asset-trigger/android-reference-7
```

The run completed with `productionEvidenceV1`, exit `1`, and these lifecycle markers:
`run-start`, `first-workload-frame`, `clean-end`.

## Observed result

| Check | Result |
|---|---:|
| Android playtest report | pass |
| Playtest diagnostics | none |
| Console errors | 0 |
| Startup | 878 ms |
| Parsed frame samples | 940 |
| Frame p50 | 9.996 ms |
| Frame p95 | 543.882 ms |
| Frame p99 | 574.800 ms |
| Evidence status | FAIL — `TN_PROD_PERFORMANCE_BUDGET` |

The large tail latency appears while each native playtest step crosses the ADB-backed mailbox on
the software-rendered emulator. The run also reports no usable draw-call or triangle sample. That
is host/transport evidence, not a measured asset-cost attribution. The reference scene's native
log reports 29 source meshes and scene collapse deferred below its mesh floor; no compiled asset
pipeline is present in this run.

## Trigger decision

The performance condition remains **false**: a generic emulator budget failure is not the required
“for asset reasons” failure. The stranger-play condition remains **false** because no five-minute
transcript exists. No asset-pipeline implementation is justified by this run.

Evidence artifacts were produced locally under
`/tmp/tn-asset-pipeline-evidence-20260812/asset-trigger/android-reference-7/` and are intentionally
not committed; this record preserves the application artifact and production-playtest hashes.

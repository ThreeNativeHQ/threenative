# Every Android game fails to boot: `TN_ASSETS_KTX2_UNSUPPORTED`

**Status:** fixed 2026-08-23 — root cause confirmed by measurement, fix proven on a physical
Pixel 8 on both JS engines
**Severity:** blocker — any game calling `createAssetLoader({ renderer })` dies before its first
frame on Android. The user sees a black screen; the reason appears only in `logcat`.
**Reported:** 2026-08-23, from a run on a physical Pixel 8
**Repository:** ThreeNative (`packages/runtime-native`, `packages/core`)

---

## What happens

Launching the native smoke game on a physical Pixel 8 (Mali-G715, Android 15) throws during boot:

```
08-23 17:14:57.404 11607 11662 I MystralStdio: [error]
TN_NATIVE_SMOKE_FAILED:TN_ASSETS_KTX2_UNSUPPORTED: the webgpu renderer on
Mozilla/5.0 (Macintosh; MystralNative/0.1) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36
supports no compressed texture format; compiled KTX2 textures cannot be transcoded here.
```

The scene never renders. The device shows a black screen with no on-screen diagnostic.

Reproduced twice on the same device, once per JavaScript engine:

| Engine | Result |
| --- | --- |
| QuickJS (`-PthreenativeJsEngine=quickjs`) | identical failure |
| V8 (default) | identical failure |

So it is **engine-independent**. It is also not a hardware limitation: a Mali-G715 supports ETC2
and ASTC.

Reproduce with:

```sh
export ANDROID_HOME="$HOME/Android/Sdk"
node packages/runtime-native/scripts/verify-android-first-proof.mjs \
  --device <SERIAL> --expect-engine quickjs
```

## Root cause

WebGPU only exposes a device feature if it was named in `requiredFeatures` at `requestDevice`
time. **All three Android device-creation branches request none.**

`packages/runtime-native/src/webgpu/context.cpp`, at lines 392, 691 and 918 — three
`#if defined(MYSTRAL_WEBGPU_WGPU_MODERN) && defined(__ANDROID__)` blocks, each containing:

```cpp
// Android emulator Vulkan can advertise IndirectFirstInstance through
// WebGPU while rejecting it when the HAL opens the device.
deviceDesc.requiredFeatureCount = 0;
deviceDesc.requiredFeatures = nullptr;
hasIndirectFirstInstance_ = false;
```

The comment names the intent: work around an **emulator** bug in one feature,
`IndirectFirstInstance`. The implementation drops **every** feature, on **every** Android device,
physical ones included. The three texture-compression features are collateral damage.

The non-Android branches immediately below do it correctly — they probe the adapter and request
each compression feature it advertises:

```cpp
for (WGPUFeatureName compression : {WGPUFeatureName_TextureCompressionBC,
                                    WGPUFeatureName_TextureCompressionETC2,
                                    WGPUFeatureName_TextureCompressionASTC}) {
    if (wgpuAdapterHasFeature(adapter_, compression)) {
        requiredFeaturesDawn[featureCount++] = compression;
    }
}
```

### The chain, end to end

1. Android requests a device with zero features → `device.features` is empty.
2. `device.features.has(name)` is implemented correctly and answers from the real device
   (`packages/runtime-native/src/webgpu/bindings.cpp:2301-2321`), so it truthfully returns `false`
   for `texture-compression-bc` / `-etc2` / `-astc`. The JS-name → `WGPUFeatureName` mapping
   (`bindings.cpp:993`) is complete and is **not** the problem.
3. Three.js `KTX2Loader.detectSupport(renderer)` asks the renderer for each compressed format,
   gets `false` for all, and leaves `workerConfig` with no format enabled.
4. `createKtx2Loader` in `packages/core/src/assets.ts:232-241` sees zero supported formats and
   throws `TN_ASSETS_KTX2_UNSUPPORTED` — deliberately, so a silent RGBA32 fallback cannot happen.
5. `createAssetLoader` (`packages/core/src/assets.ts:252-265`) runs that detection **at
   construction, before any asset request**, and `defineGame` awaits it during boot. The game dies
   before its first frame **whether or not it uses a single compressed texture**.

## Is it a regression?

Partly, and this is the interesting bit — two commits, neither wrong on its own:

| Commit | Date | Contribution |
| --- | --- | --- |
| `cd0e8fd6` "feat(native): absorb Mystral runtime host" | 2026-08-08 | Brought `context.cpp` in with the Android zero-features workaround already present. Android has therefore **never** requested compression features. |
| `95c079b4` "feat: the asset pipeline series — PRD-094 through PRD-099" | 2026-08-22 | Added `TN_ASSETS_KTX2_UNSUPPORTED` as a fail-closed **throw at boot**, replacing a silent fallback. |

So the underlying defect is 2 weeks old and was latent; the asset-pipeline series converted it from
"Android silently uploads uncompressed RGBA32" into "Android games do not start". The fail-closed
throw is correct behaviour and should stay — it is what surfaced a real, long-standing bug. The
Android device request is what needs fixing.

## Suggested fix

Narrow the workaround to the feature it was written for. In each of the three Android blocks in
`context.cpp`, keep excluding `IndirectFirstInstance`, but still request the compression features
the adapter advertises — i.e. reuse the loop the non-Android branch already has, minus
`IndirectFirstInstance`.

Open questions for whoever takes this:

1. **Does the emulator problem extend past `IndirectFirstInstance`?** The comment only claims that
   one feature. If the emulator also rejects compression features it advertises, the fix needs to
   be conditional on emulator vs physical device rather than on `__ANDROID__`.
2. **Which of the three blocks does a real device take?** They correspond to headless init, surface
   init and surface-with-display init. This is currently unverified — see the note below.
3. **Should `hasIndirectFirstInstance_ = false` stay unconditional on Android?** It is a separate
   correctness question from the compression features and should not be changed in the same pass
   without its own evidence.

## What is verified, and what is not

**Verified**
- The failure reproduces on a physical Pixel 8 on both JS engines.
- The failure is in `createKtx2Loader`'s zero-supported-format branch (the error text is unique to
  it).
- All three Android branches in `context.cpp` set `requiredFeatures = nullptr`; source-read, not
  disputed.
- `device.features.has` and the feature-name mapping are correctly implemented — they are not the
  fault.

**Not verified**
- **The adapter's actual feature set on this device was never printed.** An instrumentation line was
  added to the `#elif defined(MYSTRAL_WEBGPU_WGPU)` branch (`context.cpp:437`) and it **did not
  appear in the device log**, which is itself the evidence that Android takes the earlier
  `WGPU_MODERN && __ANDROID__` branch instead. The probe needs to be added to *that* branch to
  confirm `wgpuAdapterHasFeature(adapter_, WGPUFeatureName_TextureCompressionETC2)` is true on the
  Pixel 8. Until then the root cause is a very strong inference, not a measurement.
- Whether the Android emulator behaves the same as the phone.
- Whether desktop is affected. Desktop takes the Dawn branch, which does request the features, so
  it is expected to be fine — but no desktop KTX2 run was executed for this report.

## Environment

- Device: Google Pixel 8 (`shiba`), serial `37251FDJH0037Z`, USB, screen on
- GPU: `[WebGPU] Adapter: Mali-G715`
- Backend: wgpu-native (`MYSTRAL_USE_WGPU=ON`, `MYSTRAL_USE_DAWN=OFF` per the `tn-android` preset)
- ABI: `arm64-v8a`
- App: `com.threenative.game`
- Logs: `packages/runtime-native/artifacts/android/ktx2-probe-logcat.txt`,
  `first-proof-logcat.txt` (QuickJS), `first-proof-logcat-v8.txt` (V8)

## Relevant files

| Path | Why |
| --- | --- |
| `packages/runtime-native/src/webgpu/context.cpp:392,691,918` | the three Android branches that request no features |
| `packages/runtime-native/src/webgpu/bindings.cpp:2301` | `device.features.has`, correct |
| `packages/runtime-native/src/webgpu/bindings.cpp:993` | JS feature-name mapping, complete |
| `packages/core/src/assets.ts:217-241` | `createKtx2Loader`, where the throw originates |
| `packages/core/src/assets.ts:252-265` | boot-time detection that makes it fatal |
| `packages/runtime-native/scripts/verify-android-first-proof.mjs` | the device lane that catches it |

---

## Resolution (2026-08-23)

Each of the three Android blocks in `context.cpp` now keeps the workaround scoped to the feature it
names: `IndirectFirstInstance` stays excluded and `hasIndirectFirstInstance_` stays `false`
(unanswered question 3 deliberately left alone), while the compression loop the non-Android branches
already had requests BC/ETC2/ASTC when the adapter advertises them. If an adapter advertises none,
the request degrades to today's zero-feature behaviour rather than failing device creation. Probe
results print to the log on every Android init path, so the adapter's feature set is now measured on
each device run instead of inferred.

**The three open questions, answered with evidence:**

1. **Does the emulator problem extend past `IndirectFirstInstance`?** Not on this emulator: its
   SwiftShader adapter advertises all three compression formats, the request containing all three
   succeeded, and the gate passed. Scoped honestly: this image renders through SwiftShader, not a
   host-GPU passthrough, so a hardware-backed emulator image could still behave differently — the
   probe prints make that visible if it ever does.
2. **Which block does a real device take?** The surface-init block (`context.cpp:691` pre-fix): the
   phone logs carry `[WebGPU] Adapter:` (surface init) and never `[WebGPU] Headless adapter:`.
3. **Should `hasIndirectFirstInstance_ = false` stay unconditional on Android?** It did stay — no
   evidence about the emulator's indirect-draw behaviour changed, so it was out of scope for this
   pass.

**Green runs** (`verify-android-first-proof.mjs`, all exit 0, all four required markers in order —
`TN_NATIVE_SMOKE_THREE → READY:webgpu → FIRST_FRAME → TN_NATIVE_SMOKE_300_FRAMES:300` — non-blank
screenshot, process alive past settle):

| Lane | Adapter | Probes (BC/ETC2/ASTC) | Engine | Result |
| --- | --- | --- | --- | --- |
| Pixel 8 (`37251FDJH0037Z`) | Mali-G715 | no / yes / yes | V8 | PASS |
| Pixel 8 (`37251FDJH0037Z`) | Mali-G715 | no / yes / yes | QuickJS | PASS |
| Emulator (`emulator-5554`) | SwiftShader | yes / yes / yes | V8 | PASS |

The compile of the previously-dead Android branch is proven too: desktop builds never instantiate
it, so `cmake --build build/tn-android` (arm64, NDK 27.1) compiled `context.cpp` and linked
`libmystral-runtime.so` cleanly before any device run. Desktop takes the untouched Dawn branch.


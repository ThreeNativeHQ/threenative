// `rg11b10ufloat-renderable` must be truthful at the JS surface and usable by a render pass.
//
// Three's SSGINode builds its GI target as RGBFormat + UnsignedInt101111Type, which the WebGPU
// backend maps to `rg11b10ufloat` with RENDER_ATTACHMENT usage — unconditionally: no feature
// check, no reduced-quality fallback. Rendering into that format requires the optional WebGPU
// feature `rg11b10ufloat-renderable`. The runtime's device creation never requested it and the
// JS feature-name mapper did not know the name, so on native the stage could only manifest as a
// device loss — which lumen-hall's postprocessing.ts worked around by dropping GI on isNative().
//
// Four answers, from four independent layers:
//
//   raw Dawn   — wgpuAdapterHasFeature called here directly, the oracle no binding can lie to
//   probe line — the `[WebGPU] adapter feature probe` context.cpp prints at device creation
//   adapter JS — adapter.features.has("rg11b10ufloat-renderable")
//   device JS  — device.features.has("rg11b10ufloat-renderable")
//
// plus the thing the feature buys: a render pass into an rg11b10ufloat target that leaves the
// device alive. An adapter without the feature degrades to a reported unexecuted rather than a
// failure, because "this GPU cannot" and "these bindings cannot" are different results and only
// the second is a red.

#include "mystral/runtime.h"

#include <iostream>
#include <string>

// The same C API both backends implement; bindings.cpp reaches it the same way. The wgpu C
// header comes before webgpu_compat.h — the compat macros expand against names it declares.
#if defined(MYSTRAL_WEBGPU_DAWN)
#include <webgpu/webgpu.h>
#else
#include <webgpu.h>
#endif
#include "mystral/webgpu_compat.h"

namespace {

// Read by the JS through string injection: the oracle no binding can lie to. Everything else
// the JS reports about features is checked against this.
static bool g_rawAdapterHas = false;

constexpr const char* kSetup = R"JS((() => {
  const adapter = navigator.gpu.requestAdapter();
  const adapterHas = adapter.features.has("rg11b10ufloat-renderable");
  const device = adapter.requestDevice();
  const deviceHas = device.features.has("rg11b10ufloat-renderable");
  globalThis.__tnRg = { rawHas: RAW_ADAPTER_HAS, adapterHas, deviceHas, passRan: false };
  // Held off the reported record: JSON.stringify would otherwise serialise the whole device.
  globalThis.__tnRgDevice = device;
  if (!adapterHas) return;

  // The thing the feature buys. Before the fix this pass was the device loss itself: three's
  // SSGI creates exactly this target shape, Dawn validated RENDER_ATTACHMENT on a format the
  // device's feature set did not cover, and the run died instead of degrading.
  const target = device.createTexture({
    size: { width: 64, height: 64, depthOrArrayLayers: 1 },
    format: "rg11b10ufloat",
    usage: 0x10,                                                               // RENDER_ATTACHMENT
  });
  const view = device.createTextureView(target);
  const encoder = device.createCommandEncoder();
  const pass = encoder.beginRenderPass({
    colorAttachments: [
      { view, loadOp: "clear", storeOp: "store",
        clearValue: { r: 0.25, g: 0.5, b: 0.75, a: 1 } },
    ],
  });
  pass.end();
  device.queue.submit([encoder.finish()]);
  globalThis.__tnRg.passRan = true;
})())JS";

// Runs after the host has drained frames, so the pass above has actually crossed the packed
// frame op stream and been replayed against Dawn — the point where the pre-fix device loss
// surfaced. An empty submit plus onSubmittedWorkDone is the liveness probe: a device lost
// during the rg11b10 pass never completes this one.
constexpr const char* kRead = R"JS((() => {
  if (!globalThis.__tnRg.adapterHas) {
    console.log("TN_RG11B10:" + JSON.stringify({
      adapterHas: false, deviceHas: globalThis.__tnRg.deviceHas,
    }));
    return;
  }
  const device = globalThis.__tnRgDevice;
  const encoder = device.createCommandEncoder();
  device.queue.submit([encoder.finish()]);
  device.queue.onSubmittedWorkDone().then(() => {
    globalThis.__tnRgDone = true;
    console.log("TN_RG11B10:" + JSON.stringify(globalThis.__tnRg));
  }).catch((error) => {
    globalThis.__tnRgError = String(error && error.message ? error.message : error);
  });
})())JS";

constexpr const char* kAssert = R"JS((() => {
  const r = globalThis.__tnRg;
  if (!r.adapterHas) {
    // The adapter layer may honestly lack the feature. What it may not do is disagree with
    // the raw probe or grant the device something the adapter never had.
    if (r.rawHas) throw new Error("raw Dawn reports the feature but the JS adapter surface hid it");
    if (r.deviceHas) throw new Error("device was granted a feature the adapter does not advertise");
    console.log("TN_RG11B10_UNEXECUTED: adapter lacks rg11b10ufloat-renderable");
    return;
  }
  if (r.rawHas !== true) throw new Error("JS adapter advertised the feature raw Dawn does not have");
  if (r.deviceHas !== true)
    throw new Error("the adapter advertises rg11b10ufloat-renderable but the bindings refused it on the device");
  if (r.passRan !== true) throw new Error("setup never recorded the rg11b10ufloat render pass");
  if (globalThis.__tnRgError) throw new Error(globalThis.__tnRgError);
  if (globalThis.__tnRgDone !== true) throw new Error("liveness submit never completed");
})())JS";

#if defined(MYSTRAL_WEBGPU_DAWN)
struct RawAdapterData {
    WGPUAdapter adapter = nullptr;
    bool completed = false;
};

static void onRawAdapterRequest(WGPURequestAdapterStatus status, WGPUAdapter adapter,
                                WGPUStringView message, void* userdata1, void* userdata2) {
    auto* data = static_cast<RawAdapterData*>(userdata1);
    if (status == WGPURequestAdapterStatus_Success) data->adapter = adapter;
    else {
        std::cerr << "[RG11B10] raw adapter request failed: "
                  << (message.data ? std::string(message.data, message.length) : std::string())
                  << '\n';
    }
    data->completed = true;
}
#endif

}  // namespace

int main() {
#if defined(MYSTRAL_WEBGPU_DAWN)
    // The oracle: raw Dawn, no binding in between. This is what makes a refusal a red rather
    // than a skip — without it, a hidden feature and an absent feature look identical from JS.
    {
        WGPUInstanceDescriptor instanceDesc = {};
        WGPUInstance instance = wgpuCreateInstance(&instanceDesc);
        if (!instance) {
            std::cerr << "[RG11B10] could not create a raw Dawn instance for the oracle\n";
            return 1;
        }
        WGPURequestAdapterOptions adapterOptions = {};
        adapterOptions.powerPreference = WGPUPowerPreference_HighPerformance;
        RawAdapterData adapterData;
#if WGPU_USES_CALLBACK_INFO_PATTERN
        WGPURequestAdapterCallbackInfo callbackInfo = {};
        callbackInfo.mode = WGPUCallbackMode_AllowProcessEvents;
        callbackInfo.callback = onRawAdapterRequest;
        callbackInfo.userdata1 = &adapterData;
        callbackInfo.userdata2 = nullptr;
        wgpuInstanceRequestAdapter(instance, &adapterOptions, callbackInfo);
#else
        wgpuInstanceRequestAdapter(instance, &adapterOptions, onRawAdapterRequest, &adapterData);
#endif
        while (!adapterData.completed) {
            wgpuInstanceProcessEvents(instance);
        }
        if (!adapterData.adapter) {
            std::cerr << "[RG11B10] raw adapter request returned no adapter\n";
            return 1;
        }
        g_rawAdapterHas =
            wgpuAdapterHasFeature(adapterData.adapter, WGPUFeatureName_RG11B10UfloatRenderable) != 0;
        std::cout << "[RG11B10] raw wgpuAdapterHasFeature: " << (g_rawAdapterHas ? "yes" : "no")
                  << std::endl;
    }
#else
    std::cout << "[RG11B10] backend is not Dawn; raw oracle unavailable" << std::endl;
#endif

    mystral::RuntimeConfig config;
    config.width = 1;
    config.height = 1;
    config.noSdl = true;

    auto runtime = mystral::Runtime::create(config);
    if (!runtime) {
        std::cerr << "could not create headless native runtime\n";
        return 1;
    }

    // Inject the oracle's answer; the JS compares every layer it can see against it.
    const std::string setupWithOracle = [](const std::string& tpl) {
        const std::string needle = "RAW_ADAPTER_HAS";
        const std::string value = g_rawAdapterHas ? "true" : "false";
        std::string out = tpl;
        const auto at = out.find(needle);
        if (at != std::string::npos) out.replace(at, needle.size(), value);
        return out;
    }(std::string(kSetup));

    if (!runtime->evalScript(setupWithOracle.c_str(), "rg11b10_setup.js")) {
        std::cerr << "rg11b10ufloat bindings failed at setup";
        if (runtime->getExitCode() != 0) std::cerr << " (exit " << runtime->getExitCode() << ")";
        std::cerr << '\n';
        return 1;
    }

    // Frames, not ticks: the packed frame op stream is drained and replayed by the host once
    // per frame, and the render pass this contract is about sits in it. This is where the
    // pre-fix device loss happened.
    for (int frame = 0; frame < 60; frame += 1) {
        if (!runtime->pollEvents()) break;
    }

    if (!runtime->evalScript(kRead, "rg11b10_read.js")) {
        std::cerr << "rg11b10ufloat liveness probe failed to start\n";
        return 1;
    }
    for (int frame = 0; frame < 60; frame += 1) {
        if (!runtime->pollEvents()) break;
    }

    if (!runtime->evalScript(kAssert, "rg11b10_assert.js")) {
        std::cerr << "rg11b10ufloat contract failed\n";
        return 1;
    }

    std::cout << "native rg11b10 renderable bindings contract passed\n";
    return 0;
}

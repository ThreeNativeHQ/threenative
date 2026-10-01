// `adapter.info` must carry the identity core's `softwareAdapter` fact is read from.
//
// Core reads four names — architecture, description, device, vendor — and classifies a CPU
// rasteriser by scanning them. The webgpu-bindings contract proved those four lines exist in
// bindings.cpp; source shape is not execution. This drives the real native Runtime headless,
// reads `navigator.gpu.requestAdapter().info` through the same JS bindings a game reads, and
// fails when a field is missing or empty — the shape that made the playtest classifier call a
// run hardware with no adapter behind it.
//
// On a machine with no GPU this records what it saw and passes, naming the adapter: "this lane
// has no adapter identity" is a different result from "the bindings do not publish one", and only
// the second is a red.

#include "mystral/runtime.h"

#include <iostream>

namespace {

// Synchronous, deliberately. An `async` body settles its promise after evalScript has already
// returned true, so a missing field threw into a rejected promise this test never awaited — the
// contract passed on a bindings.cpp with `architecture` renamed to `arch`. `requestAdapter`
// resolves synchronously in these bindings, which is what the timestamp-query contract relies on
// too, so the read needs no await and the throw reaches the caller.
constexpr const char* kRead = R"JS((() => {
  const adapter = navigator.gpu.requestAdapter();
  const info = adapter.info;
  const fields = ["architecture", "description", "device", "vendor"];
  const reported = {};
  for (const field of fields) {
    const value = info === undefined || info === null ? undefined : info[field];
    reported[field] = typeof value === "string" ? value : "";
  }
  const missing = fields.filter((field) => reported[field].length === 0);
  console.log("TN_NATIVE_ADAPTER_INFO:" + JSON.stringify({ fields: reported, missing }));
  if (missing.length > 0) {
    throw new Error("TN_NATIVE_ADAPTER_INFO_INCOMPLETE:" + missing.join(","));
  }
  return true;
})()
)JS";

}  // namespace

int main() {
    mystral::RuntimeConfig config;
    config.width = 1;
    config.height = 1;
    config.noSdl = true;

    auto runtime = mystral::Runtime::create(config);
    if (!runtime) {
        std::cerr << "could not create headless native runtime\n";
        return 1;
    }

    if (!runtime->evalScript(kRead, "native_adapter_info_read.js")) {
        std::cerr << "native adapter.info did not publish the four fields core reads\n";
        if (runtime->getExitCode() != 0) std::cerr << " (exit " << runtime->getExitCode() << ")";
        std::cerr << '\n';
        return 1;
    }

    std::cout << "native adapter.info identity contract passed\n";
    return 0;
}

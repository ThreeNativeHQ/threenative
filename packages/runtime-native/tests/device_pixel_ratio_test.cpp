// `window.devicePixelRatio` must be the display's real ratio, and the canvas must draw the
// distinction the web platform draws: `width`/`height` are the backing store in physical pixels,
// `clientWidth`/`clientHeight` are the CSS layout box in logical pixels.
//
// The runtime used to report the physical surface for all four and a hardcoded ratio of 1.0. On a
// Pixel 8 that hands a layout a "2400 CSS pixel" viewport, so a UI written against it renders at
// roughly a third of its intended size — and it makes `resolutionScale` compensate for a lie.
//
// What this asserts is the *invariant*, which holds at every density including the 1.0 of a
// headless display: logical x ratio is the backing store. A build that made one of the three real
// and left another physical breaks it on any dense display, and this is the contract that says so.
// The density-dependent half — that a Pixel 8 reports 2.625 rather than 1.0 — is a device arm and
// is recorded in docs/verification/runtime-perf-state.md, not here.
//
// Needs no display, per the native-contract lane.

#include "mystral/runtime.h"

#include <iostream>

namespace {

constexpr const char* kScript = R"JS((() => {
  const ratio = globalThis.devicePixelRatio;
  if (!(typeof ratio === "number" && Number.isFinite(ratio) && ratio > 0))
    throw new Error("devicePixelRatio is not a usable ratio: " + String(ratio));

  const canvas = document.getElementById("canvas");
  if (!canvas) throw new Error("no canvas to measure");

  for (const [name, value] of [
    ["width", canvas.width],
    ["height", canvas.height],
    ["clientWidth", canvas.clientWidth],
    ["clientHeight", canvas.clientHeight],
    ["innerWidth", globalThis.innerWidth],
    ["innerHeight", globalThis.innerHeight],
  ]) {
    if (!(typeof value === "number" && Number.isFinite(value) && value > 0))
      throw new Error(name + " is not a usable dimension: " + String(value));
  }

  // The invariant: the CSS box times the ratio is the backing store. Rounding is one pixel per
  // axis because the runtime rounds the logical size it reports.
  const expectedWidth = Math.round(canvas.clientWidth * ratio);
  const expectedHeight = Math.round(canvas.clientHeight * ratio);
  if (Math.abs(expectedWidth - canvas.width) > 1 || Math.abs(expectedHeight - canvas.height) > 1) {
    throw new Error(
      "clientWidth x devicePixelRatio is not the backing store: " +
        `${canvas.clientWidth} x ${ratio} = ${expectedWidth} against width ${canvas.width}, ` +
        `${canvas.clientHeight} x ${ratio} = ${expectedHeight} against height ${canvas.height}`,
    );
  }

  // The viewport is the CSS box, not the surface.
  if (Math.abs(globalThis.innerWidth - canvas.clientWidth) > 1)
    throw new Error(
      `innerWidth ${globalThis.innerWidth} disagrees with clientWidth ${canvas.clientWidth}`,
    );

  console.log(
    "TN_DEVICE_PIXEL_RATIO:" +
      JSON.stringify({
        devicePixelRatio: ratio,
        backingStore: [canvas.width, canvas.height],
        cssBox: [canvas.clientWidth, canvas.clientHeight],
        viewport: [globalThis.innerWidth, globalThis.innerHeight],
      }),
  );
})())JS";

}  // namespace

int main() {
    mystral::RuntimeConfig config;
    config.width = 1280;
    config.height = 720;
    config.noSdl = true;

    auto runtime = mystral::Runtime::create(config);
    if (!runtime) {
        std::cerr << "could not create headless native runtime\n";
        return 1;
    }

    if (!runtime->evalScript(kScript, "device_pixel_ratio_test.js")) {
        std::cerr << "device pixel ratio contract failed";
        if (runtime->getExitCode() != 0) std::cerr << " (exit " << runtime->getExitCode() << ")";
        std::cerr << '\n';
        return 1;
    }

    std::cout << "native device pixel ratio contract passed\n";
    return 0;
}

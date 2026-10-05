// Shipping desktop/CI identity policy. The measured C++ coverage lane retains its own unchanged
// default preset and execution machinery; it neither imports nor executes this build helper.
export function desktopPreset(platform = process.platform) {
  if (platform === "darwin") return "tn-macos";
  if (platform === "win32") return "tn-windows";
  return "tn-linux";
}

// Linux arm64 has neither a V8 nor a Dawn prebuilt.
export function desktopBuildOverrides(platform = process.platform, arch = process.arch) {
  return platform === "linux" && arch === "arm64"
    ? { MYSTRAL_USE_V8: "OFF", MYSTRAL_USE_QUICKJS: "ON", MYSTRAL_USE_DAWN: "OFF", MYSTRAL_USE_WGPU: "ON" }
    : {};
}

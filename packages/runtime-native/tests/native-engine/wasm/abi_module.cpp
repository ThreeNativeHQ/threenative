// PRD-532: the engine's C ABI as a Wasm module for the browser-JS back end
// (packages/three-native/src/browser-backend.ts). The module is the ABI and nothing else: no
// entry point, no WebGPU. Its exports are listed in cmake/NativeEngineCore.cmake.
#include "threenative/abi/tn_abi.h"

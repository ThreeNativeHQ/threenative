#pragma once

namespace mystral::js {
class Engine;
}

namespace mystral::metahuman {

/**
 * Install `globalThis.__THREENATIVE_NATIVE__.metahuman`, the native half of the MetaHuman
 * facial rig: the same `packages/metahuman/cpp` C ABI the browser WASM build exports, behind
 * the same `js::Engine` seam native physics uses.
 *
 * The installed object is a flat function set over ABI handles. A handle is the ABI's own
 * never-reused id, so a destroyed rig's id can never resolve to the next rig, and the JS side
 * never holds a pointer.
 */
bool initializeNativeMetaHumanBindings(js::Engine *engine);

} // namespace mystral::metahuman

#pragma once

/**
 * NULL handles from wgpu must never reach wgpu-native's FFI.
 *
 * `wgpuDeviceCreateCommandEncoder`, `wgpuCommandEncoderBeginRenderPass`,
 * `wgpuCommandEncoderFinish` and their siblings return an opaque pointer and can return NULL —
 * on a lost device, on an out-of-memory allocation, on a surface that went away while the app
 * was being backgrounded. Handing that NULL to the next `wgpu*` call dereferences it inside
 * Rust with no JavaScript frame anywhere on the stack: the process dies with a raw SIGSEGV and
 * a backtrace that names nothing a game author can act on. That is the failure shape of the six
 * unnamed `SIGNALED status=11` exits recorded on a physical Pixel 8 on 2026-08-23.
 *
 * `createBuffer`, `createTexture` and the pipeline creators already threw to JS on NULL. These
 * helpers give the rest of the surface the same discipline: name the operation in the platform
 * log, then throw — fail closed, the way the rest of this repository does.
 */

#include <string>

namespace mystral {
namespace js {
class Engine;
}

namespace webgpu {

/** The marker every NULL-handle report carries, so a logcat filter finds all of them. */
extern const char* const kNullHandleMarker;

/** Logs `op` and `args` through the platform's log. Does not throw. */
void reportNullHandle(const char* op, const std::string& args);

/**
 * True when `handle` is usable. When it is NULL, logs the operation and throws a JS exception
 * naming it, then returns false. Call sites in a JS callback read:
 *
 *   if (!requireHandle(g_engine, encoder, "device.createCommandEncoder", ""))
 *       return g_engine->newUndefined();
 */
bool requireHandle(js::Engine* engine, const void* handle, const char* op,
                   const std::string& args = std::string());

/**
 * The same check for host-side paths that have no JS frame to throw into (canvas compositing,
 * the screenshot copy). Logs and returns false so the caller can skip the work; it must never
 * carry on with the NULL.
 */
bool requireHandleHostSide(const void* handle, const char* op,
                           const std::string& args = std::string());

/** The message `requireHandle` throws, exposed so a test can assert on the exact contract. */
std::string nullHandleMessage(const char* op, const std::string& args);

}  // namespace webgpu
}  // namespace mystral

// A NULL handle from wgpu must throw to JS naming the operation, never reach wgpu-native's FFI.
//
// `wgpuDeviceCreateCommandEncoder`, `wgpuCommandEncoderBeginRenderPass` and
// `wgpuCommandEncoderFinish` all return an opaque pointer that can be NULL — on a lost device,
// on an out-of-memory allocation, on a surface released while the app was backgrounded. Passing
// that NULL to the next `wgpu*` call dereferences it with no JavaScript frame on the stack, and
// the process dies with a raw fault naming nothing. That is the shape of the six unnamed
// `SIGNALED status=11` exits recorded on a physical Pixel 8 on 2026-08-23.
//
// Two halves, neither needing a phone, a window or a GPU:
//
//   RED  — a forked child hands a NULL encoder to the real `wgpuCommandEncoderBeginRenderPass`.
//          The parent reaps it and reports which signal killed it. That is the pre-fix path,
//          executed, contained in a child so this process survives to report it.
//   GREEN — the same NULL through `requireHandle` with a live JS engine: no fault, a thrown
//          JS exception, and the operation named in its message.

#include "mystral/js/engine.h"
#include "mystral/webgpu/checked_handle.h"

#include <csignal>
#include <cstring>
#include <iostream>
#include <string>
#include <vector>

#if !defined(_WIN32)
#include <sys/wait.h>
#include <unistd.h>
#endif

// The same C API both backends implement; bindings.cpp reaches it the same way.
#if defined(MYSTRAL_WEBGPU_DAWN)
#include <webgpu/webgpu.h>
#else
#include <webgpu.h>
#endif

namespace {

std::vector<std::string> failures;

void check(bool condition, const std::string& what) {
    if (condition) {
        std::cout << "PASS " << what << '\n';
        return;
    }
    failures.push_back(what);
    std::cerr << "FAIL " << what << '\n';
}

#if !defined(_WIN32)
// Returns the signal that killed the child, 0 if it exited normally, -1 if it could not run.
int faultOnNullHandleInChild() {
    const pid_t pid = fork();
    if (pid < 0) return -1;
    if (pid == 0) {
        // The unchecked path, verbatim: a NULL encoder into wgpu's FFI.
        WGPURenderPassDescriptor desc = {};
        WGPURenderPassEncoder pass = wgpuCommandEncoderBeginRenderPass(nullptr, &desc);
        // Unreached on every backend measured; if a backend ever tolerates it, say so instead of
        // pretending the fault happened.
        std::cout << "child survived, pass=" << static_cast<const void*>(pass) << '\n';
        _exit(0);
    }
    int status = 0;
    if (waitpid(pid, &status, 0) < 0) return -1;
    if (WIFSIGNALED(status)) return WTERMSIG(status);
    return 0;
}
#endif

// Any engine this build carries: the throw has to land in the engine the game actually runs.
struct EngineCase {
    mystral::js::EngineType type;
    const char* label;
};

constexpr EngineCase kEngines[] = {
    {mystral::js::EngineType::V8, "V8"},
    {mystral::js::EngineType::QuickJS, "QuickJS"},
    {mystral::js::EngineType::JavaScriptCore, "JavaScriptCore"},
};

}  // namespace

int main() {
#if !defined(_WIN32)
    // RED, executed. Reported either way — a backend that does not fault is information, not a
    // pass, and the checked path below is what this test actually gates on.
    const int killedBy = faultOnNullHandleInChild();
    if (killedBy > 0)
        std::cout << "RED (negative control): a NULL encoder into wgpuCommandEncoderBeginRenderPass "
                  << "killed the child with " << strsignal(killedBy) << " (signal " << killedBy
                  << ") — no JS frame, no named operation\n";
    else if (killedBy == 0)
        std::cout << "RED (negative control): this backend tolerated the NULL encoder; the checked "
                  << "path is still required because wgpu-native does not\n";
    else
        std::cout << "RED (negative control): could not fork; the unchecked path was not executed\n";
#endif

    // GREEN. Driven from JavaScript through a native function, because that is where the migrated
    // sites live: inside a JS callback, with the engine's handle scope open. A game sees the
    // failure as a thrown exception it can catch and report.
    int enginesRun = 0;
    for (const EngineCase& engineCase : kEngines) {
        auto engine = mystral::js::createEngine(engineCase.type);
        if (engine == nullptr) {
            std::cout << "SKIP " << engineCase.label << ": not compiled into this build\n";
            continue;
        }
        enginesRun += 1;
        auto* raw = engine.get();
        int sentinel = 0;
        std::string reported;

        // The script reports through a native callback rather than a return value: the engine
        // wraps a top-level eval result in a Promise, and this proof must read a string.
        raw->setGlobalProperty(
            "__tnReport",
            raw->newFunction("__tnReport",
                             [raw, &reported](void*,
                                              const std::vector<mystral::js::JSValueHandle>& args) {
                               if (!args.empty() && raw->isString(args[0]))
                                   reported = raw->toString(args[0]);
                               return raw->newUndefined();
                             }));

        // The two shapes the migrated call sites take, exposed to JS exactly as they run.
        raw->setGlobalProperty(
            "__tnCreateWithNullHandle",
            raw->newFunction("__tnCreateWithNullHandle",
                             [raw](void*, const std::vector<mystral::js::JSValueHandle>&) {
                               if (!mystral::webgpu::requireHandle(raw, nullptr,
                                                                   "device.createCommandEncoder",
                                                                   "label=frame"))
                                   return raw->newUndefined();
                               return raw->newString("reached the body with a NULL handle");
                             }));
        raw->setGlobalProperty(
            "__tnCreateWithLiveHandle",
            raw->newFunction("__tnCreateWithLiveHandle",
                             [raw, &sentinel](void*, const std::vector<mystral::js::JSValueHandle>&) {
                               if (!mystral::webgpu::requireHandle(raw, &sentinel,
                                                                   "device.createCommandEncoder"))
                                   return raw->newUndefined();
                               return raw->newString("ok");
                             }));

        constexpr const char* kScript = R"JS((() => {
          let thrown = "";
          try {
            __tnCreateWithNullHandle();
            thrown = "NOTHROW";
          } catch (error) {
            thrown = error && error.message ? error.message : String(error);
          }
          let live = "";
          try {
            live = __tnCreateWithLiveHandle();
          } catch (error) {
            live = "THREW: " + String(error);
          }
          __tnReport(thrown + "|||" + live);
          return undefined;
        })())JS";

        raw->evalWithResult(kScript, "wgpu_null_handle_test.js");
        const std::string joined = reported;
        // `hasException()` is a sticky record of the last throw, not a report on this eval: the
        // whole point is that JavaScript caught it, so the script's own report is the authority
        // here. Drain the record so the next engine starts clean.
        const std::string sticky = raw->getException();
        const size_t split = joined.find("|||");
        if (split == std::string::npos) {
            failures.push_back(std::string("the script did not reach its report on ") +
                               engineCase.label + ": returned \"" + joined + "\", last throw \"" +
                               sticky + "\"");
            continue;
        }
        const std::string thrown = joined.substr(0, split);
        const std::string live = split == std::string::npos ? "" : joined.substr(split + 3);

        check(thrown != "NOTHROW",
              std::string("a NULL handle throws into ") + engineCase.label + " rather than "
              "returning undefined and letting the caller continue");
        check(thrown.find("device.createCommandEncoder") != std::string::npos,
              "the thrown message names the operation, not just an address");
        check(thrown.find(mystral::webgpu::kNullHandleMarker) != std::string::npos,
              "the thrown message carries the TN_WGPU_NULL_HANDLE marker a logcat filter finds");
        check(thrown.find("label=frame") != std::string::npos,
              "the thrown message carries the arguments the call was made with");

        // A live handle must be waved through untouched — a guard that rejects valid handles
        // would be a worse bug than the one it fixes.
        check(live == "ok", "a non-NULL handle passes the check and throws nothing");
        std::cout << "GREEN on " << engineCase.label << ": " << thrown << '\n';
    }

    // The host-side variant, for paths with no JS frame to throw into.
    check(!mystral::webgpu::requireHandleHostSide(nullptr, "canvas2DComposite.surfaceView"),
          "the host-side check refuses a NULL handle");
    int hostSentinel = 0;
    check(mystral::webgpu::requireHandleHostSide(&hostSentinel, "canvas2DComposite.surfaceView"),
          "the host-side check passes a live handle");

    // Fail closed: a build carrying no engine proves nothing.
    if (enginesRun == 0) {
        std::cerr << "no JavaScript engine was compiled into this build; nothing was proven\n";
        return 1;
    }

    if (!failures.empty()) {
        std::cerr << "native wgpu NULL-handle contract failed:\n";
        for (const std::string& failure : failures) std::cerr << "  - " << failure << '\n';
        return 1;
    }
    std::cout << "native wgpu NULL-handle contract passed\n";
    return 0;
}

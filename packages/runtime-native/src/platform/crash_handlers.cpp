/**
 * Crash-signal handlers, and the one platform that must never get them.
 *
 * See `include/mystral/platform/crash_policy.h` for why Android leaves the disposition alone.
 */

#include "mystral/platform/crash_policy.h"

#include <csignal>
#include <cstdlib>
#include <cstring>
#include <iostream>

#if defined(__ANDROID__)
#include <android/log.h>
#include <sys/system_properties.h>
#endif

#ifdef _WIN32
#include <io.h>
#define MYSTRAL_WRITE(fd, buf, len) _write(fd, buf, len)
#define MYSTRAL_STDERR_FD 2
#else
#include <unistd.h>
#define MYSTRAL_WRITE(fd, buf, len)                                                                \
    do {                                                                                           \
        ssize_t _wr = write(fd, buf, len);                                                         \
        (void)_wr;                                                                                 \
    } while (0)
#define MYSTRAL_STDERR_FD STDERR_FILENO
#endif

namespace mystral {
namespace platform {

namespace {

// Only ever true in a process that installed the handlers, so the handler cannot run without it.
void crashSignalHandler(int sig) {
    const char* sigName = "UNKNOWN";
    switch (sig) {
        case SIGABRT: sigName = "SIGABRT"; break;
        case SIGSEGV: sigName = "SIGSEGV"; break;
#ifndef _WIN32
        case SIGBUS: sigName = "SIGBUS"; break;
        case SIGTRAP: sigName = "SIGTRAP"; break;
#endif
        case SIGILL: sigName = "SIGILL"; break;
        default: break;
    }
    // write() is the async-signal-safe one; std::cerr is not.
    MYSTRAL_WRITE(MYSTRAL_STDERR_FD, "[Mystral] Caught signal ", 24);
    MYSTRAL_WRITE(MYSTRAL_STDERR_FD, sigName, strlen(sigName));
    MYSTRAL_WRITE(MYSTRAL_STDERR_FD, ", exiting gracefully\n", 21);
    _exit(1);
}

// The pre-fix handler, kept verbatim so the negative control is the real thing and not a
// paraphrase of it: restore the default disposition, then re-raise. Reached only when
// `debug.threenative.prefix_handlers` asks for it.
void preFixCrashSignalHandler(int sig) {
    signal(sig, SIG_DFL);
    raise(sig);
}

bool preFixHandlersRequested() {
#if defined(__ANDROID__)
    char property[PROP_VALUE_MAX] = {};
    if (__system_property_get("debug.threenative.prefix_handlers", property) > 0)
        return property[0] == '1';
#endif
    const char* configured = std::getenv("THREENATIVE_PREFIX_CRASH_HANDLERS");
    return configured != nullptr && configured[0] == '1';
}

void installPreFixHandlers() {
    std::cout << "[Mystral] TN_CONTROL_PREFIX_HANDLERS: installing the pre-fix crash handlers; "
                 "debuggerd will be displaced and no tombstone should be written"
              << std::endl;
#if defined(__ANDROID__)
    __android_log_print(ANDROID_LOG_ERROR, "MystralRuntime",
                        "TN_CONTROL_PREFIX_HANDLERS: installing the pre-fix crash handlers");
#endif
    signal(SIGABRT, preFixCrashSignalHandler);
    signal(SIGSEGV, preFixCrashSignalHandler);
#ifndef _WIN32
    signal(SIGBUS, preFixCrashSignalHandler);
    signal(SIGTRAP, preFixCrashSignalHandler);
#endif
    signal(SIGILL, preFixCrashSignalHandler);
}

}  // namespace

CrashHandlerPolicy resolveCrashHandlerPolicy() {
    return crashHandlerPolicy(kAndroidPlatform, std::getenv("MYSTRAL_SHOW_CRASH_DIALOG"),
                              kSanitizerBuild);
}

bool applyCrashHandlerPolicy(CrashHandlerPolicy policy) {
    if (preFixHandlersRequested()) {
        // The negative control for "tombstones return", and the only reason this branch exists.
        // It reinstates, byte for byte, what every platform did before this change: `signal()` for
        // all five, with a handler that restores the default disposition and re-raises. On Android
        // that displaces debuggerd, so the process exits SIGNALED status=11 with nothing in
        // dropbox — the signature of the six unnamed 2026-08-23 crashes.
        //
        // Keeping it in the same binary as the fix makes the control a one-variable comparison
        // instead of a build-to-build one. It is reachable only through a `debug.` system property,
        // which is settable over adb on a developer device and by nothing else.
        installPreFixHandlers();
        return true;
    }
    if (policy == CrashHandlerPolicy::LeaveToPlatform) {
        // Android: debuggerd is already chained into these dispositions. Touching them is what
        // produced six unnamed SIGSEGV exits with no tombstone on 2026-08-23.
        std::cout << "[Mystral] Crash handlers left to the platform; debuggerd owns the tombstone"
                  << std::endl;
        return false;
    }
    if (policy == CrashHandlerPolicy::LeaveToSanitizer) {
        // AddressSanitizer already owns SIGSEGV and prints the faulting stack. Installing over it
        // means the sanitizer lane reports "exiting gracefully" and loses the only thing it exists
        // to produce.
        std::cout << "[Mystral] Crash handlers left to the sanitizer; ASan owns the report"
                  << std::endl;
        return false;
    }
    if (policy == CrashHandlerPolicy::ShowDialog) return false;

    signal(SIGABRT, crashSignalHandler);
    signal(SIGSEGV, crashSignalHandler);
#ifndef _WIN32
    signal(SIGBUS, crashSignalHandler);
    signal(SIGTRAP, crashSignalHandler);
#endif
    signal(SIGILL, crashSignalHandler);
    return true;
}

void installCrashHandlers() { applyCrashHandlerPolicy(resolveCrashHandlerPolicy()); }

int deliberateCrashAfterFrames(const char* configured) {
    if (configured == nullptr || configured[0] == '\0') return 0;
    int frames = 0;
    for (const char* cursor = configured; *cursor != '\0'; cursor += 1) {
        if (*cursor < '0' || *cursor > '9') return 0;  // Fail closed: garbage never crashes.
        frames = frames * 10 + (*cursor - '0');
        if (frames > 1000000) return 0;
    }
    return frames;
}

int deliberateCrashFrameCount() {
#if defined(__ANDROID__)
    char property[PROP_VALUE_MAX] = {};
    if (__system_property_get("debug.threenative.deliberate_crash", property) > 0) {
        const int frames = deliberateCrashAfterFrames(property);
        if (frames > 0) return frames;
    }
#endif
    return deliberateCrashAfterFrames(std::getenv("THREENATIVE_DELIBERATE_CRASH"));
}

void crashDeliberately() {
    std::cerr << "[Mystral] TN_DELIBERATE_CRASH: faulting on request to prove crash reporting"
              << std::endl;
#if defined(__ANDROID__)
    __android_log_print(ANDROID_LOG_ERROR, "MystralRuntime",
                        "TN_DELIBERATE_CRASH: faulting on request to prove crash reporting");
#endif
    // A read through a null pointer, the same shape as the fault class this proves reporting for.
    // `volatile` so no compiler decides an unobserved dereference need not happen.
    volatile const int* nowhere = nullptr;
    const int observed = *nowhere;
    (void)observed;
    std::abort();  // Unreachable; keeps the [[noreturn]] contract honest if a target tolerates it.
}

}  // namespace platform
}  // namespace mystral

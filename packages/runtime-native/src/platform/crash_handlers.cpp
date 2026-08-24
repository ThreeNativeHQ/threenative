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

}  // namespace

CrashHandlerPolicy resolveCrashHandlerPolicy() {
    return crashHandlerPolicy(kAndroidPlatform, std::getenv("MYSTRAL_SHOW_CRASH_DIALOG"));
}

bool applyCrashHandlerPolicy(CrashHandlerPolicy policy) {
    if (policy == CrashHandlerPolicy::LeaveToPlatform) {
        // Android: debuggerd is already chained into these dispositions. Touching them is what
        // produced six unnamed SIGSEGV exits with no tombstone on 2026-08-23.
        std::cout << "[Mystral] Crash handlers left to the platform; debuggerd owns the tombstone"
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

}  // namespace platform
}  // namespace mystral

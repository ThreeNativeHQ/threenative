// Does the host leave the crash-signal dispositions alone on Android?
//
// The Pixel 8 recorded six `SIGNALED status=11` exits for `com.threenative.bayview` on
// 2026-08-23 and wrote no tombstone for any of them. The cause is not the crash: it is that
// `Runtime::initialize` called `signal(SIGSEGV, ...)` on every platform, replacing the
// disposition Android's zygote had already chained debuggerd into. A crash after that install
// dies with the default action and debuggerd never runs.
//
// This proof needs no phone, no window and no GPU. It stands a fake "debuggerd" in for the real
// one — a `sigaction` handler installed before the policy is applied, exactly as the zygote does —
// then applies each policy and reads the disposition back with `sigaction(sig, nullptr, &out)`.
// The Android policy must leave the stand-in in place; the desktop policy must replace it. That
// second half is the negative control: it reproduces, observably, what every platform used to do.
//
// Nothing here raises a signal, so the test process never crashes.

#include "mystral/platform/crash_policy.h"

#include <csignal>
#include <cstdlib>
#include <iostream>
#include <string>
#include <vector>

namespace {

using mystral::platform::CrashHandlerPolicy;

int g_standInInvocations = 0;

void debuggerdStandIn(int, siginfo_t*, void*) { g_standInInvocations += 1; }

const int kChainedSignals[] = {SIGSEGV, SIGABRT, SIGBUS, SIGILL};

const char* signalName(int sig) {
    switch (sig) {
        case SIGSEGV: return "SIGSEGV";
        case SIGABRT: return "SIGABRT";
        case SIGBUS: return "SIGBUS";
        case SIGILL: return "SIGILL";
        default: return "UNKNOWN";
    }
}

// Install the stand-in on every signal the zygote chains, the way debuggerd does: SA_SIGINFO,
// three-argument handler.
void installStandIn() {
    struct sigaction action = {};
    action.sa_sigaction = debuggerdStandIn;
    action.sa_flags = SA_SIGINFO;
    sigemptyset(&action.sa_mask);
    for (int sig : kChainedSignals) sigaction(sig, &action, nullptr);
}

bool standInStillOwns(int sig) {
    struct sigaction current = {};
    if (sigaction(sig, nullptr, &current) != 0) return false;
    if ((current.sa_flags & SA_SIGINFO) == 0) return false;
    return current.sa_sigaction == debuggerdStandIn;
}

void restoreDefault() {
    struct sigaction action = {};
    action.sa_handler = SIG_DFL;
    sigemptyset(&action.sa_mask);
    for (int sig : kChainedSignals) sigaction(sig, &action, nullptr);
}

std::vector<std::string> failures;

void check(bool condition, const std::string& what) {
    if (condition) {
        std::cout << "PASS " << what << '\n';
        return;
    }
    failures.push_back(what);
    std::cerr << "FAIL " << what << '\n';
}

const char* policyName(CrashHandlerPolicy policy) {
    switch (policy) {
        case CrashHandlerPolicy::SuppressDialog: return "SuppressDialog";
        case CrashHandlerPolicy::ShowDialog: return "ShowDialog";
        case CrashHandlerPolicy::LeaveToPlatform: return "LeaveToPlatform";
        case CrashHandlerPolicy::LeaveToSanitizer: return "LeaveToSanitizer";
    }
    return "UNKNOWN";
}

}  // namespace

int main() {
    // 1. The decision itself. Android reaches LeaveToPlatform whatever the environment says,
    //    because a crash dialog is not what is at stake there.
    check(mystral::platform::crashHandlerPolicy(true, nullptr) == CrashHandlerPolicy::LeaveToPlatform,
          "Android with no MYSTRAL_SHOW_CRASH_DIALOG leaves the handlers to the platform");
    check(mystral::platform::crashHandlerPolicy(true, "1") == CrashHandlerPolicy::LeaveToPlatform,
          "Android with MYSTRAL_SHOW_CRASH_DIALOG=1 still leaves the handlers to the platform");
    check(mystral::platform::crashHandlerPolicy(false, nullptr) == CrashHandlerPolicy::SuppressDialog,
          "desktop with no MYSTRAL_SHOW_CRASH_DIALOG suppresses its crash dialog");
    check(mystral::platform::crashHandlerPolicy(false, "1") == CrashHandlerPolicy::ShowDialog,
          "desktop with MYSTRAL_SHOW_CRASH_DIALOG=1 installs nothing");

    // 1b. A sanitizer build must leave the dispositions alone for the same reason Android does:
    //     something else owns the report. AddressSanitizer installs its own SIGSEGV handler and
    //     prints the stack; the desktop handler's `_exit(1)` runs first and destroys it. Observed
    //     2026-08-29: threenative-webgpu-bindings-reentrancy-test passes in tn-linux and SIGSEGVs
    //     under tn-linux-asan during shutdown, and the lane printed no ASan report at all - only
    //     "[Mystral] Caught signal SIGSEGV, exiting gracefully".
    check(mystral::platform::crashHandlerPolicy(false, nullptr, true) ==
              CrashHandlerPolicy::LeaveToSanitizer,
          "a sanitizer build leaves the disposition to the sanitizer");
    check(mystral::platform::crashHandlerPolicy(false, "1", true) ==
              CrashHandlerPolicy::LeaveToSanitizer,
          "the sanitizer outranks MYSTRAL_SHOW_CRASH_DIALOG");
    check(mystral::platform::crashHandlerPolicy(true, nullptr, true) ==
              CrashHandlerPolicy::LeaveToPlatform,
          "Android still names debuggerd, not the sanitizer");
    check(mystral::platform::crashHandlerPolicy(false, nullptr, false) ==
              CrashHandlerPolicy::SuppressDialog,
          "a non-sanitizer desktop build is unchanged");

    // 2. The observable consequence, one signal at a time.
    for (int sig : kChainedSignals) {
        const std::string named = signalName(sig);

        installStandIn();
        const bool installedAndroid =
            mystral::platform::applyCrashHandlerPolicy(CrashHandlerPolicy::LeaveToPlatform);
        check(!installedAndroid && standInStillOwns(sig),
              "the Android policy leaves " + named + " chained to debuggerd's stand-in");

        installStandIn();
        const bool installedSanitizer =
            mystral::platform::applyCrashHandlerPolicy(CrashHandlerPolicy::LeaveToSanitizer);
        check(!installedSanitizer && standInStillOwns(sig),
              "the sanitizer policy leaves " + named + " to AddressSanitizer's own handler");

        installStandIn();
        const bool installedShowDialog =
            mystral::platform::applyCrashHandlerPolicy(CrashHandlerPolicy::ShowDialog);
        check(!installedShowDialog && standInStillOwns(sig),
              "MYSTRAL_SHOW_CRASH_DIALOG=1 leaves " + named + " chained too");

        // Negative control: the desktop policy is what HEAD did on every platform. It must
        // visibly take the disposition away — that is the mechanism that lost the tombstones.
        installStandIn();
        const bool installedDesktop =
            mystral::platform::applyCrashHandlerPolicy(CrashHandlerPolicy::SuppressDialog);
        check(installedDesktop && !standInStillOwns(sig),
              "negative control: the desktop policy replaces " + named +
                  ", which on Android is how the tombstone was lost");

        restoreDefault();
    }

    // 3. The live call site follows the compiling platform, and the stand-in was never entered.
    std::cout << "compiled for " << (mystral::platform::kAndroidPlatform ? "Android" : "desktop")
              << "; resolved policy "
              << policyName(mystral::platform::resolveCrashHandlerPolicy()) << '\n';
    check(mystral::platform::resolveCrashHandlerPolicy() ==
              mystral::platform::crashHandlerPolicy(mystral::platform::kAndroidPlatform,
                                                    std::getenv("MYSTRAL_SHOW_CRASH_DIALOG"),
                                                    mystral::platform::kSanitizerBuild),
          "the live resolver is the same pure decision, read from the real environment");
    check(g_standInInvocations == 0, "no signal was raised while proving this");

    // 4. The deliberate-crash trigger fails closed on everything that is not a frame count, so a
    //    stray or malformed value can never fault a shipped game.
    check(mystral::platform::deliberateCrashAfterFrames("120") == 120,
          "a frame count is read as a frame count");
    check(mystral::platform::deliberateCrashAfterFrames(nullptr) == 0,
          "an unset deliberate-crash setting never crashes");
    check(mystral::platform::deliberateCrashAfterFrames("") == 0,
          "an empty deliberate-crash setting never crashes");
    check(mystral::platform::deliberateCrashAfterFrames("true") == 0,
          "a non-numeric deliberate-crash setting never crashes");
    check(mystral::platform::deliberateCrashAfterFrames("12x") == 0,
          "a partly numeric deliberate-crash setting never crashes");
    check(mystral::platform::deliberateCrashAfterFrames("-5") == 0,
          "a negative deliberate-crash setting never crashes");
    check(mystral::platform::deliberateCrashAfterFrames("0") == 0,
          "zero frames never crashes");
    check(mystral::platform::deliberateCrashFrameCount() == 0,
          "nothing in this environment asked for a crash");

    if (!failures.empty()) {
        std::cerr << "native crash-handler policy contract failed:\n";
        for (const std::string& failure : failures) std::cerr << "  - " << failure << '\n';
        return 1;
    }
    std::cout << "native crash-handler policy contract passed\n";
    return 0;
}

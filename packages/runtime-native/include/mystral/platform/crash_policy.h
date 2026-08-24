#pragma once

/**
 * Crash-signal policy.
 *
 * The host used to call `signal()` for SIGSEGV/SIGABRT/SIGBUS/SIGTRAP/SIGILL on every platform,
 * right after initialization. On desktop that only suppresses an OS crash dialog. On Android it
 * is destructive: the zygote chains debuggerd into those dispositions before the process runs a
 * line of game code, and replacing them means every post-startup crash exits
 * `SIGNALED status=11` with **no tombstone** — the exact signature of the six
 * `com.threenative.bayview` crashes recorded on a physical Pixel 8 on 2026-08-23. The one
 * tombstone that device did produce (2026-08-21) came from a crash that happened *before* the
 * handlers were installed.
 *
 * So the policy is a value, decided once and observable: Android leaves the disposition alone,
 * desktop may still suppress its dialog.
 */

namespace mystral {
namespace platform {

enum class CrashHandlerPolicy {
    /** Desktop default: catch, write a line to stderr, `_exit(1)` — no OS crash dialog. */
    SuppressDialog,
    /** Desktop with `MYSTRAL_SHOW_CRASH_DIALOG=1`: no handler, the platform reports the crash. */
    ShowDialog,
    /** Android: never touch a disposition debuggerd owns, or the tombstone is lost. */
    LeaveToPlatform,
};

/** True when `MYSTRAL_SHOW_CRASH_DIALOG` asks for the platform's own crash reporting. */
constexpr bool crashDialogRequested(const char* value) {
    return value != nullptr && (value[0] == '1' || value[0] == 't' || value[0] == 'T');
}

/**
 * The whole decision, as a pure function so it can be proven without crashing a process.
 * `androidPlatform` is `kAndroidPlatform` at the live call site.
 */
constexpr CrashHandlerPolicy crashHandlerPolicy(bool androidPlatform,
                                                const char* showCrashDialogEnv) {
    return androidPlatform ? CrashHandlerPolicy::LeaveToPlatform
                           : (crashDialogRequested(showCrashDialogEnv)
                                  ? CrashHandlerPolicy::ShowDialog
                                  : CrashHandlerPolicy::SuppressDialog);
}

/** What the compiling platform is, kept beside the policy so a test can pass the other value. */
constexpr bool kAndroidPlatform =
#ifdef __ANDROID__
    true;
#else
    false;
#endif

/** Reads the environment and returns the policy this process will follow. */
CrashHandlerPolicy resolveCrashHandlerPolicy();

/**
 * Applies `policy`. Only `SuppressDialog` installs anything; the other two return without
 * touching any signal disposition. Returns true when handlers were installed.
 */
bool applyCrashHandlerPolicy(CrashHandlerPolicy policy);

/** Resolves and applies in one call — what `Runtime::initialize` uses. */
void installCrashHandlers();

}  // namespace platform
}  // namespace mystral

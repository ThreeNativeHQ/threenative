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
    /**
     * A sanitizer build: AddressSanitizer installs its own SIGSEGV handler and prints the faulting
     * stack. The desktop handler's `_exit(1)` runs first and destroys that report, so the lane
     * built to catch memory errors reports "exiting gracefully" and nothing else. Same shape as
     * Android, different owner - named separately so the log says who actually owns the report.
     */
    LeaveToSanitizer,
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
                                                const char* showCrashDialogEnv,
                                                bool sanitizerBuild = false) {
    return androidPlatform
               ? CrashHandlerPolicy::LeaveToPlatform
               : (sanitizerBuild ? CrashHandlerPolicy::LeaveToSanitizer
                                 : (crashDialogRequested(showCrashDialogEnv)
                                        ? CrashHandlerPolicy::ShowDialog
                                        : CrashHandlerPolicy::SuppressDialog));
}

/** What the compiling platform is, kept beside the policy so a test can pass the other value. */
constexpr bool kAndroidPlatform =
#ifdef __ANDROID__
    true;
#else
    false;
#endif

/** Whether this translation unit was compiled with AddressSanitizer, which owns the crash report. */
#if defined(__SANITIZE_ADDRESS__)
#define MYSTRAL_SANITIZER_BUILD 1
#elif defined(__has_feature)
#if __has_feature(address_sanitizer)
#define MYSTRAL_SANITIZER_BUILD 1
#else
#define MYSTRAL_SANITIZER_BUILD 0
#endif
#else
#define MYSTRAL_SANITIZER_BUILD 0
#endif

constexpr bool kSanitizerBuild = MYSTRAL_SANITIZER_BUILD == 1;

/** Reads the environment and returns the policy this process will follow. */
CrashHandlerPolicy resolveCrashHandlerPolicy();

/**
 * Applies `policy`. Only `SuppressDialog` installs anything; the other two return without
 * touching any signal disposition. Returns true when handlers were installed.
 */
bool applyCrashHandlerPolicy(CrashHandlerPolicy policy);

/** Resolves and applies in one call — what `Runtime::initialize` uses. */
void installCrashHandlers();

/**
 * A deliberate memory fault, after startup, on request. Nothing but a proof harness turns this on.
 *
 * The claim "a crash after startup now leaves a tombstone" cannot be checked without a crash after
 * startup, and the crash it has to model is the one that produced six unnamed `SIGNALED status=11`
 * exits on a physical Pixel 8 on 2026-08-23: a raw memory fault with no JavaScript frame on the
 * stack. Waiting for an intermittent bug to recur is not a proof lane.
 *
 * Gated on `debug.threenative.deliberate_crash` (Android's `debug.` system-property channel,
 * settable only over adb on a developer device) or `THREENATIVE_DELIBERATE_CRASH` in the
 * environment. The value is the number of frames to run first, so the fault lands well after
 * initialization, where the handler install used to be. Absent or unparsable means never.
 */
int deliberateCrashAfterFrames(const char* configured);

/** Reads the property and the environment; returns 0 when nothing asked for a crash. */
int deliberateCrashFrameCount();

/** Faults, deliberately and immediately. Never returns. */
[[noreturn]] void crashDeliberately();

}  // namespace platform
}  // namespace mystral

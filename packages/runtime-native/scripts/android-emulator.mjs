/**
 * The settings an emulator needs before it can be photographed.
 *
 * `immersive_mode_confirmations` stops the "swipe to exit full screen" overlay from covering the
 * first frame. `hide_error_dialogs` stops something much worse, and it is the only reason this
 * function is more than one line.
 *
 * The conformance lane fails closed when a window it does not own has focus, which is right: a
 * capture taken behind someone else's window photographs that window. But on a hosted runner the
 * emulator boots on software GL with two cores, and the *launcher* — not the game — goes Not
 * Responding under that load. Android then puts a system ANR dialog on top, it takes focus, and
 * every remaining row fails on a dialog that has nothing to do with the renderer.
 *
 * Measured on run 33703705629, the first run of this lane that passed its arguments correctly:
 *
 *     android emulator: 0 passed, 74 failed, 18 blocked
 *     73 x TN_ANDROID_SYSTEM_DIALOG: Application Not Responding: com.android.launcher3
 *      1 x Android timed out waiting for TN_MULTITOUCH_PROOF_PASS
 *
 * One ANR in a process this lane never exercises, and the whole matrix reads as a rendering
 * failure. `hide_error_dialogs` is the platform's own switch for this: ANR and crash dialogs are
 * suppressed and the offending process is left to recover or die quietly, which is what a headless
 * lane wants. It does not hide a *game* ANR from the lane — the game not drawing still fails its
 * rows on their own metrics, and `androidForegroundBlocker` still refuses a capture taken behind
 * any window this app does not own.
 */
export function prepareAndroidEmulator(serial, execute) {
  if (!serial.startsWith("emulator-")) return { prepared: false };
  execute("shell", "settings", "put", "secure", "immersive_mode_confirmations", "confirmed");
  execute("shell", "settings", "put", "global", "hide_error_dialogs", "1");
  return { prepared: true };
}

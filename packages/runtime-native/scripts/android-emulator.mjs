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
 *
 * **Suppressing new dialogs was not enough, and the reason is the ordering.** `hide_error_dialogs`
 * stops Android putting up a *future* ANR dialog; it does nothing to one that is already on
 * screen. The launcher goes Not Responding while the emulator is still booting — before this
 * function has ever run — so the dialog is already up when the first row launches, and it stays up
 * through all of them. Run 33726448043, with `hide_error_dialogs` already in place:
 *
 *     android emulator: 0 passed, 74 failed, 18 blocked
 *     "error": "TN_ANDROID_SYSTEM_DIALOG: Application Not Responding: com.android.launcher3"
 *
 * So the existing dialog has to be dismissed as well as future ones prevented.
 * `CLOSE_SYSTEM_DIALOGS` is the platform's own way to take down whatever is up, and force-stopping
 * the launcher clears the ANR state that would otherwise put it straight back. Both are emulator
 * only, and neither can hide a failure that belongs to this lane: the launcher is not the app
 * under test, `androidForegroundBlocker` still refuses any capture the game does not own the focus
 * for, and a game that stops responding still fails its rows on their own metrics.
 */
export function prepareAndroidEmulator(serial, execute) {
  if (!serial.startsWith("emulator-")) return { prepared: false };
  execute("shell", "settings", "put", "secure", "immersive_mode_confirmations", "confirmed");
  execute("shell", "settings", "put", "global", "hide_error_dialogs", "1");
  // Order matters: stop the launcher first so it cannot re-raise the dialog between the broadcast
  // and the launch, then take down whatever is already on screen.
  //
  // `com.android.launcher3` is the AOSP launcher the hosted runner's system image ships, and it is
  // the package the ANR names. It is deliberately not a lookup: a Pixel runs
  // `com.google.android.apps.nexuslauncher` instead, and this function has already returned for
  // any serial that is not an emulator. Force-stopping a launcher that is not there is a no-op,
  // and `am start -n` does not need one to launch the activity under test.
  execute("shell", "am", "force-stop", "com.android.launcher3");
  execute("shell", "am", "broadcast", "-a", "android.intent.action.CLOSE_SYSTEM_DIALOGS");
  return { prepared: true };
}

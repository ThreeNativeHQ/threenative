export function prepareAndroidEmulator(serial, execute) {
  if (!serial.startsWith("emulator-")) return { prepared: false };
  execute("shell", "settings", "put", "secure", "immersive_mode_confirmations", "confirmed");
  return { prepared: true };
}

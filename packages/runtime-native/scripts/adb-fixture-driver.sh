#!/bin/sh
# Runs the native-engine fixture driver on an attached Android device or emulator, so the
# differential runner drives it unchanged: fixture lines in on stdin, observations out on stdout,
# the driver's exit status back. Select the lane with
#   TN_ANDROID_DRIVER  the cross-built driver (build/android-core-<abi>/tn-native-engine-fixture-driver)
#   TN_ADB             adb (default: adb on PATH)       TN_ADB_SERIAL  the device, when several
# The binary is pushed only when the device copy's checksum differs.
set -eu
: "${TN_ANDROID_DRIVER:?TN_ANDROID_DRIVER names the cross-built fixture driver}"
adb_cmd() { if [ -n "${TN_ADB_SERIAL:-}" ]; then "${TN_ADB:-adb}" -s "$TN_ADB_SERIAL" "$@"; else "${TN_ADB:-adb}" "$@"; fi; }
remote=/data/local/tmp/tn-native-engine-fixture-driver
local_sum=$(md5sum "$TN_ANDROID_DRIVER" | cut -d' ' -f1)
# adb shell forwards stdin: every call but the driver run reads /dev/null, or it eats the fixture.
remote_sum=$(adb_cmd shell "md5sum $remote 2>/dev/null" </dev/null | cut -d' ' -f1)
if [ "$local_sum" != "$remote_sum" ]; then
  adb_cmd push "$TN_ANDROID_DRIVER" "$remote" </dev/null >/dev/null
  adb_cmd shell chmod 755 "$remote" </dev/null
fi
adb_cmd shell "$remote" "$@"

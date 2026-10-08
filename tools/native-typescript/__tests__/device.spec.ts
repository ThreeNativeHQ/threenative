import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { makeTempDirSync } from "../../../test-support/temp-dir.js";
import { checkDevice, isAarch64Elf, pushRunner, runLibrary } from "../device.mjs";

const TARGET = { abi: "arm64-v8a" };

// The fake adb reads its answers from the environment; put the environment back after each test.
const FAKE_KEYS = ["FAKE_EXIT", "FAKE_ABI", "FAKE_STATE", "FAKE_QEMU", "FAKE_CHMOD_FAIL"];
const savedEnv = Object.fromEntries(FAKE_KEYS.map((key) => [key, process.env[key]]));
afterEach(() => {
  for (const key of FAKE_KEYS) {
    if (savedEnv[key] === undefined) Reflect.deleteProperty(process.env, key);
    else process.env[key] = savedEnv[key];
  }
});

/**
 * A stand-in adb that logs each call and answers like a device: `-s` is required, getprop answers
 * from the environment, and `shell <runner> <lib>` writes stdout, a peak-RSS line and exits with
 * FAKE_EXIT, which is how the real adb forwards the device command's exit code.
 */
function fakeAdb(env: Record<string, string> = {}) {
  const dir = makeTempDirSync("tn-fake-adb-");
  const log = path.join(dir, "calls.log");
  const adb = path.join(dir, "adb");
  fs.writeFileSync(
    adb,
    `#!/bin/sh
[ "$1" = "-s" ] || { echo "adb called with no serial: $*" >> ${log}; exit 9; }
shift 2
echo "$*" >> ${log}
case "$1" in
  get-state) echo "\${FAKE_STATE:-device}" ;;
  push) echo "1 file pushed" ;;
  shell)
    case "$2" in
      chmod) if [ -n "$FAKE_CHMOD_FAIL" ]; then echo "chmod: denied" >&2; exit 1; fi ;;
      getprop) case "$3" in
        ro.product.cpu.abi) echo "\${FAKE_ABI:-arm64-v8a}" ;;
        ro.product.model) echo "Pixel 8" ;;
        ro.kernel.qemu) echo "\${FAKE_QEMU:-}" ;;
        ro.build.version.release) echo 17 ;;
      esac ;;
      */tn_so_runner*) printf 'hello\\n'; echo "TN_PEAK_RSS_KB 2048" >&2; echo "a diagnostic" >&2; exit "\${FAKE_EXIT:-0}" ;;
    esac ;;
esac
`,
    { mode: 0o755 },
  );
  Object.assign(process.env, {
    FAKE_EXIT: "0",
    FAKE_ABI: "arm64-v8a",
    FAKE_STATE: "device",
    ...env,
  });
  return { adb, calls: () => fs.readFileSync(log, "utf8") };
}

describe("checkDevice", () => {
  it("reads the model and kind of an online device that speaks the target ABI", async () => {
    const { adb } = fakeAdb({ FAKE_QEMU: "" });
    expect(await checkDevice(adb, "S1", TARGET)).toEqual({
      serial: "S1",
      abi: "arm64-v8a",
      model: "Pixel 8",
      emulator: false,
      release: "17",
    });
  });

  it("refuses a device on another ABI instead of pushing libraries it cannot load", async () => {
    const { adb } = fakeAdb({ FAKE_ABI: "x86_64" });
    await expect(checkDevice(adb, "S1", TARGET)).rejects.toThrow(
      /runs x86_64.*linked for arm64-v8a/u,
    );
  });

  it("refuses an offline device", async () => {
    const { adb } = fakeAdb({ FAKE_STATE: "offline" });
    await expect(checkDevice(adb, "S1", TARGET)).rejects.toThrow(
      /TN_NATIVE_TS_DEVICE.*not online/u,
    );
  });
});

describe("runLibrary", () => {
  it("returns the device stdout, the case's own exit code and the peak RSS, and names the serial on every call", async () => {
    const { adb, calls } = fakeAdb({ FAKE_EXIT: "3" });
    const library = path.join(makeTempDirSync("tn-lib-"), "libcase.so");
    fs.writeFileSync(library, "x");
    const result = await runLibrary(adb, "S1", library);
    expect(result.stdout.toString()).toBe("hello\n");
    expect(result.status).toBe(3);
    expect(result.peakRssBytes).toBe(2048 * 1024);
    expect(result.stderr).toBe("a diagnostic\n");
    expect(calls()).not.toContain("no serial");
    expect(calls()).toContain(
      "shell timeout 280 /data/local/tmp/tn-corpus/tn_so_runner /data/local/tmp/tn-corpus/libcase.so",
    );
  });

  it("runs the case under a device-side timeout and removes the pushed library afterwards", async () => {
    const { adb, calls } = fakeAdb();
    const library = path.join(makeTempDirSync("tn-lib-"), "libcase.so");
    fs.writeFileSync(library, "x");
    await runLibrary(adb, "S1", library);
    expect(calls()).toContain("shell timeout 280 /data/local/tmp/tn-corpus/tn_so_runner");
    expect(calls()).toContain("shell rm -f /data/local/tmp/tn-corpus/libcase.so");
  });

  it("names a chmod the device refused instead of running a file that cannot execute", async () => {
    const { adb } = fakeAdb({ FAKE_CHMOD_FAIL: "1" });
    const library = path.join(makeTempDirSync("tn-lib-"), "libcase.so");
    fs.writeFileSync(library, "x");
    await expect(runLibrary(adb, "S1", library)).rejects.toThrow(
      /adb chmod 644 libcase\.so failed/u,
    );
  });

  it("pushes the loader executable before any library", async () => {
    const { adb, calls } = fakeAdb();
    const runner = path.join(makeTempDirSync("tn-lib-"), "tn_so_runner");
    fs.writeFileSync(runner, "x");
    await pushRunner(adb, "S1", runner);
    expect(calls()).toContain("shell chmod 755 /data/local/tmp/tn-corpus/tn_so_runner");
  });
});

describe("isAarch64Elf", () => {
  const elf = (machine: number) => {
    const head = Buffer.alloc(64);
    Buffer.from([0x7f, 0x45, 0x4c, 0x46]).copy(head);
    head.writeUInt16LE(machine, 18);
    const file = path.join(makeTempDirSync("tn-elf-"), "lib.so");
    fs.writeFileSync(file, head);
    return file;
  };

  it("accepts an arm64 ELF and rejects an x86-64 one or a non-ELF", () => {
    expect(isAarch64Elf(elf(183))).toBe(true);
    expect(isAarch64Elf(elf(62))).toBe(false);
    const text = path.join(makeTempDirSync("tn-elf-"), "x");
    fs.writeFileSync(text, "#!/bin/sh\n".repeat(10));
    expect(isAarch64Elf(text)).toBe(false);
  });
});

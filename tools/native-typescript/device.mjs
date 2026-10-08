// Runs linked Perry Android libraries on an attached device (PRD-507). Everything goes through one
// adb serial the caller names, because a machine that has been used for this work usually has an
// emulator and a phone attached at once, and an unnamed adb call answers for whichever it picks.
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

export const REMOTE_DIR = "/data/local/tmp/tn-corpus";
const PEAK_RSS = /^TN_PEAK_RSS_KB (\d+)\r?\n/m;

function named(code, message) {
  const error = new Error(`${code}: ${message}`);
  error.code = code;
  return error;
}

/** One adb call against `serial`; resolves with the exit code adb forwards from the device command. */
export function adbRun(adb, serial, args, { timeoutMs = 120_000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(adb, ["-s", serial, ...args]);
    const stdout = [];
    let stderr = "";
    const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
    child.stdout.on("data", (chunk) => stdout.push(chunk));
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (status, signal) => {
      clearTimeout(timer);
      resolve({
        status: status ?? (signal === "SIGKILL" ? -9 : -1),
        stdout: Buffer.concat(stdout),
        stderr,
      });
    });
  });
}

async function property(adb, serial, name) {
  const { stdout } = await adbRun(adb, serial, ["shell", "getprop", name]);
  return stdout.toString().trim();
}

/** The device must be online and speak the ABI the libraries were linked for; anything else fails closed. */
export async function checkDevice(adb, serial, target) {
  const state = await adbRun(adb, serial, ["get-state"]);
  if (state.stdout.toString().trim() !== "device") {
    throw named(
      "TN_NATIVE_TS_DEVICE",
      `${serial} is not online (${state.stderr.trim() || "no state"})`,
    );
  }
  const abi = await property(adb, serial, "ro.product.cpu.abi");
  if (abi !== target.abi) {
    throw named(
      "TN_NATIVE_TS_DEVICE",
      `${serial} runs ${abi}, the libraries are linked for ${target.abi}`,
    );
  }
  return {
    serial,
    abi,
    model: await property(adb, serial, "ro.product.model"),
    emulator: (await property(adb, serial, "ro.kernel.qemu")) === "1",
    release: await property(adb, serial, "ro.build.version.release"),
  };
}

async function pushed(adb, serial, local, remote, mode) {
  const push = await adbRun(adb, serial, ["push", local, remote]);
  if (push.status !== 0) {
    throw named(
      "TN_NATIVE_TS_DEVICE",
      `adb push ${path.basename(local)} failed: ${push.stderr.trim()}`,
    );
  }
  await adbRun(adb, serial, ["shell", "chmod", mode, remote]);
  return remote;
}

/** Pushes the loader once per run. */
export async function pushRunner(adb, serial, runner) {
  await adbRun(adb, serial, ["shell", "mkdir", "-p", REMOTE_DIR]);
  return pushed(adb, serial, runner, `${REMOTE_DIR}/tn_so_runner`, "755");
}

/**
 * Runs one linked library through the loader. The result has the same shape as a host run:
 * stdout bytes, the case's own exit code, stderr, and the process's peak resident set.
 */
export async function runLibrary(adb, serial, library) {
  const remote = `${REMOTE_DIR}/${path.basename(library)}`;
  await pushed(adb, serial, library, remote, "644");
  const run = await adbRun(adb, serial, ["shell", `${REMOTE_DIR}/tn_so_runner ${remote}`], {
    timeoutMs: 300_000,
  });
  await adbRun(adb, serial, ["shell", "rm", "-f", remote]);
  const stderr = run.stderr;
  const peakKb = PEAK_RSS.exec(stderr)?.[1];
  return {
    stdout: run.stdout,
    status: run.status,
    stderr: stderr.replace(PEAK_RSS, ""),
    peakRssBytes: peakKb === undefined ? 0 : Number(peakKb) * 1024,
  };
}

/** True when `file` is the ELF a device of this ABI can load; guards against pushing a host binary. */
export function isAarch64Elf(file) {
  const head = Buffer.alloc(20);
  const fd = fs.openSync(file, "r");
  try {
    fs.readSync(fd, head, 0, 20, 0);
  } finally {
    fs.closeSync(fd);
  }
  return (
    head.subarray(0, 4).equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46])) &&
    head.readUInt16LE(18) === 183
  );
}

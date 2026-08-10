import { spawnSync } from "node:child_process";
import { join } from "node:path";

export function shouldRunAndroidMultitouch({ dryRun, project, target }) {
  return !dryRun && !project && target === "android";
}

export function androidMultitouchArgs(runtimeRoot, device) {
  return [
    "--dir",
    runtimeRoot,
    "native:verify:android:multitouch",
    ...(device ? ["--device", device] : []),
  ];
}

export function runAndroidMultitouchProof({ device, runtimeRoot }) {
  const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
  const args = androidMultitouchArgs(runtimeRoot, device);
  const result = spawnSync(pnpm, args, {
    cwd: join(runtimeRoot, "..", ".."),
    encoding: "utf8",
    timeout: 900_000,
  });
  return {
    status: result.status === 0 ? "pass" : "fail",
    exitCode: result.status ?? 1,
    stdout: (result.stdout || "").slice(-4_000),
    stderr: (result.stderr || result.error?.message || "").slice(-4_000),
  };
}

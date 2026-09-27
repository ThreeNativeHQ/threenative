import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { provideDisplay } from "../../playtest/src/runner/captureEnvironment.js";

if (process.platform !== "linux") {
  throw new Error("TN_UI_INPUT_HOST_REQUIRED: this check exercises the Linux WebKitGTK backend.");
}

// Own the display: the fixture installs two keyboard layouts and must not change the user's.
const display = await provideDisplay({
  env: { ...process.env, DISPLAY: undefined, TN_PLAYTEST_HOST_DISPLAY: "0" },
});
const cwd = fileURLToPath(new URL("..", import.meta.url));
async function run(command: string, args: string[]): Promise<void> {
  const child = spawn(command, args, { cwd, env: display.env, stdio: "inherit" });
  const timeout = setTimeout(() => child.kill("SIGKILL"), 60_000);
  try {
    await new Promise<void>((resolve, reject) => {
      child.once("error", reject);
      child.once("exit", (code) =>
        code === 0 ? resolve() : reject(new Error(`${command} exited ${code}`)),
      );
    });
  } finally {
    clearTimeout(timeout);
  }
}

try {
  await run("setxkbmap", ["-layout", "us,fr", "-option", ""]);
  await run("cargo", [
    "test",
    "--manifest-path",
    "native/ui-overlay/Cargo.toml",
    "ordinary_controls_use_native_focus_and_editing",
    "--",
    "--ignored",
    "--nocapture",
  ]);
} finally {
  await display.release();
}

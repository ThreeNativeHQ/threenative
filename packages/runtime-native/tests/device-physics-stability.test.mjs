import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "vitest";

const scriptsDir = resolve(dirname(fileURLToPath(import.meta.url)), "..", "scripts");
const script = join(scriptsDir, "device-physics-stability.mjs");

// The script ran main() unconditionally at module scope, so merely importing it parsed
// process.argv, printed a usage error and exited 64. That makes the file untestable and makes any
// tool that imports it launch a ten-launch device protocol. Importing must be inert.
test("importing the script does not run the launch protocol", () => {
  const output = execFileSync(
    process.execPath,
    ["--input-type=module", "-e", `await import(${JSON.stringify(script)}); console.log("inert");`],
    { encoding: "utf8", timeout: 30_000 },
  );
  assert.match(output, /inert/u);
});

test("the launch protocol still runs when the script is the entrypoint", () => {
  assert.throws(
    () => execFileSync(process.execPath, [script], { encoding: "utf8", stdio: "pipe", timeout: 30_000 }),
    (error) => error.status === 64,
    "no --apk must still exit 64",
  );
});

// It hardcoded execFileSync('adb', ...), ignoring THREENATIVE_ADB and every SDK root that the
// other six device lanes honour, so it could not run on a machine whose adb is off PATH.
test("adb resolves through the shared device resolver", async () => {
  const { adb } = await import("../scripts/device-physics-stability.mjs");
  const calls = [];
  const out = adb(["get-state"], {
    environment: { THREENATIVE_ADB: "/explicit/adb" },
    execFileSyncImpl: (executable, argv, options) => {
      calls.push({ executable, argv, options });
      return "device\n";
    },
    serial: "phone-1",
  });
  assert.equal(out, "device\n");
  assert.equal(calls[0].executable, "/explicit/adb");
  assert.deepEqual(calls[0].argv, ["-s", "phone-1", "get-state"]);
  assert.equal(calls[0].options.timeout, 120_000);
});

test("a serial-less call omits the -s flag", async () => {
  const { adb } = await import("../scripts/device-physics-stability.mjs");
  const calls = [];
  adb(["devices"], {
    environment: { THREENATIVE_ADB: "/explicit/adb" },
    execFileSyncImpl: (executable, argv) => {
      calls.push(argv);
      return "";
    },
  });
  assert.deepEqual(calls[0], ["devices"]);
});

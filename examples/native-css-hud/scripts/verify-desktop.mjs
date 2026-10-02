#!/usr/bin/env node
/**
 * Prove the native-css renderer on a real desktop host: build the game, package it against the
 * checkout-built host, run the playtest (a real pointer click on the native-painted button), then
 * read the host's own log for the backend identity and for the absence of any web view.
 *
 * The host must have been built with the backend: `TN_ENABLE_CSS_UI=1 pnpm native:build`.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const example = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repo = resolve(example, "..", "..");
const runtime = join(repo, "packages", "runtime-native", "build", "tn-linux", "mystral");
const tools = join(repo, "packages", "runtime-native", "build", "tn-linux", "mystral-tools");
const executable = join(example, "dist-native", "native-css-hud");
const playtest = join(repo, "packages", "playtest", "dist", "runner", "cli.js");

function run(command, args, label) {
  const result = spawnSync(command, args, { cwd: example, stdio: "inherit" });
  if (result.status !== 0) {
    console.error(`TN_NATIVE_CSS_VERIFY_FAILED: ${label} exited with ${result.status}`);
    process.exit(result.status ?? 1);
  }
}

for (const [label, file] of [
  ["the CSS-enabled host (TN_ENABLE_CSS_UI=1 pnpm native:build)", runtime],
  ["the packager helper (cmake --target mystral-tools)", tools],
  ["the playtest runner (pnpm --filter @threenative/playtest build)", playtest],
]) {
  if (!existsSync(file)) {
    console.error(`TN_NATIVE_CSS_VERIFY_MISSING: ${label} is not built: ${file}`);
    process.exit(1);
  }
}

// The consumer build bundles game.js and the stylesheet-only ui dir. It also installs the published
// prebuilt host, which has no CSS backend, so that artifact is discarded and repackaged below.
run("pnpm", ["exec", "threenative", "build", "--target", "desktop"], "threenative build");
rmSync(join(example, "dist-native"), { force: true, recursive: true });
rmSync(join(example, "artifacts"), { force: true, recursive: true });
run(
  process.execPath,
  [
    join(repo, "packages", "runtime-native", "scripts", "package-desktop.mjs"),
    ...["--bundle", ".threenative/build/game.js", "--ui", ".threenative/build/ui-css"],
    ...["--config", ".threenative/build/config.json", "--runtime", runtime],
    ...["--output", executable],
  ],
  "package-desktop",
);
run(
  process.execPath,
  [
    playtest,
    "playtests/native-css-hud.playtest.json",
    "--target",
    "desktop",
    "--executable",
    executable,
  ],
  "desktop playtest",
);

const console_ = JSON.parse(
  readFileSync(join(example, "artifacts", "playtest", "console.json"), "utf8"),
);
const lines = console_.map((entry) => String(entry.text));
const backend = lines.find((line) => line.startsWith("ui overlay: native-css backend=blitz-dom"));
const attached = lines.some((line) =>
  line.startsWith('TN_UI_OVERLAY:{"attached":true,"renderer":"native-css"}'),
);
const webView = lines.filter(
  (line) =>
    /webkit|webview|wry|chromium process|TN_UI_LOAD_FAILED/iu.test(line) &&
    !line.includes("no WebView"),
);
if (backend === undefined || !attached || webView.length > 0) {
  console.error(
    "TN_NATIVE_CSS_VERIFY_FAILED: the host log does not show the native-css backend with no web view.",
  );
  console.error(JSON.stringify({ backend, attached, webView }, null, 2));
  process.exit(1);
}
console.log(`native-css verified: ${backend}`);

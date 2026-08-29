import assert from "node:assert/strict";
import { test } from "vitest";

import {
  createPhysicsStabilityDevice,
  preparePhysicsStabilityInstall,
} from "../scripts/device-physics-stability.mjs";

test("physics stability uses shared optional transport with legacy exec behavior", () => {
  const calls = [];
  const explicit = createPhysicsStabilityDevice("device-1", {
    execFileSyncImpl(executable, args, options) {
      calls.push({ executable, args, options });
      return "device\n";
    },
  });
  assert.equal(explicit.command(["get-state"]), "device\n");
  assert.deepEqual(calls[0].args, ["-s", "device-1", "get-state"]);
  assert.equal(calls[0].options.timeout, 120_000);

  const defaultCalls = [];
  const defaultDevice = createPhysicsStabilityDevice(undefined, {
    environment: { THREENATIVE_ADB_SERIAL: "ambient-device" },
    execFileSyncImpl(_executable, args) {
      defaultCalls.push(args);
      const operation = args.join(" ");
      if (operation.startsWith("shell settings get")) return "0\n";
      if (operation === "shell pm path dev.example.game") {
        return "package:/data/app/dev.example.game/base.apk\n";
      }
      return "device\n";
    },
  });
  preparePhysicsStabilityInstall(
    { apk: "/tmp/game.apk", package: "dev.example.game", serial: undefined },
    defaultDevice,
  );
  assert.ok(defaultCalls.every((args) => !args.includes("-s")));
  const operations = defaultCalls.map((args) => args.join(" "));
  const ordered = [
    "shell settings put global package_verifier_enable 0",
    "install /tmp/game.apk",
    "shell pm path dev.example.game",
  ].map((operation) => operations.indexOf(operation));
  assert.ok(ordered.every((index) => index >= 0));
  assert.deepEqual(ordered, [...ordered].sort((left, right) => left - right));
});

test("physics stability preserves install verification error behavior", () => {
  const args = { apk: "/tmp/game.apk", package: "dev.example.game", serial: "device-1" };
  const deviceWithPmOutput = (output) => ({
    command(command) {
      if (command.join(" ") === "shell pm path dev.example.game") return output;
      if (command.join(" ").startsWith("shell settings get")) return "0\n";
      return "";
    },
  });

  assert.throws(
    () => preparePhysicsStabilityInstall(args, deviceWithPmOutput("not-installed\n")),
    /install did not land: pm path dev\.example\.game returned 'not-installed'/u,
  );

  const transportError = new Error("adb transport sentinel");
  const failingDevice = deviceWithPmOutput("");
  failingDevice.command = (command) => {
    if (command.join(" ") === "shell pm path dev.example.game") throw transportError;
    if (command.join(" ").startsWith("shell settings get")) return "0\n";
    return "";
  };
  assert.throws(() => preparePhysicsStabilityInstall(args, failingDevice), transportError);
});

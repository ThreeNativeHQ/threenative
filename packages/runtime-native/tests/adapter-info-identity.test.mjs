import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "vitest";

const root = fileURLToPath(new URL("../", import.meta.url));

/**
 * Core's `softwareAdapter` fact is read from four `adapter.info` fields — architecture,
 * description, device and vendor — and the playtest classifier scans them for a CPU rasteriser
 * before it will call a run hardware.
 *
 * Two earlier proofs were weaker than the claim they carried. `webgpu-bindings-contract.test.mjs`
 * asserts those four lines exist in bindings.cpp, which is source shape, not execution; and a
 * desktop STUB unit exercises the classifier over a synthetic adapter object, which proves nothing
 * about whether the host ever populates the names. This drives the real native Runtime headless
 * and reads `navigator.gpu.requestAdapter().info` through the same JS bindings a game reads.
 *
 * That read is synchronous on purpose. The first version of the script was an `async` IIFE, whose
 * `throw` settled a promise after evalScript had already returned true — the contract reported
 * "passed" with `missing: ["architecture"]` printed right above it, on a bindings.cpp with the
 * field renamed. An adapter with no GPU cannot answer this either, so a null adapter is reported
 * as unexecuted with the reason named, never as a pass.
 *
 * The executable needs no display, so this belongs to the native-contract lane.
 */

const ENGINE_BUILDS = [{ engine: "V8", directory: "build/tn-linux" }];

test.each(ENGINE_BUILDS)(
  "adapter.info publishes every field core's softwareAdapter fact reads on $engine",
  ({ directory }) => {
    const executable = join(root, directory, "threenative-adapter-info-test");
    assert.ok(
      existsSync(executable),
      `${executable} is not built. Run: cmake --build ${directory} --target threenative-adapter-info-test`,
    );

    const output = execFileSync(executable, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    const reported = /TN_NATIVE_ADAPTER_INFO:(\{.*\})/u.exec(output);
    assert.ok(reported, `the executable reported no adapter.info identity:\n${output.slice(-2000)}`);
    const { fields, missing } = JSON.parse(reported[1]);

    assert.deepEqual(
      missing,
      [],
      `adapter.info is missing ${missing.join(", ")}: core's softwareAdapter fact reads exactly these, and an absent field cannot name a software adapter`,
    );
    for (const [field, value] of Object.entries(fields)) {
      assert.ok(value.length > 0, `adapter.info.${field} is empty`);
    }
  },
);

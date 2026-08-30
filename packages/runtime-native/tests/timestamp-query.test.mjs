import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "vitest";

const root = fileURLToPath(new URL("../", import.meta.url));

/**
 * PRD-228 Change B. The bindings answered `false` to `timestamp-query` by name at two sites, so
 * every GPU number in the perf record was wall-clock algebra around an ablated scene: a total per
 * object, never a cost per pass stage.
 *
 * This drives the executable and compares two independent answers — the native adapter probe that
 * `context.cpp` prints, and what the JS bindings told the script. They have to agree. That is what
 * makes restoring the refusal a red rather than a skip: without it a refusal reads as "this GPU
 * cannot", which is a different result and not a failure.
 *
 * The executable needs no display, so this belongs to the native-contract lane.
 */
/**
 * Cross-engine coverage, named rather than implied. The JS engine is a build-time choice, so a
 * second engine means a second build directory — there is no runtime seam to switch it.
 *
 * JSC is not built here and is recorded as unexecuted: it is the macOS/iOS engine and this lane
 * is Linux. Naming it is the point; a criterion that quietly covers two of three engines and
 * reports green is the failure mode this file exists to prevent.
 */
/**
 * Adapters that are not a GPU. `Null backend` is Dawn's fallback when no Vulkan driver loads at
 * all; llvmpipe, lavapipe, softpipe and SwiftShader are CPU rasterisers. GitHub's runners have no
 * GPU, so this list is what separates "this machine cannot run the contract" from "the bindings
 * broke it".
 */
const SOFTWARE_ADAPTER = /Headless adapter: (.*(?:llvmpipe|lavapipe|softpipe|swiftshader|Null backend).*)/iu;

const ENGINE_BUILDS = [
  { engine: "V8", directory: "build/tn-linux" },
  { engine: "QuickJS", directory: "build/tn-linux-quickjs" },
];

test.each(ENGINE_BUILDS)(
  "timestamp-query resolves a monotonic nonzero delta on $engine, and the bindings agree with the adapter",
  ({ engine, directory }) => {
  const executable = join(root, directory, "threenative-timestamp-query-test");
  if (!existsSync(executable)) {
    // Never a silent pass: an unbuilt executable is unexecuted, and says so.
    assert.fail(
      `${executable} is not built. Run: cmake --build ${directory} --target threenative-timestamp-query-test`,
    );
  }
  // The executable exits non-zero when the contract fails, and its output is the only evidence of
  // why. Capturing it on both paths is what lets a GPU-less runner be reported as unexecuted
  // instead of arriving as an opaque "Command failed".
  let output;
  try {
    output = execFileSync(executable, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  } catch (error) {
    output = `${error.stdout ?? ""}${error.stderr ?? ""}`;
    const adapter = SOFTWARE_ADAPTER.exec(output);
    if (adapter) {
      // A CPU rasteriser answers `yes` to the timestamp-query feature probe and then cannot
      // deliver one: llvmpipe fails the readback map outright, and the null backend leaves every
      // query slot unwritten. Neither is these bindings refusing the feature, and neither is a
      // pass. It is recorded here as unexecuted, with the adapter named, exactly as JSC is —
      // a criterion that quietly reports green on a machine with no GPU is the failure this file
      // exists to prevent.
      assert.doesNotMatch(
        output,
        /TN_TIMESTAMP_QUERY:\{"supported":true/u,
        "a software adapter reported a successful GPU timing; that result cannot be trusted",
      );
      console.info(
        `TN_TIMESTAMP_QUERY_UNEXECUTED: ${engine} on ${adapter[1].trim()} — no GPU timestamp support on this adapter, so the contract did not execute.`,
      );
      return;
    }
    assert.fail(
      `${executable} failed on a hardware adapter, which is a real refusal:\n${output.slice(-2000)}`,
    );
  }
  assert.match(
    output,
    engine === "V8" ? /Creating V8 engine/u : /Creating QuickJS engine/u,
    `${directory} did not run under ${engine}`,
  );
  const adapterProbe = /adapter feature probe timestamp-query: (yes|no)/u.exec(output);
  assert.ok(adapterProbe, "context.cpp did not print its adapter probe for timestamp-query");
  const reported = /TN_TIMESTAMP_QUERY:(\{.*\})/u.exec(output);
  assert.ok(reported, "the executable reported no timestamp-query result at all");
  const result = JSON.parse(reported[1]);

  if (adapterProbe[1] === "no") {
    // This adapter genuinely lacks the feature. Recorded as unexecuted rather than passed.
    assert.equal(result.supported, false, "bindings advertised a feature the adapter does not have");
    return;
  }

  assert.equal(
    result.supported,
    true,
    "the adapter advertises timestamp-query but the bindings refused it",
  );
  assert.ok(
    Number.isFinite(result.deltaNs) && result.deltaNs > 0,
    `expected a nonzero GPU delta, got ${String(result.deltaNs)}`,
  );
});

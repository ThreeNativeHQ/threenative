import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "vitest";

const root = fileURLToPath(new URL("../", import.meta.url));

/**
 * `rg11b10ufloat-renderable` is the feature behind three's SSGI target format: SSGINode builds
 * its GI target as RGBFormat + UnsignedInt101111Type, the WebGPU backend maps that to
 * `rg11b10ufloat` with RENDER_ATTACHMENT usage, and rendering into it is gated on this optional
 * feature. The runtime never requested it and its JS feature-name mapper did not know the name,
 * so on native the stage could only appear as a device loss — which games then hid behind an
 * `isNative()` stage kill.
 *
 * Four layers must agree, and the test has all four: the raw Dawn probe (the oracle no binding
 * can lie to), context.cpp's adapter probe line, the JS adapter surface, and the JS device
 * surface. Agreement is what makes restoring the refusal a red rather than a skip. When the
 * adapter has the feature the contract also runs an actual render pass into the format — the
 * pre-fix device loss — and requires the device to survive it.
 *
 * The executable needs no display, so this belongs to the native-contract lane.
 */
/**
 * Adapters that are not a GPU. `Null backend` is Dawn's fallback when no Vulkan driver loads at
 * all; llvmpipe, lavapipe, softpipe and SwiftShader are CPU rasterisers. GitHub's runners have
 * no GPU, so this list is what separates "this machine cannot run the contract" from "the
 * bindings broke it".
 */
const SOFTWARE_ADAPTER = /Headless adapter: (.*(?:llvmpipe|lavapipe|softpipe|swiftshader|Null backend).*)/iu;

const ENGINE_BUILDS = [
  { engine: "V8", directory: "build/tn-linux" },
  { engine: "QuickJS", directory: "build/tn-linux-quickjs" },
];

test.each(ENGINE_BUILDS)(
  "rg11b10ufloat-renderable is truthful at every layer on $engine, and a pass into the format does not lose the device",
  ({ engine, directory }) => {
  const executable = join(root, directory, "threenative-rg11b10-renderable-test");
  if (!existsSync(executable)) {
    // Never a silent pass: an unbuilt executable is unexecuted, and says so.
    assert.fail(
      `${executable} is not built. Run: cmake --build ${directory} --target threenative-rg11b10-renderable-test`,
    );
  }
  let output;
  try {
    output = execFileSync(executable, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  } catch (error) {
    output = `${error.stdout ?? ""}${error.stderr ?? ""}`;
    const adapter = SOFTWARE_ADAPTER.exec(output);
    if (adapter) {
      console.info(
        `TN_RG11B10_UNEXECUTED: ${engine} on ${adapter[1].trim()} — no GPU adapter on this machine, so the contract did not execute.`,
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
  const rawProbe = /raw wgpuAdapterHasFeature: (yes|no)/u.exec(output);
  assert.ok(rawProbe, "the executable did not print its raw Dawn oracle result at all");
  const adapterProbe = /adapter feature probe rg11b10ufloat-renderable: (yes|no)/u.exec(output);
  assert.ok(
    adapterProbe,
    "context.cpp did not print its adapter probe for rg11b10ufloat-renderable",
  );
  assert.equal(
    adapterProbe[1],
    rawProbe[1],
    "context.cpp's adapter probe and the raw Dawn oracle disagree",
  );
  const reported = /TN_RG11B10:(\{.*\})/u.exec(output);
  assert.ok(reported, "the executable reported no rg11b10ufloat result at all");
  const result = JSON.parse(reported[1]);

  if (adapterProbe[1] === "no") {
    // This adapter genuinely lacks the feature. Recorded as unexecuted rather than passed.
    assert.equal(
      result.adapterHas,
      false,
      "bindings advertised a feature the adapter does not have",
    );
    console.info(
      "TN_RG11B10_UNEXECUTED: adapter lacks rg11b10ufloat-renderable, so the pass contract did not execute.",
    );
    return;
  }

  assert.equal(
    result.adapterHas,
    true,
    "the adapter advertises rg11b10ufloat-renderable but the JS adapter surface hid it",
  );
  assert.equal(
    result.deviceHas,
    true,
    "the adapter advertises rg11b10ufloat-renderable but the bindings refused it on the device",
  );
  assert.equal(
    result.passRan,
    true,
    "the rg11b10ufloat render pass never ran",
  );
});

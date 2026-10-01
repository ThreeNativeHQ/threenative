// The public software-adapter fact, executed on the real native host, driving the template's own
// quality policy.
//
// Three earlier proofs each cover one link and none covers the path a game takes:
// `adapter_info_test.cpp` reads `navigator.gpu.requestAdapter().info` (the provider), the forced
// SwiftShader browser run proves the policy answers `low` on a CPU rasteriser, and the desktop STUB
// unit feeds a synthetic adapter to the classifier. `createRenderer` is internal to core, so the
// public way to reach the fact is what a game does: `game.start()`, then `ctx.renderer.softwareAdapter`,
// then the template's `resolveQualityTier`. This runs that on the built host — bundle, launch,
// observe — and reports the adapter identity from a separate read.
//
// What it does and does not claim: it proves the fact is produced and the policy consumes it on
// THIS host. A hardware host reports `softwareAdapter: null` and the high tier, which says nothing
// about a software adapter natively — that half is proven by the browser SwiftShader run. The
// assertions below are written as the relationship rather than the value, so they hold for either
// class: whatever the host reports, the tier must be the one that fact selects.

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "vitest";
import { makeTempDirSync } from "../../../test-support/temp-dir.js";

const ROOT = join(import.meta.dirname, "..");
const WORKSPACE = join(ROOT, "..", "..");
const SMOKE_SRC = join(WORKSPACE, "examples", "native-smoke", "src");
const ENTRY = join(SMOKE_SRC, "adapter-policy.mjs");

function findBinary() {
  for (const candidate of [join(ROOT, "build", "tn-linux", "mystral"), join(ROOT, "build", "tn-linux-quickjs", "mystral")]) {
    if (existsSync(candidate)) return candidate;
  }
  throw new Error("TN_ADAPTER_POLICY_NO_BINARY: build the desktop host first (pnpm native:build)");
}

/** The pinned runtime-native esbuild, the same one the Android proof bundle is built with. */
function esbuild() {
  const candidate = join(ROOT, "node_modules", ".bin", "esbuild");
  assert.ok(existsSync(candidate), `${candidate} is missing: run pnpm install in packages/runtime-native`);
  return candidate;
}

function buildBundle() {
  const out = join(makeTempDirSync("tn-adapter-policy-"), "bundle.js");
  execFileSync(esbuild(), [
    ENTRY,
    "--bundle",
    "--format=iife",
    "--platform=browser",
    "--target=es2022",
    `--outfile=${out}`,
    // `import.meta.env` is a Vite-ism; core reads it behind an optional chain and the host has no
    // bundler-defined value, which is the same substitution the Android proof bundle relies on.
    "--log-level=error",
    "--define:import.meta.env={}",
  ], { cwd: WORKSPACE, encoding: "utf8", timeout: 120_000 });
  assert.ok(existsSync(out), "esbuild produced no bundle");
  return out;
}

/** Runs the real host on a private display, bounded by the screenshot endpoint, never `xvfb-run`. */
function runHost(bundle) {
  const dir = makeTempDirSync("tn-adapter-policy-run-");
  const shot = join(dir, "shot.png");
  try {
    return execFileSync(
      "sh",
      [join(WORKSPACE, "scripts", "xvfb.sh"), "env", "SDL_VIDEODRIVER=x11", findBinary(),
        "run", bundle, "--screenshot", shot, "--frames", "3"],
      { cwd: dir, encoding: "utf8", timeout: 120_000 },
    );
  } catch (error) {
    return `${error.stdout ?? ""}\n${error.stderr ?? ""}`;
  }
}

function observePolicy(output) {
  const line = /TN_NATIVE_ADAPTER_POLICY:(\{.*\})/u.exec(output);
  assert.ok(
    line,
    `the host ran the bundle without reporting the policy marker:\n${output.slice(-2000)}`,
  );
  return JSON.parse(line[1]);
}

test("native: the public softwareAdapter fact drives the template's quality tier", () => {
  assert.ok(existsSync(ENTRY), `${ENTRY} is missing`);

  const output = runHost(buildBundle());
  assert.doesNotMatch(output, /TN_NATIVE_ADAPTER_POLICY_FAILED/u, "the fixture failed on the host");
  const observed = observePolicy(output);

  // The WebGPU branch is the one that produces the fact; a webgl2 fallback reports no adapter
  // identity at all, and a run that got there proved nothing about adapter.info.
  assert.equal(observed.kind, "webgpu", "the host fell back past the WebGPU renderer");
  assert.equal(
    observed.adapterClass,
    observed.softwareAdapter === null ? "hardware" : "software",
    "the reported class disagrees with the fact it was read from",
  );

  // Identity, read independently of the classification, so neither witnesses only itself.
  const identity = observed.identity ?? {};
  for (const field of ["architecture", "description", "device", "vendor"]) {
    assert.ok(
      typeof identity[field] === "string" && identity[field].length > 0,
      `adapter.info.${field} was not observed on this host`,
    );
  }

  // The relationship, not the value: this host is hardware, so `high` is its honest answer and
  // says nothing about a software adapter natively. Both halves follow from the one fact.
  assert.equal(observed.policyTier, observed.softwareAdapter === null ? "high" : "low");
  assert.equal(observed.renderChainTier, observed.policyTier === "low" ? "low" : null);

  // The software branch of the same policy, executed natively because it is pure. This is where a
  // low preset that chose `low` but left the chain's own tier at its default gets caught: the tier
  // a game PICKS and the tier the chain RUNS AT are two settings, and only one of them was ever
  // set. (Commit 9515d989c was the same defect found on a browser software rasteriser.)
  assert.deepEqual(observed.softwarePolicy, { renderChainTier: "low", tier: "low" });
}, 180_000);

test("native: the bundle is a real core build, not a stubbed renderer", () => {
  // The whole claim rests on this file being the public core bundle. A fixture that reimplemented
  // `softwareAdapter` would pass the marker assertion above while proving nothing.
  const bundle = readFileSync(buildBundle(), "utf8");
  assert.match(bundle, /softwareAdapter/u);
  assert.match(bundle, /swiftshader\|llvmpipe/u, "core's software-adapter classifier must be in the bundle");
});
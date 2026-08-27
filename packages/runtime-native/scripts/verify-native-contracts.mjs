#!/usr/bin/env node

import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import {
  buildNativeTarget,
  configurePhysicsVerificationBuild,
  configureVideoVerificationBuild,
  desktopBuildDirectory,
  nativeTestExecutable,
  resolveCmake,
  run,
  runtimeRoot,
} from "./native-test-lane.mjs";

const temporaryDirectoryArgument = "$THREENATIVE_TEMPORARY_DIRECTORY";
const physicsTarget = "threenative-physics-actuation-bindings-test";
const videoTarget = "threenative-video-recorder-state-test";

export const executionContracts = {
  "threenative-audio-decode-ogg-test": {
    invocations: [{ args: [], passLine: "native Ogg Vorbis decode contract passed on " }],
  },
  "threenative-audio-decode-promise-test": {
    invocations: [{ args: [], passLine: "native decodeAudioData Promise contract passed on " }],
  },
  "threenative-audio-graph-test": {
    invocations: [{ args: [], passLine: "audio graph ok:" }],
  },
  "threenative-bindings-creation-test": {
    invocations: [{ args: [], passLine: "native WebGPU creation bindings passed" }],
  },
  "threenative-command-encoder-class-table-test": {
    invocations: [{ args: [], passLine: "command-encoder-class-table: prototype=shared" }],
  },
  "threenative-render-pass-class-table-test": {
    invocations: [{ args: [], passLine: "render-pass-class-table: prototype=shared" }],
  },
  "threenative-crash-handler-policy-test": {
    invocations: [{ args: [], passLine: "native crash-handler policy contract passed" }],
  },
  "threenative-dom-dispatch-lifetime-test": {
    invocations: [
      {
        args: [],
        passLine: "[dom-dispatch-lifetime] window and document dispatch survived clearFrameHandles",
      },
    ],
  },
  "threenative-embedded-bundle-test": {
    invocations: [{ args: [], passLine: "embedded_bundle bindings: all assertions passed" }],
  },
  "threenative-handle-lifetime-test": {
    invocations: [
      {
        args: ["v8"],
        passLine: "engine=v8 handles-created=512 handles-freed=512 outstanding=0",
      },
    ],
  },
  "threenative-input-restart-test": {
    invocations: [
      {
        args: [],
        passLine: "[input-restart] two register-dispose cycles delivered each event exactly once",
      },
    ],
  },
  "threenative-js-engine-contract-test": {
    invocations: [{ args: [], passLine: "js-engine-contract: engine=V8 property=own-data" }],
  },
  "threenative-lifecycle-policy-test": {
    invocations: [{ args: [], passLine: "native lifecycle policy contract passed" }],
  },
  "threenative-local-storage-test": {
    invocations: [{ args: [], passLine: "local_storage bindings: all assertions passed" }],
  },
  "threenative-physics-actuation-bindings-test": {
    invocations: [{ args: [], passLine: "native physics actuation bindings passed" }],
  },
  "threenative-rt-handle-allocation-test": {
    invocations: [{ args: [], passLine: "raytracing handle allocation contract passed" }],
  },
  "threenative-shader-module-metadata-test": {
    invocations: [
      {
        args: [],
        passLine: "shader-module-metadata: wrapper=erase+release-once teardown=release-survivors",
      },
    ],
  },
  "threenative-shutdown-lifetime-test": {
    invocations: [
      {
        args: ["http"],
        passLine: "[shutdown-lifetime] exited cleanly with a live keep-alive socket",
      },
      {
        args: ["timer-watch", temporaryDirectoryArgument],
        passLine: "[shutdown-lifetime] exited cleanly with an active interval and watch",
      },
    ],
  },
  "threenative-timer-delivery-test": {
    invocations: [{ args: [], passLine: "native timer delivery contract passed" }],
  },
  "threenative-timer-engine-first-test": {
    invocations: [{ args: [], passLine: "native engine-first timer delivery contract passed" }],
  },
  "threenative-video-recorder-state-test": {
    invocations: [{ args: [], passLine: "native video recorder missing-state guard passed" }],
  },
  "threenative-webgpu-bindings-reentrancy-test": {
    invocations: [{ args: [], passLine: "native WebGPU bindings reentrancy passed" }],
  },
  "threenative-wgpu-null-handle-test": {
    invocations: [{ args: [], passLine: "native wgpu NULL-handle contract passed" }],
  },
};

export function discoverNativeTestTargets(cmakeSource) {
  const targets = [
    ...cmakeSource.matchAll(/add_executable\(\s*(threenative-[a-z0-9-]+-test)\b/gu),
  ].map((match) => match[1]);
  const discovered = [...new Set(targets)].sort();
  if (discovered.length === 0) throw new Error("discovered zero native contract test targets");
  return discovered;
}

export function validateExecutionContracts(discoveredTargets, contracts) {
  const discovered = new Set(discoveredTargets);
  const configured = new Set(Object.keys(contracts));
  const missing = discoveredTargets.filter((target) => !configured.has(target));
  const extra = [...configured].filter((target) => !discovered.has(target)).sort();
  const errors = [];
  if (missing.length > 0) errors.push(`missing execution contracts: ${missing.join(", ")}`);
  if (extra.length > 0) errors.push(`execution contracts without targets: ${extra.join(", ")}`);
  if (errors.length > 0) throw new Error(errors.join("; "));
}

function runContractInvocations(target, contract, runTarget) {
  const failures = [];
  for (const invocation of contract.invocations) {
    try {
      const log = runTarget(target, invocation.args);
      if (!log.includes(invocation.passLine)) {
        failures.push(
          `invocation ${JSON.stringify(invocation.args)} did not report '${invocation.passLine}':\n${log}`,
        );
      }
    } catch (error) {
      failures.push(`invocation ${JSON.stringify(invocation.args)} failed: ${error.message}`);
    }
  }
  return failures;
}

function executeTarget(target, contract, buildTarget, runTarget) {
  try {
    buildTarget(target);
  } catch (error) {
    return [`build failed: ${error.message}`];
  }
  return runContractInvocations(target, contract, runTarget);
}

export function runNativeContractLane({
  buildTarget,
  contracts,
  discoveredTargets,
  report,
  runTarget,
}) {
  validateExecutionContracts(discoveredTargets, contracts);
  const failures = [];
  for (const target of discoveredTargets) {
    const targetFailures = executeTarget(target, contracts[target], buildTarget, runTarget);
    const status = targetFailures.length === 0 ? "PASS" : "FAIL";
    report({ failures: targetFailures, status, target });
    if (targetFailures.length > 0) failures.push(`${target}:\n${targetFailures.join("\n")}`);
  }
  if (failures.length > 0) {
    throw new Error(
      `${failures.length} native contract target(s) failed:\n\n${failures.join("\n\n")}`,
    );
  }
}

export function verifyNativeContracts() {
  const cmakeSource = readFileSync(join(runtimeRoot, "CMakeLists.txt"), "utf8");
  const discoveredTargets = discoverNativeTestTargets(cmakeSource);
  validateExecutionContracts(discoveredTargets, executionContracts);
  const cmake = resolveCmake();
  const shippingBuildDirectory = desktopBuildDirectory();
  let physicsBuildDirectory;
  let videoBuildDirectory;
  const temporaryDirectory = mkdtempSync(join(tmpdir(), "threenative-shutdown-lifetime-"));
  try {
    runNativeContractLane({
      buildTarget(target) {
        if (target === physicsTarget && physicsBuildDirectory === undefined) {
          physicsBuildDirectory = configurePhysicsVerificationBuild(cmake);
        }
        if (target === videoTarget && videoBuildDirectory === undefined) {
          videoBuildDirectory = configureVideoVerificationBuild(cmake);
        }
        let buildDirectory = shippingBuildDirectory;
        if (target === physicsTarget) buildDirectory = physicsBuildDirectory;
        if (target === videoTarget) buildDirectory = videoBuildDirectory;
        buildNativeTarget(cmake, buildDirectory, target);
      },
      contracts: executionContracts,
      discoveredTargets,
      report({ failures, status, target }) {
        console.info(`${status} ${target}`);
        for (const failure of failures) console.error(`  ${failure}`);
      },
      runTarget(target, args) {
        let buildDirectory = shippingBuildDirectory;
        if (target === physicsTarget) buildDirectory = physicsBuildDirectory;
        if (target === videoTarget) buildDirectory = videoBuildDirectory;
        const resolvedArgs = args.map((argument) =>
          argument === temporaryDirectoryArgument ? temporaryDirectory : argument,
        );
        return run(nativeTestExecutable(buildDirectory, target), resolvedArgs, {
          timeout: 120_000,
        });
      },
    });
  } finally {
    rmSync(temporaryDirectory, { force: true, recursive: true });
  }
  return discoveredTargets;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const targets = verifyNativeContracts();
  console.info(`native contract lane passed: ${targets.length} of ${targets.length} targets`);
}

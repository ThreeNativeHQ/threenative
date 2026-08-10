import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { RenderPipeline } from "three/webgpu";
import { test } from "vitest";
import { assertComputeProof } from "../conformance/scenes/shared/compute-smoke.js";
import {
  assertGpuValidationApi,
  assertGpuValidationObservation,
} from "../conformance/scenes/shared/gpu-validation-scope.js";
import { assertPostProcessingProof } from "../conformance/scenes/shared/postprocessing-pass.js";
import { assertSubmittedWorkPromise } from "../conformance/scenes/shared/screenshot-completion.js";
import { assertStorageBufferProof } from "../conformance/scenes/shared/storage-buffer-smoke.js";
import { assertColorNodeProof } from "../conformance/scenes/shared/tsl-color-node.js";
import { assertTimeNodeProof } from "../conformance/scenes/shared/tsl-time-node.js";

const root = fileURLToPath(new URL("../", import.meta.url));
const sceneRoot = join(root, "conformance/scenes/shared");
const sceneFiles = [
  "postprocessing-pass.js",
  "tsl-color-node.js",
  "tsl-time-node.js",
  "storage-buffer-smoke.js",
  "compute-smoke.js",
  "gpu-validation-scope.js",
  "screenshot-completion.js",
];

test("planned GPU rows use real Three.js WebGPU, TSL, storage, compute, and queue APIs", () => {
  const source = Object.fromEntries(
    sceneFiles.map((file) => [file, readFileSync(join(sceneRoot, file), "utf8")]),
  );
  const joined = Object.values(source).join("\n");
  assert.doesNotMatch(joined, /navigator\.|process\.|android|desktop|target\s*===/u);
  assert.match(source["postprocessing-pass.js"], /new THREE\.RenderPipeline/u);
  assert.match(source["postprocessing-pass.js"], /pass\(scene, camera\)[\s\S]*getTextureNode/u);
  assert.match(source["tsl-color-node.js"], /MeshBasicNodeMaterial[\s\S]*material\.colorNode\s*=\s*mix/u);
  assert.match(source["tsl-time-node.js"], /time\.greaterThanEqual\(0\)\.select[\s\S]*material\.colorNode/u);
  assert.match(source["storage-buffer-smoke.js"], /instancedArray[\s\S]*positionNode[\s\S]*colorNode/u);
  assert.match(source["compute-smoke.js"], /Fn\([\s\S]*\.compute\(4\)[\s\S]*computeAsync/u);
  assert.match(source["gpu-validation-scope.js"], /pushErrorScope[\s\S]*usage:\s*0[\s\S]*popErrorScope/u);
  assert.match(source["screenshot-completion.js"], /onSubmittedWorkDone[\s\S]*onSubmittedWorkDone/u);
});

test("scene runtime contracts fail closed when their required observations are absent", () => {
  assert.throws(() => assertColorNodeProof({ isNodeMaterial: true }), /compiled colorNode/u);
  assert.throws(() => assertTimeNodeProof({ colorNode: { isNode: true } }), /time node/u);
  assert.throws(
    () => assertStorageBufferProof({ isStorageBufferNode: true }, {}, {}),
    /storage-backed offsets/u,
  );
  assert.throws(
    () => assertComputeProof({ isComputeNode: true }, { isStorageBufferNode: true }),
    /observable computeAsync completion/u,
  );
  assert.throws(() => assertGpuValidationApi({}), /pushErrorScope and popErrorScope/u);
  assert.throws(() => assertGpuValidationObservation(null), /did not observe/u);
  assert.throws(() => assertSubmittedWorkPromise(undefined, "final"), /missing queue observation/u);
});

test("postprocessing runtime contract rejects a pipeline without the processed output", () => {
  const pipeline = Object.create(RenderPipeline.prototype);
  const sceneColor = { isNode: true };
  const outputNode = { isNode: true };
  pipeline.outputNode = sceneColor;
  assert.throws(
    () => assertPostProcessingProof(pipeline, sceneColor, outputNode),
    /did not install the processed output node/u,
  );
  pipeline.outputNode = outputNode;
  assert.doesNotThrow(() => assertPostProcessingProof(pipeline, sceneColor, outputNode));
});

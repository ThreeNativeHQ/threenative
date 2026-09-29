import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "vitest";
import {
  planNeuralInput,
  validateNeuralManifest,
  verifyNeuralStage,
} from "../agent-docs/examples/neural-rendering/model-contract.js";

const bytes = new Uint8Array([1, 2, 3, 4]);
const sha256 = createHash("sha256").update(bytes).digest("hex");
const layout = {
  provider: "integration-fixture",
  revision: "a".repeat(40),
  graph: "fixture-v1",
  stageBytes: { "stages/one.bin": 4 },
};
const makeStage = () => ({ path: "stages/one.bin", bytes: 4, sha256 });
const manifest = () => ({
  version: 1,
  provider: layout.provider,
  revision: layout.revision,
  graph: layout.graph,
  stages: [makeStage()] as [ReturnType<typeof makeStage>],
});
const device = () => ({
  kind: "webgpu",
  features: new Set(["shader-f16"]),
  limits: {
    maxTextureDimension2D: 4096,
    maxComputeWorkgroupStorageSize: 32768,
    maxBufferSize: 1_048_576,
    maxStorageBufferBindingSize: 524_288,
  },
});
const requirements = () => ({
  features: ["shader-f16"],
  limits: { maxComputeWorkgroupStorageSize: 32768 },
  alignment: 16,
  minimumDimension: 32,
  estimateMemory: (width: number, height: number) => ({
    liveBytes: width * height * 8,
    peakBytes: width * height * 12,
    largestBufferBytes: width * height * 4,
    largestStorageBindingBytes: width * height * 4,
  }),
});
const request = { width: 33, height: 17, maxBytes: 1_048_576 };

test("accepts only the pinned data-only model layout and freezes the validated copy", () => {
  const raw = manifest();
  const valid = validateNeuralManifest(raw, layout);
  assert.deepEqual(valid, raw);
  assert.notEqual(valid, raw);
  assert.ok(Object.isFrozen(valid));
  assert.ok(Object.isFrozen(valid.stages));
  assert.ok(Object.isFrozen(valid.stages[0]));
  raw.stages[0].bytes = 99;
  const first = valid.stages[0];
  assert.ok(first);
  assert.equal(first.bytes, 4);
});

for (const field of ["version", "provider", "revision", "graph"] as const) {
  test(`rejects mismatched ${field} before processing stage data`, () => {
    assert.throws(() => validateNeuralManifest({ ...manifest(), [field]: "wrong" }, layout));
  });
}
for (const raw of [null, [], 12, "manifest", {}, { ...manifest(), shader: "evil.wgsl" }]) {
  test(`rejects malformed or executable manifest fields: ${JSON.stringify(raw)}`, () => {
    assert.throws(() => validateNeuralManifest(raw, layout));
  });
}
for (const path of [
  "../one.bin",
  "/one.bin",
  "a/../one.bin",
  "a//one.bin",
  "%2e%2e/one.bin",
  "a\\one.bin",
  "https://example.org/one.bin",
  "one.bin?x=1",
  "one.bin#x",
  "./one.bin",
]) {
  test(`rejects an unsafe stage path even in a caller-supplied layout: ${path}`, () => {
    const raw = manifest();
    raw.stages[0].path = path;
    assert.throws(
      () => validateNeuralManifest(raw, { ...layout, stageBytes: { [path]: 4 } }),
      /PATH/,
    );
  });
}

test("rejects missing, duplicate, unknown, and extra-key stages", () => {
  const stage = manifest().stages[0];
  for (const stages of [
    [],
    [stage, stage],
    [{ ...stage, path: "other.bin" }],
    [{ ...stage, code: "run()" }],
  ]) {
    assert.throws(() => validateNeuralManifest({ ...manifest(), stages }, layout));
  }
});
for (const size of [
  0,
  -1,
  3,
  4.5,
  Number.NaN,
  Number.POSITIVE_INFINITY,
  Number.MAX_SAFE_INTEGER + 1,
]) {
  test(`rejects invalid or mismatched stage length ${size}`, () => {
    const raw = manifest();
    raw.stages[0].bytes = size;
    assert.throws(() => validateNeuralManifest(raw, layout));
  });
}

test("rejects invalid hash metadata", () => {
  for (const hash of ["", "x".repeat(64), "a".repeat(63)]) {
    const raw = manifest();
    raw.stages[0].sha256 = hash;
    assert.throws(() => validateNeuralManifest(raw, layout), /HASH/);
  }
});

test("canonicalizes stage order to the reviewed graph, not download order", () => {
  const one = manifest().stages[0];
  const two = { ...one, path: "stages/two.bin" };
  const result = validateNeuralManifest(
    { ...manifest(), stages: [two, one] },
    {
      ...layout,
      stageBytes: { "stages/one.bin": 4, "stages/two.bin": 4 },
    },
  );
  assert.deepEqual(
    result.stages.map((stage) => stage.path),
    [one.path, two.path],
  );
});

test("verifies bytes with a real SHA-256 implementation", async () => {
  await verifyNeuralStage(manifest().stages[0], bytes, async (data) =>
    createHash("sha256").update(data).digest("hex"),
  );
});

test("rejects truncated/oversized data before hashing and corrupt data after hashing", async () => {
  let calls = 0;
  const digest = async (data: Uint8Array) => {
    calls += 1;
    return createHash("sha256").update(data).digest("hex");
  };
  for (const data of [new Uint8Array(3), new Uint8Array(5)]) {
    await assert.rejects(verifyNeuralStage(manifest().stages[0], data, digest), /LENGTH/);
  }
  assert.equal(calls, 0);
  await assert.rejects(verifyNeuralStage(manifest().stages[0], new Uint8Array(4), digest), /HASH/);
});

test("plans padded dimensions and reports live/peak bytes without allocating GPU resources", () => {
  assert.deepEqual(planNeuralInput(request, device(), requirements()), {
    width: 33,
    height: 17,
    paddedWidth: 48,
    paddedHeight: 32,
    liveBytes: 12288,
    peakBytes: 18432,
    largestBufferBytes: 6144,
    largestStorageBindingBytes: 6144,
  });
});

test("uses actual device limits; insufficient workgroup storage does not pass", () => {
  const actual = device();
  actual.limits.maxComputeWorkgroupStorageSize = 16384;
  assert.throws(
    () => planNeuralInput(request, actual, requirements()),
    /maxComputeWorkgroupStorageSize.*32768.*16384/,
  );
});

test("distinguishes unavailable WebGPU, missing features, and missing device limits", () => {
  assert.throws(
    () => planNeuralInput(request, { ...device(), kind: "webgl2" }, requirements()),
    /BACKEND/,
  );
  assert.throws(
    () => planNeuralInput(request, { ...device(), features: new Set<string>() }, requirements()),
    /FEATURE.*shader-f16/,
  );
  assert.throws(
    () => planNeuralInput(request, { ...device(), limits: {} }, requirements()),
    /LIMIT/,
  );
});
for (const size of [
  0,
  -1,
  1.5,
  Number.NaN,
  Number.POSITIVE_INFINITY,
  513,
  Number.MAX_SAFE_INTEGER,
]) {
  test(`rejects invalid or non-smoke input dimensions ${size}`, () => {
    assert.throws(() => planNeuralInput({ ...request, width: size }, device(), requirements()));
  });
}

test("checks padded size against the texture limit", () => {
  const actual = device();
  actual.limits.maxTextureDimension2D = 40;
  assert.throws(() => planNeuralInput(request, actual, requirements()), /maxTextureDimension2D/);
});

test("requires an explicit valid byte cap and enforces peak, not just live, usage", () => {
  for (const maxBytes of [0, -1, Number.NaN, Number.POSITIVE_INFINITY, 15000]) {
    assert.throws(() => planNeuralInput({ ...request, maxBytes }, device(), requirements()));
  }
  assert.equal(
    planNeuralInput({ ...request, maxBytes: 18432 }, device(), requirements()).peakBytes,
    18432,
  );
});

test("checks maximum individual allocation and storage-binding sizes separately", () => {
  const actual = device();
  actual.limits.maxBufferSize = 6000;
  assert.throws(() => planNeuralInput(request, actual, requirements()), /maxBufferSize/);
  actual.limits.maxBufferSize = 10000;
  actual.limits.maxStorageBufferBindingSize = 6000;
  assert.throws(
    () => planNeuralInput(request, actual, requirements()),
    /maxStorageBufferBindingSize/,
  );
});

test("rejects unsafe estimates and impossible live/peak/binding relationships", () => {
  const base = requirements().estimateMemory(48, 32);
  for (const estimate of [
    { ...base, liveBytes: -1 },
    { ...base, peakBytes: Number.NaN },
    { ...base, peakBytes: Number.MAX_SAFE_INTEGER + 1 },
    { ...base, peakBytes: 1 },
    { ...base, largestBufferBytes: base.peakBytes + 1 },
    { ...base, largestStorageBindingBytes: base.largestBufferBytes + 1 },
  ]) {
    assert.throws(() =>
      planNeuralInput(request, device(), { ...requirements(), estimateMemory: () => estimate }),
    );
  }
});

for (const ending of ["\n", "\r", "\u2028", "\u2029"]) {
  test(`rejects a stage key with a trailing line terminator ${JSON.stringify(ending)}`, () => {
    const path = `one.bin${ending}`;
    const raw = manifest();
    raw.stages[0].path = path;
    assert.throws(
      () => validateNeuralManifest(raw, { ...layout, stageBytes: { [path]: 4 } }),
      /PATH/,
    );
  });
}

test("rejects line-terminated digests and pinned source identities", () => {
  const raw = manifest();
  raw.stages[0].sha256 += "\n";
  assert.throws(() => validateNeuralManifest(raw, layout), /HASH/);
  for (const key of ["provider", "revision", "graph"] as const) {
    const value = `${layout[key]}\n`;
    assert.throws(
      () => validateNeuralManifest({ ...manifest(), [key]: value }, { ...layout, [key]: value }),
      /LAYOUT/,
    );
  }
});

test("rejects oversized stage counts and summed byte overflow", () => {
  assert.throws(() => validateNeuralManifest(manifest(), { ...layout, stageBytes: {} }));
  assert.throws(() =>
    validateNeuralManifest(manifest(), {
      ...layout,
      stageBytes: {
        "one.bin": Number.MAX_SAFE_INTEGER,
        "two.bin": 1,
      },
    }),
  );
  const stageBytes = Object.fromEntries(Array.from({ length: 1025 }, (_, i) => [`${i}.bin`, 1]));
  assert.throws(() => validateNeuralManifest(manifest(), { ...layout, stageBytes }));
});

test("fails before estimation for malformed dimensions/requirements or unavailable device limits", () => {
  let estimated = 0;
  const options = {
    ...requirements(),
    estimateMemory: (width: number, height: number) => {
      estimated += 1;
      return requirements().estimateMemory(width, height);
    },
  };
  for (const alignment of [0, -1, 0.5, Number.POSITIVE_INFINITY]) {
    assert.throws(() => planNeuralInput(request, device(), { ...options, alignment }));
  }
  assert.throws(() =>
    planNeuralInput(request, device(), {
      ...options,
      limits: { minUniformBufferOffsetAlignment: 256 },
    }),
  );
  const actual = device();
  actual.limits.maxTextureDimension2D = Number.NaN;
  assert.throws(() => planNeuralInput(request, actual, options));
  assert.equal(estimated, 0);
});

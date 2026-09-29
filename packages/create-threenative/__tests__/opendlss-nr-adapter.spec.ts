import assert from "node:assert/strict";
import { test } from "vitest";
import { createFixtureProvider } from "../agent-docs/examples/neural-rendering/fixture-provider.js";
import {
  OPEN_DLSS_NR_REVISION,
  createOpenDLSSNRProvider,
} from "../agent-docs/examples/neural-rendering/opendlss-provider.js";

function fixture() {
  const log: string[] = [];
  let destroyed = 0;
  const device = {
    limits: {
      maxComputeWorkgroupStorageSize: 32768,
      maxStorageBufferBindingSize: 128 * 1024 * 1024,
    },
    createShaderModule() {
      return {};
    },
    createComputePipeline(options: { compute: { entryPoint: string } }) {
      log.push(`compile:${options.compute.entryPoint}`);
      return {
        getBindGroupLayout() {
          return {};
        },
      };
    },
    createBindGroup() {
      return {};
    },
    createBuffer() {
      return {
        destroy() {
          destroyed += 1;
        },
      };
    },
    queue: {
      writeBuffer() {
        log.push("parameters");
      },
      submit() {
        throw new Error("provider must not submit");
      },
    },
    destroy() {
      throw new Error("borrowed device");
    },
  };
  const rows = 320 * 320;
  const features = { buffer: { size: rows * 64, usage: 128, mapState: "unmapped" } };
  const head = { rows, buffer: { size: rows * 16, usage: 128, mapState: "unmapped" } };
  const network = {
    device,
    features,
    graph: { head },
    geometry: {
      validWidth: 256,
      validHeight: 256,
      fullWidth: 320,
      fullHeight: 320,
      fullRows: rows,
    },
    tensors: { total: rows * 80 },
    model: { bytesUploaded: 1024 },
    recorder: {
      encode() {
        log.push("network");
      },
    },
    run() {
      throw new Error("must use recorded encoder path");
    },
    destroy() {
      throw new Error("unsafe upstream destructor");
    },
  };
  const encoder = {
    beginComputePass({ label }: { label: string }) {
      log.push(label);
      return {
        setPipeline() {},
        setBindGroup() {},
        dispatchWorkgroups(x: number, y: number) {
          log.push(`dispatch:${x}x${y}`);
        },
        end() {
          log.push("end");
        },
      };
    },
  };
  const texture = () => ({
    width: 256,
    height: 256,
    format: "rgba16float",
    usage: 12,
    sampleCount: 1,
    dimension: "2d",
    depthOrArrayLayers: 1,
    createView() {
      return {};
    },
  });
  const options = { network, sourceRevision: OPEN_DLSS_NR_REVISION, peakBytes: rows * 80 + 1024 };
  return { log, device, network, encoder, options, texture, destroyed: () => destroyed };
}

test("encodes half-grid features, the real graph, then HDR reconstruction on one supplied encoder", () => {
  const f = fixture();
  const provider = createOpenDLSSNRProvider(f.device as never, f.options as never);
  assert.equal(provider.kind, "neural");
  // `assert.deepEqual` is an `asserts` signature: a bare `[]` narrows `log` to `never[]` for the
  // rest of the test, and every `indexOf`/`includes` below it then rejects its own argument.
  assert.deepEqual(f.log, [] as string[]);
  provider.encode(f.encoder as never, { original: f.texture(), enhanced: f.texture() } as never);
  assert.ok(f.log.indexOf("input_features") < f.log.indexOf("network"));
  assert.ok(f.log.indexOf("network") < f.log.indexOf("compose_hdr"));
  assert.ok(f.log.includes("dispatch:40x40"));
  assert.ok(f.log.includes("dispatch:32x32"));
  provider.dispose();
  provider.dispose();
  assert.equal(f.destroyed(), 1);
  assert.throws(() => provider.encode(f.encoder as never, {} as never), /CLOSED/);
});

test("requires the pinned revision, correct device and conservative declared allocation estimate", () => {
  const f = fixture();
  assert.throws(
    () =>
      createOpenDLSSNRProvider(
        f.device as never,
        { ...f.options, sourceRevision: "main" } as never,
      ),
    /REVISION/,
  );
  assert.throws(() => createOpenDLSSNRProvider({} as never, f.options as never), /DEVICE/);
  assert.throws(
    () => createOpenDLSSNRProvider(f.device as never, { ...f.options, peakBytes: 1 } as never),
    /MEMORY/,
  );
  f.device.limits.maxComputeWorkgroupStorageSize = 16384;
  assert.throws(() => createOpenDLSSNRProvider(f.device as never, f.options as never), /32768/);
});

test("rejects incorrect padded graph geometry and truncated/non-storage tensor buffers", () => {
  const f = fixture();
  f.network.geometry.fullRows -= 1;
  assert.throws(() => createOpenDLSSNRProvider(f.device as never, f.options as never), /GEOMETRY/);
  f.network.geometry.fullRows += 1;
  f.network.features.buffer.size = 4;
  assert.throws(() => createOpenDLSSNRProvider(f.device as never, f.options as never), /BUFFER/);
  f.network.features.buffer.size = 320 * 320 * 64;
  f.network.graph.head.buffer.usage = 0;
  assert.throws(() => createOpenDLSSNRProvider(f.device as never, f.options as never), /BUFFER/);
});

test("rejects unsupported temporal/style controls rather than pretending they were applied", () => {
  const f = fixture();
  for (const conditioning of [
    { temporal: true },
    { style: 1 },
    { localTone: Number.NaN },
    { paperWhite: 0 },
  ]) {
    assert.throws(
      () => createOpenDLSSNRProvider(f.device as never, { ...f.options, conditioning } as never),
      /CONDITIONING/,
    );
  }
});

test("validates actual frame textures before dispatch", () => {
  const f = fixture();
  const provider = createOpenDLSSNRProvider(f.device as never, f.options as never);
  const original = f.texture();
  assert.throws(
    () => provider.encode(f.encoder as never, { original, enhanced: original } as never),
    /TEXTURE/,
  );
  assert.throws(
    () =>
      provider.encode(
        f.encoder as never,
        {
          original: { ...original, format: "rgba8unorm" },
          enhanced: f.texture(),
        } as never,
      ),
    /TEXTURE/,
  );
  assert.deepEqual(f.log, [] as string[]);
});

test("fixture performs a real compute dispatch and is never labeled as neural enhancement", () => {
  const f = fixture();
  const provider = createFixtureProvider(f.device as never, 256, 256);
  assert.equal(provider.kind, "fixture");
  provider.encode(f.encoder as never, { original: f.texture(), enhanced: f.texture() } as never);
  assert.ok(f.log.includes("fixture_grade"));
  assert.equal(f.log.includes("network"), false);
  provider.dispose();
  assert.equal(f.destroyed(), 0);
});

test("does not append composition behind a graph that has not synchronously recorded", () => {
  const f = fixture();
  f.network.recorder.encode = async () => {};
  const provider = createOpenDLSSNRProvider(f.device as never, f.options as never);
  assert.throws(
    () =>
      provider.encode(
        f.encoder as never,
        {
          original: f.texture(),
          enhanced: f.texture(),
        } as never,
      ),
    /SYNCHRONOUS/,
  );
  assert.equal(f.log.includes("compose_hdr"), false);
  provider.dispose();
});

import assert from "node:assert/strict";
import { test } from "vitest";
import { PerspectiveCamera, Scene } from "three";
import { PassNode } from "three/webgpu";
import { attachNeuralCapture } from "../agent-docs/examples/neural-rendering/render-capture.js";
import { createFixtureProvider } from "../agent-docs/examples/neural-rendering/fixture-provider.js";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((yes) => { resolve = yes; });
  return { promise, resolve };
}
function fixture() {
  const log: string[] = [];
  const done = deferred();
  const world = new PassNode(PassNode.COLOR, new Scene(), new PerspectiveCamera());
  world.renderTarget.setSize(32, 16);
  const originalUpdate = () => { log.push("world"); };
  world.updateBefore = originalUpdate;
  const device = {
    createShaderModule() { return {}; },
    createSampler() { return {}; },
    createComputePipeline() { return { getBindGroupLayout() { return {}; } }; },
    createBindGroup() { return {}; },
  };
  const textures = new Map<object, object>();
  const bridge = { device,
    texture(value: object, request: { width: number; height: number; usage: number }) {
      let gpu = textures.get(value);
      if (gpu === undefined) {
        gpu = { ...request, usage: 12, format: "rgba16float", dimension: "2d", depthOrArrayLayers: 1,
          sampleCount: 1, createView() { return {}; } };
        textures.set(value, gpu);
      }
      if (value === world.getTexture("output")) log.push("resolve world");
      return gpu;
    },
    submit(encode: (encoder: unknown) => void) {
      encode({ beginComputePass({ label }: { label: string }) {
        log.push(label); return { setPipeline() {}, setBindGroup() {}, dispatchWorkgroups() {}, end() {} };
      } });
      log.push("submit");
      return { completed: done.promise, retired: done.promise };
    }, retire() { log.push("retire"); return Promise.resolve(); },
  };
  const provider = createFixtureProvider(device as never, 32, 16);
  let rebuild: () => unknown = () => undefined;
  const capture = attachNeuralCapture({ worldPass: world, bridge: bridge as never, provider,
    maxBytes: 8192, rebuildGraph() { log.push("detach graph"); return rebuild(); } });
  return { log, world, capture, done, originalUpdate, textures, setRebuild(value: () => unknown) { rebuild = value; } };
}

test("binds to the existing world pass and records capture -> fixture -> submit after world rendering", async () => {
  const f = fixture();
  assert.equal(f.capture.stage.before, "probeVolume");
  assert.equal(f.capture.textures.original.generateMipmaps, false);
  assert.equal(f.capture.textures.enhanced.mipmapsAutoUpdate, false);
  assert.ok(f.capture.stage.build(f.world.getTextureNode()));
  f.capture.capture();
  f.world.updateBefore({} as never);
  assert.deepEqual(f.log, ["world", "resolve world", "capture_linear_hdr", "fixture_channel_swap", "submit"]);
  f.done.resolve(); await f.capture.settled;
  assert.equal(f.capture.state.frozen, true);
  assert.equal(f.capture.state.frameId, 1);
  await f.capture.dispose();
});

test("does not dispatch without an explicit capture and rejects insertion that would discard earlier effects", async () => {
  const f = fixture();
  f.world.updateBefore({} as never);
  assert.deepEqual(f.log, ["world"]);
  assert.throws(() => f.capture.stage.build({}), /ORDER/);
  await f.capture.dispose();
});

test("removes the graph and render hook before retiring or disposing captured textures", async () => {
  const f = fixture();
  f.capture.stage.build(f.world.getTextureNode());
  let disposed = 0;
  f.capture.textures.original.addEventListener("dispose", () => { disposed += 1; });
  f.capture.textures.enhanced.addEventListener("dispose", () => { disposed += 1; });
  f.capture.capture(); f.world.updateBefore({} as never);
  const disposing = f.capture.dispose();
  assert.equal(f.world.updateBefore, f.originalUpdate);
  assert.equal(f.log.at(-1), "detach graph");
  assert.equal(disposed, 0);
  f.done.resolve(); await disposing;
  assert.equal(disposed, 2);
  assert.notEqual(f.capture.stage.available(), true);
  assert.throws(() => f.capture.capture(), /DISABLED|CLOSED/);
  await f.capture.dispose(); assert.equal(disposed, 2);
});

test("validates keyboard-friendly split/view controls and reports diagnostic provenance", async () => {
  const f = fixture();
  f.capture.setDivider(0.25); f.capture.setView("original");
  assert.throws(() => f.capture.setDivider(Number.NaN), /DIVIDER/);
  assert.throws(() => f.capture.setDivider(1.01), /DIVIDER/);
  assert.throws(() => f.capture.setView("other" as never), /VIEW/);
  assert.equal(f.capture.state.gpuMs, undefined);
  assert.equal(f.capture.state.kind, "fixture");
  await f.capture.dispose();
});


test("an asynchronous graph detach retains allocations and permits safe retry", async () => {
  const f = fixture();
  let disposed = 0;
  f.capture.textures.original.addEventListener("dispose", () => { disposed += 1; });
  f.setRebuild(async () => {});
  await assert.rejects(f.capture.dispose(), /SYNCHRONOUS/);
  assert.equal(disposed, 0);
  f.setRebuild(() => undefined);
  await f.capture.dispose();
  assert.equal(disposed, 1);
});

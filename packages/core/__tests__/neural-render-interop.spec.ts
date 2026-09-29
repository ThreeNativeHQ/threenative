import assert from "node:assert/strict";
import { test } from "vitest";
import { createWebGPUInterop } from "../src/webgpu.js";

function deferred<T = void>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
function fixture() {
  const log: string[] = [];
  const done = deferred();
  const lost = deferred<{ message: string }>();
  let validation: { message: string } | null = null;
  const gpuTexture = {
    width: 32,
    height: 16,
    depthOrArrayLayers: 1,
    sampleCount: 1,
    dimension: "2d",
    format: "rgba16float",
    usage: 4 | 8,
    createView() {
      return {};
    },
  };
  const source = {};
  const encoder = {
    finish() {
      log.push("finish");
      return {};
    },
  };
  const device = {
    lost: lost.promise,
    features: new Set(),
    limits: {},
    queue: {
      submit() {
        log.push("submit");
      },
      onSubmittedWorkDone() {
        log.push("fence");
        return done.promise;
      },
    },
    pushErrorScope(kind: string) {
      log.push(`push:${kind}`);
    },
    popErrorScope() {
      log.push("pop");
      return Promise.resolve(validation);
    },
    createCommandEncoder() {
      log.push("encoder");
      return encoder;
    },
    destroy() {
      throw new Error("must not destroy borrowed device");
    },
  };
  const raw = {
    backend: {
      isWebGPUBackend: true,
      device,
      get(value: unknown) {
        return value === source ? { texture: gpuTexture } : {};
      },
    },
    initTexture() {
      log.push("initTexture");
    },
  };
  const bridge = () => createWebGPUInterop({ kind: "webgpu", raw });
  return {
    log,
    done,
    lost,
    device,
    raw,
    bridge,
    source,
    gpuTexture,
    rejectValidation() {
      validation = { message: "bad shader" };
    },
  };
}

test("rejects non-WebGPU and uninitialized backends instead of acquiring another device", () => {
  assert.throws(() => createWebGPUInterop({ kind: "webgl2", raw: {} }), /WEBGPU/);
  assert.throws(() => createWebGPUInterop({ kind: "webgpu", raw: {} }), /BACKEND/);
  assert.throws(
    () =>
      createWebGPUInterop({
        kind: "webgpu",
        raw: {
          backend: { isWebGPUBackend: true, device: null },
        },
      }),
    /BACKEND/,
  );
});

test("resolves only resources from this renderer's backend and validates actual descriptors", () => {
  const f = fixture();
  const bridge = f.bridge();
  const spec = { width: 32, height: 16, format: "rgba16float" as const, usage: 4 };
  assert.equal(bridge.device, f.device);
  assert.equal(bridge.texture(f.source as never, spec), f.gpuTexture);
  assert.equal(f.log.includes("initTexture"), false);
  assert.throws(() => bridge.texture({} as never, spec), /TEXTURE/);
  assert.throws(() => bridge.texture(f.source as never, { ...spec, width: 16 }), /TEXTURE/);
  assert.throws(() => bridge.texture(f.source as never, { ...spec, usage: 16 }), /TEXTURE/);
  f.gpuTexture.sampleCount = 4;
  assert.throws(() => bridge.texture(f.source as never, spec), /TEXTURE/);
});

test("initialization of an owned output is explicit", () => {
  const f = fixture();
  f.bridge().texture(f.source as never, {
    width: 32,
    height: 16,
    format: "rgba16float",
    usage: 8,
    initialize: true,
  });
  assert.deepEqual(f.log, ["initTexture"]);
});

test("encodes synchronously then submits once, closes scopes and publishes only after completion", async () => {
  const f = fixture();
  const job = f.bridge().submit((encoder) => {
    assert.ok(encoder);
    f.log.push("compute");
  });
  assert.deepEqual(f.log, [
    "push:out-of-memory",
    "push:validation",
    "encoder",
    "compute",
    "finish",
    "submit",
    "pop",
    "pop",
    "fence",
  ]);
  let settled = false;
  void job.completed.then(() => {
    settled = true;
  });
  await Promise.resolve();
  assert.equal(settled, false);
  f.done.resolve();
  await job.completed;
  await job.retired;
  assert.equal(settled, true);
});

test("validation rejection is not permission to retire before GPU work completes", async () => {
  const f = fixture();
  f.rejectValidation();
  const job = f.bridge().submit(() => {});
  const rejection = assert.rejects(job.completed, /bad shader/);
  let retired = false;
  void job.retired.then(() => {
    retired = true;
  });
  await rejection;
  assert.equal(retired, false);
  f.done.resolve();
  await job.retired;
  assert.equal(retired, true);
});

test("an encoder failure balances scopes and never submits a partial command buffer", async () => {
  const f = fixture();
  const job = f.bridge().submit(() => {
    throw new Error("bad provider");
  });
  await assert.rejects(job.completed, /bad provider/);
  assert.equal(f.log.includes("submit"), false);
  assert.equal(f.log.filter((v) => v === "pop").length, 2);
  // The world capture may already be queued, so its fence is still necessary.
  f.done.resolve();
  await job.retired;
});

test("rejects an asynchronous encoder rather than submitting before its work is encoded", async () => {
  const f = fixture();
  const job = f.bridge().submit((async () => {}) as never);
  await assert.rejects(job.completed, /SYNCHRONOUS/);
  assert.equal(f.log.includes("submit"), false);
  f.done.resolve();
  await job.retired;
});

test("a rejected queue fence preserves retirement until confirmed loss", async () => {
  const f = fixture();
  const job = f.bridge().submit(() => {});
  const rejection = assert.rejects(job.completed, /queue failure/);
  f.done.reject(new Error("queue failure"));
  await rejection;
  let retired = false;
  void job.retired.then(() => {
    retired = true;
  });
  await Promise.resolve();
  assert.equal(retired, false);
  f.lost.resolve({ message: "lost" });
  await job.retired;
  assert.equal(retired, true);
});

test("device loss fails completion, releases retirement and blocks future submissions", async () => {
  const f = fixture();
  const bridge = f.bridge();
  const job = bridge.submit(() => {});
  const rejection = assert.rejects(job.completed, /LOST/);
  f.lost.resolve({ message: "test loss" });
  await rejection;
  await job.retired;
  assert.throws(() => bridge.submit(() => {}), /LOST/);
});

test("completed submissions do not accumulate reactions on the lifetime device-loss promise", async () => {
  const f = fixture();
  const base = f.device.lost;
  // A thenable class rather than an object literal: `lint/suspicious/noThenProperty` exists to stop
  // an ordinary record from becoming thenable by accident, and this one is the instrument.
  class CountingLifetime<T> implements PromiseLike<T> {
    readonly #value: Promise<T>;
    subscriptions = 0;
    constructor(value: Promise<T>) {
      this.#value = value;
    }
    // biome-ignore lint/suspicious/noThenProperty: deliberate thenable test double; it counts lifetime-promise reactions, so an accumulating implementation fails on the assertion below.
    then<R1 = T, R2 = never>(
      onFulfilled?: ((value: T) => R1 | PromiseLike<R1>) | null,
      onRejected?: ((reason: unknown) => R2 | PromiseLike<R2>) | null,
    ): Promise<R1 | R2> {
      this.subscriptions += 1;
      return this.#value.then(onFulfilled, onRejected);
    }
  }
  const counting = new CountingLifetime(base);
  f.device.lost = counting as unknown as typeof base;
  const bridge = f.bridge();
  f.done.resolve();
  for (let i = 0; i < 10; i += 1) {
    const job = bridge.submit(() => {});
    await job.completed;
    await job.retired;
  }
  assert.ok(
    counting.subscriptions <= 1,
    `retained ${counting.subscriptions} lifetime-promise reactions`,
  );
});

import { WebGPUBackend } from "three/webgpu";
import { expect, it } from "vitest";

it("retains the WebGPU instance for the lifetime of its backend", async () => {
  const navigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  const device = {
    features: { has: () => false },
    lost: new Promise(() => undefined),
    onuncapturederror: null,
  };
  const adapter = {
    features: { has: () => false },
    requestDevice: async () => device,
  };
  const gpu = { requestAdapter: async () => adapter };
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: { gpu },
  });

  try {
    const canvasTarget = {};
    const backend = new WebGPUBackend();
    await backend.init({
      getCanvasTarget: () => canvasTarget,
      onDeviceLost: () => undefined,
      onError: () => undefined,
      xr: { enabled: false },
    } as never);

    expect((backend as WebGPUBackend & { gpu?: unknown }).gpu).toBe(gpu);
  } finally {
    if (navigatorDescriptor === undefined) Reflect.deleteProperty(globalThis, "navigator");
    else Object.defineProperty(globalThis, "navigator", navigatorDescriptor);
  }
});

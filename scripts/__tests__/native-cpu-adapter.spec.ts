import { describe, expect, it, vi } from "vitest";
import { createAdapterBackedRenderer } from "../../examples/native-cpu-load-test/src/adapter.js";

interface IFakeDevice {
  readonly label: string;
}

interface IFakeDeviceDescriptor {
  readonly requiredFeatures: readonly string[];
  readonly requiredLimits: Readonly<Record<string, number>>;
}

interface IFakeAdapter {
  readonly info: Readonly<Record<string, string>>;
  readonly features: ReadonlySet<string>;
  requestDevice: (descriptor?: IFakeDeviceDescriptor) => Promise<IFakeDevice>;
}

describe("native CPU load-test adapter identity", () => {
  it("passes the reported adapter's device to the renderer without a second adapter request", async () => {
    const renderingDevice = { label: "rendering-device" } satisfies IFakeDevice;
    const renderingAdapter = {
      info: { description: "rendering adapter", vendor: "trusted" },
      features: new Set(["timestamp-query", "not-a-three-feature"]),
      requestDevice: vi.fn(async (_descriptor?: IFakeDeviceDescriptor) => renderingDevice),
    } satisfies IFakeAdapter;
    const unrelatedAdapter = {
      info: { description: "unrelated adapter", vendor: "other" },
      features: new Set<string>(),
      requestDevice: vi.fn(async (_descriptor?: IFakeDeviceDescriptor) => ({
        label: "unrelated-device",
      })),
    } satisfies IFakeAdapter;
    const adapters = [renderingAdapter, unrelatedAdapter];
    const requestAdapter = vi.fn(async (_options?: unknown) => adapters.shift() ?? null);
    const gpu = { requestAdapter };
    let rendererDevice: IFakeDevice | undefined;

    const result = await createAdapterBackedRenderer(gpu, (parameters) => ({
      backend: { isWebGPUBackend: true },
      init: async () => {
        if (parameters.device === undefined) {
          const adapter = await gpu.requestAdapter();
          rendererDevice = adapter === null ? undefined : await adapter.requestDevice();
          return;
        }
        rendererDevice = parameters.device;
      },
    }));

    expect(requestAdapter).toHaveBeenCalledTimes(1);
    expect(requestAdapter).toHaveBeenCalledWith({
      powerPreference: undefined,
      featureLevel: "compatibility",
      xrCompatible: false,
    });
    expect(renderingAdapter.requestDevice).toHaveBeenCalledTimes(1);
    expect(renderingAdapter.requestDevice).toHaveBeenCalledWith({
      requiredFeatures: ["timestamp-query"],
      requiredLimits: {},
    });
    expect(unrelatedAdapter.requestDevice).not.toHaveBeenCalled();
    expect(rendererDevice).toBe(renderingDevice);
    expect(result.adapterInfo).toEqual({ description: "rendering adapter", vendor: "trusted" });
    expect(result.adapterInfo).not.toEqual(unrelatedAdapter.info);
  });

  it("withholds adapter metadata when initialization switches to the WebGL backend", async () => {
    const renderingDevice = { label: "rendering-device" } satisfies IFakeDevice;
    const renderingAdapter = {
      info: { description: "rendering adapter", vendor: "trusted" },
      features: new Set<string>(),
      requestDevice: vi.fn(async (_descriptor?: IFakeDeviceDescriptor) => renderingDevice),
    } satisfies IFakeAdapter;
    const gpu = {
      requestAdapter: vi.fn(async (_options?: unknown) => renderingAdapter),
    };
    const renderer: {
      backend: { isWebGPUBackend: boolean };
      init: () => Promise<void>;
    } = {
      backend: { isWebGPUBackend: true },
      init: async () => {
        renderer.backend.isWebGPUBackend = false;
      },
    };

    const result = await createAdapterBackedRenderer(gpu, () => renderer);

    expect(renderer.backend.isWebGPUBackend).toBe(false);
    expect(result.adapterInfo).toBeNull();
  });
});

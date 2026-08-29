import { GPUFeatureName } from "three/src/renderers/webgpu/utils/WebGPUConstants.js";

interface IAdapterRequestOptions {
  readonly powerPreference: "low-power" | "high-performance" | undefined;
  readonly featureLevel: "compatibility";
  readonly xrCompatible: boolean;
}

interface IDeviceDescriptor {
  readonly requiredFeatures: readonly string[];
  readonly requiredLimits: Readonly<Record<string, number>>;
}

export interface IAdapter<TDevice> {
  readonly info?: Readonly<Record<string, unknown>>;
  readonly features: ReadonlySet<string>;
  requestDevice: (descriptor: IDeviceDescriptor) => Promise<TDevice>;
}

export interface IGPU<TDevice> {
  requestAdapter: (options: IAdapterRequestOptions) => Promise<IAdapter<TDevice> | null>;
}

export interface IRendererOptions<TDevice> {
  readonly alpha: false;
  readonly antialias: false;
  readonly device?: TDevice;
  readonly forceWebGL?: boolean;
}

interface IInitializableRenderer {
  init: () => Promise<unknown>;
  readonly backend: { readonly isWebGPUBackend?: boolean };
}

export interface IAdapterBackedRenderer<TDevice, TRenderer> {
  readonly adapterInfo: Record<string, string> | null;
  readonly renderer: TRenderer;
}

function adapterInfoOf<TDevice>(adapter: IAdapter<TDevice> | null): Record<string, string> | null {
  const info = adapter?.info;
  if (info === undefined) return null;
  const entries = (["architecture", "description", "device", "vendor"] as const).flatMap((key) => {
    const value = info[key];
    return typeof value === "string" && value.trim().length > 0
      ? [[key, value.trim()] as const]
      : [];
  });
  return entries.length > 0 ? Object.fromEntries(entries) : null;
}

export async function createAdapterBackedRenderer<
  TDevice,
  TRenderer extends IInitializableRenderer,
>(
  gpu: IGPU<TDevice> | undefined,
  createRenderer: (parameters: IRendererOptions<TDevice>) => TRenderer,
): Promise<IAdapterBackedRenderer<TDevice, TRenderer>> {
  let adapter: IAdapter<TDevice> | null = null;
  let device: TDevice | null = null;
  if (gpu !== undefined) {
    try {
      adapter = await gpu.requestAdapter({
        powerPreference: undefined,
        featureLevel: "compatibility",
        xrCompatible: false,
      });
      if (adapter !== null) {
        const renderingAdapter = adapter;
        const supportedFeatures = Object.values(GPUFeatureName).filter((name) =>
          renderingAdapter.features.has(name),
        );
        device = await renderingAdapter.requestDevice({
          requiredFeatures: supportedFeatures,
          requiredLimits: {},
        });
      }
    } catch {
      adapter = null;
      device = null;
    }
  }

  const renderer = createRenderer(
    device === null
      ? { alpha: false, antialias: false, forceWebGL: true }
      : { alpha: false, antialias: false, device },
  );
  await renderer.init();
  return {
    adapterInfo:
      renderer.backend.isWebGPUBackend === true && adapter !== null && device !== null
        ? adapterInfoOf(adapter)
        : null,
    renderer,
  };
}

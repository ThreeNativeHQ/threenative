import * as THREE from "three/webgpu";
import { startVisualScene } from "./scene-support.js";

const REFUSAL = /TN_NATIVE_RAYTRACING_UNAVAILABLE[\s\S]*buffer-to-texture copy-out interop exists/u;
const WEB_RAY_TRACING_FEATURE = "ray-tracing";

async function assertBrowserRayTracingCapability() {
  const gpu = globalThis.navigator?.gpu;
  if (typeof gpu?.requestAdapter !== "function") {
    throw new Error(
      "TN_WEB_RAYTRACING_UNAVAILABLE: browser does not expose navigator.gpu.requestAdapter.",
    );
  }

  const adapter = await gpu.requestAdapter();
  if (!adapter) {
    throw new Error("TN_WEB_RAYTRACING_UNAVAILABLE: browser WebGPU returned no adapter.");
  }
  if (typeof adapter.requestDevice !== "function") {
    throw new Error(
      "TN_WEB_RAYTRACING_UNAVAILABLE: browser WebGPU adapter does not expose requestDevice.",
    );
  }
  if (adapter.features?.has(WEB_RAY_TRACING_FEATURE) !== true) {
    throw new Error(
      `TN_WEB_RAYTRACING_UNAVAILABLE: browser WebGPU adapter does not expose the '${WEB_RAY_TRACING_FEATURE}' feature; refusing to report the raytracing surface.`,
    );
  }

  let device;
  try {
    device = await adapter.requestDevice({ requiredFeatures: [WEB_RAY_TRACING_FEATURE] });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`TN_WEB_RAYTRACING_UNAVAILABLE: browser requestDevice rejected ray tracing: ${message}`);
  }
  device?.destroy?.();
  return { target: "web", rayTracingFeature: WEB_RAY_TRACING_FEATURE, rayTracingDevice: true };
}

function assertNativeRayTracingRefusal() {
  const raytracing = globalThis.mystralRT;
  if (typeof raytracing?.traceRays !== "function") {
    throw new Error("Native raytracing conformance requires the mystralRT binding.");
  }

  try {
    raytracing.traceRays({});
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (REFUSAL.test(message)) {
      console.log(`[ThreeNative conformance] native raytracing refusal: ${message}`);
      return { message, refused: true, target: "native" };
    }
    throw new Error(`Native raytracing refused for an unexpected reason: ${message}`);
  }
  throw new Error(
    "Native traceRays resolved without the required refusal; the unreadable-result gate is missing.",
  );
}

export async function startScene(canvas, dimensions) {
  const detail =
    globalThis.__THREENATIVE_NATIVE__ === undefined
      ? await assertBrowserRayTracingCapability()
      : assertNativeRayTracingRefusal();
  return startVisualScene(canvas, dimensions, "raytracing-refusal", ({ scene }) => {
    const card = new THREE.Mesh(
      new THREE.BoxGeometry(1.7, 0.95, 0.18),
      new THREE.MeshBasicMaterial({ color: 0x334155 }),
    );
    const marker = new THREE.Mesh(
      new THREE.TorusGeometry(0.24, 0.08, 12, 32),
      new THREE.MeshBasicMaterial({ color: 0x38bdf8 }),
    );
    marker.position.set(0.42, 0.08, 0.15);
    card.add(marker);
    scene.add(card);
    return { card, detail, marker };
  });
}

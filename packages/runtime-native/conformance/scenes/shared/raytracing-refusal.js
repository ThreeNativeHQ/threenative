import * as THREE from "three/webgpu";
import { startVisualScene } from "./scene-support.js";

const REFUSAL = /TN_NATIVE_RAYTRACING_UNAVAILABLE[\s\S]*buffer-to-texture copy-out interop exists/u;

function assertNativeRayTracingRefusal() {
  // The native host marker is the target boundary; the browser keeps its existing WebGPU path and
  // has no mystralRT global to call.
  if (globalThis.__THREENATIVE_NATIVE__ === undefined) return { target: "web", refused: false };

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
  const detail = assertNativeRayTracingRefusal();
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

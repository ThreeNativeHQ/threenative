import * as THREE from "three/webgpu";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

import { makeStaticGlbFixture } from "./gltf-loader-fixtures.js";
import { assertCondition, startVisualScene } from "./scene-support.js";

export async function assertAbortControllerRequest(url) {
  const controller = new AbortController();
  const request = new Request(url, { signal: controller.signal });
  assertCondition(request.signal?.aborted === false, "Request signal must start active");
  controller.abort(new Error("TN_CONFORMANCE_ABORT_PROBE"));
  let rejected = false;
  try {
    await fetch(request);
  } catch {
    rejected = true;
  }
  assertCondition(controller.signal.aborted === true, "AbortController must mark its signal aborted");
  assertCondition(request.signal?.aborted === true, "Request must observe its AbortSignal abort");
  assertCondition(rejected, "fetch(Request) must reject an already-aborted request");

  const response = await fetch(new Request(url));
  assertCondition(response.ok, "live GLB Request must succeed");
  assertCondition(
    response.headers.get("content-type") === "model/gltf-binary",
    "Response.headers.get must preserve the GLB content type",
  );
  const bytes = await response.arrayBuffer();
  assertCondition(bytes.byteLength > 20, "live GLB Request must return fixture bytes");
  return { aborted: controller.signal.aborted, byteLength: bytes.byteLength };
}

export function assertStaticGlb(gltf, events, errors) {
  const mesh = gltf?.scene?.getObjectByName("StaticGlbMesh");
  assertCondition(mesh?.isMesh === true, "GLTFLoader must create StaticGlbMesh from the GLB");
  assertCondition(
    mesh.geometry?.getAttribute("position")?.count === 3,
    "GLB mesh must contain three loaded vertices",
  );
  assertCondition(mesh.material?.isMeshStandardMaterial === true, "GLB PBR material must load");
  assertCondition(events.includes("start") && events.includes("load"), "LoadingManager must complete");
  assertCondition(errors.length === 0, "LoadingManager must report no GLB errors");
  return mesh;
}

export async function loadStaticGlbFixture() {
  const url = URL.createObjectURL(
    new Blob([makeStaticGlbFixture()], { type: "model/gltf-binary" }),
  );
  try {
    const abortProof = await assertAbortControllerRequest(url);
    const manager = new THREE.LoadingManager();
    const events = [];
    const errors = [];
    manager.onStart = () => events.push("start");
    manager.onLoad = () => events.push("load");
    manager.onError = (failedUrl) => errors.push(failedUrl);
    const gltf = await new GLTFLoader(manager).loadAsync(url);
    const mesh = assertStaticGlb(gltf, events, errors);
    return { abortProof, events, gltf, mesh };
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function startScene(canvas, dimensions) {
  const proof = await loadStaticGlbFixture();
  return startVisualScene(canvas, dimensions, "gltf-glb", ({ scene }) => {
    scene.add(new THREE.HemisphereLight(0xffffff, 0x202040, 2.4));
    const key = new THREE.DirectionalLight(0xffffff, 3.2);
    key.position.set(3, 4, 5);
    scene.add(key, proof.gltf.scene);
    return {
      ...proof,
      detail: {
        abortObserved: proof.abortProof.aborted,
        loadingManagerEvents: proof.events.length,
      },
    };
  });
}

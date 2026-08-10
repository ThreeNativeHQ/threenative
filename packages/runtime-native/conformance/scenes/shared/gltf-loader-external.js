import * as THREE from "three/webgpu";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

import { makeExternalGltfFixture } from "./gltf-loader-fixtures.js";
import { assertCondition, startVisualScene } from "./scene-support.js";

export function assertExternalGltf(gltf, requested, events, errors) {
  const mesh = gltf?.scene?.getObjectByName("ExternalGltfMesh");
  assertCondition(mesh?.isMesh === true, "GLTFLoader must create ExternalGltfMesh");
  assertCondition(
    mesh.geometry?.getAttribute("position")?.count === 3,
    "external fixture.bin must provide three positions",
  );
  assertCondition(mesh.material?.map?.isTexture === true, "external fixture.png must decode to a texture");
  assertCondition(
    requested.some((url) => url.endsWith("fixture.bin")),
    "LoadingManager must request the external glTF buffer",
  );
  assertCondition(
    requested.some((url) => url.endsWith("fixture.png")),
    "LoadingManager must request the external glTF texture",
  );
  assertCondition(events.includes("load"), "LoadingManager must finish external resources");
  assertCondition(errors.length === 0, "LoadingManager must report no external resource errors");
  return mesh;
}

export async function loadExternalGltfFixture() {
  const fixture = makeExternalGltfFixture();
  const bufferUrl = URL.createObjectURL(
    new Blob([fixture.binary], { type: "application/octet-stream" }),
  );
  const textureUrl = URL.createObjectURL(new Blob([fixture.png], { type: "image/png" }));
  try {
    const manager = new THREE.LoadingManager();
    const requested = [];
    const events = [];
    const errors = [];
    manager.setURLModifier((url) => {
      requested.push(url);
      if (url.endsWith("fixture.bin")) return bufferUrl;
      if (url.endsWith("fixture.png")) return textureUrl;
      throw new Error(`Unexpected external glTF resource: ${url}`);
    });
    manager.onLoad = () => events.push("load");
    manager.onError = (failedUrl) => errors.push(failedUrl);
    const gltf = await new GLTFLoader(manager).parseAsync(
      JSON.stringify(fixture.document),
      "tn-fixture:///",
    );
    const mesh = assertExternalGltf(gltf, requested, events, errors);
    return { events, gltf, mesh, requested };
  } finally {
    URL.revokeObjectURL(bufferUrl);
    URL.revokeObjectURL(textureUrl);
  }
}

export async function startScene(canvas, dimensions) {
  const proof = await loadExternalGltfFixture();
  return startVisualScene(canvas, dimensions, "gltf-external", ({ scene }) => {
    scene.add(new THREE.AmbientLight(0xffffff, 1.8));
    const light = new THREE.DirectionalLight(0xffffff, 2.8);
    light.position.set(2, 3, 4);
    scene.add(light, proof.gltf.scene);
    return {
      ...proof,
      detail: { loadingManagerEvents: proof.events.length, resources: proof.requested.length },
    };
  }, { background: 0x101820 });
}

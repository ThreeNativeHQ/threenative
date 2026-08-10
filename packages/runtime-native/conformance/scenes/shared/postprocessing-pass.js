import * as THREE from "three/webgpu";
import { pass, vec3, vec4 } from "three/tsl";

export function assertPostProcessingProof(pipeline, sceneColor, outputNode) {
  if (!(pipeline instanceof THREE.RenderPipeline)) {
    throw new Error("Postprocessing proof requires a Three.js RenderPipeline.");
  }
  if (sceneColor?.isNode !== true || outputNode?.isNode !== true) {
    throw new Error("Postprocessing proof requires scene-pass and output TSL nodes.");
  }
  if (pipeline.outputNode !== outputNode) {
    throw new Error("Postprocessing proof did not install the processed output node.");
  }
}

export async function startScene(canvas, dimensions) {
  const renderer = new THREE.WebGPURenderer({ canvas, antialias: false });
  await renderer.init();
  renderer.setPixelRatio(1);
  renderer.setSize(dimensions.width, dimensions.height, false);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x101827);
  const camera = new THREE.PerspectiveCamera(52, dimensions.width / dimensions.height, 0.1, 100);
  camera.position.set(0, 0.15, 3.4);

  const left = new THREE.Mesh(
    new THREE.SphereGeometry(0.72, 24, 16),
    new THREE.MeshBasicMaterial({ color: 0xf26440 }),
  );
  left.position.x = -0.75;
  const right = new THREE.Mesh(
    new THREE.TorusKnotGeometry(0.48, 0.16, 64, 12),
    new THREE.MeshBasicMaterial({ color: 0x38bdf8 }),
  );
  right.position.x = 0.78;
  right.rotation.set(0.35, 0.25, 0.1);
  scene.add(left, right);

  const scenePass = pass(scene, camera);
  const sceneColor = scenePass.getTextureNode("output");
  const outputNode = vec4(sceneColor.rgb.mul(vec3(1.12, 0.72, 1.24)), sceneColor.a);
  const pipeline = new THREE.RenderPipeline(renderer);
  pipeline.outputNode = outputNode;
  assertPostProcessingProof(pipeline, sceneColor, outputNode);

  function frame() {
    pipeline.render();
    requestAnimationFrame(frame);
  }
  pipeline.render();
  requestAnimationFrame(frame);
  globalThis.__TN_CONFORMANCE = {
    ok: true,
    type: "postprocessing-pass",
    detail: { pipeline: "RenderPipeline", source: "PassNode", transformed: true },
  };
  return { renderer, scene, camera, pipeline, scenePass, left, right };
}

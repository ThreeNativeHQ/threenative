import * as THREE from "three/webgpu";
import { pass } from "three/tsl";
import { RenderChain } from "../../../../core/src/render/chain.ts";
import {
  VelocityTracker,
  readVelocityPreviousBoneMatrices,
  readVelocityPreviousMatrices,
  readVelocityPreviousWorldMatrix,
} from "../../../../core/src/render/velocity.ts";
import { createTemporalAA } from "../../../../create-threenative/templates/starter/src/render/temporalAA.ts";

// Shared browser/native content. The caller owns the renderer and sole frame loop.
export function createTemporalAAFixture(renderer, scene, camera, variant = "temporal") {
  scene.background = new THREE.Color(0x0d1630);
  camera.position.set(0, 0.3, 6);
  const sun = new THREE.DirectionalLight(0xffffff, 2.0);
  sun.position.set(2, 5, 3);
  scene.add(new THREE.HemisphereLight(0xb4d4ff, 0x303848, 1.5), sun);
  const white = new THREE.MeshStandardMaterial({ color: 0xe1eafa });
  const fence = new THREE.InstancedMesh(new THREE.BoxGeometry(0.012, 2.6, 0.02), white, 40);
  const matrix = new THREE.Matrix4();
  for (let index = 0; index < fence.count; index++) {
    fence.setMatrixAt(index, matrix.makeTranslation((index - 20) * 0.125, 0, -0.6));
  }
  scene.add(fence);
  const diagonal = new THREE.Mesh(new THREE.BoxGeometry(5.5, 0.02, 0.03), white);
  diagonal.rotation.z = 0.27;
  scene.add(diagonal);
  const rigid = new THREE.Mesh(new THREE.BoxGeometry(0.75, 0.9, 0.3), new THREE.MeshStandardMaterial({ color: 0xf0924e }));
  rigid.position.set(-1.5, 0.6, 0.4);
  scene.add(rigid);
  const instances = new THREE.InstancedMesh(new THREE.SphereGeometry(0.16, 12, 8), new THREE.MeshStandardMaterial({ color: 0x60ead6 }), 3);
  scene.add(instances);
  const geometry = new THREE.BoxGeometry(0.28, 1.4, 0.25, 1, 8, 1);
  const skinIndices = [];
  const skinWeights = [];
  for (let index = 0; index < geometry.attributes.position.count; index++) {
    const weight = THREE.MathUtils.clamp(geometry.attributes.position.getY(index) + 0.5, 0, 1);
    skinIndices.push(0, 1, 0, 0);
    skinWeights.push(1 - weight, weight, 0, 0);
  }
  geometry.setAttribute("skinIndex", new THREE.Uint16BufferAttribute(skinIndices, 4));
  geometry.setAttribute("skinWeight", new THREE.Float32BufferAttribute(skinWeights, 4));
  const character = new THREE.SkinnedMesh(geometry, new THREE.MeshStandardMaterial({ color: 0xdd72df }));
  const root = new THREE.Bone();
  const limb = new THREE.Bone();
  root.add(limb); character.add(root);
  character.bind(new THREE.Skeleton([root, limb]));
  character.position.set(1.4, 0.25, 0.5);
  scene.add(character);
  const scenePass = pass(scene, camera);
  const pipeline = new THREE.RenderPipeline(renderer);
  const tracker = new VelocityTracker();
  let temporal;
  const chain = new RenderChain({
    renderer: { kind: "webgpu", raw: renderer, setOutputNode: (node) => { pipeline.outputNode = node; }, clearOutputNode: () => {} },
    input: scenePass.getTextureNode("output"), worldPass: scenePass,
    request: { stages: variant === "reference" ? [] : ["traa"], velocity: { pass: scenePass } },
    stages: [{
      name: "traa",
      build: (input, context) => {
        temporal = createTemporalAA(input, scenePass.getTextureNode("depth"), context.velocityNode, camera);
        return temporal.node;
      },
      dispose: () => temporal?.dispose(),
    }],
  });
  if (variant === "reference") pipeline.outputNode = scenePass;
  let frame = 0;
  let resets = 0;
  let lastReset = null;
  const observation = () => ({
    frame, resets, lastReset, aa: temporal?.report() ?? null,
    stages: chain.applied.stages, velocity: chain.applied.velocity,
    rigidHistory: readVelocityPreviousWorldMatrix(rigid) !== undefined,
    skinnedHistory: readVelocityPreviousBoneMatrices(character) !== undefined,
    instancedHistory: readVelocityPreviousMatrices(instances) !== undefined,
  });
  const render = () => {
    rigid.position.x = -1.5 + Math.sin(frame / 18) * 0.65;
    limb.rotation.z = Math.sin(frame / 13) * 0.7;
    for (let index = 0; index < instances.count; index++) {
      instances.setMatrixAt(index, matrix.makeTranslation(-0.5 + index * 0.6, -0.9 + Math.sin(frame / 11 + index) * 0.22, 0.3));
    }
    instances.instanceMatrix.needsUpdate = true;
    camera.position.x = Math.sin(frame / 50) * 0.15 + (variant === "cut" && frame >= 20 ? 1.2 : 0);
    if (frame === 20 && variant === "cut") temporal?.resetHistory("camera-cut");
    if (frame === 20 && variant === "projection") { camera.fov = 65; camera.updateProjectionMatrix(); }
    if (frame === 20 && variant === "resize") { renderer.setSize(960, 540, false); camera.aspect = 960 / 540; camera.updateProjectionMatrix(); }
    tracker.update(scene);
    pipeline.render();
    tracker.commit(scene);
    const result = temporal?.report();
    if (result?.resetReason) { resets += 1; lastReset = result; }
    frame += 1;
  };
  return {
    render, observation,
    dispose: () => {
      chain.dispose(); tracker.clear(); scenePass.dispose(); pipeline.dispose();
      const geometries = new Set();
      const materials = new Set();
      scene.traverse((object) => { if (object.geometry) geometries.add(object.geometry); if (object.material) materials.add(object.material); });
      for (const item of geometries) item.dispose();
      for (const item of materials) item.dispose();
      character.skeleton.dispose();
    },
  };
}

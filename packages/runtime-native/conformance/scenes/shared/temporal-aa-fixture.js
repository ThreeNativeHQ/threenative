import * as THREE from "three/webgpu";
import { mrt, pass, texture, vec2 } from "three/tsl";
import { RenderChain } from "../../../../core/src/render/chain.ts";
import {
  VelocityTracker,
  readVelocityPreviousBoneMatrices,
  readVelocityPreviousMatrices,
  readVelocityPreviousWorldMatrix,
} from "../../../../core/src/render/velocity.ts";
import { createTemporalAA } from "../../../../create-threenative/templates/starter/src/render/temporalAA.ts";
import { createTemporalVelocityProbe } from "./temporal-velocity-probe.ts";

// Shared browser/native content. The caller owns the renderer and sole frame loop.
export function createTemporalAAFixture(renderer, scene, camera, variant = "temporal", measurement = false) {
  const policy = variant.replace(/-open$/u, "");
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
  // Diagnostic only: clone inherits usage. This isolates previous-buffer upload policy while
  // current geometry and its authored per-frame needsUpdate remain identical.
  if (variant === "dynamic-instances") instances.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
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
  // Saturated foreground is a measurable history marker. Removing it reveals the actual scene,
  // including thin geometry; no reset is requested because this is ordinary disocclusion.
  const occluder = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 0.8), new THREE.MeshBasicMaterial({ color: 0xff0000 }));
  occluder.position.set(0.25, 0.45, 1.3);
  if (measurement) scene.add(occluder);
  const scenePass = pass(scene, camera);
  const pipeline = new THREE.RenderPipeline(renderer);
  const tracker = new VelocityTracker();
  let temporal;
  let setupCount = 0;
  let setupDuringJitter = 0;
  const chain = new RenderChain({
    renderer: { kind: "webgpu", raw: renderer, setOutputNode: (node) => { pipeline.outputNode = node; }, clearOutputNode: () => {} },
    input: scenePass.getTextureNode("output"), worldPass: scenePass,
    request: { stages: variant === "reference" ? [] : ["traa"], velocity: { pass: scenePass } },
    stages: [{
      name: "traa",
      build: (input, context) => {
        temporal = createTemporalAA(input, scenePass.getTextureNode("depth"), context.velocityNode, camera);
        // Diagnostic: normalized depth range is at most 1, so only the upstream edge bypass
        // is disabled. Its disocclusion threshold and history blend remain identical.
        if (policy === "strict-rejection") temporal.node.edgeDepthDiff = 1;
        // Causal probe only: suppress bilinear diffusion of repeatedly reprojected history.
        // Nearest sampling can introduce motion snapping; it is not a proposed quality policy.
        if (policy === "nearest-history") {
          temporal.node._historyRenderTarget.texture.minFilter = THREE.NearestFilter;
          temporal.node._historyRenderTarget.texture.magFilter = THREE.NearestFilter;
        }
        const setup = temporal.node.setup.bind(temporal.node);
        temporal.node.setup = (builder) => {
          setupCount++;
          if (camera.view?.enabled) setupDuringJitter++;
          const result = setup(builder);
          if (policy === "unchecked-history") {
          // Fixture-only negative control: actually render an unchecked 95% history blend.
          // This bypasses depth rejection AND neighbourhood clipping; it is not a product mode
          // and does not isolate either mechanism's individual contribution.
            temporal.node._resolveMaterial.colorNode = temporal.node.beautyNode.mul(0.05).add(texture(temporal.node._historyRenderTarget.texture).mul(0.95));
          }
          return result;
        };
        return temporal.node;
      },
      dispose: () => temporal?.dispose(),
    }],
  });
  if (variant === "zero-velocity") scenePass.setMRT(scenePass.getMRT().merge(mrt({ velocity: vec2(0) })));
  if (variant === "reference") pipeline.outputNode = scenePass;
  const probeMatrix = new THREE.Matrix4();
  const frontTriangle = geometry.groups[4].start + 18;
  const velocityProbe = measurement && variant !== "reference" ? createTemporalVelocityProbe(renderer, scene, camera, scenePass, () => {
    const skinned = new THREE.Vector3();
    for (let corner = 0; corner < 3; corner++) skinned.add(character.getVertexPosition(geometry.index.getX(frontTriangle + corner), new THREE.Vector3()));
    skinned.multiplyScalar(1 / 3).applyMatrix4(character.matrixWorld);
    instances.getMatrixAt(0, probeMatrix);
    return {
      rigid: new THREE.Vector3(0, 0, 0.15).applyMatrix4(rigid.matrixWorld),
      instance: new THREE.Vector3(0, 0, 0.16).applyMatrix4(probeMatrix).applyMatrix4(instances.matrixWorld),
      skinned,
    };
  }) : null;
  let frame = 0;
  let instanceDraw = null;
  let instanceUploads = [];
  let readbackAttributes = [];
  const attributeIds = new WeakMap();
  let nextAttributeId = 0;
  const attributeId = (attribute) => {
    if (!attributeIds.has(attribute)) attributeIds.set(attribute, ++nextAttributeId);
    return attributeIds.get(attribute);
  };
  const originalCreateAttribute = renderer.backend.createAttribute;
  const originalUpdateAttribute = renderer.backend.updateAttribute;
  const recordUpload = (method, attribute) => {
    const data = attribute.isInterleavedBufferAttribute ? attribute.data : attribute;
    if (frame >= 21 && frame <= 23 && data.array.length === instances.count * 16) {
      instanceUploads.push({
        method, wrapperId: attributeId(attribute), callId: renderer.info.render.calls,
        bufferExists: renderer.backend.get(data).buffer !== undefined,
        bufferUuid: data.uuid ?? null, version: data.version,
        isCurrent: data.array === instances.instanceMatrix.array, values: Array.from(data.array),
      });
    }
  };
  const observedCreateAttribute = function (attribute, ...args) {
    recordUpload("create", attribute);
    return originalCreateAttribute.call(this, attribute, ...args);
  };
  const observedUpdateAttribute = function (attribute, ...args) {
    recordUpload("update", attribute);
    return originalUpdateAttribute.call(this, attribute, ...args);
  };
  // Fixture-only observation of the actual compiled draw. Unlike getShaderAsync(), this never
  // compiles an extra pass or advances previous-frame bookkeeping while inspecting the shader.
  const originalDraw = renderer.backend.draw;
  const observedDraw = function (renderObject, ...args) {
    if (renderObject.object === instances && frame >= 21 && frame <= 23) {
      const state = renderObject.getNodeBuilderState();
      const matrixAttributes = state.nodeAttributes.filter(({ node }) => node?.attribute?.data?.stride === 16);
      const unique = new Set();
      readbackAttributes = matrixAttributes.map(({ node }) => node.attribute).filter((attribute) => {
        if (unique.has(attribute.data)) return false;
        unique.add(attribute.data);
        return true;
      });
      instanceDraw = {
        frame: frame + 1, callId: renderer.info.render.calls,
        objectUuid: instances.uuid,
        matrixId: instances.instanceMatrix.id,
        vertexShader: state.vertexShader,
        beforeEvents: state.updateBeforeNodes.map((node) => node.eventType ?? node.constructor.name),
        attributes: matrixAttributes.map(({ name, node }) => ({
          name, wrapperId: attributeId(node.attribute),
          attributeCall: renderer._geometries.attributeCall.get(node.attribute) ?? null,
          bufferCall: renderer._geometries.attributeCall.get(node.attribute.data) ?? null,
          bufferUuid: node.attribute.data.uuid, version: node.attribute.data.version,
          isCurrent: node.attribute.data.array === instances.instanceMatrix.array,
          values: Array.from(node.attribute.data.array),
        })),
      };
    }
    return originalDraw.call(this, renderObject, ...args);
  };
  if (variant === "recompile") {
    renderer.backend.draw = observedDraw;
    renderer.backend.createAttribute = observedCreateAttribute;
    renderer.backend.updateAttribute = observedUpdateAttribute;
  }
  let resets = 0;
  let lastReset = null;
  const observation = () => ({
    frame, resets, lastReset, aa: temporal?.report() ?? null, instanceDraw, instanceUploads,
    measurement, variant, setupCount, setupDuringJitter, occluderVisible: measurement && occluder.visible,
    pose: { cameraX: camera.position.x, rigidX: rigid.position.x, limbZ: limb.rotation.z },
    velocityProbe: velocityProbe?.observation() ?? null,
    historyValues: measurement ? {
      instances: Array.from(instances.instanceMatrix.array),
      previousInstances: Array.from(readVelocityPreviousMatrices(instances) ?? []),
      bones: Array.from(character.skeleton.boneMatrices),
      previousBones: Array.from(readVelocityPreviousBoneMatrices(character) ?? []),
    } : null,
    stages: chain.applied.stages, velocity: chain.applied.velocity,
    rigidHistory: readVelocityPreviousWorldMatrix(rigid) !== undefined,
    skinnedHistory: readVelocityPreviousBoneMatrices(character) !== undefined,
    instancedHistory: readVelocityPreviousMatrices(instances) !== undefined,
  });
  const render = () => {
    instanceDraw = null;
    instanceUploads = [];
    readbackAttributes = [];
    if (variant === "recompile" && frame === 22) renderer.contextNode.needsUpdate = true;
    if (measurement) occluder.visible = frame < 28 && !variant.endsWith("-open");
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
    velocityProbe?.before();
    pipeline.render();
    tracker.commit(scene);
    const result = temporal?.report();
    if (result?.resetReason) { resets += 1; lastReset = result; }
    frame += 1;
  };
  return {
    render, observation,
    sampleVelocity: async () => {
      await velocityProbe?.read();
      if (instanceDraw !== null) {
        instanceDraw.gpuValues = [];
        for (const attribute of readbackAttributes) {
          const bytes = await renderer.getArrayBufferAsync(attribute);
          instanceDraw.gpuValues.push({
            wrapperId: attributeId(attribute), bufferUuid: attribute.data.uuid,
            isCurrent: attribute.data.array === instances.instanceMatrix.array,
            values: Array.from(new Float32Array(bytes)),
          });
        }
      }
    },
    dispose: () => {
      if (renderer.backend.draw === observedDraw) renderer.backend.draw = originalDraw;
      if (renderer.backend.createAttribute === observedCreateAttribute) renderer.backend.createAttribute = originalCreateAttribute;
      if (renderer.backend.updateAttribute === observedUpdateAttribute) renderer.backend.updateAttribute = originalUpdateAttribute;
      velocityProbe?.dispose();
      chain.dispose(); tracker.clear(); scenePass.dispose(); pipeline.dispose();
      const geometries = new Set();
      const materials = new Set();
      scene.traverse((object) => { if (object.geometry) geometries.add(object.geometry); if (object.material) materials.add(object.material); });
      for (const item of geometries) item.dispose();
      for (const item of materials) item.dispose();
      character.skeleton.dispose();
      if (!measurement) { occluder.geometry.dispose(); occluder.material.dispose(); }
    },
  };
}

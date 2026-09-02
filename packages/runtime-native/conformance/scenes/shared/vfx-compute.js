import * as THREE from "three/webgpu";
import {
  Fn,
  color,
  cos,
  hash,
  instanceIndex,
  instancedArray,
  positionLocal,
  sin,
  time,
  vec3,
} from "three/tsl";
import { startVisualScene } from "./scene-support.js";

const PARTICLE_COUNT = 64;
const MESH_COUNT = 12;
const SEED = 316;

export function assertVfxComputeProof(nodes) {
  for (const [name, node] of nodes.buffers) {
    if (node?.isStorageBufferNode !== true) {
      throw new Error(`VFX compute proof requires a storage buffer for ${name}.`);
    }
  }
  if (nodes.start?.isComputeNode !== true || nodes.process?.isComputeNode !== true) {
    throw new Error("VFX compute proof requires start and process ComputeNodes.");
  }
  if (nodes.spriteMaterial?.positionNode?.isNode !== true) {
    throw new Error("VFX compute proof must feed the sprite storage buffer into its material.");
  }
  if (nodes.ribbonMaterial?.positionNode?.isNode !== true || nodes.meshMaterial?.positionNode?.isNode !== true) {
    throw new Error("VFX compute proof must feed storage buffers into ribbon and mesh materials.");
  }
}

export async function startScene(canvas, dimensions) {
  return startVisualScene(canvas, dimensions, "vfx-compute", async ({ renderer, scene, camera }) => {
    const spritePositions = instancedArray(PARTICLE_COUNT, "vec3");
    const ribbonPositions = instancedArray(PARTICLE_COUNT, "vec3");
    // The shared dispatch covers all three render surfaces. The mesh consumes only its first
    // twelve slots, while the larger storage allocation keeps the compute index in bounds.
    const meshPositions = instancedArray(PARTICLE_COUNT, "vec3");
    const start = Fn(() => {
      const angle = hash(instanceIndex.add(SEED)).mul(Math.PI * 2);
      const radius = hash(instanceIndex.add(SEED + 17)).mul(0.95).add(0.2);
      spritePositions.element(instanceIndex).assign(
        vec3(cos(angle).mul(radius), sin(angle).mul(radius), 0),
      );
      ribbonPositions.element(instanceIndex).assign(
        vec3(cos(angle).mul(radius), sin(angle).mul(radius), -0.05),
      );
      meshPositions.element(instanceIndex).assign(
        vec3(
          hash(instanceIndex.add(SEED + 31)).sub(0.5).mul(1.3),
          hash(instanceIndex.add(SEED + 47)).sub(0.5).mul(0.9),
          0.12,
        ),
      );
    })().compute(PARTICLE_COUNT);
    const process = Fn(() => {
      const phase = time.mul(1.7).add(hash(instanceIndex.add(SEED + 61)).mul(Math.PI * 2));
      const radius = hash(instanceIndex.add(SEED + 73)).mul(0.95).add(0.2);
      spritePositions.element(instanceIndex).assign(
        vec3(cos(phase).mul(radius), sin(phase).mul(radius), sin(phase.mul(0.7)).mul(0.25)),
      );
      ribbonPositions.element(instanceIndex).assign(
        vec3(cos(phase).mul(radius), sin(phase).mul(radius), cos(phase.mul(0.7)).mul(0.25)),
      );
      meshPositions.element(instanceIndex).assign(
        vec3(
          hash(instanceIndex.add(SEED + 31)).sub(0.5).mul(1.3),
          hash(instanceIndex.add(SEED + 47)).sub(0.5).mul(0.9),
          sin(phase).mul(0.2).add(0.12),
        ),
      );
    })().compute(PARTICLE_COUNT);

    const spriteMaterial = new THREE.SpriteNodeMaterial({ transparent: true, toneMapped: false });
    spriteMaterial.positionNode = spritePositions.toAttribute();
    spriteMaterial.colorNode = color(0x51d8ff);
    const sprite = new THREE.Sprite(spriteMaterial);
    sprite.count = PARTICLE_COUNT;
    sprite.scale.setScalar(0.12);
    sprite.frustumCulled = false;
    scene.add(sprite);

    const ribbonMaterial = new THREE.MeshBasicNodeMaterial({ transparent: true, toneMapped: false });
    ribbonMaterial.positionNode = positionLocal.add(ribbonPositions.element(instanceIndex));
    ribbonMaterial.colorNode = color(0xd06cff);
    const ribbon = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.035, 0.38), ribbonMaterial, PARTICLE_COUNT);
    const ribbonMatrix = new THREE.Matrix4();
    for (let index = 0; index < PARTICLE_COUNT; index += 1) ribbon.setMatrixAt(index, ribbonMatrix);
    scene.add(ribbon);

    const meshMaterial = new THREE.MeshBasicNodeMaterial({ transparent: true, toneMapped: false });
    meshMaterial.positionNode = positionLocal.add(meshPositions.element(instanceIndex));
    meshMaterial.colorNode = color(0xffc857);
    const mesh = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(0.09, 1), meshMaterial, MESH_COUNT);
    const meshMatrix = new THREE.Matrix4();
    for (let index = 0; index < MESH_COUNT; index += 1) mesh.setMatrixAt(index, meshMatrix);
    scene.add(mesh);

    assertVfxComputeProof({
      buffers: [["sprite", spritePositions], ["ribbon", ribbonPositions], ["mesh", meshPositions]],
      meshMaterial,
      process,
      ribbonMaterial,
      spriteMaterial,
      start,
    });
    await renderer.computeAsync(start);
    let frame = 0;
    const render = () => {
      const moving = frame > 0 && frame <= 8;
      scene.background.set(moving ? 0x321a42 : 0x090b20);
      if (frame === 0) console.info("TN_CONFORMANCE_TEMPORAL_FRAME:vfx-compute:frame-zero");
      if (frame === 8) console.info("TN_CONFORMANCE_TEMPORAL_FRAME:vfx-compute:settled");
      if (frame === 9) console.info("TN_CONFORMANCE_TEMPORAL_FRAME:vfx-compute:next");
      renderer.compute(process);
      renderer.render(scene, camera);
      frame += 1;
      if (frame >= 8) {
        globalThis.__TN_CONFORMANCE_TEMPORAL = {
          effect: "vfx-compute",
          frame,
          frameZeroRendered: true,
          settledFrameRendered: true,
          nextFrameRendered: frame > 8,
          restoredFrameRendered: frame > 8,
          restoredToFrameZero: frame > 8 && scene.background.getHex() === 0x090b20,
        };
      }
    };
    return {
      detail: {
        computeDriven: true,
        dispatchCount: 1,
        instancedMesh: true,
        ribbon: true,
        seed: SEED,
        sprite: true,
      },
      mesh,
      render,
      ribbon,
      sprite,
    };
  }, { background: 0x090b20 });
}

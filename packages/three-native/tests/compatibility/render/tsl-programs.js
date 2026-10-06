import { RenderPipeline } from "three";
import {
  Fn,
  float,
  instanceIndex,
  instancedArray,
  length,
  normalViewGeometry,
  normalize,
  pass,
  positionLocal,
  screenUV,
  sin,
  uint,
  uniform,
  uv,
  vec2,
  vec3,
  vec4,
} from "three/tsl";
import { FluidParticles3D } from "/core/fluid-particles.js";
/**
 * The TSL programs a render fixture's `tsl` op applies, authored in upstream TSL. Each has a C++
 * twin of the same name in runtime-native/tests/native-engine/fixture/tsl_programs.h, authored with
 * the native TSL builder; the fixture's golden is what this one draws.
 */
import { GPUParticles3D } from "/core/particles.js";

/**
 * PRD-513: a post pass over the scene texture: a 2-texel chromatic split (texel centres, so the
 * sampler's filter cannot matter) and a radial vignette, before the output transform.
 */
function chromatic(renderer, scene, camera) {
  const pipeline = new RenderPipeline(renderer);
  const color = pass(scene, camera).getTextureNode();
  const offset = vec2(2 / 320, 0);
  const r = color.sample(screenUV.add(offset)).x;
  const g = color.sample(screenUV).y;
  const b = color.sample(screenUV.sub(offset)).z;
  const vignette = float(1).sub(length(screenUV.sub(0.5)).mul(0.6));
  pipeline.outputNode = vec4(vec3(r, g, b).mul(vignette), 1);
  return pipeline;
}

export const GRID_COUNT = 10_000;

const PARTICLE_COUNT = 12;
const PARTICLE_STEPS = 10;

// Game-owned appearance deliberately varies over UVs; the native twin consumes this same graph.
function particleMaterial(material) {
  material.colorNode = vec4(uv(), 0.35, 1);
  material.opacityNode = float(0.8);
}
function replaceSprite(target, sprite, scene) {
  sprite.position.copy(target.position);
  sprite.quaternion.copy(target.quaternion);
  sprite.scale.copy(target.scale);
  sprite.center.copy(target.center);
  sprite.frustumCulled = false;
  scene.remove(target);
  scene.add(sprite);
}

/** Drive the shipped game API, never an ordinary directional shadow disguised as VSM. */
async function virtualShadow({ target, renderer, scene, camera }, cut = false) {
  const { VirtualShadowNode } = await import("/core/virtual-shadow.js");
  target.shadow.shadowNode = new VirtualShadowNode(target, {
    clipExtents: [8, 24],
    mapSize: 256,
    lightDistance: 20,
    depthRange: 40,
    selectionGuard: 0.9,
    refreshStep: 0,
    invalidationDelay: 0,
    adaptiveRefresh: false,
    adaptiveCasterGate: false,
    minCasterTexels: 0,
    followViewFocus: false,
    receiverPlaneBias: true,
    shadowLodBias: false,
    marker: false,
  });
  // Warm both levels at the capture's eye position: a rotation cut must reuse these page keys.
  for (let i = 0; i < 2; ++i) {
    renderer.render(scene, camera);
    await renderer.backend.device.queue.onSubmittedWorkDone();
  }
  if (cut) {
    // Index-only edits leave caster bounds/position versions intact. Cached maps still hold
    // the wide box; a fresh map sees only degenerate triangles, leaving the floor unshadowed.
    const geometry = scene.getObjectByName("cutCaster").geometry;
    geometry.setIndex(new Array(geometry.index.count).fill(0));
    camera.lookAt(0, 0.4, 0);
    camera.updateMatrixWorld(true);
    target.shadow.shadowNode.invalidateAll();
  }
}

export const programs = {
  async "vsm-basic"(context) {
    await virtualShadow(context);
  },
  async "vsm-cut"(context) {
    await virtualShadow(context, true);
  },
  async "vsm-deformation"({ target }) {
    target.positionNode = positionLocal.add(vec3(0, 0, sin(positionLocal.x.mul(2)).mul(0.4)));
  },
  async "particles-sprite"({ target, scene, renderer }) {
    const material = target.material;
    particleMaterial(material);
    const particles = new GPUParticles3D({
      amount: PARTICLE_COUNT,
      material,
      start: (buffers) =>
        Fn(() => {
          const row = instanceIndex.div(uint(4));
          const col = instanceIndex.sub(row.mul(uint(4)));
          buffers.positions.element(instanceIndex).assign(
            vec3(
              float(col).sub(1.5).mul(1.1),
              float(row).sub(1).mul(0.85),
              float(instanceIndex.mod(uint(3)))
                .sub(1)
                .mul(0.2),
            ),
          );
          buffers.velocities.element(instanceIndex).assign(vec3(0.1, 0.25, -0.08));
        })().compute(PARTICLE_COUNT),
      process: (buffers) =>
        Fn(() => {
          const velocity = buffers.velocities.element(instanceIndex);
          buffers.positions
            .element(instanceIndex)
            .assign(buffers.positions.element(instanceIndex).add(velocity.mul(1 / 60)));
          velocity.assign(velocity.add(vec3(0, -1.2 / 60, 0)));
        })().compute(PARTICLE_COUNT),
    });
    replaceSprite(target, particles, scene);
    particles.attachRenderer(renderer);
    for (let i = 0; i < PARTICLE_STEPS; ++i) particles.process(renderer);
    await renderer.backend.device.queue.onSubmittedWorkDone();
  },
  async "fluid-particles"({ target, scene, renderer }) {
    if (renderer.backend.isWebGPUBackend !== true) throw new Error("fluid fixture needs WebGPU");
    // IRendererLike uses kind/compute/readback; Three's raw renderer does not implement kind.
    const attached = {
      kind: "webgpu",
      compute: (node) => renderer.compute(node),
      readback: (attribute) => renderer.getArrayBufferAsync(attribute),
    };
    const fluid = new FluidParticles3D({
      capacity: PARTICLE_COUNT,
      bounds: { min: [-1, -1, -1], max: [1, 1, 1] },
      voxelSize: 0.25,
    });
    particleMaterial(target.material);
    target.material.positionNode = fluid.positions.toAttribute().xyz;
    target.count = PARTICLE_COUNT;
    target.frustumCulled = false;
    scene.add(fluid);
    fluid.attachRenderer(attached);
    for (let i = 0; i < PARTICLE_COUNT; ++i) {
      if (
        !fluid.emit(
          [
            ((i % 3) - 1) * 0.1,
            ((Math.floor(i / 3) % 2) - 0.5) * 0.1,
            (Math.floor(i / 6) - 0.5) * 0.1,
          ],
          [0.1 + (i % 3) * 0.07, 0.25, -0.08 + Math.floor(i / 6) * 0.1],
        )
      )
        throw new Error("fluid fixture emission refused");
    }
    for (let i = 0; i < PARTICLE_STEPS; ++i) fluid.process();
    await renderer.backend.device.queue.onSubmittedWorkDone();
  },
  async "nodemat-color-uv"({ target }) {
    target.colorNode = vec4(uv(), uniform(0.35).setName("nodeTint"), 1);
  },
  async "nodemat-standard-nodes"({ target }) {
    target.roughnessNode = uv().x.mul(0.7).add(0.2);
    target.metalnessNode = uv().y.mul(0.8);
    target.emissiveNode = vec3(sin(uv().x.mul(8)).mul(0.15).add(0.15), 0, 0);
  },
  async "nodemat-normal-opacity"({ target }) {
    target.normalNode = normalize(
      normalViewGeometry.add(vec3(sin(uv().x.mul(10)).mul(0.35), 0, 0)),
    );
    target.opacityNode = uv().y.mul(0.6).add(0.2);
  },
  /**
   * PRD-513: a compute pass writes 10,000 instance positions on a 100 x 100 grid with a wave, and
   * the material's positionNode places each instance at its own entry.
   */
  async "storage-instances"({ target, renderer }) {
    const positions = instancedArray(GRID_COUNT, "vec4").setName("positions");
    const time = uniform(0.75);
    const kernel = Fn(() => {
      const row = instanceIndex.div(uint(100));
      const column = float(instanceIndex.sub(row.mul(uint(100))));
      positions
        .element(instanceIndex)
        .assign(vec4(column.mul(0.5), sin(column.mul(0.25).add(time)), float(row).mul(0.5), 1));
    })().compute(GRID_COUNT);
    await renderer.computeAsync(kernel);
    target.positionNode = positionLocal.add(positions.element(instanceIndex).xyz);
  },

  async "post-chromatic"({ renderer, scene, camera }) {
    const pipeline = chromatic(renderer, scene, camera);
    return { render: () => pipeline.render() };
  },

  /** The same pass, drawn once at 200 x 150 first: the captured frame is the one after a resize. */
  async "post-chromatic-resized"({ renderer, scene, camera, width, height }) {
    const pipeline = chromatic(renderer, scene, camera);
    renderer.setSize(200, 150, false);
    pipeline.render();
    await renderer.backend.device.queue.onSubmittedWorkDone();
    renderer.setSize(width, height, false);
    return { render: () => pipeline.render() };
  },

  /** PRD-512: a plane bent by a sine wave along its own z, which its shadow must follow. */
  async "wave-plane"({ target }) {
    target.positionNode = positionLocal.add(vec3(0, 0, sin(positionLocal.x.mul(2)).mul(0.4)));
  },
};

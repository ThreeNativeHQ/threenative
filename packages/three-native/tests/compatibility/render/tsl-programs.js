/**
 * The TSL programs a render fixture's `tsl` op applies, authored in upstream TSL. Each has a C++
 * twin of the same name in runtime-native/tests/native-engine/fixture/tsl_programs.h, authored with
 * the native TSL builder; the fixture's golden is what this one draws.
 */
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

export const programs = {
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

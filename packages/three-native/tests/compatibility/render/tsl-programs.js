/**
 * The TSL programs a render fixture's `tsl` op applies, authored in upstream TSL. Each has a C++
 * twin of the same name in runtime-native/tests/native-engine/fixture/tsl_programs.h, authored with
 * the native TSL builder; the fixture's golden is what this one draws.
 */
import {
  Fn,
  float,
  instanceIndex,
  instancedArray,
  positionLocal,
  sin,
  uint,
  uniform,
  vec3,
  vec4,
} from "three/tsl";

export const GRID_COUNT = 10_000;

export const programs = {
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

  /** PRD-512: a plane bent by a sine wave along its own z, which its shadow must follow. */
  async "wave-plane"({ target }) {
    target.positionNode = positionLocal.add(vec3(0, 0, sin(positionLocal.x.mul(2)).mul(0.4)));
  },
};

// TSL authoring calls the native lazy graph; no upstream shader implementation enters the player.
import { liveUniforms } from "../../../../three-native/src/tsl-uniforms.ts";

// three's `uniform.value = x` (shared with the Wasm back end): a number goes through at once; an
// edited Color or VectorN goes through `syncUniforms`, which the renderer calls before each frame.
const live = liveUniforms(globalThis.tsl.uniform, (node, lanes) => globalThis.tsl.setUniform(node, ...lanes));
export const uniform = live.uniform;
export const syncUniforms = live.sync;
export const {
  float, int, uint, vec2, vec3, vec4, attribute, uv, texture, Fn, If, Loop,
  instancedArray, add, sub, mul, div, negate, lessThan, greaterThan, equal, abs, sin, cos,
  floor, fract, sqrt, exp, exp2, log2, normalize, length, min, max, pow, step, dot,
  distance, cross, mix, clamp, smoothstep, select, positionLocal, positionWorld,
  normalViewGeometry, instanceIndex, cameraViewMatrix, color, ivec2, nodeObject, reflect, textureLoad,
  convertToTexture, screenUV, materialColor, materialEmissive, materialMetalness, materialRoughness,
} = globalThis.tsl;

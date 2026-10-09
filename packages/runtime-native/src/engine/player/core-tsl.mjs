// TSL authoring calls the native lazy graph; no upstream shader implementation enters the player.
import { liveUniforms } from "../../../../three-native/src/tsl-uniforms.ts";
import { defineReflector } from "../../../../three-native/src/reflector.ts";
import { definePass } from "../../../../three-native/src/pass-node.ts";
import { Object3D, PerspectiveCamera } from "./core-three.mjs";

// three's `uniform.value = x` (shared with the Wasm back end): a number goes through at once; an
// edited Color or VectorN goes through `syncUniforms`, which the renderer calls before each frame.
const live = liveUniforms(globalThis.tsl.uniform, (node, lanes) => globalThis.tsl.setUniform(node, ...lanes));
export const uniform = live.uniform;
export const uniformArray = live.uniformArray;
export const syncUniforms = live.sync;

export const {
  float, int, uint, vec2, vec3, vec4, attribute, uv, texture, Fn, If, Loop,
  instancedArray, add, sub, mul, div, negate, lessThan, greaterThan, equal, abs, sin, cos,
  floor, fract, sqrt, exp, exp2, log2, normalize, length, min, max, pow, step, dot,
  distance, cross, mix, clamp, smoothstep, select, positionLocal, positionWorld,
  normalViewGeometry, instanceIndex, cameraViewMatrix, color, ivec2, nodeObject, reflect, textureLoad,
  mx_noise_float, mx_worley_noise_vec2, pmremTexture,
  convertToTexture, screenUV, materialColor, materialEmissive, materialMetalness, materialRoughness,
  cameraPosition, cameraProjectionMatrix, cameraWorldMatrix, positionGeometry, normalWorld, varying,
  cameraNear, cameraFar, viewportSharedTexture, viewportDepthTexture, linearDepth, viewportLinearDepth,
} = globalThis.tsl;
export const {
  oneMinus, screenCoordinate, normalGeometry, tangentGeometry, positionViewDirection, dFdx, dFdy, lengthSq,
  atan, mod, fwidth, saturation, mat2, hash, time, transformDirection,
} = globalThis.tsl;

// three's pass(), mrt() and MRT slots over the player's one scene pass (shared with the Wasm back
// end); the player draws the scene and camera a pass is pointed at.
export const { pass, mrt, output, normalView, metalness, roughness } = definePass(globalThis.tsl, (scene, camera) => {
  globalThis.tn.scene = scene;
  globalThis.tn.camera = camera;
});

export const reflector = defineReflector(globalThis.tsl.reflector, { Object3D, PerspectiveCamera });

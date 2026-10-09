// TSL authoring calls the native lazy graph; no upstream shader implementation enters the player.
import { liveUniforms } from "../../../../three-native/src/tsl-uniforms.ts";
import { defineReflector } from "../../../../three-native/src/reflector.ts";
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
} = globalThis.tsl;

// MRT slots: the names a scene pass writes beside its colour. They mark an `mrt()` output only;
// the native scene pass produces colour, depth and view normals, and nothing reads these as nodes.
const slot = (name) => Object.freeze({ isMRTSlot: true, name });
export const output = slot("output");
export const normalView = slot("normalView");
export const metalness = slot("metalness");
export const roughness = slot("roughness");

export function mrt(outputs) {
  for (const [name, value] of Object.entries(outputs))
    if (value?.isMRTSlot !== true || (name !== value.name && !(name === "normal" && value === normalView)))
      throw new Error(`TN_NATIVE_MRT_UNSUPPORTED: ${name} must be one of output, normal: normalView, metalness, roughness`);
  return Object.freeze({ isMRTNode: true, outputs: Object.freeze({ ...outputs }) });
}

// three's PassNode over the player's own scene pass: its targets are the renderer's colour
// ("output"), depth and, with an MRT that asks for it, view normals. The player draws one scene
// pass, so the scene and camera a pass is pointed at are what the player draws.
class PassNode {
  isPassNode = true;
  #mrt = null;
  #scene;
  #camera;
  constructor(scene, camera) {
    this.scene = scene;
    this.camera = camera;
  }
  get scene() { return this.#scene; }
  set scene(value) { this.#scene = globalThis.tn.scene = value; }
  get camera() { return this.#camera; }
  set camera(value) { this.#camera = globalThis.tn.camera = value; }
  setMRT(value) {
    if (value !== null && value?.isMRTNode !== true) throw new Error("TN_NATIVE_MRT_UNSUPPORTED: setMRT takes mrt()");
    this.#mrt = value;
    return this;
  }
  getMRT() { return this.#mrt; }
  getTextureNode(name = "output") {
    if (name === "output") return texture({ name: "scene" }, uv());
    if (name === "depth") return texture({ name: "depth" }, uv());
    if (name === "normal" && this.#mrt?.outputs.normal === normalView) return texture({ name: "normal" }, uv());
    throw new Error(`TN_NATIVE_PASS_TEXTURE_UNSUPPORTED: the native scene pass has no '${name}' target`);
  }
  dispose() {}
}
export const pass = (scene, camera) => new PassNode(scene, camera);

export const reflector = defineReflector(globalThis.tsl.reflector, { Object3D, PerspectiveCamera });

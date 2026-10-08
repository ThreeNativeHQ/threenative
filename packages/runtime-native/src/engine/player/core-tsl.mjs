// TSL authoring calls the native lazy graph; no upstream shader implementation enters the player.
export const {
  float, int, uint, vec2, vec3, vec4, uniform, attribute, uv, texture, Fn, If, Loop,
  instancedArray, add, sub, mul, div, negate, lessThan, greaterThan, equal, abs, sin, cos,
  floor, fract, sqrt, exp, exp2, log2, normalize, length, min, max, pow, step, dot,
  distance, cross, mix, clamp, smoothstep, select, positionLocal, positionWorld,
  normalViewGeometry, instanceIndex, cameraViewMatrix, color, ivec2, nodeObject, reflect, textureLoad,
  convertToTexture, screenUV, materialColor, materialEmissive, materialMetalness, materialRoughness,
  cameraPosition, cameraProjectionMatrix, cameraWorldMatrix, positionGeometry, normalWorld, varying,
} = globalThis.tsl;

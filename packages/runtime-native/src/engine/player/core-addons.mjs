// three/addons/tsl/display's GTAO, Denoise, SMAA and Bloom as the engine's live effects. Each returns
// the effect's node; its scalar uniforms read and write the native effect (`ao(...).radius.value`).
const { ao: nativeAo, denoise: nativeDenoise, smaa: nativeSmaa, bloom: nativeBloom } = globalThis.tsl;

function uniforms(node, names) {
  for (const name of names)
    Object.defineProperty(node, name, { configurable: true, value: Object.freeze({
      get value() { return node.__effect(name); },
      set value(value) { node.__effect(name, value); },
    }) });
  return node;
}

export function ao(depthNode, normalNode, camera) {
  const node = uniforms(nativeAo(depthNode, normalNode ?? null, camera),
    ["radius", "thickness", "distanceExponent", "distanceFallOff", "scale", "samples"]);
  Object.defineProperty(node, "resolutionScale", { configurable: true,
    get() { return node.__effect("resolutionScale"); },
    set(value) { node.__effect("resolutionScale", value); } });
  node.getTextureNode = () => node;
  return node;
}

export const denoise = (node, depthNode, normalNode, camera) =>
  uniforms(nativeDenoise(node, depthNode, normalNode ?? null, camera), ["lumaPhi", "depthPhi", "normalPhi", "radius", "index"]);

export const smaa = (node) => nativeSmaa(node);

export const bloom = (node, strength, radius, threshold) => nativeBloom(node, strength, radius, threshold);

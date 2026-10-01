import { DataTexture, MeshStandardMaterial, SRGBColorSpace } from "three";

// Bounded PBR test images qualify interchange; they are not the five starter worlds' final art.
function texture(role) {
  const size = 16;
  const pixels = new Uint8Array(size * size * 4);
  const palette = {
    colour: [
      [80, 105, 60, 255],
      [120, 150, 85, 255],
    ],
    normal: [
      [128, 128, 255, 255],
      [128, 128, 255, 255],
    ],
    roughness: [
      [185, 185, 185, 255],
      [225, 225, 225, 255],
    ],
    ao: [
      [220, 220, 220, 255],
      [255, 255, 255, 255],
    ],
  }[role];
  if (!palette) throw new Error(`Unknown fixture texture role '${role}'`);
  for (let z = 0; z < size; z++)
    for (let x = 0; x < size; x++)
      pixels.set(palette[((x >> 2) + (z >> 2)) % 2], (z * size + x) * 4);
  const result = new DataTexture(pixels, size, size);
  if (role === "colour") result.colorSpace = SRGBColorSpace;
  result.needsUpdate = true;
  return result;
}

export async function exportFixtureWorld() {
  const started = performance.now();
  const material = new MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.95,
    map: texture("colour"),
    normalMap: texture("normal"),
    roughnessMap: texture("roughness"),
    aoMap: texture("ao"),
  });
  try {
    const output = await window.strata.view.exportCurrentWorld(material);
    window.exportedWorld = output;
    return {
      report: output.report,
      bytes: output.bytes.byteLength,
      exportMs: performance.now() - started,
    };
  } finally {
    for (const map of [material.map, material.normalMap, material.roughnessMap, material.aoMap])
      map?.dispose();
    material.dispose();
  }
}

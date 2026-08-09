import { THREE, startVisualScene } from "./scene-support.js";

export function startScene(canvas, dimensions) {
  return startVisualScene(canvas, dimensions, "texture-material", ({ scene }) => {
    const pixels = new Uint8Array([
      255, 196, 64, 255, 42, 67, 101, 255, 42, 67, 101, 255, 255, 196, 64, 255,
    ]);
    const texture = new THREE.DataTexture(pixels, 2, 2, THREE.RGBAFormat);
    texture.magFilter = THREE.NearestFilter;
    texture.needsUpdate = true;
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(1.8, 1.8),
      new THREE.MeshBasicMaterial({ map: texture }),
    );
    scene.add(mesh);
    return { mesh, texture };
  });
}

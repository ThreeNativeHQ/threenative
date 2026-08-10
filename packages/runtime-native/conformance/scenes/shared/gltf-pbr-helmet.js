import { startVisualScene } from "./scene-support.js";
import { loadPbrHelmet, THREE } from "./planned-animation-support.js";

export async function startScene(canvas, dimensions) {
  const { gltf, helmet } = await loadPbrHelmet();
  return startVisualScene(canvas, dimensions, "gltf-pbr-helmet", ({ scene }) => {
    gltf.scene.position.set(0, -0.5, 0);
    scene.add(new THREE.HemisphereLight(0xc7ddff, 0x18203d, 2.2));
    const key = new THREE.DirectionalLight(0xffffff, 4.2);
    key.position.set(2.5, 4, 3);
    scene.add(key, gltf.scene);
    return {
      detail: {
        mesh: helmet.name,
        material: helmet.material.type,
        metalness: helmet.material.metalness,
        roughness: helmet.material.roughness,
      },
      helmet,
    };
  });
}

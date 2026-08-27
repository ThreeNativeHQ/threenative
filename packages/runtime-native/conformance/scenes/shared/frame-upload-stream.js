import { THREE, startVisualScene } from "./scene-support.js";

export function startScene(canvas, dimensions) {
  return startVisualScene(canvas, dimensions, "frame-upload-stream", ({ scene }) => {
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array([-1, -0.7, 0, 1, -0.7, 0, 0, 0.9, 0]);
    const attribute = new THREE.BufferAttribute(positions, 3);
    attribute.setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute("position", attribute);
    const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ color: 0x36d399 }));
    let frame = 0;
    mesh.onBeforeRender = () => {
      // Force a steady-state queue.writeBuffer every frame. Alternating the copied source makes
      // a stale/deferred upload visible as a wobble or corrupted triangle rather than a green row.
      positions[7] = 0.82 + (frame++ % 2) * 0.08;
      attribute.needsUpdate = true;
    };
    scene.add(mesh);
    return { mesh, detail: { dynamicUpload: true } };
  });
}

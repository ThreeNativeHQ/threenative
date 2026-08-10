import { THREE, assertCondition, startVisualScene } from "./scene-support.js";

export function assertColorManagementProof(encoded, roundTrip) {
  assertCondition(THREE.ColorManagement.enabled === true, "Three.js color management is disabled");
  assertCondition(
    Math.abs(encoded.r - 0.21404114048223255) < 1e-6,
    "sRGB input was not converted to linear working space",
  );
  assertCondition(
    Math.abs(roundTrip.r - 0.5) < 1e-5,
    "linear working color did not round-trip to sRGB",
  );
}

export function startScene(canvas, dimensions) {
  return startVisualScene(canvas, dimensions, "color-management", ({ renderer, scene }) => {
    assertCondition(
      renderer.outputColorSpace === THREE.SRGBColorSpace,
      "renderer output must be sRGB",
    );
    const encoded = new THREE.Color().setRGB(0.5, 0.5, 0.5, THREE.SRGBColorSpace);
    const roundTrip = encoded.clone();
    THREE.ColorManagement.workingToColorSpace(roundTrip, THREE.SRGBColorSpace);
    assertColorManagementProof(encoded, roundTrip);

    const values = [encoded, new THREE.Color().setRGB(0.5, 0.5, 0.5), new THREE.Color(0xf6ad55)];
    const meshes = values.map((color, index) => {
      const mesh = new THREE.Mesh(
        new THREE.PlaneGeometry(0.78, 1.45),
        new THREE.MeshBasicMaterial({ color }),
      );
      mesh.position.x = (index - 1) * 0.88;
      scene.add(mesh);
      return mesh;
    });
    return { meshes, detail: { linearGrey: encoded.r, roundTripGrey: roundTrip.r } };
  });
}

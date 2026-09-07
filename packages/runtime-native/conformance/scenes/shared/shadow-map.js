import { THREE, startVisualScene } from "./scene-support.js";

const CHECKER_SIZE = 4;
const CHECKER_DATA = new Uint8Array([
  255, 255, 255, 255, 0, 0, 0, 255, 255, 255, 255, 255, 0, 0, 0, 255,
  0, 0, 0, 255, 255, 255, 255, 255, 0, 0, 0, 255, 255, 255, 255, 255,
  255, 255, 255, 255, 0, 0, 0, 255, 255, 255, 255, 255, 0, 0, 0, 255,
  0, 0, 0, 255, 255, 255, 255, 255, 0, 0, 0, 255, 255, 255, 255, 255,
]);
const SOLID_DATA = new Uint8Array([255, 255, 255, 255]);

function createAlphaMap(data, size) {
  const texture = new THREE.DataTexture(
    data,
    size,
    size,
    THREE.RGBAFormat,
    THREE.UnsignedByteType,
  );
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return texture;
}

function createCheckerAlphaMap() {
  return createAlphaMap(CHECKER_DATA, CHECKER_SIZE);
}

function createSolidAlphaMap() {
  return createAlphaMap(SOLID_DATA, 1);
}

function createPlanarMaterial(alphaMap, color, alphaTest) {
  return new THREE.MeshStandardMaterial({
    alphaMap,
    alphaTest,
    color,
    metalness: 0,
    roughness: 0.6,
    side: THREE.DoubleSide,
  });
}

function createPlanarCaster(alphaMap, color, alphaTest, x) {
  const caster = new THREE.Mesh(
    new THREE.PlaneGeometry(0.82, 1.05),
    createPlanarMaterial(alphaMap, color, alphaTest),
  );
  caster.position.set(x, -0.2, 1);
  caster.castShadow = true;
  return caster;
}

export function startScene(canvas, dimensions) {
  return startVisualScene(canvas, dimensions, "shadow-map", ({ renderer, scene, camera }) => {
    renderer.shadowMap.enabled = true;
    camera.position.set(2.8, 2.3, 4.2);
    camera.lookAt(0, 0, 0);
    const object = new THREE.Mesh(
      new THREE.TorusKnotGeometry(0.52, 0.17, 80, 14),
      new THREE.MeshStandardMaterial({ color: 0xed8936, roughness: 0.6 }),
    );
    object.position.y = 0.35;
    object.castShadow = true;
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(5, 5),
      new THREE.MeshStandardMaterial({ color: 0x718096, roughness: 0.9 }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -0.75;
    floor.receiveShadow = true;
    const checkerAlphaMap = createCheckerAlphaMap();
    const solidAlphaMap = createSolidAlphaMap();
    const cutoutCaster = createPlanarCaster(checkerAlphaMap, 0x3182ce, 0, -1.05);
    const rightCaster = createPlanarCaster(checkerAlphaMap, 0xdd6b20, 0.5, 1.05);
    const rightReplacementMaterial = createPlanarMaterial(solidAlphaMap, 0xdd6b20, 0.5);
    const light = new THREE.DirectionalLight(0xffffff, 3.5);
    light.position.set(-2.5, 4, 3);
    light.castShadow = true;
    scene.add(
      object,
      floor,
      cutoutCaster,
      rightCaster,
      light,
      new THREE.AmbientLight(0x405070, 0.45),
    );

    const cutoutSourceMaterial = cutoutCaster.material;
    const rightSourceMaterial = rightCaster.material;
    const detail = {
      frames: { cutoutAlphaTest: null, rightMaterialReplacement: null },
      mutations: { cutoutAlphaTestApplied: false, rightMaterialReplacementApplied: false },
      sourceVersions: {
        cutoutBefore: cutoutSourceMaterial.version,
        cutoutAfter: null,
        rightBefore: rightSourceMaterial.version,
        rightAfter: null,
        rightReplacement: rightReplacementMaterial.version,
      },
      finalAlphaTests: {
        cutout: cutoutSourceMaterial.alphaTest,
        right: rightSourceMaterial.alphaTest,
      },
    };
    let renderFrame = 0;
    const render = () => {
      renderFrame += 1;
      if (renderFrame === 2) {
        cutoutSourceMaterial.alphaTest = 0.5;
        detail.frames.cutoutAlphaTest = renderFrame;
        detail.sourceVersions.cutoutAfter = cutoutSourceMaterial.version;
        detail.mutations.cutoutAlphaTestApplied =
          cutoutSourceMaterial.alphaTest === 0.5
          && detail.sourceVersions.cutoutAfter !== detail.sourceVersions.cutoutBefore;
      } else if (renderFrame === 3) {
        rightCaster.material = rightReplacementMaterial;
        detail.frames.rightMaterialReplacement = renderFrame;
        detail.sourceVersions.rightAfter = rightCaster.material.version;
        detail.mutations.rightMaterialReplacementApplied =
          rightCaster.material !== rightSourceMaterial
          && rightCaster.material.alphaTest === 0.5
          && rightCaster.material.alphaMap === solidAlphaMap
          && detail.sourceVersions.rightAfter === detail.sourceVersions.rightBefore;
      }
      detail.finalAlphaTests.cutout = cutoutCaster.material.alphaTest;
      detail.finalAlphaTests.right = rightCaster.material.alphaTest;
      renderer.render(scene, camera);
    };
    return {
      object,
      floor,
      light,
      cutoutCaster,
      rightCaster,
      render,
      detail,
    };
  });
}

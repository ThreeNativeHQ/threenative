import { THREE, assertCondition } from "./scene-support.js";

export const SCREEN_SPACE_TEXT = "SCORE 1200";
export const SCREEN_SPACE_TEXT_BRIGHT_FLOOR = 161;
export const SCREEN_SPACE_TEXT_BOUNDS = [0, 0, 58, 6];

const CHARS = "0123456789:ACEHIMNORST";
const GLYPHS =
  "7e33ae63f 3884210c4 7c21fc21f 7e10f421f 4210fc631 7e10f843 7e31f843 8422221f 7e31fc63f 7e10fc63f 8401080 4631fc62e 7c210843f 7c217843f 4631fc631 7c842109f 4631ad771 4631cd671 3a318c62e 45257c62f 7e10f843f 10842109f"
    .split(" ")
    .map((hex) => BigInt(`0x${hex}`));

export function layoutHudText(text) {
  assertCondition(typeof text === "string" && text.length > 0, "HUD text must be non-empty");
  const points = [];
  for (const [character, value] of [...text].entries()) {
    if (value === " ") continue;
    const glyph = GLYPHS[CHARS.indexOf(value)];
    assertCondition(glyph !== undefined, `Missing HUD glyph: ${value}`);
    for (let pixel = 0; pixel < 35; pixel += 1) {
      if ((glyph & (1n << BigInt(pixel))) === 0n) continue;
      points.push({ x: character * 6 + (pixel % 5), y: Math.floor(pixel / 5) });
    }
  }
  assertCondition(points.length > 0, "HUD text produced no bright glyph geometry");
  return {
    bounds: [
      Math.min(...points.map(({ x }) => x)),
      Math.min(...points.map(({ y }) => y)),
      Math.max(...points.map(({ x }) => x)),
      Math.max(...points.map(({ y }) => y)),
    ],
    brightGlyphs: points.length,
    points,
    text,
  };
}

export function assertScreenSpaceTextProof(proof) {
  assertCondition(proof.text === SCREEN_SPACE_TEXT, `Expected exactly ${SCREEN_SPACE_TEXT}`);
  assertCondition(
    proof.brightGlyphs >= SCREEN_SPACE_TEXT_BRIGHT_FLOOR,
    `Bright glyph count ${proof.brightGlyphs} is below ${SCREEN_SPACE_TEXT_BRIGHT_FLOOR}`,
  );
  assertCondition(
    SCREEN_SPACE_TEXT_BOUNDS.every((value, index) => proof.bounds[index] === value),
    `Glyph bounds ${proof.bounds.join(",")} do not match ${SCREEN_SPACE_TEXT_BOUNDS.join(",")}`,
  );
}

export function assertHudReadoutChanged(before, after) {
  assertCondition(before.text !== after.text, "HUD state value did not change");
  assertCondition(before.count !== after.count, "HUD instance count did not change");
  assertCondition(
    before.matrices.some((value, index) => value !== after.matrices[index]),
    "HUD instance matrices did not change",
  );
}

export function createHudText(camera) {
  const material = new THREE.MeshBasicMaterial({ color: 0xf6e05e });
  material.depthTest = material.depthWrite = false;
  const mesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.82, 0.82), material, 2_048);
  const matrix = new THREE.Matrix4();
  mesh.frustumCulled = false;
  camera.add(mesh);
  return {
    mesh,
    update(text) {
      const proof = layoutHudText(text);
      assertCondition(proof.points.length <= mesh.instanceMatrix.count, "HUD instance capacity exceeded");
      for (const [index, point] of proof.points.entries()) {
        matrix.makeTranslation(point.x, -point.y, 0);
        mesh.setMatrixAt(index, matrix);
      }
      mesh.count = proof.points.length;
      mesh.instanceMatrix.needsUpdate = true;
      const height = 2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
      mesh.position.set(-height * camera.aspect * 0.46, height * 0.42, -1);
      mesh.scale.setScalar(height / 160);
      return {
        ...proof,
        count: mesh.count,
        matrices: Array.from(mesh.instanceMatrix.array.slice(0, mesh.count * 16)),
      };
    },
  };
}

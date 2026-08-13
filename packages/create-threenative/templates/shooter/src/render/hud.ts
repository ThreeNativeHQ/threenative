import { InstancedMesh, MathUtils, Matrix4, MeshBasicMaterial, PlaneGeometry } from "three";
import type { PerspectiveCamera } from "three";
import { palette } from "./palette.js";

const CHARS = "0123456789: /ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const GLYPHS =
  "a33ae62f 884210c7 c444422f e107420f 11f4a98a e107843f a317842f 8422221f a317462f a10f462f 8401080 0 44222110 631fc62e e317c62f 8210843f e318c62f c217843f 4217843f a31e843f 631fc635 c842109f 9294211d 52519535 c2108427 631ad775 631cd675 a318c62f 4217c62f 9358c62f 5257c62f e107043f 842109f a318c633 1518c631 775ac635 62a22a35 8422a31 c222221f"
    .split(" ")
    .map((hex) => BigInt(`0x${hex}`));

export interface IHudValues {
  readonly health: number;
  readonly lives: number;
  readonly scanCount: number;
  readonly seconds: number;
  readonly targets: number;
  readonly wave: number;
  readonly wavesCleared: number;
}

function drawText(root: InstancedMesh, matrix: Matrix4, text: string): number {
  let instance = 0;
  for (const [y, line] of text.split("\n").entries()) {
    for (let x = 0; x < line.length; x += 1) {
      const glyph = GLYPHS[CHARS.indexOf(line[x] ?? " ")];
      if (glyph === undefined) continue;
      for (let pixel = 0; pixel < 35; pixel += 1) {
        if ((glyph & (1n << BigInt(pixel))) === 0n) continue;
        matrix.makeTranslation(x * 6 + (pixel % 5), -y * 9 - Math.floor(pixel / 5), 0);
        root.setMatrixAt(instance, matrix);
        instance += 1;
      }
    }
  }
  return instance;
}

export function createHud(camera: PerspectiveCamera) {
  const material = new MeshBasicMaterial({ color: palette.accent });
  material.depthTest = material.depthWrite = false;
  const root = new InstancedMesh(new PlaneGeometry(0.82, 0.82), material, 2_048);
  root.name = "arena-hud";
  root.renderOrder = 10_000;
  const matrix = new Matrix4();
  camera.add(root);

  return {
    glyphs: 0,
    update(values: IHudValues): void {
      const text = [
        "CLEAR 5 WAVES",
        "FAIL 0 LIVES",
        `WAVE ${values.wave} / 5`,
        `HP ${Math.max(0, Math.round(values.health))} LIVES ${Math.max(0, Math.round(values.lives))}`,
        `TARGETS ${Math.max(0, Math.round(values.targets))}`,
        `SCAN ${Math.max(0, Math.round(values.scanCount))}`,
        `TIME ${String(Math.floor(values.seconds / 60)).padStart(2, "0")}:${String(Math.floor(values.seconds % 60)).padStart(2, "0")}`,
      ].join("\n");
      const instance = drawText(root, matrix, text);
      root.count = this.glyphs = instance;
      root.instanceMatrix.needsUpdate = true;
      const height = 2 * Math.tan(MathUtils.degToRad(camera.fov / 2));
      root.position.set(-height * camera.aspect * 0.47, height * 0.44, -1);
      root.scale.setScalar(height / 158);
    },
    dispose(): void {
      root.removeFromParent();
      root.geometry.dispose();
      material.dispose();
    },
  };
}

import {
  InstancedMesh,
  Matrix4,
  MeshBasicMaterial,
  type PerspectiveCamera,
  PlaneGeometry,
} from "three";
import type { RaceStatus } from "../state.js";
import { palette } from "./palette.js";

const PIXEL = 5;
const GLYPHS: Record<string, number> = {
  A: 0x1f454f,
  C: 0x114441,
  D: 0x1f1111f,
  E: 0x1f11c1,
  F: 0x1f11111,
  G: 0x1f111d,
  I: 0x1f0041f,
  L: 0x111111f,
  N: 0x1f151f,
  O: 0x0e1110e,
  P: 0x1f1171,
  R: 0x1f1171,
  S: 0x1e10f,
  T: 0x42108421,
  W: 0x1f15f,
  ":": 0x200200,
  "0": 0x1f15f,
  "1": 0x42108421,
  "2": 0x1d11d,
  "3": 0x1d10f,
};

export function createHud(camera: PerspectiveCamera) {
  const material = new MeshBasicMaterial({ color: palette.shadow });
  material.depthTest = material.depthWrite = false;
  const root = new InstancedMesh(new PlaneGeometry(0.08, 0.08), material, 400);
  root.renderOrder = 10_000;
  camera.add(root);
  const matrix = new Matrix4();
  return {
    update(values: {
      readonly lap: number;
      readonly place: number;
      readonly status: RaceStatus;
    }): void {
      const label = `LAP ${values.lap} P${values.place} ${values.status}`;
      let instance = 0;
      for (const [index, character] of [...label].entries()) {
        const glyph = GLYPHS[character] ?? 0;
        for (let pixel = 0; pixel < PIXEL * PIXEL; pixel += 1) {
          if ((glyph & (1 << pixel)) === 0) continue;
          matrix.makeTranslation(index * 6 + (pixel % PIXEL), -Math.floor(pixel / PIXEL), 0);
          root.setMatrixAt(instance, matrix);
          instance += 1;
        }
      }
      root.count = instance;
      root.instanceMatrix.needsUpdate = true;
      root.position.set(-0.72, 0.42, -1);
      root.scale.setScalar(0.02);
    },
    dispose(): void {
      root.removeFromParent();
      root.geometry.dispose();
      material.dispose();
    },
  };
}

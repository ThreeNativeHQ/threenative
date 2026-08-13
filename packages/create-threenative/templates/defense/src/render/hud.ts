import { InstancedMesh, Matrix4, MeshBasicMaterial, PlaneGeometry } from "three";
import type { PerspectiveCamera } from "three";
import { palette } from "./palette.js";

const FONT: Readonly<Record<string, readonly string[]>> = {
  "0": ["11111", "10001", "10011", "10101", "11001", "10001", "11111"],
  "1": ["00100", "01100", "00100", "00100", "00100", "00100", "01110"],
  "2": ["11110", "00001", "00001", "01110", "10000", "10000", "11111"],
  "3": ["11110", "00001", "00001", "01110", "00001", "00001", "11110"],
  "4": ["10010", "10010", "10010", "11111", "00010", "00010", "00010"],
  "5": ["11111", "10000", "10000", "11110", "00001", "00001", "11110"],
  "6": ["01110", "10000", "10000", "11110", "10001", "10001", "01110"],
  "7": ["11111", "00001", "00010", "00100", "01000", "01000", "01000"],
  "8": ["01110", "10001", "10001", "01110", "10001", "10001", "01110"],
  "9": ["01110", "10001", "10001", "01111", "00001", "00001", "01110"],
  A: ["01110", "10001", "10001", "11111", "10001", "10001", "10001"],
  C: ["01111", "10000", "10000", "10000", "10000", "10000", "01111"],
  D: ["11110", "10001", "10001", "10001", "10001", "10001", "11110"],
  E: ["11111", "10000", "10000", "11110", "10000", "10000", "11111"],
  G: ["01111", "10000", "10000", "10111", "10001", "10001", "01111"],
  I: ["11111", "00100", "00100", "00100", "00100", "00100", "11111"],
  K: ["10001", "10010", "10100", "11000", "10100", "10010", "10001"],
  L: ["10000", "10000", "10000", "10000", "10000", "10000", "11111"],
  N: ["10001", "11001", "10101", "10011", "10001", "10001", "10001"],
  O: ["01110", "10001", "10001", "10001", "10001", "10001", "01110"],
  P: ["11110", "10001", "10001", "11110", "10000", "10000", "10000"],
  R: ["11110", "10001", "10001", "11110", "10100", "10010", "10001"],
  S: ["01111", "10000", "10000", "01110", "00001", "00001", "11110"],
  T: ["11111", "00100", "00100", "00100", "00100", "00100", "00100"],
  V: ["10001", "10001", "10001", "10001", "10001", "01010", "00100"],
  W: ["10001", "10001", "10001", "10101", "10101", "11011", "10001"],
  Y: ["10001", "10001", "01010", "00100", "00100", "00100", "00100"],
  ":": ["00000", "00100", "00100", "00000", "00100", "00100", "00000"],
  " ": ["00000", "00000", "00000", "00000", "00000", "00000", "00000"],
};
const BLANK_GLYPH = FONT[" "] ?? ["00000"];

export interface IDefenseHudValues {
  readonly balance: number;
  readonly leaks: number;
  readonly status: string;
  readonly towers: number;
  readonly wave: number;
}

function drawText(root: InstancedMesh, matrix: Matrix4, text: readonly string[]): number {
  let instance = 0;
  for (const [lineIndex, line] of text.entries()) {
    for (let charIndex = 0; charIndex < line.length; charIndex += 1) {
      const glyph = FONT[line[charIndex] ?? " "] ?? BLANK_GLYPH;
      for (const [row, pattern] of glyph.entries()) {
        for (let column = 0; column < pattern.length; column += 1) {
          if (pattern[column] !== "1") continue;
          matrix.makeTranslation(charIndex * 6 + column, -lineIndex * 9 - row, -1);
          root.setMatrixAt(instance, matrix);
          instance += 1;
        }
      }
    }
  }
  return instance;
}

export function createHud(camera: PerspectiveCamera) {
  const material = new MeshBasicMaterial({ color: palette.accent });
  material.depthTest = material.depthWrite = false;
  const root = new InstancedMesh(new PlaneGeometry(1, 1), material, 2_048);
  root.renderOrder = 10_000;
  camera.add(root);
  const matrix = new Matrix4();
  return {
    update(values: IDefenseHudValues): void {
      const text = [
        `CRED ${Math.max(0, Math.round(values.balance))}`,
        `WAVE ${String(Math.max(0, values.wave)).padStart(2, "0")}:10`,
        `LEAK ${String(Math.max(0, values.leaks)).padStart(2, "0")}:20`,
        `TOWR ${Math.max(0, Math.round(values.towers))}`,
        values.status,
      ];
      const instance = drawText(root, matrix, text);
      root.count = instance;
      root.instanceMatrix.needsUpdate = true;
      root.position.set(-0.26, 0.3, -1.5);
      root.scale.setScalar(0.009);
    },
    dispose(): void {
      root.removeFromParent();
      root.geometry.dispose();
      material.dispose();
    },
  };
}

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { BoxGeometry, Mesh, MeshStandardMaterial } from "three";
import { evaluateSolid } from "./csg.js";
import { writeSolidGlb } from "./export-glb.js";
const output = resolve(process.argv[2] ?? "assets/doorway.glb");
const material = new MeshStandardMaterial({ color: 0x8c9296, roughness: 0.9 });
const wall = new Mesh(new BoxGeometry(4, 3, 0.3), material);
wall.position.y = 1.5;
const cutter = new Mesh(new BoxGeometry(1, 2.2, 1), material);
cutter.position.y = 0.9;
const result = evaluateSolid(wall, cutter, "subtract");
try {
  const bytes = await writeSolidGlb(result.mesh);
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, bytes, { flag: "wx" });
  console.info(
    `Wrote ${bytes.byteLength} bytes to ${output}; run the ordinary ThreeNative asset cook next.`,
  );
} finally {
  result.dispose();
  wall.geometry.dispose();
  cutter.geometry.dispose();
  material.dispose();
}

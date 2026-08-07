import { BoxGeometry, BufferAttribute, Group, Mesh, MeshStandardMaterial } from "three";

export const palette = {
  skyHigh: 0x1458bd,
  skyLow: 0x83d8f2,
  ground: 0x55b935,
  character: 0xf29a38,
  accent: 0xffc83d,
  shadow: 0x241d1a,
} as const;

const materialCache = new Map<number, MeshStandardMaterial>();

export function toon(color: number): MeshStandardMaterial {
  const cached = materialCache.get(color);
  if (cached !== undefined) return cached;
  const material = new MeshStandardMaterial({ color, roughness: 0.78, metalness: 0 });
  materialCache.set(color, material);
  return material;
}

function mottle(mesh: Mesh, seed = 1): void {
  const position = mesh.geometry.getAttribute("position");
  if (position === undefined) return;
  const colors = new Float32Array(position.count * 3);
  for (let index = 0; index < position.count; index += 1) {
    const value = 0.88 + ((index * 17 + seed * 13) % 7) * 0.02;
    colors[index * 3] = value;
    colors[index * 3 + 1] = value;
    colors[index * 3 + 2] = value;
  }
  mesh.geometry.setAttribute("color", new BufferAttribute(colors, 3));
  const material = (mesh.material as MeshStandardMaterial).clone();
  material.vertexColors = true;
  mesh.material = material;
}

export function rockBox(width: number, height: number, depth: number, seed = 1): Group {
  const group = new Group();
  const top = new Mesh(new BoxGeometry(width, 0.28, depth), toon(palette.ground));
  top.position.y = height / 2 - 0.14;
  top.castShadow = true;
  top.receiveShadow = true;
  mottle(top, seed);
  const stone = new Mesh(
    new BoxGeometry(width * 0.84, height - 0.28, depth * 0.82),
    toon(palette.shadow),
  );
  stone.position.y = -0.14;
  stone.castShadow = true;
  stone.receiveShadow = true;
  group.add(top, stone);
  return group;
}

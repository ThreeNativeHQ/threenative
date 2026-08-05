import { BoxGeometry, BufferAttribute, Group, Mesh, MeshStandardMaterial } from "three";

export const palette = {
  skyHigh: 0x1458bd,
  skyLow: 0x83d8f2,
  cloud: 0xffffff,
  grass: 0x55b935,
  grassLight: 0x79d44b,
  rock: 0x806d5b,
  rockDark: 0x55483c,
  fur: 0xf29a38,
  furLight: 0xffd9a1,
  jacket: 0x347fd0,
  jacketDark: 0x1d5698,
  cream: 0xfff0d6,
  eye: 0x241d1a,
  coin: 0xffc83d,
  enemy: 0xe64a3f,
} as const;

const materialCache = new Map<number, MeshStandardMaterial>();

export function toon(color: number): MeshStandardMaterial {
  const cached = materialCache.get(color);
  if (cached !== undefined) return cached;
  const material = new MeshStandardMaterial({ color, roughness: 0.78, metalness: 0 });
  materialCache.set(color, material);
  return material;
}

export function mottle(mesh: Mesh, seed = 1): void {
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
  const top = new Mesh(new BoxGeometry(width, 0.28, depth), toon(palette.grass));
  top.position.y = height / 2 - 0.14;
  top.castShadow = true;
  top.receiveShadow = true;
  mottle(top, seed);
  const stone = new Mesh(
    new BoxGeometry(width * 0.84, height - 0.28, depth * 0.82),
    toon(palette.rock),
  );
  stone.position.y = -0.14;
  stone.castShadow = true;
  stone.receiveShadow = true;
  group.add(top, stone);
  return group;
}

import { CapsuleGeometry, Group, Mesh, MeshStandardMaterial, SphereGeometry } from "three";

export interface ICharacterRig {
  readonly leftArm: Mesh;
  readonly leftLeg: Mesh;
  readonly rightArm: Mesh;
  readonly rightLeg: Mesh;
  readonly root: Group;
  readonly torso: Group;
}

/**
 * The visible controller: a chalk-white figure built from primitives, so the capsule the
 * physics actually simulates has something legible standing in it.
 */
export function buildCharacter(): ICharacterRig {
  const skin = new MeshStandardMaterial({ color: 0xf3efe4, roughness: 0.65, metalness: 0.02 });
  const root = new Group();
  const torso = new Group();
  root.add(torso);

  const body = new Mesh(new CapsuleGeometry(0.24, 0.34, 6, 16), skin);
  body.position.y = 0.62;
  body.castShadow = true;
  torso.add(body);

  const head = new Mesh(new SphereGeometry(0.21, 20, 16), skin);
  head.position.y = 1.06;
  head.castShadow = true;
  torso.add(head);

  const leftArm = limb(skin, -0.3, 0.72, 0.16, 0.4);
  const rightArm = limb(skin, 0.3, 0.72, 0.16, 0.4);
  const leftLeg = limb(skin, -0.13, 0.34, 0.13, 0.34);
  const rightLeg = limb(skin, 0.13, 0.34, 0.13, 0.34);
  torso.add(leftArm, rightArm, leftLeg, rightLeg);

  return { leftArm, leftLeg, rightArm, rightLeg, root, torso };
}

function limb(
  material: MeshStandardMaterial,
  x: number,
  y: number,
  radius: number,
  length: number,
): Mesh {
  const mesh = new Mesh(new CapsuleGeometry(radius, length, 5, 12), material);
  mesh.position.set(x, y, 0);
  mesh.castShadow = true;
  return mesh;
}

import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import {
  CapsuleGeometry,
  ConeGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  SphereGeometry,
  TorusGeometry,
  type ColorRepresentation,
} from "three";

export function material(color: ColorRepresentation, roughness = 0.72, metalness = 0): MeshStandardMaterial {
  return new MeshStandardMaterial({ color, roughness, metalness });
}

export function roundedBox(
  width: number,
  height: number,
  depth: number,
  color: ColorRepresentation,
  radius = 0.16,
): Mesh {
  const mesh = new Mesh(new RoundedBoxGeometry(width, height, depth, 5, Math.min(radius, height * 0.35)), material(color));
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

export function ball(radius: number, color: ColorRepresentation): Mesh {
  const mesh = new Mesh(new SphereGeometry(radius, 20, 14), material(color));
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

export function cylinder(radius: number, height: number, color: ColorRepresentation, sides = 16): Mesh {
  const mesh = new Mesh(new CylinderGeometry(radius, radius, height, sides), material(color));
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

export function cone(radius: number, height: number, color: ColorRepresentation): Mesh {
  const mesh = new Mesh(new ConeGeometry(radius, height, 14), material(color));
  mesh.castShadow = true;
  return mesh;
}

export function capsule(radius: number, length: number, color: ColorRepresentation): Mesh {
  const mesh = new Mesh(new CapsuleGeometry(radius, length, 8, 16), material(color));
  mesh.castShadow = true;
  return mesh;
}

export function ring(radius: number, tube: number, color: ColorRepresentation): Mesh {
  const mesh = new Mesh(new TorusGeometry(radius, tube, 10, 24), material(color, 0.3, 0.25));
  mesh.castShadow = true;
  return mesh;
}

export function star(color: ColorRepresentation): Group {
  const group = new Group();
  for (let i = 0; i < 5; i++) {
    const ray = roundedBox(0.18, 0.62, 0.14, color, 0.07);
    ray.position.y = 0.25;
    ray.rotation.z = (i / 5) * Math.PI * 2;
    ray.translateY(0.25);
    group.add(ray);
  }
  return group;
}

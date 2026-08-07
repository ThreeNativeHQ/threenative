import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";

export function roundedBox(
  width: number,
  height: number,
  depth: number,
  radius: number,
  material: THREE.Material,
): THREE.Mesh {
  const geometry = new RoundedBoxGeometry(
    width,
    height,
    depth,
    3,
    Math.min(radius, width / 2, height / 2, depth / 2),
  );
  geometry.computeVertexNormals();
  return new THREE.Mesh(geometry, material);
}

export function block(
  width: number,
  height: number,
  depth: number,
  material: THREE.Material,
  radius = 0.16,
): THREE.Mesh {
  return roundedBox(width, height, depth, radius, material);
}

export function ball(radius: number, material: THREE.Material): THREE.Mesh {
  return new THREE.Mesh(new THREE.SphereGeometry(radius, 20, 14), material);
}

export function tube(
  radius: number,
  height: number,
  material: THREE.Material,
  radialSegments = 14,
): THREE.Mesh {
  return new THREE.Mesh(
    new THREE.CylinderGeometry(radius, radius, height, radialSegments),
    material,
  );
}

export function spike(
  radius: number,
  height: number,
  material: THREE.Material,
): THREE.Mesh {
  return new THREE.Mesh(new THREE.ConeGeometry(radius, height, 12), material);
}

export function makeRandom(seed = 1): () => number {
  let value = seed >>> 0;
  return () => {
    value = Math.imul(1664525, value) + 1013904223;
    return (value >>> 0) / 4294967296;
  };
}

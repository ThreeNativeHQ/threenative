import * as THREE from "three";

export const palette = {
  sky: "#49bdf4",
  skyDeep: "#2084dc",
  grass: "#66c72f",
  grassLight: "#9be23d",
  grassDark: "#277e36",
  soil: "#6d4837",
  soilLight: "#98613f",
  stone: "#66838a",
  stoneDark: "#3f6068",
  wood: "#b86c32",
  woodLight: "#e19a47",
  woodDark: "#70402c",
  fox: "#f59d2f",
  foxLight: "#ffd17a",
  foxDark: "#a94d27",
  backpack: "#2387bd",
  backpackLight: "#58c1e8",
  gold: "#ffc12f",
  goldLight: "#ffe27a",
  red: "#e8573b",
  redDark: "#9f3a35",
  teal: "#2fbfc3",
  cloud: "#f5fbff",
  ink: "#24374a",
} as const;

export function standard(
  color: THREE.ColorRepresentation,
  options: THREE.MeshStandardMaterialParameters = {},
): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color,
    roughness: 0.78,
    metalness: 0.02,
    ...options,
  });
}

export function basic(
  color: THREE.ColorRepresentation,
  options: THREE.MeshBasicMaterialParameters = {},
): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({ color, ...options });
}

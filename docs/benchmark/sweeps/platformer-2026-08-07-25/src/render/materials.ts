import { MeshStandardMaterial } from "three";

export const standardMaterial = (color: number, roughness = 0.5) =>
  new MeshStandardMaterial({ color, roughness });

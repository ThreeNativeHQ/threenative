// Adapted from VictorZakharov/beautiful-water (MIT); the source attribution is in README.md.
import { color, mix, smoothstep } from "three/tsl";
import type { Node } from "three/webgpu";
import { palette } from "./palette.js";

export function waterColourNode(height: Node<"float">): Node<"vec3"> {
  return mix(
    color(palette.floor),
    color(palette.accent),
    smoothstep(-0.25, 0.3, height),
  ) as Node<"vec3">;
}

import type { Camera, Scene } from "three";
import { bloom } from "three/addons/tsl/display/BloomNode.js";
import { pass } from "three/tsl";
import * as THREE from "three/webgpu";

export interface PostStack {
  render(): void;
}

export function createPostProcessing(
  renderer: THREE.WebGPURenderer,
  scene: Scene,
  camera: Camera,
): PostStack {
  const post = new THREE.RenderPipeline(renderer);
  const scenePass = pass(scene, camera);
  const colour = scenePass.getTextureNode();
  post.outputNode = colour.add(bloom(colour, 0.9, 0.5, 0.25));
  return post;
}

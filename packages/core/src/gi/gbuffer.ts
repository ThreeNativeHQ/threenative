import type { Camera, Scene } from "three";
import {
  diffuseColor,
  metalness,
  mrt,
  normalWorld,
  output,
  pass,
  positionWorld,
  roughness,
  screenUV,
} from "three/tsl";
import type { Node, TextureNode } from "three/webgpu";

export type GBufferPass = ReturnType<typeof pass>;

export interface IGBuffer {
  readonly albedo: TextureNode;
  readonly depth: TextureNode;
  readonly normal: TextureNode;
  readonly pass: GBufferPass;
  readonly viewZ: Node<"float">;
  /** World position written by the scene pass for spatial GI lookup. */
  readonly worldPosition: Node<"vec3">;
}

/** Marker consumed by the game loop so the scene update precedes the depth-backed render pass. */
export interface IGBufferDriven {
  readonly requiresGBuffer: true;
}

function configure(passNode: GBufferPass): IGBuffer {
  // `metalness` belongs to the game's SSR/material chain. Always request a distinct `albedo`
  // attachment, even when a caller configured metalness first; `getTextureNode` creates that
  // owned slot when it is absent.
  const albedo = passNode.getTextureNode("albedo");
  const depth = passNode.getTextureNode("depth");
  const normal = passNode.getTextureNode("normal");
  const worldPositionTexture = passNode.getTextureNode("worldPosition");
  const viewZ = passNode.getViewZNode();
  const worldPosition = worldPositionTexture.sample(screenUV).xyz as Node<"vec3">;
  const textures = passNode.renderTarget.textures;
  const orderedNames = ["output", "albedo", "normal", "worldPosition"];
  passNode.renderTarget.textures = [
    ...orderedNames.flatMap((name) => textures.filter((texture) => texture.name === name)),
    ...textures.filter((texture) => !orderedNames.includes(texture.name)),
  ];
  const outputs: Record<string, Node> = {
    albedo: diffuseColor,
    normal: normalWorld,
    output,
    worldPosition: positionWorld,
  };
  if (textures.some((texture) => texture.name === "metalness")) outputs.metalness = metalness;
  if (textures.some((texture) => texture.name === "roughness")) outputs.roughness = roughness;
  passNode.setMRT(mrt(outputs));
  return {
    albedo,
    depth,
    normal,
    pass: passNode,
    viewZ,
    worldPosition,
  };
}

/**
 * Add the depth, world-normal, and material-albedo attachments a game-owned solve can read.
 *
 * The pass is created only by this explicit call; importing the module or running a game without
 * a consumer does not add a render target or change the ordinary render path.
 * @situation provide depth, normal, and albedo to a game-owned indirect-light solve
 * @constraint call this only from an opt-in render path; it allocates a multi-render target
 * @example const gbuffer = createGBuffer(scene, camera);
 */
export function createGBuffer(scene: Scene, camera: Camera): IGBuffer {
  return configure(pass(scene, camera));
}

/**
 * Attach GBuffer outputs to an existing scene pass so several game-owned effects share one render.
 * @situation share one scene pass between indirect light and a game's post-processing chain
 * @constraint configure the pass before it is compiled
 * @example const gbuffer = attachGBuffer(scenePass);
 */
export function attachGBuffer(passNode: GBufferPass): IGBuffer {
  return configure(passNode);
}

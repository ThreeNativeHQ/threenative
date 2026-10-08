// @ts-expect-error Three's private texture manager has no public declarations.
import Textures from "three/src/renderers/common/Textures.js";
import { DepthTexture, RenderTarget } from "three/webgpu";
import { describe, expect, it } from "vitest";
import { settleShadowTarget } from "../src/render/shadow-target-settle.js";

/**
 * three's own texture manager over a backend that only counts. A shadow level's depth texture is
 * created by the first material's bind groups (`updateTexture`) before anything registers the
 * level's render target; the native host logged `Destroyed texture [2048x2048 Depth24Plus] used in a
 * submit` once per frame when the registration then destroyed it.
 */
function scene() {
  const events: string[] = [];
  const backend = {
    createTexture: (texture: { isDepthTexture?: boolean }) => {
      if (texture.isDepthTexture === true) events.push("create");
    },
    destroyTexture: (texture: { isDepthTexture?: boolean }) => {
      if (texture.isDepthTexture === true) events.push("destroy");
    },
    delete: () => undefined,
    generateMipmaps: () => undefined,
    get: () => ({}),
    updateSampler: () => undefined,
  };
  const info = {
    createTexture: () => undefined,
    destroyTexture: () => undefined,
    memory: { renderTargets: 0, textures: 0 },
  };
  const renderer = { getRenderTarget: () => null };
  const textures = new Textures(renderer as never, backend as never, info as never);
  const depth = new DepthTexture(2048, 2048);
  const target = new RenderTarget(2048, 2048, { depthBuffer: true, depthTexture: depth });
  return { depth, events, target, textures };
}

describe("registering a shadow target after its depth texture exists", () => {
  it("red control: the plain registration destroys the texture a bind group already holds", () => {
    const { depth, events, target, textures } = scene();
    textures.updateTexture(depth); // the first material's bind groups
    textures.updateRenderTarget(target); // the registration that used to come second
    expect(events).toEqual(["create", "destroy", "create"]);
  });

  it("settling keeps the texture: one creation, no destruction", () => {
    const { depth, events, target, textures } = scene();
    textures.updateTexture(depth);
    settleShadowTarget(textures, target);
    expect(events).toEqual(["create"]);
  });

  it("is the plain registration when no bind group got there first", () => {
    const { depth, events, target, textures } = scene();
    settleShadowTarget(textures, target);
    textures.updateTexture(depth);
    expect(events).toEqual(["create"]);
  });

  it("still re-creates the texture when the target really is resized", () => {
    const { depth, events, target, textures } = scene();
    textures.updateTexture(depth);
    settleShadowTarget(textures, target);
    target.setSize(1024, 1024);
    settleShadowTarget(textures, target);
    textures.updateTexture(depth);
    expect(events).toEqual(["create", "destroy", "create"]);
  });
});

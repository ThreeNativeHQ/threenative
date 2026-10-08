import type { RenderTarget } from "three/webgpu";

interface ITextureRecord {
  height?: number;
  initialized?: boolean;
  sampleCount?: number;
  width?: number;
}

/** The part of three's `Textures` (the renderer's `_textures`) that settling touches. */
export interface ITextureManager {
  get?(object: object): ITextureRecord;
  getSize?(texture: object): { height: number; width: number };
  updateRenderTarget?(target: RenderTarget): void;
}

/**
 * Registers a shadow render target with the renderer's texture manager without destroying a depth
 * texture a bind group already holds.
 *
 * three re-versions a render target's depth texture on its *first* registration (`updateRenderTarget`
 * finds no recorded size, so it sets `depthTexture.needsUpdate`, and the next `updateTexture` destroys
 * the GPUTexture and makes a new one). When a material's bind groups were built before that
 * registration, they hold the destroyed texture and every draw through them submits it:
 * `Destroyed texture [2048x2048 Depth24Plus] used in a submit`, once per frame, on the native host.
 *
 * So when the depth texture already exists, the size three would have recorded is recorded first and
 * the registration finds nothing new. Otherwise the call is the plain registration.
 *
 * This covers the first registration only. A real resize (`target.setSize()` on a target a bind group
 * already holds) still re-creates the depth texture under that group, and is not handled here:
 * `VirtualShadowNode` never resizes a level target after `#init`, which is the only writer of the
 * levels' `shadow.mapSize` (see its `mapSize` option). A caller that does resize one has to refresh
 * the bind groups that hold its depth texture.
 */
export function settleShadowTarget(textures: ITextureManager, target: RenderTarget): void {
  const record = textures.get?.(target);
  const depth = target.depthTexture;
  const depthRecord = depth === null ? undefined : textures.get?.(depth);
  if (record !== undefined && record.width === undefined && depthRecord?.initialized === true) {
    const size = textures.getSize?.(target.texture);
    if (size !== undefined) {
      record.width = size.width;
      record.height = size.height;
      record.sampleCount = target.samples === 0 ? 1 : target.samples;
    }
  }
  textures.updateRenderTarget?.(target);
}

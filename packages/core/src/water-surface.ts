import { type Camera, type Object3D, Quaternion, Vector3 } from "three";
import {
  cameraFar,
  cameraNear,
  clamp,
  float,
  linearDepth,
  reflector,
  screenUV,
  select,
  vec2,
  viewportDepthTexture,
  viewportLinearDepth,
  viewportSharedTexture,
} from "three/tsl";
import type { Node } from "three/webgpu";

/** What the mirrored pass costs: how big it is, how many of them, and how much of the world. */
export interface IWaterReflectionOptions {
  /**
   * The mirrored pass's render target, as a fraction of the drawing buffer.
   *
   * How many *pixels* the second pass costs. Half is the usual answer. This is not on its own the
   * number that decides whether a surface is affordable, and a game that reads it that way will
   * measure no improvement and conclude its water is free: a scene with many objects is bound by
   * the draw calls the mirrored pass submits, not by its pixels, and those do not shrink with the
   * target. Measured on `sandbox/midway-open-pacific` at 1920x1080 on an nvidia/turing adapter with
   * 1,965 draws in the frame, halving this again — 0.5 to 0.25 — moved GPU p95 from 17.80 ms to
   * 17.58 ms. Removing the pass entirely moved it to 7.67 ms. `layers` is the number that mattered.
   */
  readonly resolutionScale: number;
  /** Whether this surface may appear in other reflectors' passes. Off is one pass; on is n². */
  readonly bounces?: boolean;
  /**
   * Which layers the mirrored pass draws, as a three `Layers` mask. Omit to draw everything the
   * scene camera draws, which is the default and what a reflection means when nothing says
   * otherwise.
   *
   * This is how much *world* the second pass costs, and on a crowded scene it is the whole bill.
   * The mirrored pass is a second draw of everything, so a frame with sixty-eight aircraft in it
   * pays for sixty-eight aircraft twice — once where the player can see them and once in the water,
   * where they are a few pixels and half of them are behind the camera anyway. Put the big
   * silhouettes a player actually reads in the water on their own layer and name it here.
   *
   * The mask decides what appears in the mirror, so the game owns it: this only carries the number
   * through to the pass, and a game that omits it gets the whole world reflected as before.
   */
  readonly layers?: number;
}

export interface IWaterSurfaceOptions {
  /** World-space height of the surface, in metres. The mirror plane, and where thickness is 0. */
  readonly level: number;
  /**
   * Thickness readings saturate here, in metres.
   *
   * A required number because it is the range of the instrument, not a taste: sky behind the
   * surface has no depth at all, and something has to be reported for it.
   */
  readonly maxThickness: number;
  /** Omit for a surface that reflects nothing; `reflectionAt` then throws rather than lying. */
  readonly reflection?: IWaterReflectionOptions;
}

/**
 * The pass three hangs off the node `reflector()` returns. Its virtual cameras are the only place a
 * layer mask can be applied, and three's published types stop at the texture node, so the one field
 * this file needs is named here rather than cast at each use.
 */
interface IReflectorPass {
  getVirtualCamera(camera: Camera): Camera;
}
interface IReflectorWithPass {
  _reflectorBaseNode: IReflectorPass;
}

const UP = new Vector3(0, 1, 0);
const FORWARD = new Vector3(0, 0, 1);
/** The one rotation that turns the reflector target's local +Z into world up. */
const FACING_UP = new Quaternion().setFromUnitVectors(FORWARD, UP);

function finite(name: string, value: number): number {
  if (typeof value !== "number" || !Number.isFinite(value))
    throw new Error(`WaterSurface3D.${name} must be finite.`);
  return value;
}

/**
 * What a horizontal water surface can see: the world mirrored in it, the world beneath it, and
 * how much water stands between the two.
 *
 * This is the render plumbing a water material needs and cannot write portably — a mirrored
 * camera and its render target, the frame's own colour read back as the light coming up through
 * the surface, and the scene's depth turned into **metres of water under this pixel**. It decides
 * nothing about how any of that looks: no colour, no absorption tint, no fresnel weighting, no
 * glint. Those are the game's, composed from the nodes below in its own `src/render/` material.
 *
 * The depth reading is the part worth having. `linearDepth` answers in a normalised 0..1 that
 * changes meaning with every camera near/far pair, so a material that subtracts two of them gets
 * a number in no unit at all, and its shoreline moves when the camera's far plane does.
 * `thicknessAt` returns metres, and metres survive the camera changing.
 *
 * ```js
 * const surface = new WaterSurface3D({ level: 0, maxThickness: 4, reflection: { resolutionScale: 0.5 } });
 * const offset = normal.xz.mul(0.02);
 * material.colorNode = mix(
 *   surface.refractionAt(offset).mul(siltTint),      // the game's colours,
 *   surface.reflectionAt(offset),                    // composed by the game,
 *   fresnel,                                         // with the game's own fresnel.
 * );
 * material.opacityNode = surface.thicknessAt().div(surface.maxThickness);
 * ```
 */
export class WaterSurface3D {
  readonly maxThickness: number;
  /**
   * The object whose plane is mirrored, kept outside the scene graph on purpose.
   *
   * A water level is a fact about the world, not about the mesh that happens to draw it: parent
   * the mirror to the surface mesh, as three's own examples do, and a non-uniform scale anywhere
   * up that mesh's ancestry skews the plane the reflection is taken about. This one is placed
   * from `level` and nothing else, so it stays level.
   */
  readonly target: Object3D | undefined;
  #level: number;
  #reflector: ReturnType<typeof reflector> | undefined;
  #released = false;

  constructor(options: IWaterSurfaceOptions) {
    if (options === undefined || typeof options !== "object")
      throw new Error("WaterSurface3D requires options.");
    this.#level = finite("level", options.level);
    this.maxThickness = finite("maxThickness", options.maxThickness);
    if (this.maxThickness <= 0) throw new Error("WaterSurface3D.maxThickness must be positive.");
    const reflection = options.reflection;
    if (reflection === undefined) {
      this.target = undefined;
      return;
    }
    if (typeof reflection !== "object")
      throw new Error("WaterSurface3D.reflection must be an object.");
    const resolutionScale = finite("reflection.resolutionScale", reflection.resolutionScale);
    if (resolutionScale <= 0 || resolutionScale > 1)
      throw new Error("WaterSurface3D.reflection.resolutionScale must be within (0, 1].");
    const node = reflector({
      bounces: reflection.bounces === true,
      generateMipmaps: false,
      resolutionScale,
    });
    this.reflectionLayers = reflection.layers;
    if (reflection.layers !== undefined) {
      const mask = reflection.layers;
      if (!Number.isInteger(mask) || mask < 0)
        throw new Error("WaterSurface3D.reflection.layers must be a non-negative integer mask.");
      // The pass mints one virtual camera per scene camera, lazily, inside three. There is no
      // constructor seam for it and no list to walk afterwards, so the mask is applied where every
      // such camera is born. A camera three has already handed out is caught too, because the same
      // call returns it.
      // `reflector()` returns the texture node; the pass itself — and the virtual cameras it mints —
      // live on the reflector base node hanging off it.
      const pass = (node as unknown as IReflectorWithPass)._reflectorBaseNode; // quality-allow: three 0.185 does not type `_reflectorBaseNode` on the reflector node it returns
      const mint = pass.getVirtualCamera.bind(pass);
      pass.getVirtualCamera = (camera: Camera): Camera => {
        const virtual = mint(camera);
        virtual.layers.mask = mask;
        return virtual;
      };
    }
    this.#reflector = node;
    this.target = node.target;
    node.target.matrixAutoUpdate = false;
    node.target.matrixWorldAutoUpdate = false;
    this.#placeTarget();
  }

  /**
   * The camera the mirrored pass draws this surface with, for one scene camera.
   *
   * The pass mints one of these per scene camera, lazily, and reflects the camera through the
   * mirror plane each frame. It is exposed because `layers` is not the only thing a game may need
   * to say about the second draw — a near/far pair is the other — and because a reflection you
   * cannot inspect is a reflection you cannot cost. Undefined when this surface has no reflection.
   */
  reflectionCameraFor(camera: Camera): Camera | undefined {
    if (this.#reflector === undefined) return undefined;
    // quality-allow: three 0.185 does not type `_reflectorBaseNode` on the reflector node it returns
    return (this.#reflector as unknown as IReflectorWithPass)._reflectorBaseNode.getVirtualCamera(
      camera,
    );
  }

  /** What the mirrored pass draws, as the mask the game supplied. Undefined means everything. */
  readonly reflectionLayers: number | undefined;

  /** The world-space height of the surface, in metres. */
  get level(): number {
    return this.#level;
  }

  /** Move the surface — a tide, a sluice, a flooding room. The mirror plane follows. */
  setLevel(value: number): void {
    if (this.#released) throw new Error("WaterSurface3D is released.");
    this.#level = finite("level", value);
    this.#placeTarget();
  }

  get released(): boolean {
    return this.#released;
  }

  #placeTarget(): void {
    const target = this.target;
    if (target === undefined) return;
    target.position.set(0, this.#level, 0);
    target.quaternion.copy(FACING_UP);
    target.scale.set(1, 1, 1);
    target.updateMatrix();
    // Nothing else will: the target is deliberately not in the scene graph.
    target.matrixWorld.copy(target.matrix);
  }

  /**
   * The world mirrored in the surface, at an optional screen-space offset.
   *
   * The offset is where a game spends its surface normal: a still mirror takes none, and ripples
   * are the normal's horizontal part scaled by however far the game wants the reflection to slide.
   */
  reflectionAt(offset?: Node<"vec2">): Node<"vec3"> {
    const node = this.#reflector;
    if (node === undefined)
      throw new Error("WaterSurface3D was built without reflection; there is nothing to sample.");
    if (offset === undefined) return node.rgb as unknown as Node<"vec3">; // quality-allow: TSL result shape is set by construction; three 0.185 types swizzles and Fn loosely
    // The mirrored pass is flipped in x; the offset rides on top of that, not instead of it.
    return node.sample(clamp(screenUV.flipX().add(offset), vec2(0, 0), vec2(1, 1)))
      .rgb as unknown as Node<"vec3">; // quality-allow: TSL result shape is set by construction; three 0.185 types swizzles and Fn loosely
  }

  /**
   * The frame beneath the surface — everything already drawn this frame, read at an offset.
   *
   * An offset that lands on something **in front of** the water is refused and the fragment falls
   * back to a straight read. Without that, a rock standing in the shallows smears across the
   * water in front of it: the classic refraction bleed, and the reason a hand-rolled offset looks
   * wrong the first time every game writes one.
   */
  refractionAt(offset?: Node<"vec2">): Node<"vec3"> {
    if (offset === undefined) return viewportSharedTexture().rgb as unknown as Node<"vec3">; // quality-allow: TSL result shape is set by construction; three 0.185 types swizzles and Fn loosely
    const safe = select(this.thicknessAt(offset).greaterThan(float(0)), offset, vec2(0, 0));
    return viewportSharedTexture(clamp(screenUV.add(safe), vec2(0, 0), vec2(1, 1)))
      .rgb as unknown as Node<"vec3">; // quality-allow: TSL result shape is set by construction; three 0.185 types swizzles and Fn loosely
  }

  /**
   * Metres of water between this fragment and whatever is drawn behind it, clamped to
   * `maxThickness`. Zero exactly where the bed meets the surface, which is the shoreline.
   *
   * Sky behind the surface has no depth and reads as `maxThickness`, not as zero: an unbounded
   * horizon is deep water, not dry land.
   */
  thicknessAt(offset?: Node<"vec2">): Node<"float"> {
    const behind =
      offset === undefined
        ? viewportLinearDepth
        : linearDepth(viewportDepthTexture(clamp(screenUV.add(offset), vec2(0, 0), vec2(1, 1))));
    // `linearDepth` answers in a 0..1 normalised by the camera's near and far. Undo that here,
    // once, so every reading downstream is in metres and stays in metres when the camera changes.
    const span = cameraFar.sub(cameraNear);
    const metres = behind.sub(linearDepth()).mul(span);
    return clamp(metres, float(0), float(this.maxThickness)) as unknown as Node<"float">; // quality-allow: TSL result shape is set by construction; three 0.185 types swizzles and Fn loosely
  }

  /** Drop the mirrored pass and its render target. */
  dispose(): void {
    if (this.#released) return;
    this.#released = true;
    this.target?.removeFromParent();
    this.#reflector?.dispose();
    this.#reflector = undefined;
  }
}

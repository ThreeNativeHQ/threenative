import { type Object3D, Quaternion, Vector3 } from "three";
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

/** How the mirrored pass is sized. Both numbers are cost, not appearance. */
export interface IWaterReflectionOptions {
  /**
   * The mirrored pass's render target, as a fraction of the drawing buffer.
   *
   * A reflection is a second draw of the whole world, so this is the one number that decides
   * whether a water surface is affordable. Half is the usual answer.
   */
  readonly resolutionScale: number;
  /** Whether this surface may appear in other reflectors' passes. Off is one pass; on is n². */
  readonly bounces?: boolean;
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
    this.#reflector = node;
    this.target = node.target;
    node.target.matrixAutoUpdate = false;
    node.target.matrixWorldAutoUpdate = false;
    this.#placeTarget();
  }

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
    if (offset === undefined) return node.rgb as unknown as Node<"vec3">;
    // The mirrored pass is flipped in x; the offset rides on top of that, not instead of it.
    return node.sample(clamp(screenUV.flipX().add(offset), vec2(0, 0), vec2(1, 1)))
      .rgb as unknown as Node<"vec3">;
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
    if (offset === undefined) return viewportSharedTexture().rgb as unknown as Node<"vec3">;
    const safe = select(this.thicknessAt(offset).greaterThan(float(0)), offset, vec2(0, 0));
    return viewportSharedTexture(clamp(screenUV.add(safe), vec2(0, 0), vec2(1, 1)))
      .rgb as unknown as Node<"vec3">;
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
    return clamp(metres, float(0), float(this.maxThickness)) as unknown as Node<"float">;
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

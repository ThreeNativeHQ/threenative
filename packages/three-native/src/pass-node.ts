/**
 * three's `pass(scene, camera)`, `mrt()` and the MRT slots over the engine's own scene pass, for both
 * back ends (the V8 player and the Wasm engine). The engine draws one scene pass whose targets are
 * the renderer's colour ("output"), depth and, with an MRT that asks for it, view normals; a pass's
 * texture nodes name those targets, and nothing reads the slots as nodes.
 */

interface IPassTsl {
  texture(target: { readonly name: string }, uv: unknown): unknown;
  uv(): unknown;
}

interface IMRTSlot {
  readonly isMRTSlot: true;
  readonly name: string;
}

interface IMRTNode {
  readonly isMRTNode: true;
  readonly outputs: Readonly<Record<string, IMRTSlot>>;
}

/**
 * `onTarget(scene, camera)` hears where a pass points (the V8 player draws that scene); a back end that
 * draws the renderer's last scene passes none.
 */
export function definePass(tsl: IPassTsl, onTarget?: (scene: unknown, camera: unknown) => void) {
  const slot = (name: string): IMRTSlot => Object.freeze({ isMRTSlot: true, name });
  const output = slot("output");
  const normalView = slot("normalView");
  const metalness = slot("metalness");
  const roughness = slot("roughness");

  function mrt(outputs: Record<string, IMRTSlot>): IMRTNode {
    for (const [name, value] of Object.entries(outputs))
      if (
        value?.isMRTSlot !== true ||
        (name !== value.name && !(name === "normal" && value === normalView))
      )
        throw new Error(
          `TN_NATIVE_MRT_UNSUPPORTED: ${name} must be one of output, normal: normalView, metalness, roughness`,
        );
    return Object.freeze({ isMRTNode: true, outputs: Object.freeze({ ...outputs }) });
  }

  class PassNode {
    readonly isPassNode = true;
    #mrt: IMRTNode | null = null;
    #scene: unknown;
    #camera: unknown;

    constructor(scene: unknown, camera: unknown) {
      this.#scene = scene;
      this.#camera = camera;
      onTarget?.(scene, camera);
    }

    get scene(): unknown {
      return this.#scene;
    }
    set scene(value: unknown) {
      this.#scene = value;
      onTarget?.(value, this.#camera);
    }
    get camera(): unknown {
      return this.#camera;
    }
    set camera(value: unknown) {
      this.#camera = value;
      onTarget?.(this.#scene, value);
    }

    setMRT(value: IMRTNode | null): this {
      if (value !== null && value?.isMRTNode !== true)
        throw new Error("TN_NATIVE_MRT_UNSUPPORTED: setMRT takes mrt()");
      this.#mrt = value;
      return this;
    }

    getMRT(): IMRTNode | null {
      return this.#mrt;
    }

    getTextureNode(name = "output"): unknown {
      if (name === "output") return tsl.texture({ name: "scene" }, tsl.uv());
      if (name === "depth") return tsl.texture({ name: "depth" }, tsl.uv());
      if (name === "normal" && this.#mrt?.outputs.normal === normalView)
        return tsl.texture({ name: "normal" }, tsl.uv());
      throw new Error(
        `TN_NATIVE_PASS_TEXTURE_UNSUPPORTED: the native scene pass has no '${name}' target`,
      );
    }

    dispose(): void {}
  }

  const pass = (scene: unknown, camera: unknown): PassNode => new PassNode(scene, camera);
  return { pass, mrt, output, normalView, metalness, roughness };
}

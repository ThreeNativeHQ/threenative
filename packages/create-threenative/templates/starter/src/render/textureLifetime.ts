import { convertToTexture } from "three/tsl";
import type { Node } from "three/webgpu";

interface ITextureResource {
  readonly isRTTNode: true;
  readonly renderTarget: { dispose(): void };
  readonly _quadMesh: { material: { dispose(): void } };
}

function hasRttMarker(value: unknown): value is { readonly isRTTNode: true } {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { isRTTNode?: unknown }).isRTTNode === true
  );
}

function isTextureResource(value: unknown): value is ITextureResource {
  if (!hasRttMarker(value)) return false;
  const resource = value as {
    renderTarget?: { dispose?: unknown } | null;
    _quadMesh?: { material?: { dispose?: unknown } } | null;
  };
  return (
    typeof resource.renderTarget?.dispose === "function" &&
    typeof resource._quadMesh?.material?.dispose === "function"
  );
}

/** Owns only RTT nodes created by this stage; ordinary and shared texture nodes remain external. */
export function createTextureScope() {
  const owned = new Set<ITextureResource>();
  return {
    texture(input: Node): Node {
      const output = convertToTexture(input);
      if (output !== input && hasRttMarker(output)) this.own(output);
      return output;
    },
    own<T>(newRtt: T): T {
      if (!isTextureResource(newRtt))
        throw new Error("texture scope requires a disposable RTTNode.");
      owned.add(newRtt);
      return newRtt;
    },
    dispose(): void {
      for (const resource of owned) {
        resource.renderTarget.dispose();
        resource._quadMesh.material.dispose();
      }
      owned.clear();
    },
  };
}

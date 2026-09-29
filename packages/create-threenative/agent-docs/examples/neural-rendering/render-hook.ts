import { requireSynchronous } from "./gpu-contract.js";

/**
 * Observe a game-owned PassNode's public updateBefore override without replacing its scene,
 * MRT, velocity state or renderer. Instance-local, synchronous, and exactly reversible.
 */
export function afterRenderedPass<T>(
  pass: { updateBefore(frame: T): unknown },
  observer: (frame: T) => void,
): () => void {
  const previous = pass.updateBefore;
  let active: typeof observer | undefined = observer;
  function wrapped(this: typeof pass, frame: T): unknown {
    const result = previous.call(this, frame);
    requireSynchronous(result, "world pass updateBefore");
    if (result !== false) active?.(frame);
    return result;
  }
  pass.updateBefore = wrapped;
  return () => {
    active = undefined;
    // A later authoring wrapper may retain this one; leave it intact with our observer disabled.
    if (pass.updateBefore === wrapped) pass.updateBefore = previous;
  };
}

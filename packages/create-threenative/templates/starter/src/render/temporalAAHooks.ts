// Generated user source: who owns the two pipeline callbacks a temporal AA compile borrows. Upstream
// TRAANode's setup writes its own pair bound to that node, so the originals are the slots as they
// stand before the first setup — a recompile must never capture them again as the originals.
import type { Renderer } from "three/webgpu";

export type PipelineContext = {
  onBeforeRenderPipeline?: () => void;
  onAfterRenderPipeline?: () => void;
};

export function createTemporalAAHooks(jitter: (renderer: Renderer) => void) {
  let context: PipelineContext | undefined;
  let previousBefore: (() => void) | undefined;
  let previousAfter: (() => void) | undefined;
  let ownedBefore: (() => void) | undefined;
  let ownedAfter: (() => void) | undefined;

  return {
    /** The originals, read once and before upstream's setup has written the node's own pair. */
    captureBeforeSetup(next: PipelineContext): void {
      if (context !== undefined) return;
      context = next;
      previousBefore = next.onBeforeRenderPipeline;
      previousAfter = next.onAfterRenderPipeline;
    },
    /**
     * The node's own after-callback is ours to give back, since this compile is what installed it.
     * The jitter callback keeps its identity across recompiles, so a second setup finds the slot
     * already claimed instead of recording this provider's own callback as the previous owner.
     */
    installAfterSetup(next: PipelineContext, renderer: Renderer): void {
      ownedBefore ??= () => jitter(renderer);
      ownedAfter = next.onAfterRenderPipeline;
      next.onBeforeRenderPipeline = ownedBefore;
    },
    /** Each slot goes back to its own original, and only while it is still this node's: a later
     * owner keeps the slot, and upstream's pair belongs to the node being disposed. */
    dispose(): void {
      const owner = context;
      if (owner !== undefined && owner.onBeforeRenderPipeline === ownedBefore)
        owner.onBeforeRenderPipeline = previousBefore;
      if (owner !== undefined && owner.onAfterRenderPipeline === ownedAfter)
        owner.onAfterRenderPipeline = previousAfter;
      context = undefined;
      previousBefore = undefined;
      previousAfter = undefined;
      ownedBefore = undefined;
      ownedAfter = undefined;
    },
  };
}

// Generated for you: grouped-cluster foliage anchors for this game's flora.
// Every anchor references a live segment index on an isolated RNG substream,
// so canopy draws never perturb the skeleton — detached leaves are impossible
// unless the caller drops segments (the mesh audit re-checks this).
import type { IFloraBudgets, IFloraLeafSample, IFloraSegmentSample } from "./floraSample.js";

export function growLeaves(
  foliage: () => number,
  leafScale: number,
  segments: IFloraSegmentSample[],
  leaves: IFloraLeafSample[],
  budgets: IFloraBudgets,
): void {
  for (let index = 0; index < segments.length; index += 1) {
    if (leaves.length >= budgets.maxLeaves) break;
    const segment = segments[index] as IFloraSegmentSample;
    const extra = segment.depth >= 1 ? 1 : 0;
    const clusters = extra + Math.floor(foliage() * 2);
    for (let cluster = 0; cluster < clusters; cluster += 1) {
      if (leaves.length >= budgets.maxLeaves) break;
      const along = 0.55 + foliage() * 0.45;
      const offset = (foliage() - 0.5) * 0.5;
      const size = Math.max(0.12, 0.42 * leafScale * (0.7 + foliage() * 0.6));
      leaves.push({
        anchor: [
          segment.x + (segment.tipX - segment.x) * along + offset,
          segment.y + (segment.tipY - segment.y) * along + Math.abs(offset) * 0.5,
          segment.z + (segment.tipZ - segment.z) * along - offset,
        ],
        angle: foliage() * Math.PI * 2,
        phase: foliage() * Math.PI * 2,
        segment: index,
        size,
      });
    }
  }
}

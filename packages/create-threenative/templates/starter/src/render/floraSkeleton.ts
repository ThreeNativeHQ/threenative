// Generated for you: the flora branch graph for this game. BFS emission
// keeps parent < own index; one origin per plant (the trunk base); capped by
// the segment budget. Pipe-model taper (0.70) derives from the parent radius
// only — the seed never sets a thickness.
import type { IFloraBudgets, IFloraSegmentSample } from "./floraSample.js";

export interface IFloraGrowState {
  readonly droopBase: number;
  readonly canopy: () => number;
  readonly budgets: IFloraBudgets;
  readonly segments: IFloraSegmentSample[];
}

export interface IFloraPlantSize {
  readonly baseRadius: number;
  readonly height: number;
  readonly leanX: number;
  readonly leanZ: number;
}

export function growBranch(
  state: IFloraGrowState,
  plant: number,
  ox: number,
  oz: number,
  size: IFloraPlantSize,
): void {
  const branchAngle = 0.45 + state.canopy() * 0.3;
  const trunkSegments = 2 + Math.floor(state.canopy() * 2);
  const queue: Array<{
    depth: number;
    parent: number;
    x: number;
    y: number;
    z: number;
    direction: number;
    radius: number;
  }> = [
    {
      depth: 0,
      parent: -1,
      x: ox,
      y: 0,
      z: oz,
      direction: state.canopy() * Math.PI * 2,
      radius: size.baseRadius,
    },
  ];
  while (queue.length > 0 && state.segments.length < state.budgets.maxSegments) {
    const node = queue.shift();
    if (node === undefined) break;
    const length = (size.height / (trunkSegments + 2)) * (0.8 + state.canopy() * 0.4);
    const spread = state.canopy() * branchAngle;
    // Per-node derivation: each branch continues from its own parent's
    // direction and radius, so forks thin independently (pipe model).
    const direction = node.direction + (state.canopy() - 0.5) * 0.6;
    const droop = Math.min(Math.PI / 2, state.droopBase * (1 + node.depth * 0.3));
    const tipX = node.x + Math.sin(direction + spread) * length * 0.5 + size.leanX * length;
    const tipZ = node.z + Math.cos(direction + spread) * length * 0.5 + size.leanZ * length;
    const tipY = node.y + Math.cos(droop) * length;
    const tipRadius = Math.max(0.012, node.radius * 0.7);
    const index = state.segments.length;
    state.segments.push({
      bend: droop,
      depth: node.depth,
      parent: node.parent,
      plant,
      radius: node.radius,
      tipRadius,
      tipX,
      tipY,
      tipZ,
      x: node.x,
      y: node.y,
      z: node.z,
    });
    if (node.depth >= 2) continue;
    queue.push({
      depth: node.depth + 1,
      parent: index,
      x: tipX,
      y: tipY,
      z: tipZ,
      direction,
      radius: tipRadius,
    });
    if (node.depth === 0 && state.segments.length + queue.length < state.budgets.maxSegments)
      queue.push({
        depth: 1,
        parent: index,
        x: tipX,
        y: tipY,
        z: tipZ,
        direction,
        radius: tipRadius,
      });
  }
}

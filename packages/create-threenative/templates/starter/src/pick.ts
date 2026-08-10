import type { Ctx } from "@threenative/core";
import type { PhysicsContext } from "@threenative/physics";
import { Mesh } from "three";
import type { GameState } from "./state.js";

type PickCtx = Ctx<GameState, PhysicsContext>;

const FAST_PICK_BUDGET_MS = 1;
let trackedTarget: Mesh | undefined;
let fastPickCount = 0;

export function pickAt(ctx: PickCtx): void {
  const target = ctx.scene.getObjectByName("sculpture");
  if (!(target instanceof Mesh)) {
    trackedTarget = undefined;
    fastPickCount = 0;
    const previous = ctx.state.getState();
    ctx.state.set({ fastPicks: 0, hovered: "" });
    if (previous.fastPicks !== 0 || previous.hovered !== "") ctx.state.flush();
    return;
  }

  if (trackedTarget !== target) {
    trackedTarget = target;
    fastPickCount = ctx.state.getState().fastPicks;
  }

  const started = performance.now();
  const hit = ctx.raycast({ targets: target });
  const elapsed = performance.now() - started;
  if (hit !== undefined && elapsed < FAST_PICK_BUDGET_MS) fastPickCount += 1;
  const previous = ctx.state.getState();
  const hovered = hit?.object.name ?? "";
  ctx.state.set({ fastPicks: fastPickCount, hovered });
  if (previous.hovered !== hovered) ctx.state.flush();
}

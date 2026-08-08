import type { Ctx } from "@threenative/core";
import type { PhysicsContext } from "@threenative/physics";
import { BufferGeometry, Mesh, Raycaster, Vector2 } from "three";
import { acceleratedRaycast, computeBoundsTree, disposeBoundsTree } from "three-mesh-bvh";
import type { GameState } from "./state.js";

type PickCtx = Ctx<GameState, PhysicsContext>;

const FAST_PICK_BUDGET_MS = 1;
const ndc = new Vector2();
const raycaster = new Raycaster();
raycaster.firstHitOnly = true;

// This is a global Three.js effect owned by this project. Delete this file and
// its import to remove accelerated picking, or remove these three assignments
// if another library owns the same prototypes.
BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;
Mesh.prototype.raycast = acceleratedRaycast;

export function pickAt(ctx: PickCtx): void {
  const target = ctx.scene.getObjectByName("sculpture");
  if (!(target instanceof Mesh)) {
    ctx.state.set({ hovered: "" });
    return;
  }

  if (target.geometry.boundsTree === undefined) target.geometry.computeBoundsTree();
  const { width, height } = ctx.viewport.size;
  const pointer = ctx.input.raw.pointer.position;
  ndc.set((pointer.x / width) * 2 - 1, -(pointer.y / height) * 2 + 1);
  raycaster.setFromCamera(ndc, ctx.camera);
  const started = performance.now();
  const hit = raycaster.intersectObject(target, false)[0];
  const elapsed = performance.now() - started;
  const state = ctx.state.getState();
  ctx.state.set({
    fastPicks: state.fastPicks + (hit !== undefined && elapsed < FAST_PICK_BUDGET_MS ? 1 : 0),
    hovered: hit?.object.name ?? "",
  });
}

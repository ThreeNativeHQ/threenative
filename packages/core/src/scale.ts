import { Box3, type Object3D } from "three";

export type NormaliseAxis = "height" | "longest";

export interface INormaliseToMetresOptions {
  readonly metres: number;
  readonly axis: NormaliseAxis;
  /** Crown bone to use for a skinned height measurement. Defaults to a named/highest bone. */
  readonly top?: Object3D | string;
}

/**
 * Scale an asset to a real-world size and return the factor applied.
 *
 * Height for a skinned asset comes from its crown bone, not its bind-pose Box3. Longest-axis
 * normalization remains a geometry measurement because it is used for rigid props and weapons.
 */
export function normaliseToMetres(object: Object3D, options: INormaliseToMetresOptions): number {
  if (!Number.isFinite(options.metres) || options.metres <= 0) {
    throw new Error("normaliseToMetres metres must be finite and positive.");
  }
  if (options.axis !== "height" && options.axis !== "longest") {
    throw new Error("normaliseToMetres axis must be 'height' or 'longest'.");
  }

  object.updateWorldMatrix(true, true);
  const current =
    options.axis === "height" ? measuredHeight(object, options.top) : measuredLongestAxis(object);
  const factor = current > 0 && Number.isFinite(current) ? options.metres / current : 1;
  object.scale.multiplyScalar(factor);
  object.updateWorldMatrix(true, true);
  return factor;
}

function measuredHeight(object: Object3D, requestedTop: Object3D | string | undefined): number {
  const originY = object.matrixWorld.elements[13];
  const skinned = hasSkinnedMesh(object);
  const top = resolveTop(object, requestedTop, skinned);
  if (top !== undefined) return top.matrixWorld.elements[13] - originY;
  if (skinned) return 0;

  const bounds = new Box3().setFromObject(object, true);
  return bounds.isEmpty() ? 0 : bounds.max.y - bounds.min.y;
}

function measuredLongestAxis(object: Object3D): number {
  const bounds = new Box3().setFromObject(object);
  if (bounds.isEmpty()) return 0;
  return Math.max(
    bounds.max.x - bounds.min.x,
    bounds.max.y - bounds.min.y,
    bounds.max.z - bounds.min.z,
  );
}

function hasSkinnedMesh(object: Object3D): boolean {
  let found = false;
  object.traverse((child) => {
    if ((child as { isSkinnedMesh?: boolean }).isSkinnedMesh === true) found = true;
  });
  return found;
}

function resolveTop(
  object: Object3D,
  requestedTop: Object3D | string | undefined,
  skinned: boolean,
): Object3D | undefined {
  if (requestedTop !== undefined && typeof requestedTop !== "string") return requestedTop;
  if (typeof requestedTop === "string") {
    const named = object.getObjectByName(requestedTop);
    if (named !== undefined) return named;
    throw new Error(`normaliseToMetres could not find top bone '${requestedTop}'.`);
  }
  if (!skinned) return undefined;

  let crown: { readonly bone: Object3D; readonly rank: number } | undefined;
  let highest: Object3D | undefined;
  object.traverse((child) => {
    if ((child as { isBone?: boolean }).isBone !== true) return;
    if (
      highest === undefined ||
      child.matrixWorld.elements[13] > highest.matrixWorld.elements[13]
    ) {
      highest = child;
    }
    const rank = crownRank(child.name);
    if (
      rank > 0 &&
      (crown === undefined ||
        rank > crown.rank ||
        (rank === crown.rank &&
          (child.matrixWorld.elements[13] > crown.bone.matrixWorld.elements[13] ||
            (child.matrixWorld.elements[13] === crown.bone.matrixWorld.elements[13] &&
              child.name.localeCompare(crown.bone.name) < 0))))
    ) {
      crown = { bone: child, rank };
    }
  });
  return crown?.bone ?? highest;
}

function crownRank(name: string): number {
  const normalized = name.toLowerCase().replace(/[^a-z0-9]/gu, "");
  if (normalized.includes("crown")) return 3;
  if (normalized.endsWith("headtopend") || normalized.endsWith("headend")) return 3;
  if (normalized.includes("headtop")) return 2;
  return 0;
}

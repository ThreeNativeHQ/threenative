import {
  BufferAttribute,
  type BufferGeometry,
  Color,
  type ColorRepresentation,
  Matrix4,
  Object3D,
} from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

/**
 * One piece on its way into a merged buffer.
 *
 * A `Mesh` is already one of these — pass the meshes straight in and their own transforms are
 * used. Every value here is the game's: the shape, where it sits, and what colour it is.
 */
export interface IMergePart {
  /** The piece's own colour, written flat across its vertices. Omit it on every part for none. */
  readonly color?: ColorRepresentation;
  /** The shape. It is cloned before anything is done to it, so the game's copy is untouched. */
  readonly geometry: BufferGeometry;
  /** Where the piece sits. A `Mesh` brings its own; identity when there is none. */
  readonly matrix?: Matrix4;
}

export interface IMergePartsOptions {
  /** Named in the error when the merge is refused. Say what was being built. */
  readonly label: string;
}

function placementMatrix(part: IMergePart): Matrix4 | undefined {
  if (!(part instanceof Object3D)) return part.matrix;
  if (!part.matrixAutoUpdate) return part.matrix;
  return new Matrix4().compose(part.position, part.quaternion, part.scale);
}

/**
 * Flatten one piece: place it, de-index it, strip it to position, and paint its colour.
 *
 * `mergeGeometries` needs every input to agree on indexing and on the exact set of attribute
 * names. A `BoxGeometry` is indexed and an `ExtrudeGeometry` is not, so a building made of both
 * fails at the first piece; the attribute sets diverge the same way. De-indexing everything and
 * keeping position alone is what makes the two agree — and the normals are recomputed after the
 * merge anyway, because a welded seam's normal is not either input's.
 */
function flatten(part: IMergePart, paint: boolean): BufferGeometry {
  const placed = part.geometry.clone();
  const matrix = placementMatrix(part);
  if (matrix !== undefined) placed.applyMatrix4(matrix);
  const flat = placed.index === null ? placed : placed.toNonIndexed();
  for (const name of Object.keys(flat.attributes)) {
    if (name !== "position") flat.deleteAttribute(name);
  }
  flat.morphAttributes = {};
  flat.morphTargetsRelative = false;
  const position = flat.getAttribute("position");
  if (!paint || position === undefined) return flat;
  const tone = new Color(part.color);
  const painted = new Float32Array(position.count * 3);
  for (let vertex = 0; vertex < position.count; vertex += 1) {
    painted[vertex * 3] = tone.r;
    painted[vertex * 3 + 1] = tone.g;
    painted[vertex * 3 + 2] = tone.b;
  }
  flat.setAttribute("color", new BufferAttribute(painted, 3));
  return flat;
}

/**
 * Merge game-authored pieces into one buffer, keeping each piece's own colour.
 *
 * Two things go wrong every time an agent bakes a building, a ship or a character out of
 * primitives, and neither is about how any of it looks. `mergeGeometries` returns `null` on
 * mismatched inputs instead of throwing, and the usual mismatch — one non-indexed extrusion among
 * a hundred indexed primitives — is invisible until the whole scene is missing; and a merged
 * buffer draws with one surface, so per-piece colour is gone unless every piece carries a flat
 * `color` attribute written before the merge. Writing that attribute is mechanical. The colours
 * are entirely the game's, one per part, and changing them changes nothing here.
 */
export function mergeParts(
  parts: Iterable<IMergePart>,
  options: IMergePartsOptions,
): BufferGeometry {
  const list = [...parts];
  const { label } = options;
  if (list.length === 0) throw new Error(`mergeParts(${label}): the part list is empty.`);
  const coloured = list.filter((part) => part.color !== undefined).length;
  if (coloured !== 0 && coloured !== list.length) {
    const reason = "A merged buffer needs the attribute on every part or on none of them.";
    throw new Error(
      `mergeParts(${label}): ${coloured} of ${list.length} parts name a colour. ${reason}`,
    );
  }
  const merged = mergeGeometries(
    list.map((part) => flatten(part, coloured !== 0)),
    false,
  );
  if (merged === null) {
    const reason = "three.js refused the merge and reported why on the console.";
    const requirement =
      "Every part needs a position attribute, and morph targets do not survive a merge.";
    throw new Error(`mergeParts(${label}): ${reason} Tried ${list.length} parts. ${requirement}`);
  }
  merged.computeVertexNormals();
  return merged;
}

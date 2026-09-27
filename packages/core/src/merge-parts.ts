import {
  BufferAttribute,
  type BufferGeometry,
  Color,
  type ColorRepresentation,
  type Material,
  Matrix4,
  Mesh,
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
  /**
   * Channels to keep from each part besides `position`. Absent or empty keeps today's
   * position-only merge, whose normals are recomputed from the merged result.
   *
   * `"normal"` keeps each part's authored normals, transformed by the part's placement matrix
   * (the inverse-transpose normal matrix) and **never** recomputed. `"uv"` keeps each part's
   * texture coordinates verbatim — the placement matrix moves position and normal, so UV values
   * are retained unchanged. A part that does not carry a listed channel refuses the merge.
   */
  readonly preserve?: readonly ("uv" | "normal")[];
}

export interface IMergeByMaterialOptions {
  /** Named in the error when a group's merge is refused. Say what was being built. */
  readonly label: string;
  /**
   * Leaves one mesh out of its material's group and out of the result — a piece that moves at run
   * time, or one a capture script addresses by name.
   */
  readonly skip?: (mesh: Mesh) => boolean;
}

/** The channels `mergeByMaterial` keeps, in the order it asks `mergeParts` for them. */
const MERGEABLE_CHANNELS = ["normal", "uv"] as const;

function placementMatrix(part: IMergePart): Matrix4 | undefined {
  if (!(part instanceof Object3D)) return part.matrix;
  if (!part.matrixAutoUpdate) return part.matrix;
  return new Matrix4().compose(part.position, part.quaternion, part.scale);
}

/**
 * Flatten one piece: place it, de-index it, strip it to position plus the requested channels, and
 * paint its colour.
 *
 * `mergeGeometries` needs every input to agree on indexing and on the exact set of attribute
 * names. A `BoxGeometry` is indexed and an `ExtrudeGeometry` is not, so a building made of both
 * fails at the first piece; the attribute sets diverge the same way. De-indexing everything and
 * keeping one known set of channels is what makes the two agree. Position alone is the default and
 * the normals are recomputed after the merge, because the merged seam's normal is not either
 * input's; a caller that asks for `normal` keeps the authored ones instead, and `uv` is copied
 * through.
 */
function flatten(
  part: IMergePart,
  paint: boolean,
  preserve: readonly ("uv" | "normal")[],
): BufferGeometry {
  const placed = part.geometry.clone();
  const matrix = placementMatrix(part);
  if (matrix !== undefined) placed.applyMatrix4(matrix);
  const flat = placed.index === null ? placed : placed.toNonIndexed();
  if (flat !== placed) placed.dispose();
  const keep = new Set<string>(["position", ...preserve]);
  for (const name of Object.keys(flat.attributes)) {
    if (!keep.has(name)) flat.deleteAttribute(name);
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
 * Merge game-authored pieces into one buffer, keeping each piece's own colour and, when asked,
 * its uv and authored normals.
 *
 * Two things go wrong every time an agent bakes a building, a ship or a character out of
 * primitives, and neither is about how any of it looks. `mergeGeometries` returns `null` on
 * mismatched inputs instead of throwing, and the usual mismatch — one non-indexed extrusion among
 * a hundred indexed primitives — is invisible until the whole scene is missing; and a merged
 * buffer draws with one surface, so per-piece colour is gone unless every piece carries a flat
 * `color` attribute written before the merge. Writing that attribute is mechanical. The colours
 * are entirely the game's, one per part, and changing them changes nothing here. By default the
 * merged normals are recomputed from the merged buffer; `preserve` keeps the authored normals and
 * texture coordinates instead so an imported model's shading survives the bake.
 */
export function mergeParts(
  parts: Iterable<IMergePart>,
  options: IMergePartsOptions,
): BufferGeometry {
  const list = [...parts];
  const { label } = options;
  const preserve = options.preserve ?? [];
  if (list.length === 0) throw new Error(`mergeParts(${label}): the part list is empty.`);
  const coloured = list.filter((part) => part.color !== undefined).length;
  if (coloured !== 0 && coloured !== list.length) {
    const reason = "A merged buffer needs the attribute on every part or on none of them.";
    throw new Error(
      `mergeParts(${label}): ${coloured} of ${list.length} parts name a colour. ${reason}`,
    );
  }
  list.forEach((part, index) => {
    for (const channel of preserve) {
      if (part.geometry.getAttribute(channel) === undefined) {
        throw new Error(
          `mergeParts(${label}): part ${index} has no ${channel} to preserve. Prepare the missing channel in the part's own data first.`,
        );
      }
    }
  });
  const flattened: BufferGeometry[] = [];
  let merged: BufferGeometry | null;
  try {
    for (const part of list) flattened.push(flatten(part, coloured !== 0, preserve));
    merged = mergeGeometries(flattened, false);
  } finally {
    for (const geometry of flattened) geometry.dispose();
  }
  if (merged === null) {
    const reason = "three.js refused the merge and reported why on the console.";
    const requirement =
      "Every part needs a position attribute, and morph targets do not survive a merge.";
    throw new Error(`mergeParts(${label}): ${reason} Tried ${list.length} parts. ${requirement}`);
  }
  if (!preserve.includes("normal")) merged.computeVertexNormals();
  return merged;
}

/**
 * Bake a hierarchy's static meshes into one mesh per material, transforms and all.
 *
 * A building or a ship is dozens of boxes and cylinders that never move relative to each other, and
 * every one of them is a draw call. Grouping by material and merging each group is the ordinary
 * fix, and the ordinary fix is thirty lines an agent rewrites in every game, each time slightly
 * differently: walk the tree, group by material, bake `matrixWorld` into the vertices, hand the
 * group to `mergeParts`, build a mesh on the game's own material. The parts here are the same
 * `IMergePart` list, so a game that already merges by hand gets the same refusals — a group that
 * cannot merge throws naming `label:material`, not silently vanishing.
 *
 * Nothing here decides how anything looks: the material is the game's own instance, the geometry is
 * exactly what was authored, and the group split follows the materials the game already made.
 *
 * `normal` survives when every mesh in a group carries it and is recomputed otherwise. `uv` survives
 * when any mesh carries it, so a group where only some do is the refusal `mergeParts` raises, never
 * a texture silently left unmapped. Skinned and instanced meshes are left alone — their vertices are not
 * theirs to bake.
 */
export function mergeByMaterial(root: Object3D, options: IMergeByMaterialOptions): Mesh[] {
  root.updateMatrixWorld(true);
  const toRoot = new Matrix4().copy(root.matrixWorld).invert();
  const groups = new Map<Material, Mesh[]>();
  root.traverse((object) => {
    // three's own discriminators, read structurally the way `assets.ts` reads `isTexture`.
    const renderable = object as Mesh & { isInstancedMesh?: boolean; isSkinnedMesh?: boolean };
    if (!renderable.isMesh || renderable.isSkinnedMesh || renderable.isInstancedMesh) return;
    if (Array.isArray(renderable.material) || options.skip?.(renderable) === true) return;
    const group = groups.get(renderable.material);
    if (group === undefined) groups.set(renderable.material, [renderable]);
    else group.push(renderable);
  });
  return [...groups].map(([material, meshes], index) => {
    // A normal missing from one piece is recomputed; a uv missing from one piece is a refusal, since
    // dropping it would leave the group's texture unmapped without a word.
    const has = (mesh: Mesh, channel: "normal" | "uv") =>
      mesh.geometry.getAttribute(channel) !== undefined;
    const preserve = MERGEABLE_CHANNELS.filter((channel) =>
      channel === "uv"
        ? meshes.some((mesh) => has(mesh, channel))
        : meshes.every((mesh) => has(mesh, channel)),
    );
    return new Mesh(
      mergeParts(
        meshes.map((mesh) => ({
          geometry: mesh.geometry,
          matrix: toRoot.clone().multiply(mesh.matrixWorld),
        })),
        { label: `${options.label}:${material.name || index}`, preserve },
      ),
      material,
    );
  });
}

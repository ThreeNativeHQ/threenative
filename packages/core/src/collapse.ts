import { Float32BufferAttribute, Matrix3, Matrix4, Mesh, Uint32BufferAttribute } from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { attribute, normalLocal, positionLocal, storage, vec4 } from "three/tsl";
import { StorageBufferAttribute } from "three/webgpu";

/**
 * Interpreted JavaScript, not the GPU and not the JS→C++ boundary, is what costs a native frame:
 * PRD-068 measured the render-command bindings at ~2% of a CPU-bound frame on a Pixel 8, leaving
 * Three.js render-list build, matrix refresh and culling over every object as the residual. A
 * scene of a few thousand meshes therefore runs at a quarter of its frame budget under QuickJS
 * while the GPU idles.
 *
 * This pass removes that work rather than speeding it up. It watches the scene for a few frames,
 * learns which objects actually move, bakes everything that does not into merged geometry, and
 * gives each moving part one `mat4` in a storage buffer that the vertex shader looks up. Three.js
 * then walks one object per material instead of one per mesh.
 *
 * It is deliberately invisible to the game: nothing here reads a `userData` flag, and a game that
 * does nothing gets the same picture it had before. Where the picture cannot be preserved the pass
 * declines and says why — it never collapses anyway.
 */

interface MaterialLike {
  type: string;
  uuid: string;
  clone(): MaterialLike;
  positionNode?: unknown;
  normalNode?: unknown;
}

interface ObjectLike {
  readonly children: ObjectLike[];
  isLight?: boolean;
  parent: ObjectLike | null;
  visible: boolean;
  matrix: { elements: ArrayLike<number> };
  matrixWorld: Matrix4;
  isCamera?: boolean;
  isMesh?: boolean;
  geometry?: GeometryLike;
  material?: MaterialLike | MaterialLike[];
  add(child: ObjectLike): void;
  remove(child: ObjectLike): void;
  traverse(callback: (object: ObjectLike) => void): void;
  updateMatrixWorld(force?: boolean): void;
}

interface GeometryLike {
  readonly attributes: Record<string, { count: number }>;
  readonly index: unknown;
  clone(): GeometryLike;
  toNonIndexed(): GeometryLike;
  applyMatrix4(matrix: Matrix4): GeometryLike;
  deleteAttribute(name: string): GeometryLike;
  setAttribute(name: string, value: unknown): GeometryLike;
  getAttribute(name: string): { count: number } | undefined;
  dispose(): void;
}

export interface SceneCollapseReport {
  /** True once the scene was replaced by merged geometry. */
  readonly collapsed: boolean;
  /** Why the pass declined, when it did. Absent on success. */
  readonly reason?: string;
  /** Meshes the pass considered — camera-parented subtrees are not counted. */
  readonly sourceMeshes: number;
  /** Draw-visible objects after the collapse, one per material instance in use. */
  readonly mergedMeshes: number;
  /** Moving parts that kept an independent transform. */
  readonly movingParts: number;
}

export interface SceneCollapseOptions {
  /**
   * Frames to watch before deciding what moves. Too few and a slow-moving object is baked static;
   * the watchdog catches that and restores, but the restore costs a visible hitch.
   */
  readonly observeFrames?: number;
  /** Below this mesh count the collapse costs more than it saves and the pass declines. */
  readonly minMeshes?: number;
  /** Called once, when the pass collapses or declines. */
  readonly onReport?: (report: SceneCollapseReport) => void;
}

interface MovingPart {
  readonly index: number;
  readonly object: ObjectLike;
  /**
   * True when the part's scale is uniform. The normal matrix is then proportional to the rotation
   * already sitting in the transform, and since the shader normalises what it reads, the upper
   * 3×3 can be copied straight across. Only genuinely squashed parts pay for an inverse each
   * frame; on the fox that is the difference between 141 matrix inversions a frame and a handful.
   */
  readonly uniformScale: boolean;
}

interface CollapseGroup {
  readonly material: MaterialLike;
  readonly chunks: GeometryLike[];
  readonly dynamic: boolean;
}

/**
 * The only attributes a merged draw keeps. Anything else a source geometry carried — tangents,
 * extra UV sets, skinning weights — is dropped deliberately rather than merged half-present.
 */
const CANONICAL_ATTRIBUTES = ["position", "normal", "uv", "color", "tnOwnerId"];

/** A subtree holding any light stays in the scene, whatever else it also holds. */
function containsLight(object: ObjectLike): boolean {
  let found = false;
  object.traverse((child) => {
    if (child.isLight === true) found = true;
  });
  return found;
}

const objectKeys = new WeakMap<object, string>();

/**
 * Textures are compared by what they contain, not by which object they are. A palette helper that
 * builds its gradient ramp inside the material factory hands every material a byte-identical but
 * distinct texture, and comparing by uuid then split one shared look into 274 separate draws.
 * Pixel data that matches is the same ramp. Textures backed by a decoded image, whose bytes are
 * not reachable here, still fall back to identity.
 */
function objectKey(
  value: Record<string, unknown> & {
    r?: unknown;
    g?: unknown;
    b?: unknown;
    uuid?: unknown;
    image?: unknown;
  },
): string {
  const cached = objectKeys.get(value);
  if (cached !== undefined) return cached;
  const isColor = (value as { isColor?: boolean }).isColor === true;
  let key = isColor ? `rgb:${value.r},${value.g},${value.b}` : String(value.uuid ?? "obj");
  const image = value.image as
    | { width?: number; height?: number; data?: ArrayLike<number> }
    | undefined;
  const data = image?.data;
  if (data !== undefined && typeof data.length === "number") {
    let hash = 2166136261;
    for (let index = 0; index < data.length; index += 1) {
      hash ^= (data[index] ?? 0) & 0xff;
      hash = Math.imul(hash, 16777619);
    }
    key = `tex:${image?.width}x${image?.height}:${data.length}:${(hash >>> 0).toString(36)}`;
    for (const field of [
      "wrapS",
      "wrapT",
      "magFilter",
      "minFilter",
      "format",
      "type",
      "colorSpace",
      "flipY",
    ]) {
      key += `:${String(value[field])}`;
    }
  }
  objectKeys.set(value, key);
  return key;
}

function colorOf(material: MaterialLike): { r: number; g: number; b: number } | undefined {
  const color = (material as { color?: { r: number; g: number; b: number } }).color;
  return color === undefined || typeof color.r !== "number" ? undefined : color;
}

/**
 * The fields that decide how a material looks. Everything outside this list is either identity or
 * Three.js bookkeeping: comparing every own property instead split one shared look into 228 draws
 * because `_listeners`, the internal event map, exists on whichever materials happened to be
 * subscribed. `color` is absent on purpose — it moves to a vertex attribute.
 */
const LOOK_FIELDS = [
  "alphaHash",
  "alphaMap",
  "alphaTest",
  "alphaToCoverage",
  "aoMap",
  "aoMapIntensity",
  "attenuationColor",
  "attenuationDistance",
  "blendAlpha",
  "blendDst",
  "blendEquation",
  "blendSrc",
  "blending",
  "bumpMap",
  "bumpScale",
  "clearcoat",
  "clearcoatMap",
  "clearcoatRoughness",
  "clipIntersection",
  "clipShadows",
  "clippingPlanes",
  "colorWrite",
  "combine",
  "depthFunc",
  "depthTest",
  "depthWrite",
  "displacementBias",
  "displacementMap",
  "displacementScale",
  "dithering",
  "emissive",
  "emissiveIntensity",
  "emissiveMap",
  "envMap",
  "envMapIntensity",
  "flatShading",
  "fog",
  "forceSinglePass",
  "gradientMap",
  "ior",
  "iridescence",
  "lightMap",
  "lightMapIntensity",
  "map",
  "metalness",
  "metalnessMap",
  "normalMap",
  "normalMapType",
  "normalScale",
  "opacity",
  "polygonOffset",
  "polygonOffsetFactor",
  "polygonOffsetUnits",
  "premultipliedAlpha",
  "reflectivity",
  "refractionRatio",
  "roughness",
  "roughnessMap",
  "sheen",
  "sheenColor",
  "shadowSide",
  "shininess",
  "side",
  "specular",
  "specularMap",
  "stencilWrite",
  "toneMapped",
  "transmission",
  "transparent",
  "vertexColors",
  "visible",
  "wireframe",
];

/**
 * Two materials may share a merged draw only when nothing but their colour differs. Every other
 * field — class, maps, transparency, side, ramp — is part of how the game looks, so any
 * disagreement keeps them in separate groups rather than silently picking one.
 */
function materialSignature(material: MaterialLike): string {
  const source = material as unknown as Record<string, unknown>;
  const parts: string[] = [material.type];
  for (const key of LOOK_FIELDS) {
    const value = source[key];
    if (value === undefined) continue;
    if (value === null) {
      parts.push(`${key}:none`);
      continue;
    }
    parts.push(
      typeof value === "object"
        ? `${key}:${objectKey(value as Record<string, unknown>)}`
        : `${key}:${String(value)}`,
    );
  }
  return parts.join("|");
}

function materialOf(object: ObjectLike): MaterialLike | undefined {
  const material = object.material;
  if (material === undefined) return undefined;
  return Array.isArray(material) ? material[0] : material;
}

/**
 * Rotating a normal by the object matrix is only correct while the scale is uniform, and real
 * rigs are full of squashed primitives — the first run of this pass declined a whole level over
 * a torso scaled `1, 1, 0.92`. So each moving part uploads its normal matrix too: the inverse
 * transpose of the upper 3×3, widened into a mat4 because that is what aligns cleanly in a
 * storage buffer. It costs one 3×3 inverse per moving part per frame.
 */
function writeNormalMatrix(target: Float32Array, offset: number, source: Matrix3): void {
  const e = source.elements;
  target[offset] = e[0] ?? 0;
  target[offset + 1] = e[1] ?? 0;
  target[offset + 2] = e[2] ?? 0;
  target[offset + 3] = 0;
  target[offset + 4] = e[3] ?? 0;
  target[offset + 5] = e[4] ?? 0;
  target[offset + 6] = e[5] ?? 0;
  target[offset + 7] = 0;
  target[offset + 8] = e[6] ?? 0;
  target[offset + 9] = e[7] ?? 0;
  target[offset + 10] = e[8] ?? 0;
  target[offset + 11] = 0;
  target[offset + 15] = 1;
}

/** Whether a transform scales every axis equally, within a tolerance that ignores float drift. */
function hasUniformScale(matrix: Matrix4): boolean {
  const e = matrix.elements;
  const x = Math.hypot(e[0] ?? 0, e[1] ?? 0, e[2] ?? 0);
  const y = Math.hypot(e[4] ?? 0, e[5] ?? 0, e[6] ?? 0);
  const z = Math.hypot(e[8] ?? 0, e[9] ?? 0, e[10] ?? 0);
  const largest = Math.max(x, y, z);
  if (largest === 0) return true;
  return Math.max(Math.abs(x - y), Math.abs(y - z), Math.abs(x - z)) / largest < 1e-4;
}

function writeNormals(target: Float32Array, part: MovingPart, scratch: Matrix3): void {
  const offset = part.index * 16;
  if (part.uniformScale) {
    const e = part.object.matrixWorld.elements;
    target[offset] = e[0] ?? 0;
    target[offset + 1] = e[1] ?? 0;
    target[offset + 2] = e[2] ?? 0;
    target[offset + 4] = e[4] ?? 0;
    target[offset + 5] = e[5] ?? 0;
    target[offset + 6] = e[6] ?? 0;
    target[offset + 8] = e[8] ?? 0;
    target[offset + 9] = e[9] ?? 0;
    target[offset + 10] = e[10] ?? 0;
    target[offset + 15] = 1;
    return;
  }
  writeNormalMatrix(target, offset, scratch.getNormalMatrix(part.object.matrixWorld));
}

function sameMatrix(a: ArrayLike<number>, b: ArrayLike<number>): boolean {
  for (let index = 0; index < 16; index += 1) if (a[index] !== b[index]) return false;
  return true;
}

/**
 * Attribute sets have to agree before geometries can merge. Rather than invent the missing ones —
 * a fabricated UV or normal is a silent visual change — the pass merges on the intersection and
 * declines the group if `position` is not in it.
 */
function sharedAttributeNames(chunks: GeometryLike[]): string[] {
  let shared: string[] | undefined;
  for (const chunk of chunks) {
    const names = Object.keys(chunk.attributes);
    shared = shared === undefined ? names : shared.filter((name) => names.includes(name));
  }
  return shared ?? [];
}

export class SceneCollapse {
  readonly #scene: ObjectLike;
  readonly #observeFrames: number;
  readonly #minMeshes: number;
  readonly #onReport: (report: SceneCollapseReport) => void;
  readonly #samples = new Map<ObjectLike, Float64Array>();
  readonly #moving = new Set<ObjectLike>();
  readonly #changes = new Map<ObjectLike, number>();
  #observed = 0;
  #meshCount = -1;
  #reportedSmall = false;
  #report: SceneCollapseReport | undefined;
  #restore: (() => void) | undefined;
  #update: (() => void) | undefined;

  constructor(scene: ObjectLike, options: SceneCollapseOptions = {}) {
    const observeFrames = options.observeFrames ?? 45;
    const minMeshes = options.minMeshes ?? 200;
    if (!Number.isInteger(observeFrames) || observeFrames < 1)
      throw new Error("SceneCollapse.observeFrames must be a positive integer.");
    if (!Number.isInteger(minMeshes) || minMeshes < 1)
      throw new Error("SceneCollapse.minMeshes must be a positive integer.");
    this.#scene = scene;
    this.#observeFrames = observeFrames;
    this.#minMeshes = minMeshes;
    // A pass that silently declines is a pass nobody can debug: the frame rate simply stays bad
    // and the reason never leaves the process. It always says what it decided.
    this.#onReport =
      options.onReport ??
      ((report) => {
        console.info(`TN_SCENE_COLLAPSE:${JSON.stringify(report)}`);
      });
  }

  /** The pass has reached a verdict — collapsed or declined. */
  get settled(): boolean {
    return this.#report !== undefined;
  }

  get report(): SceneCollapseReport | undefined {
    return this.#report;
  }

  /**
   * Call once per rendered frame. Samples local matrices until the observation window closes, then
   * collapses; afterwards it refreshes the moving parts' transforms.
   */
  frame(): void {
    if (this.#report !== undefined) {
      this.#update?.();
      return;
    }
    // A scene is not ready to be judged while it is still being built: counting frames alone
    // decided once at nine meshes, before the level existed. Waiting for the count to hold
    // perfectly still is the opposite mistake — a running game spawns and retires meshes every
    // frame, so the window reset forever. The window opens when the scene first gets big enough
    // to be worth collapsing, and runs from there.
    if (this.#meshCount < this.#minMeshes) {
      this.#meshCount = this.#countMeshes();
      if (this.#meshCount < this.#minMeshes) {
        if (!this.#reportedSmall) {
          this.#reportedSmall = true;
          this.#onReport({
            collapsed: false,
            reason: `fewer than ${this.#minMeshes} meshes so far; still watching`,
            sourceMeshes: this.#meshCount,
            mergedMeshes: 0,
            movingParts: 0,
          });
        }
        return;
      }
    }
    this.#sample();
    this.#observed += 1;
    if (this.#observed >= this.#observeFrames) this.#collapse();
  }

  /** Put the original scene back. Used when a supposedly static object turns out to move. */
  restore(): void {
    this.#restore?.();
    this.#restore = undefined;
    this.#update = undefined;
  }

  #countMeshes(): number {
    let count = 0;
    this.#scene.traverse((object) => {
      if (object.isMesh === true) count += 1;
    });
    return count;
  }

  #sample(): void {
    this.#scene.traverse((object) => {
      if (object.isCamera === true) return;
      const previous = this.#samples.get(object);
      if (previous === undefined) {
        // Float64, not Float32: rounding each double to a float on the way in made every object
        // compare unequal to itself on the next frame, and a whole static level read as animated.
        this.#samples.set(object, Float64Array.from(object.matrix.elements));
        return;
      }
      if (sameMatrix(previous, object.matrix.elements)) return;
      previous.set(object.matrix.elements);
      // One change is not motion. A mesh added mid-window is composed from its position and
      // quaternion on the first render after it appears, which reads exactly like a move and
      // classified an entire static level as animated. Motion is change that keeps happening.
      const changes = (this.#changes.get(object) ?? 0) + 1;
      this.#changes.set(object, changes);
      if (changes >= 2) this.#moving.add(object);
    });
  }

  #decline(reason: string, sourceMeshes: number): void {
    this.#report = { collapsed: false, reason, sourceMeshes, mergedMeshes: 0, movingParts: 0 };
    this.#onReport(this.#report);
  }

  /**
   * A camera-parented subtree — where every framework HUD lives — must survive untouched. Baking
   * its world matrix would strand it wherever the camera happened to be when the pass ran.
   */
  #excluded(object: ObjectLike): boolean {
    for (let current: ObjectLike | null = object; current !== null; current = current.parent) {
      if (current.isCamera === true) return true;
    }
    return false;
  }

  /**
   * The owner is the mesh's own parent whenever anything above it animates, not the nearest node
   * observed moving. Picking the nearest mover assumes every node between it and the mesh is
   * static, and a joint that happens to hold still during the observation window then freezes its
   * geometry for good — the fox's limbs glitching mid-stride. Uploading the parent's world matrix
   * carries the whole chain every frame and assumes nothing.
   */
  #ownerOf(object: ObjectLike): ObjectLike | undefined {
    let animated = false;
    for (let current: ObjectLike | null = object; current !== null; current = current.parent) {
      if (this.#moving.has(current)) {
        animated = true;
        break;
      }
    }
    if (!animated) return undefined;
    return object.parent ?? object;
  }

  #collapse(): void {
    this.#scene.updateMatrixWorld(true);
    const meshes: ObjectLike[] = [];
    this.#scene.traverse((object) => {
      if (object.isMesh !== true) return;
      if (this.#excluded(object)) return;
      if (object.geometry?.getAttribute("position") === undefined) return;
      meshes.push(object);
    });
    if (meshes.length < this.#minMeshes) {
      // The camera subtree is excluded here but not by the counter that opened the window, so a
      // scene can still fall under the floor at this point. Reopen the window rather than settle.
      this.#meshCount = 0;
      this.#observed = 0;
      return;
    }

    const movingParts: MovingPart[] = [];
    const movingIndex = new Map<ObjectLike, number>();
    const groups = new Map<string, CollapseGroup>();
    const bakedFrom: { mesh: ObjectLike; parent: ObjectLike }[] = [];
    const inverse = new Matrix4();

    for (const mesh of meshes) {
      const material = materialOf(mesh);
      if (material === undefined) {
        this.#decline("a mesh has no material", meshes.length);
        return;
      }
      const owner = this.#ownerOf(mesh);
      let ownerId: number | undefined;
      if (owner !== undefined) {
        ownerId = movingIndex.get(owner);
        if (ownerId === undefined) {
          ownerId = movingParts.length;
          movingIndex.set(owner, ownerId);
          movingParts.push({
            index: ownerId,
            object: owner,
            uniformScale: hasUniformScale(owner.matrixWorld),
          });
        }
      }
      const local =
        owner === undefined
          ? mesh.matrixWorld
          : inverse.copy(owner.matrixWorld).invert().multiply(mesh.matrixWorld);
      const source = mesh.geometry;
      if (source === undefined) {
        this.#decline("a mesh lost its geometry between the scan and the merge", meshes.length);
        return;
      }
      const geometry = (
        source.index !== null ? source.toNonIndexed() : source.clone()
      ).applyMatrix4(new Matrix4().copy(local));
      // Reduce every chunk to the same canonical attributes before grouping. Merging geometries
      // whose attribute sets disagree used to intersect them, and the first casualty was `normal`:
      // lit materials then shaded from nothing and the entire level rendered black while the
      // unlit HUD and waterfalls looked perfect. Missing normals are computed, never dropped.
      for (const name of Object.keys(geometry.attributes)) {
        if (!CANONICAL_ATTRIBUTES.includes(name)) geometry.deleteAttribute(name);
      }
      if (geometry.getAttribute("normal") === undefined)
        (geometry as unknown as { computeVertexNormals(): void }).computeVertexNormals();
      if (ownerId !== undefined) {
        const count = geometry.getAttribute("position")?.count ?? 0;
        const ids = new Uint32Array(count);
        ids.fill(ownerId);
        geometry.setAttribute("tnOwnerId", new Uint32BufferAttribute(ids, 1));
      }
      // Grouping by material identity produced 274 draws and as many compiled shaders, which cost
      // more than the 2,282 objects it replaced. Palettes are the common case: dozens of
      // materials identical but for `color`. Those merge into one group with the colour moved to
      // a vertex attribute, so the class, the toon ramp and every map still come from the game.
      // Anything else about the material differing keeps the groups apart.
      // Transparent surfaces are never colour-merged. Blending depends on the order the draws
      // arrive in, and Three.js can only sort whole objects — fold a dozen transparent materials
      // into one buffer and that ordering is gone, which reads on screen as shading that flickers
      // as the camera moves. They stay one draw per material, and there are few of them.
      const blended = (material as unknown as { transparent?: boolean }).transparent === true;
      // The static/moving split belongs in every key. Without it a transparent material used by
      // both a wall and a moving part merged into one draw whose shader looked up a per-vertex
      // owner id that half the vertices did not carry, and the whole scene rendered colourless.
      const kind = owner === undefined ? "static" : "moving";
      const color = colorOf(material);
      // Every chunk is given the identical attribute set, so shape stops being a reason to split.
      // Letting it vary left 225 groups whose materials were otherwise interchangeable: a mesh
      // without UVs could not join one with them. A UV nobody samples is harmless — a material
      // that samples a map is already held apart by its signature.
      const count = geometry.getAttribute("position")?.count ?? 0;
      if (geometry.getAttribute("uv") === undefined)
        geometry.setAttribute("uv", new Float32BufferAttribute(new Float32Array(count * 2), 2));
      const rgb = color ?? { r: 1, g: 1, b: 1 };
      // A geometry may already carry colours the game painted itself — the sky bakes its gradient
      // that way, and overwriting it turned the sky flat white and hid every cloud against it.
      // Three multiplies material colour by vertex colour, so folding one into the other keeps
      // both: an absent attribute is white and leaves the material colour untouched.
      const painted =
        (material as unknown as { vertexColors?: boolean }).vertexColors === true
          ? (geometry.getAttribute("color") as unknown as
              | { getX(i: number): number; getY(i: number): number; getZ(i: number): number }
              | undefined)
          : undefined;
      const colors = new Float32Array(count * 3);
      for (let index = 0; index < count; index += 1) {
        colors[index * 3] = rgb.r * (painted ? painted.getX(index) : 1);
        colors[index * 3 + 1] = rgb.g * (painted ? painted.getY(index) : 1);
        colors[index * 3 + 2] = rgb.b * (painted ? painted.getZ(index) : 1);
      }
      geometry.setAttribute("color", new Float32BufferAttribute(colors, 3));
      // Transparent materials were once held apart by identity to protect blend order. On a real
      // scene that meant 220 of 225 draws, and the frame cost of that dwarfed any ordering it
      // bought. They group by look like everything else; opacity, depthWrite and blend mode are
      // all part of the signature, so only genuinely interchangeable surfaces end up together.
      const key = `${kind}|${materialSignature(material)}`;
      const group = groups.get(key) ?? { material, chunks: [], dynamic: owner !== undefined };
      group.chunks.push(geometry);
      groups.set(key, group);
      if (mesh.parent !== null) bakedFrom.push({ mesh, parent: mesh.parent });
    }

    const slots = Math.max(1, movingParts.length);
    const transformData = new Float32Array(slots * 16);
    const normalData = new Float32Array(slots * 16);
    const normalMatrix = new Matrix3();
    for (const part of movingParts) {
      transformData.set(part.object.matrixWorld.elements, part.index * 16);
      writeNormals(normalData, part, normalMatrix);
    }
    const transformAttribute = new StorageBufferAttribute(transformData, 16);
    const normalAttribute = new StorageBufferAttribute(normalData, 16);
    const transformNode = storage(transformAttribute, "mat4", slots);
    const normalNodes = storage(normalAttribute, "mat4", slots);
    const ownerIdNode = attribute("tnOwnerId", "uint") as never;
    const ownerMatrix = transformNode.element(ownerIdNode);
    const ownerNormalMatrix = normalNodes.element(ownerIdNode);

    const added: ObjectLike[] = [];
    let mergedMeshes = 0;
    for (const group of groups.values()) {
      const shared = sharedAttributeNames(group.chunks);
      if (!shared.includes("position")) {
        this.#decline("a merge group disagrees on its position attribute", meshes.length);
        return;
      }
      for (const chunk of group.chunks) {
        for (const name of Object.keys(chunk.attributes)) {
          if (!shared.includes(name)) chunk.deleteAttribute(name);
        }
      }
      const geometry = mergeGeometries(group.chunks as never[], false);
      if (geometry === null) {
        this.#decline("three.js refused to merge a group", meshes.length);
        return;
      }
      // Static geometry keeps the game's own material instance untouched: same class, same maps,
      // same toon ramp. Only a moving group needs a node material, and only to add the lookup.
      // The group's colours now live per vertex, so the shared material has to read them from
      // there. Cloned, never constructed: this is still the game's material.
      let material = group.material;
      if (geometry.getAttribute("color") !== undefined) {
        material = material.clone();
        const tinted = material as unknown as {
          vertexColors: boolean;
          color?: { setRGB(r: number, g: number, b: number): void };
        };
        tinted.vertexColors = true;
        // Three multiplies the material colour by the vertex colour. The group's representative
        // still carries whichever colour it happened to have, so leaving it in tints every other
        // material in the group by it — the whole palette came out wrong. White is the identity.
        tinted.color?.setRGB(1, 1, 1);
      }
      if (geometry.getAttribute("normal") === undefined) {
        // Every chunk had normals going in, so losing them here means the merge disagreed about
        // shape. Lit materials would render black; decline instead of shipping a black level.
        this.#decline("a merge group lost its normals", meshes.length);
        return;
      }
      if (group.dynamic && geometry.getAttribute("tnOwnerId") === undefined) {
        // The shader below indexes a transform by a per-vertex id. If the merge dropped that
        // attribute the lookup is undefined and the draw renders garbage — which it did, silently.
        this.#decline(
          "a moving group lost its per-vertex transform id in the merge",
          meshes.length,
        );
        return;
      }
      if (group.dynamic) {
        // A clone, never a fresh material: the class, the colour, the toon ramp and every map
        // stay the game's. This pass adds a vertex lookup; it does not decide how anything looks.
        const node = material.clone();
        node.positionNode = ownerMatrix.mul(vec4(positionLocal, 1)).xyz;
        // Rotating a part without rotating its normal leaves its shading frozen in place.
        node.normalNode = ownerNormalMatrix.mul(vec4(normalLocal, 0)).xyz.normalize();
        material = node;
      }
      const mesh = new Mesh(geometry as never, material as never);
      // The merged geometry spans the level, so a bounding-sphere test can only ever say "visible".
      mesh.frustumCulled = false;
      this.#scene.add(mesh as never as ObjectLike);
      added.push(mesh as never as ObjectLike);
      mergedMeshes += 1;
    }

    // Removing the source meshes is not enough. Three.js walks the whole graph every frame to
    // refresh world matrices, so the level's remaining Groups still cost a full traversal while
    // drawing nothing — which is why the first collapsed build ran slower than no collapse at
    // all. The consumed hierarchy leaves the scene entirely; the game keeps its own references
    // and goes on animating them, and this pass recomputes the moving subtrees by hand.
    for (const entry of bakedFrom) entry.parent.remove(entry.mesh);
    const detached: ObjectLike[] = [];
    for (const child of [...this.#scene.children]) {
      if (child.isCamera === true || added.includes(child)) continue;
      // Lights are not geometry and were never collapsed, but they live in the same tree. Sweeping
      // them out with it left every lit material shading from nothing: the level went black while
      // the unlit HUD and waterfalls looked perfect.
      if (containsLight(child)) continue;
      detached.push(child);
      this.#scene.remove(child);
    }
    const movingRoots: ObjectLike[] = [];
    for (const part of movingParts) {
      let root = part.object;
      while (root.parent !== null) root = root.parent;
      if (!movingRoots.includes(root)) movingRoots.push(root);
    }

    this.#update = () => {
      // Only the subtrees that actually move are walked now, instead of the whole level.
      for (const root of movingRoots) root.updateMatrixWorld(true);
      for (const part of movingParts) {
        transformData.set(part.object.matrixWorld.elements, part.index * 16);
        writeNormals(normalData, part, normalMatrix);
        if (part.object.visible !== true) {
          // A hidden part has no draw of its own to skip, so it is pushed out of the frustum.
          transformData[part.index * 16 + 12] = 1e9;
          transformData[part.index * 16 + 13] = 1e9;
          transformData[part.index * 16 + 14] = 1e9;
        }
      }
      if (movingParts.length > 0) {
        transformAttribute.needsUpdate = true;
        normalAttribute.needsUpdate = true;
      }
    };
    this.#restore = () => {
      for (const mesh of added) this.#scene.remove(mesh);
      for (const entry of bakedFrom) entry.parent.add(entry.mesh);
      for (const child of detached) this.#scene.add(child);
    };
    this.#report = {
      collapsed: true,
      sourceMeshes: meshes.length,
      mergedMeshes,
      movingParts: movingParts.length,
    };
    this.#onReport(this.#report);
  }
}

import {
  type BufferGeometry,
  InstancedMesh,
  type Material,
  type Matrix4,
  Object3D,
  Quaternion,
  Vector3,
} from "three";

/** The axis a unit-height geometry is laid out along, and the axis {@link InstancedBatch.span} rotates from. */
const UP = new Vector3(0, 1, 0);
/** Shorter than this and `from` and `to` are the same point, so there is no direction to face. */
const MIN_SPAN = 1e-5;

/** One instance's transform, in the units the geometry was authored in. */
export interface IInstancedPlacement {
  /** World position of the instance's origin, as `[x, y, z]`. */
  readonly position: readonly [number, number, number];
  /** Euler rotation in radians, as `[x, y, z]`. Default none. */
  readonly rotation?: readonly [number, number, number];
  /** Per-axis scale as `[x, y, z]`, or one number for all three. Default 1. */
  readonly scale?: readonly [number, number, number] | number;
}

export interface IInstancedBatchOptions {
  /** The shape every instance draws, supplied by the game. */
  readonly geometry: BufferGeometry;
  /**
   * The surface every instance draws with, supplied by the game and used by reference — recolour
   * it and the whole batch recolours. Required: collapsing the draws is the engine's job, what
   * the props look like never is.
   */
  readonly material: Material;
}

export interface IInstancedBatchBuildOptions {
  /** Passed straight to the built mesh. Default `false`, as in Three.js. */
  readonly castShadow?: boolean;
  /** Name on the built mesh, so a capture or a scene dump can tell one batch from another. */
  readonly name?: string;
  /** Added to this object when the batch builds. Omit to take the mesh and place it yourself. */
  readonly parent?: Object3D;
  /** Passed straight to the built mesh. Default `false`, as in Three.js. */
  readonly receiveShadow?: boolean;
}

/**
 * Collapses many copies of one shape into a single draw, without knowing the count up front.
 *
 * `new InstancedMesh(geometry, material, count)` needs `count` before anything has been placed, so
 * a procedural builder either walks its own layout twice, over-allocates and fixes `.count`
 * afterwards, or gathers transforms into an array first. This is that array, with the
 * `Object3D`-scratch-and-`updateMatrix` dance and the post-fill bookkeeping — `instanceMatrix`
 * invalidation and a bounding sphere the culler can use — done once instead of at every site.
 *
 * It decides nothing about how the result looks: the shape, the surface and every transform are
 * the game's, and the built mesh is handed back so the game can keep animating instances by index.
 */
export class InstancedBatch {
  readonly geometry: BufferGeometry;
  readonly material: Material;
  readonly #matrices: Matrix4[] = [];
  readonly #scratch = new Object3D();
  readonly #direction = new Vector3();
  readonly #midpoint = new Vector3();
  readonly #rotation = new Quaternion();
  #mesh: InstancedMesh | undefined;

  constructor(options: IInstancedBatchOptions) {
    if (options === undefined || options === null)
      throw new Error("InstancedBatch requires geometry and material options.");
    if (options.geometry === undefined || options.geometry === null)
      throw new Error("InstancedBatch.geometry is required.");
    if (options.material === undefined || options.material === null)
      throw new Error("InstancedBatch.material is required; the batch never chooses one.");
    this.geometry = options.geometry;
    this.material = options.material;
  }

  /** How many instances have been placed so far. */
  get count(): number {
    return this.#matrices.length;
  }

  /** The built mesh, or `undefined` before {@link build} — never a guess. */
  get mesh(): InstancedMesh | undefined {
    return this.#mesh;
  }

  /**
   * Records one instance from a matrix the game composed itself, and returns its instance index.
   *
   * The matrix is copied, so the caller may reuse a single scratch `Matrix4` across every call.
   */
  add(matrix: Matrix4): number {
    this.#assertOpen("add");
    if (matrix === undefined || matrix === null)
      throw new Error("InstancedBatch.add requires a Matrix4.");
    this.#matrices.push(matrix.clone());
    return this.#matrices.length - 1;
  }

  /** Records one instance from position, scale and Euler rotation, and returns its instance index. */
  place(placement: IInstancedPlacement): number {
    this.#assertOpen("place");
    if (placement === undefined || placement === null)
      throw new Error("InstancedBatch.place requires a placement.");
    const [x, y, z] = requireTriple(placement.position, "InstancedBatch.place position");
    const scale = placement.scale ?? 1;
    const [sx, sy, sz] =
      typeof scale === "number"
        ? requireScalar(scale)
        : requireTriple(scale, "InstancedBatch.place scale");
    const [rx, ry, rz] =
      placement.rotation === undefined
        ? ([0, 0, 0] as const)
        : requireTriple(placement.rotation, "InstancedBatch.place rotation");
    this.#scratch.position.set(x, y, z);
    this.#scratch.quaternion.identity();
    this.#scratch.rotation.set(rx, ry, rz);
    this.#scratch.scale.set(sx, sy, sz);
    this.#scratch.updateMatrix();
    this.#matrices.push(this.#scratch.matrix.clone());
    return this.#matrices.length - 1;
  }

  /**
   * Records one instance stretched between two points, and returns its instance index.
   *
   * Chains, tie rods, railing bars, struts and cables are all "from A to B" rather than "at P with
   * rotation R". Deriving the orientation here is what keeps every caller from hand-computing an
   * Euler angle that goes wrong the moment one endpoint moves.
   */
  span(
    from: readonly [number, number, number],
    to: readonly [number, number, number],
    radius: number,
  ): number {
    this.#assertOpen("span");
    const [fx, fy, fz] = requireTriple(from, "InstancedBatch.span from");
    const [tx, ty, tz] = requireTriple(to, "InstancedBatch.span to");
    if (!Number.isFinite(radius) || radius <= 0)
      throw new Error("InstancedBatch.span radius must be a positive finite number.");
    this.#direction.set(tx - fx, ty - fy, tz - fz);
    const length = this.#direction.length();
    // Fail closed rather than skip. `place` and `span` return the index a game animates by, so a
    // silently dropped instance shifts every later index and the caller's own bookkeeping with it.
    if (length < MIN_SPAN)
      throw new Error(
        "InstancedBatch.span endpoints are the same point, so there is no direction.",
      );
    this.#direction.divideScalar(length);
    this.#rotation.setFromUnitVectors(UP, this.#direction);
    this.#midpoint.set((fx + tx) / 2, (fy + ty) / 2, (fz + tz) / 2);
    this.#scratch.position.copy(this.#midpoint);
    this.#scratch.rotation.set(0, 0, 0);
    this.#scratch.quaternion.copy(this.#rotation);
    this.#scratch.scale.set(radius, length, radius);
    this.#scratch.updateMatrix();
    this.#matrices.push(this.#scratch.matrix.clone());
    return this.#matrices.length - 1;
  }

  /**
   * Turns everything placed so far into one `InstancedMesh`, and returns it.
   *
   * Returns `undefined` when nothing was placed. That is deliberate: `new InstancedMesh(g, m, 0)`
   * satisfies every type check and draws nothing, so a builder whose layout produced no instances
   * would look identical to one that worked. `undefined` puts that case in the caller's types.
   */
  build(options: IInstancedBatchBuildOptions = {}): InstancedMesh | undefined {
    if (this.#mesh !== undefined)
      throw new Error("InstancedBatch.build was already called; the instance count is fixed.");
    if (this.#matrices.length === 0) return undefined;
    const mesh = new InstancedMesh(this.geometry, this.material, this.#matrices.length);
    if (options.name !== undefined) mesh.name = options.name;
    for (let index = 0; index < this.#matrices.length; index += 1) {
      mesh.setMatrixAt(index, this.#matrices[index] as Matrix4);
    }
    mesh.instanceMatrix.needsUpdate = true;
    mesh.castShadow = options.castShadow ?? false;
    mesh.receiveShadow = options.receiveShadow ?? false;
    // Without this the batch is culled against the bounds of a single un-transformed copy, so a
    // spread-out batch pops out of view long before it leaves the frustum.
    mesh.computeBoundingSphere();
    this.#mesh = mesh;
    options.parent?.add(mesh);
    return mesh;
  }

  #assertOpen(method: string): void {
    if (this.#mesh !== undefined)
      throw new Error(
        `InstancedBatch.${method} after build(): an InstancedMesh has a fixed instance count.`,
      );
  }
}

function requireScalar(value: number): readonly [number, number, number] {
  if (!Number.isFinite(value))
    throw new Error("InstancedBatch.place scale must be a finite number.");
  return [value, value, value];
}

function requireTriple(
  value: readonly [number, number, number] | undefined,
  label: string,
): readonly [number, number, number] {
  if (value === undefined || value === null || value.length !== 3)
    throw new Error(`${label} must be a [x, y, z] triple.`);
  const [x, y, z] = value;
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z))
    throw new Error(`${label} must be three finite numbers.`);
  return [x, y, z];
}

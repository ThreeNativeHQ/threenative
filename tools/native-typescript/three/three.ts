// The `three` module for native TypeScript (PRD-506, decision 11): three's class names over the
// engine's C ABI, for programs Perry compiles ahead of time. Game code imports from "three"
// unchanged; the corpus runner stages this file as that module and links tn_three_shim.c, the hooks
// and the engine. Every call goes through the Perry adapter, which owns Perry's value
// representation and the engine knows nothing of Perry.
// It covers the classes the qualification fixtures use; the catalog's supported set is the bound.
//
// An engine object is named by a small integer, and the class instance below is the program's
// wrapper for it: one wrapper per engine object, kept in `objects` so a round trip through the engine
// returns the same object (`getObjectById(id) === mesh`).
//
// Lifetime: Perry 0.5.1520 pins any object handed to a native-library function as a `jsvalue`
// argument, so a wrapper never crosses the FFI boundary — that would make it immortal. The wrapper
// table lives here instead, and the adapter is told to release an engine object from `forget()`.
import * as adapter from "tn-three-adapter";

/** An engine object, named by the adapter's number for it; 0 is no object. */
type Handle = adapter.TnObject;

const NO_OBJECT = 0;

/** The program's wrapper for each engine object it holds, indexed by the object itself. An array,
 * not a Map: Perry's collector leaves Map churn resident, and a slot-indexed array does not. */
const objects: unknown[] = [];

function create(className: string): Handle {
  adapter.init();
  const handle = adapter.construct(className);
  if (handle === NO_OBJECT) throw `TN_AOT_CONSTRUCT_REFUSED ${className}`;
  return handle;
}

function readNumber(handle: Handle, path: string): number {
  if (handle === NO_OBJECT) throw `TN_AOT_GET_REFUSED ${path}`;
  if (adapter.get(handle, path) < 0) throw `TN_AOT_GET_REFUSED ${path}`;
  return adapter.resultNumber();
}

function readString(handle: Handle, path: string): string {
  if (handle === NO_OBJECT) throw `TN_AOT_GET_REFUSED ${path}`;
  if (adapter.get(handle, path) < 0) throw `TN_AOT_GET_REFUSED ${path}`;
  return adapter.resultString();
}

function readObject(handle: Handle, path: string): Handle {
  if (adapter.get(handle, path) < 0) throw `TN_AOT_GET_REFUSED ${path}`;
  return adapter.resultObject();
}

function writeNumber(handle: Handle, path: string, value: number): void {
  if (handle === NO_OBJECT) throw `TN_AOT_SET_REFUSED ${path}`;
  if (adapter.setNumber(handle, path, value) < 0) throw `TN_AOT_SET_REFUSED ${path}`;
}

/** The program's wrapper for an engine object, or a new Object3D when it has none yet. */
function objectFor(handle: Handle): Object3D | null {
  if (handle === NO_OBJECT) return null;
  const known = objects[handle];
  return (known as Object3D | undefined) ?? new Object3D(handle);
}

export class Vector3 {
  slot: Handle;
  // `adopt` names an engine object that already exists (a member such as mesh.position).
  constructor(x?: number, y?: number, z?: number, adopt?: Handle) {
    if (adopt !== undefined && adopt !== null) {
      this.slot = adopt;
    } else {
      adapter.argNumber(x === undefined ? 0 : x);
      adapter.argNumber(y === undefined ? 0 : y);
      adapter.argNumber(z === undefined ? 0 : z);
      this.slot = create("Vector3");
    }
    objects[this.slot] = this;
  }
  get x(): number {
    return readNumber(this.slot, "x");
  }
  set x(value: number) {
    writeNumber(this.slot, "x", value);
  }
  get y(): number {
    return readNumber(this.slot, "y");
  }
  set y(value: number) {
    writeNumber(this.slot, "y", value);
  }
  get z(): number {
    return readNumber(this.slot, "z");
  }
  set z(value: number) {
    writeNumber(this.slot, "z", value);
  }
}

export class BoxGeometry {
  slot: Handle;
  constructor(width?: number, height?: number, depth?: number) {
    adapter.argNumber(width === undefined ? 1 : width);
    adapter.argNumber(height === undefined ? 1 : height);
    adapter.argNumber(depth === undefined ? 1 : depth);
    this.slot = create("BoxGeometry");
    objects[this.slot] = this;
  }
  get type(): string {
    return readString(this.slot, "type");
  }
}

export class MeshStandardMaterial {
  slot: Handle;
  constructor() {
    this.slot = create("MeshStandardMaterial");
    objects[this.slot] = this;
  }
  get type(): string {
    return readString(this.slot, "type");
  }
}

type BeforeRender = (
  renderer: null,
  scene: Object3D | null,
  camera: Object3D | null,
  geometry: BoxGeometry | null,
  material: MeshStandardMaterial | null,
  group: null,
) => void;

export class Object3D {
  slot: Handle;
  positionMember: Vector3 | undefined;
  beforeRender: BeforeRender | undefined;
  constructor(slot: Handle) {
    this.slot = slot;
    objects[slot] = this;
  }
  get type(): string {
    return readString(this.slot, "type");
  }
  get id(): number {
    return readNumber(this.slot, "id");
  }
  get name(): string {
    return readString(this.slot, "name");
  }
  get position(): Vector3 {
    if (this.positionMember === undefined)
      this.positionMember = new Vector3(0, 0, 0, readObject(this.slot, "position"));
    return this.positionMember;
  }
  // three's onBeforeRender: the engine calls it before the object is drawn. The closure handed to
  // the engine captures this wrapper, so two meshes with callbacks each run their own.
  get onBeforeRender(): BeforeRender | undefined {
    return this.beforeRender;
  }
  set onBeforeRender(fn: BeforeRender | undefined) {
    this.beforeRender = fn;
    if (
      adapter.setCallback(
        this.slot,
        "onBeforeRender",
        fn === undefined
          ? undefined
          : (scene: Handle, camera: Handle, geometry: Handle, material: Handle): number =>
              runBeforeRender(this, scene, camera, geometry, material),
      ) < 0
    )
      throw "TN_AOT_CALLBACK_REFUSED onBeforeRender";
  }
  /** Releases this object's engine handle. Game code calls it where three calls `dispose()`. */
  dispose(): void {
    if (this.slot === NO_OBJECT) return;
    adapter.release(this.slot);
    objects[this.slot] = undefined;
  }
  add(child: Object3D): Object3D {
    adapter.argObject(child.slot);
    if (adapter.invoke(this.slot, "add") < 0) throw "TN_AOT_INVOKE_REFUSED add";
    return this;
  }
  remove(child: Object3D): Object3D {
    adapter.argObject(child.slot);
    if (adapter.invoke(this.slot, "remove") < 0) throw "TN_AOT_INVOKE_REFUSED remove";
    return this;
  }
  clear(): Object3D {
    if (adapter.invoke(this.slot, "clear") < 0) throw "TN_AOT_INVOKE_REFUSED clear";
    return this;
  }
  getObjectById(id: number): Object3D | null {
    adapter.argNumber(id);
    if (adapter.invoke(this.slot, "getObjectById") < 0) throw "TN_AOT_INVOKE_REFUSED getObjectById";
    return objectFor(adapter.resultObject());
  }
}

export class Scene extends Object3D {
  constructor() {
    super(create("Scene"));
  }
}

export class Mesh extends Object3D {
  geometry: BoxGeometry;
  material: MeshStandardMaterial;
  constructor(geometry: BoxGeometry, material: MeshStandardMaterial) {
    adapter.argObject(geometry.slot);
    adapter.argObject(material.slot);
    super(create("Mesh"));
    this.geometry = geometry;
    this.material = material;
  }
}

/**
 * Runs one object's `onBeforeRender`, as the engine does before a draw. The other three objects
 * arrive as the engine's own handles, resolved here to the wrappers this program already has.
 * 0 when it ran, 1 when it threw: the message goes to the adapter, which hands it to the engine as
 * a render diagnostic, so a throwing callback is a status and never a crash.
 */
function runBeforeRender(
  self: Object3D,
  scene: Handle,
  camera: Handle,
  geometry: Handle,
  material: Handle,
): number {
  const fn = self.beforeRender;
  if (fn === undefined) return 0;
  const mesh = self as Mesh;
  try {
    fn(
      null,
      objectFor(scene),
      objectFor(camera),
      geometry !== NO_OBJECT ? mesh.geometry : null,
      material !== NO_OBJECT ? mesh.material : null,
      null,
    );
    return 0;
  } catch (thrown) {
    adapter.callbackError(`${thrown}`);
    return 1;
  }
}

/**
 * Releases the engine objects of the wrappers the engine can no longer reach, so a scene load/unload
 * or a UI mount/dispose returns the engine's own object count to its baseline. Reachability is
 * decided here, not by walking the program's roots: a Scene and a callback-bearing object the safe
 * point holds are the roots, and their wrapper's own members are kept with them. Every other wrapper
 * is one the program dropped, so its engine object is released.
 */
export function releaseUnreferenced(): number {
  // Keep the wrappers the engine can still reach: a callback-bearing object the safe point holds,
  // and the members its wrapper owns. The program's own locals are not visible here, so anything
  // else is a wrapper it dropped; releasing its engine object is what lets the count return.
  const live = new Set<Handle>();
  const queue: { slot: Handle }[] = [];
  const keep = (wrapper: unknown): void => {
    const slot = (wrapper as { slot?: Handle } | null | undefined)?.slot;
    if (slot === undefined || slot === NO_OBJECT || live.has(slot)) return;
    live.add(slot);
    queue.push(wrapper as { slot: Handle });
  };
  for (let handle = 1; handle < objects.length; handle += 1) {
    const wrapper = objects[handle];
    // A scene roots itself: game code holds it for the program's life, and the engine holds its
    // children. A held callback-bearing object is attached, so the engine may still call it.
    if (wrapper instanceof Scene || (wrapper !== undefined && adapter.held(handle) !== 0))
      keep(wrapper);
  }
  while (queue.length > 0) {
    const owner = queue.pop() as Object3D;
    keep(owner.positionMember);
    const mesh = owner as Mesh;
    keep(mesh.geometry);
    keep(mesh.material);
  }
  let released = 0;
  for (let handle = 1; handle < objects.length; handle += 1) {
    const wrapper = objects[handle];
    if (wrapper === undefined || live.has(handle)) continue;
    adapter.release(handle);
    objects[handle] = undefined;
    released += 1;
  }
  return released;
}

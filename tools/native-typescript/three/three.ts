// The `three` module for native TypeScript (PRD-506): three's class names over the engine's C ABI,
// for programs compiled ahead of time by tslang. Game code imports from "three" unchanged; the
// corpus runner stages this file as that module and links tn_three_shim.c and the engine.
// It covers the classes the qualification fixtures use; the catalog's supported set is the bound.
//
// Every wrapper is tracked by the shim: when the program drops it, a collector finalizer releases its
// engine object. The shim holds wrappers weakly, so the program's own references decide.

declare function tnx_init(): i32;
declare function tnx_arg_number(n: number): void;
declare function tnx_arg_object(slot: i32): void;
declare function tnx_construct(className: string): i32;
declare function tnx_invoke(self: i32, method: string): i32;
declare function tnx_get(self: i32, path: string): i32;
declare function tnx_result_number(): number;
declare function tnx_result_object(): i32;
declare function tnx_result_string(): string;
declare function tnx_set_number(self: i32, path: string, value: number): i32;
declare function tnx_track(wrapper: Opaque, slot: i32): void;
declare function tnx_has_wrapper(slot: i32): i32;
declare function tnx_wrapper(slot: i32): Opaque;
declare function tnx_set_callback(slot: i32, name: string, on: i32): i32;
declare function tnx_callback_error(message: string): void;

function create(className: string): i32 {
  tnx_init();
  const slot = tnx_construct(className);
  if (slot < 0) throw `TN_AOT_CONSTRUCT_REFUSED ${className}`;
  return slot;
}

function readNumber(slot: i32, path: string): number {
  if (tnx_get(slot, path) < 0) throw `TN_AOT_GET_REFUSED ${path}`;
  return tnx_result_number();
}

function readString(slot: i32, path: string): string {
  if (tnx_get(slot, path) < 0) throw `TN_AOT_GET_REFUSED ${path}`;
  return tnx_result_string();
}

function readObject(slot: i32, path: string): i32 {
  if (tnx_get(slot, path) < 0) throw `TN_AOT_GET_REFUSED ${path}`;
  return tnx_result_object();
}

function writeNumber(slot: i32, path: string, value: number): void {
  if (tnx_set_number(slot, path, value) < 0) throw `TN_AOT_SET_REFUSED ${path}`;
}

/** The program's wrapper for an engine object, or a new Object3D wrapper when it has none left. */
function objectFor(slot: i32): Object3D | null {
  if (slot <= 0) return null;
  if (tnx_has_wrapper(slot) !== 0) return tnx_wrapper(slot) as Object3D;
  return new Object3D(slot);
}

export class Vector3 {
  slot: i32;
  // `adopt` names an engine object that already exists (a member such as mesh.position).
  constructor(x?: number, y?: number, z?: number, adopt?: i32) {
    if (adopt !== undefined && adopt > 0) {
      this.slot = adopt;
    } else {
      tnx_arg_number(x === undefined ? 0 : x);
      tnx_arg_number(y === undefined ? 0 : y);
      tnx_arg_number(z === undefined ? 0 : z);
      this.slot = create("Vector3");
    }
    tnx_track(this as Opaque, this.slot);
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
  slot: i32;
  constructor(width?: number, height?: number, depth?: number) {
    tnx_arg_number(width === undefined ? 1 : width);
    tnx_arg_number(height === undefined ? 1 : height);
    tnx_arg_number(depth === undefined ? 1 : depth);
    this.slot = create("BoxGeometry");
    tnx_track(this as Opaque, this.slot);
  }
  get type(): string {
    return readString(this.slot, "type");
  }
}

export class MeshStandardMaterial {
  slot: i32;
  constructor() {
    this.slot = create("MeshStandardMaterial");
    tnx_track(this as Opaque, this.slot);
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
  slot: i32;
  positionMember: Vector3 | undefined;
  beforeRender: BeforeRender | undefined;
  constructor(slot: i32) {
    this.slot = slot;
    tnx_track(this as Opaque, slot);
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
  // three's onBeforeRender: the engine calls it before the object is drawn (tn_set_callback).
  get onBeforeRender(): BeforeRender | undefined {
    return this.beforeRender;
  }
  set onBeforeRender(fn: BeforeRender | undefined) {
    this.beforeRender = fn;
    if (tnx_set_callback(this.slot, "onBeforeRender", fn === undefined ? 0 : 1) < 0)
      throw "TN_AOT_CALLBACK_REFUSED onBeforeRender";
  }
  add(child: Object3D): Object3D {
    tnx_arg_object(child.slot);
    if (tnx_invoke(this.slot, "add") < 0) throw "TN_AOT_INVOKE_REFUSED add";
    return this;
  }
  remove(child: Object3D): Object3D {
    tnx_arg_object(child.slot);
    if (tnx_invoke(this.slot, "remove") < 0) throw "TN_AOT_INVOKE_REFUSED remove";
    return this;
  }
  clear(): Object3D {
    if (tnx_invoke(this.slot, "clear") < 0) throw "TN_AOT_INVOKE_REFUSED clear";
    return this;
  }
  getObjectById(id: number): Object3D | null {
    tnx_arg_number(id);
    if (tnx_invoke(this.slot, "getObjectById") < 0) throw "TN_AOT_INVOKE_REFUSED getObjectById";
    return objectFor(tnx_result_object());
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
    tnx_arg_object(geometry.slot);
    tnx_arg_object(material.slot);
    super(create("Mesh"));
    this.geometry = geometry;
    this.material = material;
  }
}

/**
 * Called by the shim when the engine runs a callback: the wrapper is the object it is set on, and the
 * other objects arrive as slots. 0 when it ran, 1 when it threw (the message goes to the shim).
 */
export function tn_aot_dispatch(
  wrapper: Opaque,
  scene: i32,
  camera: i32,
  geometry: i32,
  material: i32,
): i32 {
  const self = wrapper as Object3D;
  const fn = self.beforeRender;
  if (fn === undefined) return 0;
  const mesh = wrapper as Mesh;
  try {
    fn(
      null,
      objectFor(scene),
      objectFor(camera),
      geometry > 0 ? mesh.geometry : null,
      material > 0 ? mesh.material : null,
      null,
    );
    return 0;
  } catch (thrown) {
    tnx_callback_error(`${thrown}`);
    return 1;
  }
}

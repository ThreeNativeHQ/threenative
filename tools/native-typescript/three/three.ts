// The `three` module for native TypeScript (PRD-506): three's class names over the engine's C ABI,
// for programs compiled ahead of time by tslang. Game code imports from "three" unchanged; the
// corpus runner stages this file as that module and links tn_three_shim.c and the engine.
// It covers the classes the qualification fixtures use; the catalog's supported set is the bound.

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

// One wrapper per engine object, indexed by the shim's slot.
const wrappers: Object3D[] = [];

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

export class Vector3 {
  slot: i32;
  constructor(x?: number, y?: number, z?: number) {
    tnx_arg_number(x === undefined ? 0 : x);
    tnx_arg_number(y === undefined ? 0 : y);
    tnx_arg_number(z === undefined ? 0 : z);
    this.slot = create("Vector3");
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

// A member object (mesh.position) is the owner's own Vector3; it is never constructed.
class MemberVector3 extends Vector3 {
  constructor(slot: i32) {
    super(0, 0, 0);
    this.slot = slot;
  }
}

export class Object3D {
  slot: i32;
  positionMember: MemberVector3 | undefined;
  constructor(slot: i32) {
    this.slot = slot;
    wrappers[slot] = this;
  }
  get type(): string {
    return readString(this.slot, "type");
  }
  get id(): number {
    return readNumber(this.slot, "id");
  }
  get position(): Vector3 {
    if (this.positionMember === undefined)
      this.positionMember = new MemberVector3(readObject(this.slot, "position"));
    return this.positionMember;
  }
  add(child: Object3D): Object3D {
    tnx_arg_object(child.slot);
    if (tnx_invoke(this.slot, "add") < 0) throw "TN_AOT_INVOKE_REFUSED add";
    return this;
  }
  getObjectById(id: number): Object3D | undefined {
    tnx_arg_number(id);
    if (tnx_invoke(this.slot, "getObjectById") < 0) throw "TN_AOT_INVOKE_REFUSED getObjectById";
    const slot = tnx_result_object();
    return slot > 0 ? wrappers[slot] : undefined;
  }
}

export class Scene extends Object3D {
  constructor() {
    super(create("Scene"));
  }
}

export class BoxGeometry {
  slot: i32;
  constructor(width?: number, height?: number, depth?: number) {
    tnx_arg_number(width === undefined ? 1 : width);
    tnx_arg_number(height === undefined ? 1 : height);
    tnx_arg_number(depth === undefined ? 1 : depth);
    this.slot = create("BoxGeometry");
  }
  get type(): string {
    return readString(this.slot, "type");
  }
}

export class MeshStandardMaterial {
  slot: i32;
  constructor() {
    this.slot = create("MeshStandardMaterial");
  }
  get type(): string {
    return readString(this.slot, "type");
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

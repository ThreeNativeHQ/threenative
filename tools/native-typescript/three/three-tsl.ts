// Thin bindings only: native graph construction and lowering stay in C++.
import * as adapter from "tn-three-adapter";
export class TslNode {
  slot: number;
  constructor(op: string, a = 0, b = 0, c = 0, value = 0) {
    adapter.init();
    this.slot = adapter.tslBuild(op, a, b, c, value);
    if (this.slot === 0) throw adapter.tslError();
  }
  get x(): TslNode {
    return new TslNode("x", this.slot);
  }
  add(node: TslNode): TslNode {
    return new TslNode("add", this.slot, node.slot);
  }
  mul(node: TslNode): TslNode {
    return new TslNode("mul", this.slot, node.slot);
  }
  mod(node: TslNode): TslNode {
    return new TslNode("mod", this.slot, node.slot);
  }
  dispose(): void {
    adapter.tslRelease(this.slot);
  }
}
export function float(value: number): TslNode {
  return new TslNode("float", 0, 0, 0, value);
}
export function uv(): TslNode {
  return new TslNode("uv");
}
export function sin(node: TslNode): TslNode {
  return new TslNode("sin", node.slot);
}
export function vec3(a: TslNode, b: TslNode, c: TslNode): TslNode {
  return new TslNode("vec3", a.slot, b.slot, c.slot);
}

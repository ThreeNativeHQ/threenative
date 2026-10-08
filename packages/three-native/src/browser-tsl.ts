/**
 * TSL on the Wasm engine (PRD-540): three's `three/tsl` authoring functions and node methods as JS
 * wrappers over node ids, built by the engine's one TSL name table (`tn_tsl_call`, shared with the
 * V8 back end). A node is an engine graph node; nothing here builds shader code in JavaScript.
 *
 * Not here yet: the closure and statement forms (Fn, If, Loop, Else, toVar, assign) and writing a
 * uniform's `.value`; the catalog keeps refusing them by name.
 */
import { type IEngineRef, TSL_NODE, engineRef } from "./browser-backend.js";

/** One argument as `tn_tsl_call` takes it. */
export type TslArgValue =
  | { readonly kind: "node"; readonly node: number }
  | { readonly kind: "number"; readonly number: number }
  | { readonly kind: "string" | "named"; readonly text: string }
  | { readonly kind: "rgb"; readonly rgb: readonly [number, number, number] };

/** The engine side of TSL: one call by name, node release, and a material's node slot. */
export interface ITslRuntime {
  call(name: string, receiver: number | null, args: readonly TslArgValue[]): number;
  release(node: number): void;
  set(material: IEngineRef, path: string, node: number): void;
}

/** Module functions the shared table answers (engine/abi/tsl_call.cpp). */
const FUNCTIONS = [
  "float",
  "int",
  "uint",
  "vec2",
  "vec3",
  "vec4",
  "uniform",
  "attribute",
  "uv",
  "texture",
  "add",
  "sub",
  "mul",
  "div",
  "negate",
  "lessThan",
  "greaterThan",
  "equal",
  "abs",
  "sin",
  "cos",
  "floor",
  "fract",
  "sqrt",
  "exp",
  "exp2",
  "log2",
  "normalize",
  "length",
  "min",
  "max",
  "pow",
  "step",
  "dot",
  "distance",
  "cross",
  "mix",
  "clamp",
  "smoothstep",
  "select",
  "nodeObject",
  "color",
  "ivec2",
  "textureLoad",
  "reflect",
  "convertToTexture",
  "mx_noise_float",
  "mx_worley_noise_vec2",
] as const;
/** Node methods the shared table answers, with the receiver passed apart. */
const METHODS = [
  "add",
  "sub",
  "mul",
  "div",
  "negate",
  "lessThan",
  "greaterThan",
  "equal",
  "abs",
  "sin",
  "cos",
  "floor",
  "fract",
  "sqrt",
  "exp",
  "exp2",
  "log2",
  "normalize",
  "length",
  "min",
  "max",
  "pow",
  "step",
  "dot",
  "distance",
  "cross",
  "reflect",
  "mix",
  "clamp",
  "smoothstep",
  "select",
  "sample",
] as const;
const SWIZZLES: Readonly<Record<string, string>> = {
  x: "x",
  y: "y",
  z: "z",
  w: "w",
  xy: "xy",
  xyz: "xyz",
  zyx: "zyx",
  yx: "yx",
  r: "x",
  g: "y",
  b: "z",
  a: "w",
  rg: "xy",
  rgb: "xyz",
  rgba: "xyzw",
};
const VECTORS = new Map<string, readonly string[]>([
  ["Vector2", ["x", "y"]],
  ["Vector3", ["x", "y", "z"]],
  ["Vector4", ["x", "y", "z", "w"]],
]);

interface ITslNode {
  readonly [TSL_NODE]: number;
}

export function isTslNode(value: unknown): value is ITslNode {
  return typeof value === "object" && value !== null && TSL_NODE in value;
}

/** Defines the TSL exports over `runtime`. */
export function defineTsl(runtime: ITslRuntime): Record<string, unknown> {
  const released = new FinalizationRegistry<number>((node) => runtime.release(node));
  const prototype: Record<string, unknown> = {};
  const wrap = (node: number): ITslNode => {
    const object = Object.create(prototype) as ITslNode;
    Object.defineProperty(object, TSL_NODE, { value: node });
    released.register(object, node);
    return object;
  };
  const argument = (name: string, index: number, count: number, value: unknown): TslArgValue => {
    if (isTslNode(value)) return { kind: "node", node: value[TSL_NODE] };
    if (typeof value === "number") return { kind: "number", number: value };
    if (typeof value === "string") return { kind: "string", text: value };
    if (typeof value === "object" && value !== null && engineRef(value) !== undefined) {
      const object = value as Record<string, unknown>;
      // A texture names its map; textureLoad also takes a texture node.
      if (index === 0 && (name === "texture" || name === "textureLoad"))
        return { kind: "named", text: String(object.name) };
      if (name === "color" && count === 1 && object.isColor === true)
        return { kind: "rgb", rgb: [object.r, object.g, object.b] as [number, number, number] };
      // TSL's nodeObject turns a three vector into its constant: vec3(new Vector3(1, 2, 3)).
      const lanes = VECTORS.get(object.constructor.name);
      if (lanes !== undefined)
        return {
          kind: "node",
          node: call(
            `vec${lanes.length}`,
            null,
            lanes.map((lane) => object[lane]),
          ),
        };
    }
    throw new TypeError(
      `TN_TSL ${name}: argument ${index} is not a TSL node, number, string or three value`,
    );
  };
  const call = (name: string, receiver: number | null, args: readonly unknown[]): number =>
    runtime.call(
      name,
      receiver,
      args.map((value, index) => argument(name, index, args.length, value)),
    );

  for (const name of METHODS)
    prototype[name] = function (this: ITslNode, ...args: unknown[]) {
      return wrap(call(name, this[TSL_NODE], args));
    };
  for (const [alias, lanes] of Object.entries(SWIZZLES))
    Object.defineProperty(prototype, alias, {
      get(this: ITslNode) {
        return wrap(call(`swizzle:${lanes}`, this[TSL_NODE], []));
      },
    });
  const exports: Record<string, unknown> = {};
  for (const name of FUNCTIONS)
    exports[name] = (...args: unknown[]) => wrap(call(name, null, args));
  return exports;
}

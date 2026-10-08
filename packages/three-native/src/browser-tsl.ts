/**
 * TSL on the Wasm engine (PRD-540): three's `three/tsl` authoring functions and node methods as JS
 * wrappers over node ids, built by the engine's one TSL name table (`tn_tsl_call`, shared with the
 * V8 back end). A node is an engine graph node; nothing here builds shader code in JavaScript.
 *
 * The closure and statement forms (Fn, If, Else, Loop, toVar, assign) run the callback here, between
 * an engine scope's begin and end, as V8's adapter runs it between its own.
 */
import { type IEngineRef, TSL_NODE, engineRef } from "./browser-backend.js";
import { liveUniforms, uniformLanes } from "./tsl-uniforms.js";

/** One argument as `tn_tsl_call` takes it. */
export type TslArgValue =
  | { readonly kind: "node"; readonly node: number }
  | { readonly kind: "number"; readonly number: number }
  | { readonly kind: "string" | "named"; readonly text: string }
  | { readonly kind: "rgb" | "vector"; readonly numbers: readonly number[] };

/** The engine side of TSL: one call by name, node release, and a material's node slot. */
export interface ITslRuntime {
  call(name: string, receiver: number | null, args: readonly TslArgValue[]): number;
  release(node: number): void;
  set(material: IEngineRef, path: string, node: number): void;
  /** three's `uniform.value = x`: the uniform's lanes, with no program change. */
  setUniform(node: number, lanes: readonly number[]): void;
  /** A callback starts collecting statements (Fn, If, Else, Loop bodies). */
  scopeBegin(): void;
  /** Its body node, or `result` when it collected no statement. */
  scopeEnd(result: TslArgValue | null): number;
  /** toVar, assign, If, Else, Loop.begin, Loop.index and Loop.end in the open scope. */
  statement(name: string, receiver: number | null, args: readonly TslArgValue[]): number;
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
interface ITslNode {
  readonly [TSL_NODE]: number;
}

export function isTslNode(value: unknown): value is ITslNode {
  return typeof value === "object" && value !== null && TSL_NODE in value;
}

/**
 * Defines the TSL exports over `runtime`. `sync` pushes edited Color/VectorN uniform values; the
 * renderer calls it before each frame.
 */
export function defineTsl(runtime: ITslRuntime): {
  exports: Record<string, unknown>;
  sync(): void;
} {
  const released = new FinalizationRegistry<number>((node) => runtime.release(node));
  const prototype: Record<string, unknown> = {};
  const wrap = (node: number): ITslNode => {
    const object = Object.create(prototype) as ITslNode;
    Object.defineProperty(object, TSL_NODE, { value: node });
    released.register(object, node);
    return object;
  };
  const argument = (name: string, index: number, value: unknown): TslArgValue => {
    if (isTslNode(value)) return { kind: "node", node: value[TSL_NODE] };
    if (typeof value === "number") return { kind: "number", number: value };
    if (typeof value === "string") return { kind: "string", text: value };
    if (typeof value === "object" && value !== null && engineRef(value) !== undefined) {
      const object = value as Record<string, unknown>;
      // A texture names its map; textureLoad also takes a texture node.
      if (index === 0 && (name === "texture" || name === "textureLoad"))
        return { kind: "named", text: String(object.name) };
      // TSL's nodeObject turns a three Color or VectorN into its constant: vec3(new Vector3(1, 2, 3)).
      if (object.isColor === true) return { kind: "rgb", numbers: uniformLanes(object) };
      if (object.isVector2 === true || object.isVector3 === true || object.isVector4 === true)
        return { kind: "vector", numbers: uniformLanes(object) };
    }
    throw new TypeError(
      `TN_TSL ${name}: argument ${index} is not a TSL node, number, string or three value`,
    );
  };
  const call = (name: string, receiver: number | null, args: readonly unknown[]): number =>
    runtime.call(
      name,
      receiver,
      args.map((value, index) => argument(name, index, value)),
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
  // A callback between an engine scope's begin and end; the scope closes even when it throws.
  const capture = (callback: unknown, input?: unknown): number => {
    if (typeof callback !== "function") throw new TypeError("TN_TSL: expected a callback");
    runtime.scopeBegin();
    let result: unknown;
    let closed = false;
    try {
      result = (callback as (input?: unknown) => unknown)(input);
      closed = true;
      return runtime.scopeEnd(result === undefined ? null : argument("Fn", 0, result));
    } finally {
      if (!closed) runtime.scopeEnd(null);
    }
  };
  const statement = (name: string, receiver: number | null, args: readonly unknown[]): number =>
    runtime.statement(
      name,
      receiver,
      args.map((value, index) => argument(name, index, value)),
    );
  prototype.toVar = function (this: ITslNode) {
    return wrap(statement("toVar", this[TSL_NODE], []));
  };
  prototype.assign = function (this: ITslNode, value: unknown) {
    statement("assign", this[TSL_NODE], [value]);
    return this;
  };
  prototype.Else = function (this: ITslNode, callback: unknown) {
    const body = capture(callback);
    return wrap(runtime.statement("Else", this[TSL_NODE], [{ kind: "node", node: body }]));
  };
  const exports: Record<string, unknown> = {};
  for (const name of FUNCTIONS)
    exports[name] = (...args: unknown[]) => wrap(call(name, null, args));
  // Fn builds once, at definition; calling it answers that graph, as on V8.
  exports.Fn = (callback: unknown) => {
    const graph = wrap(capture(callback));
    return () => graph;
  };
  exports.If = (condition: unknown, callback: unknown) => {
    const cond = argument("If", 0, condition);
    const body = capture(callback);
    return wrap(runtime.statement("If", null, [cond, { kind: "node", node: body }]));
  };
  exports.Loop = (count: unknown, callback: unknown) => {
    const loop = statement("Loop.begin", null, [count]);
    const index = runtime.statement("Loop.index", loop, []);
    const body = capture(callback, { i: wrap(index) });
    return wrap(runtime.statement("Loop.end", loop, [{ kind: "node", node: body }]));
  };
  const live = liveUniforms(exports.uniform as (value: unknown) => ITslNode, (node, lanes) =>
    runtime.setUniform(node[TSL_NODE], lanes),
  );
  exports.uniform = live.uniform;
  return { exports, sync: live.sync };
}

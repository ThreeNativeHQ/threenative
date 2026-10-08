/**
 * PRD-540: TSL on the browser back end goes through the engine's one name table (`tn_tsl_call`).
 * Midway's first TSL call is a class field `uniform(0)`; its ocean builds `uniform(new Vector2())`
 * and `vec3(SUN_DIRECTION)`, then assigns graphs to node materials.
 */

import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { definePostEffects } from "../src/addons/post-effects.js";
import {
  type EngineValue,
  type IBrowserRuntime,
  type IEngineRef,
  type IRegistryDump,
  defineBrowserClasses,
} from "../src/browser-backend.js";
import { type ITslRuntime, type TslArgValue, defineTsl } from "../src/browser-tsl.js";
import { loadCatalog } from "../src/catalog.js";

const REPO = process.cwd();
const catalog = loadCatalog(REPO);
const registry = JSON.parse(
  readFileSync(path.join(REPO, "packages/three-native/api/native-registry.json"), "utf8"),
) as IRegistryDump;

interface ICall {
  readonly name: string;
  readonly receiver: number | null;
  readonly args: readonly TslArgValue[];
}

function tslRuntime(calls: ICall[], sets: string[], uniforms: string[] = []): ITslRuntime {
  let next = 0;
  return {
    call(name, receiver, args) {
      calls.push({ name, receiver, args });
      return ++next;
    },
    release() {},
    set(material, path, node) {
      sets.push(`${material.key.split(":")[0]}.${path}=${node}`);
    },
    setUniform(node, lanes) {
      uniforms.push(`${node}=${lanes.join(",")}`);
    },
    scopeBegin() {
      calls.push({ name: "(begin", receiver: null, args: [] });
    },
    scopeEnd(result) {
      calls.push({ name: "end)", receiver: null, args: result === null ? [] : [result] });
      return ++next;
    },
    statement(name, receiver, args) {
      calls.push({ name, receiver, args });
      return ++next;
    },
    effectParameter(node, name, value) {
      calls.push({
        name: `effect ${name}`,
        receiver: node,
        args: value === undefined ? [] : [{ kind: "number", number: value }],
      });
      return value ?? 0.25;
    },
    setPost(node) {
      sets.push(`post=${node}`);
    },
  };
}

function engineRuntime(tsl: ITslRuntime, values: Record<string, EngineValue>): IBrowserRuntime {
  const types = new Map<string, number>();
  let next = 0;
  return {
    typeId(name) {
      if (!types.has(name)) types.set(name, types.size + 1);
      return types.get(name) as number;
    },
    construct: (name): IEngineRef => ({ key: `${name}:0:${++next}:1`, type: types.get(name) ?? 0 }),
    invoke: () => null,
    get: (_self, property) => values[property] ?? 0,
    set() {},
    release() {},
    setCallback() {},
    tsl,
  };
}

type Constructor = new (...args: unknown[]) => Record<string, unknown>;
type Fn = (...args: unknown[]) => Record<string, unknown>;

describe("TSL on the browser back end", () => {
  it("builds uniform(0) and its node methods and swizzles through the shared table", () => {
    const calls: ICall[] = [];
    const tsl = defineTsl(tslRuntime(calls, [])).exports;
    const clock = (tsl.uniform as Fn)(0);
    const scaled = (clock.mul as Fn)(2);
    void scaled.x;
    expect(calls).toEqual([
      { name: "uniform", receiver: null, args: [{ kind: "number", number: 0 }] },
      { name: "mul", receiver: 1, args: [{ kind: "number", number: 2 }] },
      { name: "swizzle:x", receiver: 2, args: [] },
    ]);
  });

  it("turns three values into what TSL makes of them, and assigns graphs to node materials", () => {
    const calls: ICall[] = [];
    const sets: string[] = [];
    const runtime = tslRuntime(calls, sets);
    const { classes } = defineBrowserClasses(
      registry,
      engineRuntime(runtime, { x: 1, y: 2, z: 3, name: "sea" }),
      catalog,
    );
    const tsl = defineTsl(runtime).exports;
    const sun = new (classes.Vector3 as Constructor)();
    (tsl.vec3 as Fn)(sun);
    const sea = new (classes.Texture as Constructor)();
    const sample = (tsl.texture as Fn)(sea, (tsl.uv as Fn)());
    expect(calls.map(({ name }) => name)).toEqual(["vec3", "uv", "texture"]);
    expect(calls[0]?.args).toEqual([{ kind: "vector", numbers: [1, 2, 3] }]);
    expect(calls[2]?.args).toEqual([
      { kind: "named", text: "sea" },
      { kind: "node", node: 2 },
    ]);

    const material = new (classes.MeshBasicNodeMaterial as Constructor)();
    material.colorNode = sample;
    expect(sets).toEqual(["MeshBasicNodeMaterial.colorNode=3"]);
    expect(material.colorNode).toBe(sample);
  });

  it("writes uniform.value through to the engine: numbers at once, edited vectors each frame", () => {
    const uniforms: string[] = [];
    const runtime = tslRuntime([], [], uniforms);
    const values: Record<string, EngineValue> = { x: 0, y: 0 };
    const { classes } = defineBrowserClasses(registry, engineRuntime(runtime, values), catalog);
    const tsl = defineTsl(runtime);
    const clock = (tsl.exports.uniform as Fn)(0);
    expect(clock.value).toBe(0);
    clock.value = 2.5; // Midway: this.clock.value = this.time
    expect(clock.value).toBe(2.5);
    const origin = new (classes.Vector2 as Constructor)();
    const center = (tsl.exports.uniform as Fn)(origin);
    expect(center.value).toBe(origin); // three keeps the vector the uniform was made from
    values.x = 4;
    values.y = 5; // Midway: origin.value.set(camera.x, camera.z)
    tsl.sync();
    expect(uniforms).toEqual(["1=2.5", "2=4,5"]);
  });

  it("runs Fn, If, Else and Loop callbacks inside engine scopes, as V8's adapter does", () => {
    const calls: ICall[] = [];
    const tsl = defineTsl(tslRuntime(calls, [])).exports;
    const shade = (tsl.Fn as (callback: () => void) => () => unknown)(() => {
      const acc = ((tsl.float as Fn)(0).toVar as Fn)();
      (tsl.Loop as Fn)(2, ({ i }: { i: Record<string, unknown> }) => {
        const branch = (tsl.If as Fn)((i.lessThan as Fn)(1), () => (acc.assign as Fn)(1));
        (branch.Else as Fn)(() => (acc.assign as Fn)(2));
      });
    });
    expect(shade()).toBe(shade()); // built once, at definition
    expect(calls.map(({ name }) => name)).toEqual([
      "(begin",
      "float",
      "toVar",
      "Loop.begin",
      "Loop.index",
      "(begin",
      "lessThan",
      "(begin",
      "assign",
      "end)",
      "If",
      "(begin",
      "assign",
      "end)",
      "Else",
      "end)",
      "Loop.end",
      "end)",
    ]);
    // A callback that throws still closes its scope, and the original error comes through.
    calls.length = 0;
    expect(() =>
      (tsl.Fn as Fn)(() => {
        throw new Error("original");
      }),
    ).toThrow("original");
    expect(calls.map(({ name }) => name)).toEqual(["(begin", "end)"]);
  });

  it("publishes a live effect's uniforms as three's ao(...).radius.value", () => {
    const calls: ICall[] = [];
    const tsl = defineTsl(tslRuntime(calls, [])).exports;
    const effects = definePostEffects(tsl as never);
    const depth = (tsl.uv as Fn)();
    const ao = effects.ao(depth, undefined, undefined) as unknown as Record<
      string,
      { value: number }
    >;
    expect(calls.at(-1)).toEqual({
      name: "ao",
      receiver: null,
      args: [{ kind: "node", node: 1 }, { kind: "other" }, { kind: "other" }],
    });
    expect(ao.radius?.value).toBe(0.25);
    (ao.radius as { value: number }).value = 0.5;
    expect(calls.slice(-2).map(({ name, args }) => [name, args])).toEqual([
      ["effect radius", []],
      ["effect radius", [{ kind: "number", number: 0.5 }]],
    ]);
  });

  it("refuses an argument TSL has no meaning for, by name", () => {
    const tsl = defineTsl(tslRuntime([], [])).exports;
    expect(() => (tsl.sin as Fn)({ plain: true })).toThrow("TN_TSL sin: argument 0");
  });
});

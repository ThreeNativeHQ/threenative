/**
 * PRD-540: TSL on the browser back end goes through the engine's one name table (`tn_tsl_call`).
 * Midway's first TSL call is a class field `uniform(0)`; its ocean builds `uniform(new Vector2())`
 * and `vec3(SUN_DIRECTION)`, then assigns graphs to node materials.
 */

import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

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

function tslRuntime(calls: ICall[], sets: string[]): ITslRuntime {
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
    const tsl = defineTsl(tslRuntime(calls, []));
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
    const tsl = defineTsl(runtime);
    const sun = new (classes.Vector3 as Constructor)();
    (tsl.vec3 as Fn)(sun);
    const sea = new (classes.Texture as Constructor)();
    const sample = (tsl.texture as Fn)(sea, (tsl.uv as Fn)());
    expect(calls.map(({ name }) => name)).toEqual(["vec3", "vec3", "uv", "texture"]);
    expect(calls[0]?.args).toEqual([1, 2, 3].map((number) => ({ kind: "number", number })));
    expect(calls[1]?.args).toEqual([{ kind: "node", node: 1 }]);
    expect(calls[3]?.args).toEqual([
      { kind: "named", text: "sea" },
      { kind: "node", node: 3 },
    ]);

    const material = new (classes.MeshBasicNodeMaterial as Constructor)();
    material.colorNode = sample;
    expect(sets).toEqual(["MeshBasicNodeMaterial.colorNode=4"]);
    expect(material.colorNode).toBe(sample);
  });

  it("hands pmremTexture the texture object itself, as an engine handle", () => {
    const calls: ICall[] = [];
    const runtime = tslRuntime(calls, []);
    const { classes } = defineBrowserClasses(registry, engineRuntime(runtime, {}), catalog);
    const tsl = defineTsl(runtime);
    const sky = new (classes.DataTexture as Constructor)();
    (tsl.pmremTexture as Fn)(sky, (tsl.uv as Fn)(), 0.5);
    expect(calls[1]).toMatchObject({ name: "pmremTexture", receiver: null });
    expect(calls[1]?.args[0]).toMatchObject({
      kind: "handle",
      ref: { key: expect.stringMatching(/^DataTexture:/) },
    });
    expect(calls[1]?.args.slice(1)).toEqual([
      { kind: "node", node: 1 },
      { kind: "number", number: 0.5 },
    ]);
  });

  it("refuses an argument TSL has no meaning for, by name", () => {
    const tsl = defineTsl(tslRuntime([], []));
    expect(() => (tsl.sin as Fn)({ plain: true })).toThrow("TN_TSL sin: argument 0");
  });
});

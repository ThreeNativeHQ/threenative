/**
 * PRD-540: the language half of three's object surface on the browser back end. The catalog marks
 * these `native-not-bound` because they are JavaScript, not engine state: the class chain
 * (`mesh instanceof Object3D`), the `is*` flags, `userData`, and the `traverse` family over
 * `children`.
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
import { loadCatalog } from "../src/catalog.js";

const REPO = process.cwd();
const catalog = loadCatalog(REPO);
const registry = JSON.parse(
  readFileSync(path.join(REPO, "packages/three-native/api/native-registry.json"), "utf8"),
) as IRegistryDump;

/** A scene graph held by the fake engine: `children` answers each object's child refs. */
function sceneRuntime(
  children: Map<string, IEngineRef[]>,
  visible: Set<string>,
  reads: string[] = [],
): IBrowserRuntime {
  const types = new Map<string, number>();
  let next = 0;
  const parentOf = (ref: IEngineRef) =>
    [...children].find(([, refs]) => refs.some((child) => child.key === ref.key))?.[0];
  const refs = new Map<string, IEngineRef>();
  return {
    typeId(name) {
      if (!types.has(name)) types.set(name, types.size + 1);
      return types.get(name) as number;
    },
    construct(name) {
      const ref = { key: `${name}:0:${++next}:1`, type: types.get(name) ?? 0 };
      refs.set(ref.key, ref);
      return ref;
    },
    // `__walk`: the engine's preorder walk of this graph, only visible subtrees when asked, each
    // object followed by its parent's index when `withParents`.
    invoke(self, method, args): EngineValue {
      if (method === "add") {
        const child = args[0] as IEngineRef;
        for (const list of children.values()) {
          const at = list.findIndex((ref) => ref.key === child.key);
          if (at >= 0) list.splice(at, 1);
        }
        children.set(self.key, [...(children.get(self.key) ?? []), child]);
      }
      if (method !== "__walk") return null;
      const walked: EngineValue[] = [];
      const order: string[] = [];
      const visit = (ref: IEngineRef) => {
        if (args[0] === true && !visible.has(ref.key)) return;
        walked.push(ref);
        if (args[1] === true) walked.push(order.indexOf(parentOf(ref) ?? ""));
        order.push(ref.key);
        for (const child of children.get(ref.key) ?? []) visit(child);
      };
      visit(self);
      return walked;
    },
    get(self, property): EngineValue {
      reads.push(property);
      if (property === "children") return children.get(self.key) ?? [];
      if (property === "visible") return visible.has(self.key);
      if (property === "parent") return refs.get(parentOf(self) ?? "") ?? null;
      return 0;
    },
    set() {},
    release() {},
    setCallback() {},
  };
}

/** The registry without `children` (and the walk over it), as it was before the engine bound it. */
function withoutChildren(dump: IRegistryDump): IRegistryDump {
  return {
    classes: Object.fromEntries(
      Object.entries(dump.classes).map(([name, binding]) => [
        name,
        {
          ...binding,
          members: binding.members.filter((member) => member !== "children"),
          methods: binding.methods.filter((method) => method !== "__walk"),
        },
      ]),
    ),
  };
}

type Constructor = new (...args: unknown[]) => Record<string, unknown>;

describe("browser back end object surface", () => {
  it("chains classes as three does and carries three's is* flags", () => {
    const { classes } = defineBrowserClasses(registry, sceneRuntime(new Map(), new Set()), catalog);
    const mesh = new (classes.Mesh as Constructor)();
    expect(mesh instanceof (classes.Object3D as Constructor)).toBe(true);
    expect(mesh.isMesh).toBe(true);
    expect(mesh.isObject3D).toBe(true);
    expect(mesh.isMaterial).toBeUndefined();
    const material = new (classes.MeshStandardMaterial as Constructor)();
    expect(material.isMeshStandardMaterial && material.isMaterial).toBe(true);
  });

  it("keeps one userData object per engine object", () => {
    const { classes } = defineBrowserClasses(registry, sceneRuntime(new Map(), new Set()), catalog);
    const group = new (classes.Group as Constructor)();
    expect(group.userData).toEqual({});
    (group.userData as Record<string, unknown>).hp = 3;
    expect(group.userData).toEqual({ hp: 3 });
    group.userData = { team: "red" };
    expect(group.userData).toEqual({ team: "red" });
  });

  it("walks children depth first, and only visible subtrees for traverseVisible", () => {
    const children = new Map<string, IEngineRef[]>();
    const visible = new Set<string>();
    const runtime = sceneRuntime(children, visible);
    const { classes } = defineBrowserClasses(registry, runtime, catalog);
    const make = (name: string) => {
      const object = new (classes.Group as Constructor)();
      object.label = name;
      return object;
    };
    const [root, a, a1, b] = ["root", "a", "a1", "b"].map(make) as [
      Record<string, unknown>,
      Record<string, unknown>,
      Record<string, unknown>,
      Record<string, unknown>,
    ];
    const refOf = (object: Record<string, unknown>) =>
      Object.getOwnPropertySymbols(object).map(
        (s) => (object as Record<symbol, unknown>)[s],
      )[0] as IEngineRef;
    children.set(refOf(root).key, [refOf(a), refOf(b)]);
    children.set(refOf(a).key, [refOf(a1)]);
    for (const object of [root, a, b]) visible.add(refOf(object).key);

    const all: unknown[] = [];
    (root.traverse as (fn: (o: Record<string, unknown>) => void) => void)((o) => all.push(o.label));
    expect(all).toEqual(["root", "a", "a1", "b"]);
    visible.delete(refOf(a).key);
    const shown: unknown[] = [];
    (root.traverseVisible as (fn: (o: Record<string, unknown>) => void) => void)((o) =>
      shown.push(o.label),
    );
    expect(shown).toEqual(["root", "b"]);
  });

  it("keeps each walked object's parent until add, remove, attach or clear moves it", () => {
    const children = new Map<string, IEngineRef[]>();
    const reads: string[] = [];
    const { classes } = defineBrowserClasses(
      registry,
      sceneRuntime(children, new Set(), reads),
      catalog,
    );
    type Node = Record<string, unknown> & { parent: Node | null };
    const [root, a, a1, b] = [0, 1, 2, 3].map(() => new (classes.Group as Constructor)()) as [
      Node,
      Node,
      Node,
      Node,
    ];
    const refOf = (object: object) =>
      Object.getOwnPropertySymbols(object).map(
        (s) => (object as Record<symbol, unknown>)[s],
      )[0] as IEngineRef;
    children.set(refOf(root).key, [refOf(a), refOf(b)]);
    children.set(refOf(a).key, [refOf(a1)]);
    // What a game does per mesh inside traverse: walk `parent` to the root.
    (root.traverse as (fn: (o: Node) => void) => void)((o) => {
      for (let n: Node | null = o; n !== null; n = n.parent);
    });
    expect(reads.filter((read) => read === "parent")).toEqual(["parent"]);
    expect([a1.parent, a.parent, b.parent, root.parent]).toEqual([a, root, root, null]);
    expect(reads.filter((read) => read === "parent")).toHaveLength(1);
    (b.add as (child: object) => void)(a1);
    expect(a1.parent).toBe(b);
    expect(reads.filter((read) => read === "parent")).toHaveLength(2);
    (root.clear as () => void)();
    void [a.parent, b.parent];
    expect(reads.filter((read) => read === "parent")).toHaveLength(4);
  });

  it("refuses traverse on a class whose binding has no children", () => {
    const { classes } = defineBrowserClasses(
      withoutChildren(registry),
      sceneRuntime(new Map(), new Set()),
      catalog,
    );
    const group = new (classes.Group as Constructor)();
    expect(() => (group.traverse as (fn: () => void) => void)(() => {})).toThrow(
      "TN_BROWSER_UNBOUND: Group.children",
    );
  });
});

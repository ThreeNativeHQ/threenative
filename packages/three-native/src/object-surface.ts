/**
 * The JavaScript half of three's object surface that both engine back ends share (PRD-540; moved
 * from the V8 player's core-three.mjs): `geometry.attributes` and `groups`, `shape.holes`, and the
 * abstract `Material` base. The engine owns the data; these are views over its bindings.
 */

type Constructor = abstract new (...args: never[]) => object;
type Prototype = Record<string, unknown> & object;

/** The engine classes the views attach to; a missing one is skipped. */
export interface ISurfaceClasses {
  readonly bufferGeometry: Constructor;
  readonly geometries: readonly Constructor[];
  readonly shape?: Constructor;
  readonly materials: readonly Constructor[];
}

// three's `geometry.attributes` map over the native named attributes: one live view per geometry,
// reading through getAttribute and writing through setAttribute/deleteAttribute.
// ponytail: names are three's standard ones plus those set from JS; a custom-named attribute only a
// native loader added is readable by name but not enumerated. Add a native name list if one appears.
const STANDARD_ATTRIBUTES = [
  "position",
  "normal",
  "uv",
  "uv1",
  "uv2",
  "uv3",
  "color",
  "tangent",
  "skinIndex",
  "skinWeight",
];

interface IGeometry {
  setAttribute(name: string, attribute: unknown): unknown;
  deleteAttribute(name: string): unknown;
  hasAttribute(name: string): boolean;
  getAttribute(name: string): unknown;
}

function defineGeometrySurface(
  BufferGeometry: Constructor,
  geometries: readonly Constructor[],
): void {
  const authoredNames = new WeakMap<object, Set<string>>();
  const attributeViews = new WeakMap<object, object>();
  for (const geometry of [BufferGeometry, ...geometries]) {
    const prototype = geometry.prototype as Prototype & IGeometry;
    const { setAttribute, deleteAttribute } = prototype;
    prototype.setAttribute = function (this: IGeometry, name: string, attribute: unknown) {
      if (!authoredNames.has(this)) authoredNames.set(this, new Set());
      authoredNames.get(this)?.add(String(name));
      return setAttribute.call(this, name, attribute);
    };
    prototype.deleteAttribute = function (this: IGeometry, name: string) {
      authoredNames.get(this)?.delete(String(name));
      return deleteAttribute.call(this, name);
    };
    // The registry answers `groups` as canonical JSON text (the fixtures' protocol); three's is an
    // array of { start, count, materialIndex } in that key order.
    // ponytail: a fresh array per read, so edit groups with addGroup/clearGroups, as three advises.
    const groups = Object.getOwnPropertyDescriptor(prototype, "groups");
    if (groups?.get !== undefined)
      Object.defineProperty(prototype, "groups", {
        configurable: true,
        get(this: object) {
          return (
            JSON.parse(groups.get?.call(this) as string) as {
              start: number;
              count: number;
              materialIndex: number;
            }[]
          ).map(({ start, count, materialIndex }) => ({ start, count, materialIndex }));
        },
      });
  }
  Object.defineProperty(BufferGeometry.prototype, "attributes", {
    configurable: true,
    get(this: IGeometry) {
      const cached = attributeViews.get(this);
      if (cached !== undefined) return cached;
      const names = () =>
        [...new Set([...STANDARD_ATTRIBUTES, ...(authoredNames.get(this) ?? [])])].filter((name) =>
          this.hasAttribute(name),
        );
      const view = new Proxy(
        {},
        {
          get: (_, name) =>
            typeof name === "string" && this.hasAttribute(name)
              ? this.getAttribute(name)
              : undefined,
          has: (_, name) => typeof name === "string" && this.hasAttribute(name),
          set: (_, name, attribute) => {
            this.setAttribute(String(name), attribute);
            return true;
          },
          deleteProperty: (_, name) => {
            this.deleteAttribute(String(name));
            return true;
          },
          ownKeys: () => names(),
          getOwnPropertyDescriptor: (_, name) =>
            typeof name === "string" && this.hasAttribute(name)
              ? {
                  value: this.getAttribute(name),
                  writable: true,
                  enumerable: true,
                  configurable: true,
                }
              : undefined,
        },
      );
      attributeViews.set(this, view);
      return view;
    },
  });
}

// three's `shape.holes` is the plain array a game pushes paths into: each change writes the whole
// array through the native setter, so the geometry built from the shape sees it.
function defineShapeHoles(Shape: Constructor): void {
  const holeViews = new WeakMap<object, unknown[]>();
  const holes = Object.getOwnPropertyDescriptor(Shape.prototype, "holes");
  if (holes?.get === undefined || holes.set === undefined)
    throw new TypeError("TN_BROWSER_UNBOUND: Shape.holes needs the engine's getter and setter");
  Object.defineProperty(Shape.prototype, "holes", {
    configurable: true,
    get(this: object) {
      if (!holeViews.has(this)) {
        const shape = this;
        holeViews.set(
          this,
          new Proxy(holes.get?.call(this) as unknown[], {
            set(target, key, value) {
              (target as unknown as Record<PropertyKey, unknown>)[key] = value;
              holes.set?.call(shape, [...target]);
              return true;
            },
          }),
        );
      }
      return holeViews.get(this);
    },
    set(this: object, value: unknown[]) {
      holes.set?.call(this, [...value]);
      holeViews.delete(this);
    },
  });
}

/**
 * three's abstract Material: the base the native material classes share for `instanceof` and its
 * default hooks. The engine compiles no WebGL program, so the hooks stay three's no-op defaults; a
 * bare Material has no native class and refuses construction.
 */
export class Material {
  constructor() {
    throw new Error("TN_NATIVE_MATERIAL_ABSTRACT: construct a concrete material class");
  }

  onBeforeCompile(): void {}

  customProgramCacheKey(): string {
    return this.onBeforeCompile.toString();
  }
}
(Material.prototype as unknown as Prototype).isMaterial = true;

/** Attaches the shared views to a back end's engine classes. */
export function defineObjectSurface(classes: ISurfaceClasses): void {
  defineGeometrySurface(classes.bufferGeometry, classes.geometries);
  if (classes.shape !== undefined) defineShapeHoles(classes.shape);
  for (const material of classes.materials) {
    Object.setPrototypeOf(material.prototype, Material.prototype);
    // The browser back end already defines the flag (read-only) from the catalog.
    const flag = `is${material.name}`;
    if (!Object.hasOwn(material.prototype, flag)) (material.prototype as Prototype)[flag] = true;
  }
}

// three's scene classes and the `is<Class>` flag each one defines; every light is also `isLight`.
const FLAGGED_CLASSES = [
  "Object3D",
  "Scene",
  "Group",
  "Mesh",
  "SkinnedMesh",
  "InstancedMesh",
  "Bone",
  "LOD",
  "Sprite",
  "Line",
  "LineSegments",
  "Points",
  "Camera",
  "PerspectiveCamera",
  "OrthographicCamera",
  "AmbientLight",
  "DirectionalLight",
  "HemisphereLight",
  "PointLight",
  "SpotLight",
] as const;

/**
 * Puts three's type flags (`isMesh`, `isCamera`, `isLight`, ...) on a back end's scene classes. A
 * subclass inherits its parent's through the prototype chain, as in three; a missing class is skipped.
 */
export function defineTypeFlags(classes: Readonly<Record<string, unknown>>): void {
  for (const name of FLAGGED_CLASSES) {
    const cls = classes[name] as Constructor | undefined;
    if (typeof cls !== "function") continue;
    const flags = name.endsWith("Light") ? [`is${name}`, "isLight"] : [`is${name}`];
    for (const flag of flags)
      Object.defineProperty(cls.prototype, flag, { configurable: true, value: true });
  }
}

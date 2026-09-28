import type { Color, Material } from "three";

import { tintableMaterial } from "./projection-skinned.js";

/**
 * The fingerprint a uniform batch is keyed on, and the per-frame proof a member still matches it.
 *
 * A group of meshes that share a geometry and a material differing **only in base colour** draws as
 * one instanced call with the colour carried per instance, so the draw's only job is to know which
 * materials are interchangeable. That question has two halves, and both are affordable every frame
 * for a scene of four thousand materials:
 *
 * - **At classification**, a material's own properties become a signature string, and the values
 *   behind it are cached by position. Two materials with the same signature differ in nothing a
 *   shader can see except the colour.
 * - **Per frame**, the material is asked whether it still holds every value its group's shared draw
 *   was built from. False is the safe answer: the member leaves the group and is drawn exactly, and
 *   the next frame re-derives the classification. True is a claim about the whole of it.
 *
 * There are two ways to ask, and which one a material gets depends on whether a watch has landed on
 * it yet:
 *
 * - **The poll** reads the material's own values in one `Object.values` call and compares them
 *   against that cache. Everything is compared by identity, which is what a swap is, except the
 *   small-object types three clones per material — a `Color`, a `Vector2`, an `Euler` — which a game
 *   mutates in place, so their components are read instead. A property the group cannot carry
 *   (`color` travels per instance, `defines` is walked shallowly beside this, and the identity
 *   fields are no draw's business) is skipped rather than watched, and the number of own properties
 *   is compared, because a game that attaches a draw-affecting one after the fact would otherwise be
 *   invisible here and the group would keep drawing it with a shared material that never had it.
 * - **The watch** hands the properties the poll judges by identity to accessor pairs that keep their
 *   values in a store keyed by name and raise one dirty bit on a write. A settled frame is then one
 *   read of that bit, the same in-place component compares and the same `defines` walk — the
 *   assignments the poll spent eighty-one reads on are now the game's own writes, wherever they
 *   happen to be written from.
 *
 * A watch lands when its uniform group is applied, in slices under `UNIFORM_WATCH_INSTALL_BUDGET_MS`
 * a frame, and a member whose watch has not landed keeps the poll: detection never lapses, only the
 * saving arrives a few frames late. Installing costs about 33 µs per material — 130 ms for four
 * thousand, which is why it is sliced — and it is undone exactly: the plain data properties come
 * back, and a hook the game shadowed keeps the game's own function, when the material leaves the
 * group, the group is disposed, or the mirror is torn down. The mirror draws every uniform batch
 * with a clone of its own, so no draw ever reads a watched material.
 *
 * Two things the poll saw that a watch cannot are recorded here rather than claimed: a property
 * *added* to a watched material after its watch landed is a new own property no accessor covers, and
 * `Object.freeze` or a `delete` on a watched material leaves a member the frame's check calls
 * unchanged. Both are rare, both fail towards keeping the material batched, and neither is a guard
 * row anywhere in the suite.
 *
 * The comparison is deliberately a value compare and nothing else. `material.version` is not part of
 * it, because `material.needsUpdate = true` bumps it without changing a pixel, and a material that
 * set it every frame would then be reclassified every frame for nothing. Every change that *can*
 * move a pixel is a change to one of the values read here, so the values are the whole truth and
 * the version is not.
 */

/** Own properties no draw reads: the per-instance colour, and identity or bookkeeping. */
const UNREAD_PROPERTIES: ReadonlySet<string> = new Set([
  "color",
  "defines",
  "id",
  "name",
  "userData",
  "uuid",
  "version",
]);

/**
 * The two hooks three keeps on `Material.prototype` that a game shadows by assigning its own.
 *
 * They are not own properties until they are shadowed, so they are in no material's value list and
 * the poll only ever notices the assignment as a change in how many properties it has. A watch
 * cannot see a property that appears, so it watches these two *names* directly: as non-enumerable
 * own accessors, which leaves the material's own property list — and therefore its signature, its
 * spread and its `toJSON` — exactly as the game wrote it.
 */
const WATCHED_HOOKS = new Set(["customProgramCacheKey", "onBeforeCompile"]);

/** Where a watched material's values live. Not an own property of the material, so nothing sees it. */
const WATCH_STORE: unique symbol = Symbol("threenative.uniformWatch");

/** Set by a write to a watched key that moved the value; read and cleared by the frame's check. */
const WATCH_DIRTY: unique symbol = Symbol("threenative.uniformWatchDirty");

/** What each watched hook held before the watch shadowed it, so the undo can tell shadowed from not. */
const WATCH_SEEDS: unique symbol = Symbol("threenative.uniformWatchSeeds");

/**
 * What one frame may spend turning members into watched members.
 *
 * An install is 33 µs per material, so four thousand of them is a 130 ms hitch; a budget turns that
 * into a few frames of the cost the poll already cost. The number is a frame budget, not a machine
 * threshold: anything above zero keeps the install off the settle path, and nothing below it changes
 * what the frame can detect.
 */
export const UNIFORM_WATCH_INSTALL_BUDGET_MS = 2;

/** A watched material's values by name, plus the one bit the settled frame reads. */
type WatchStore = Record<string, unknown> & {
  [WATCH_DIRTY]: boolean;
  [WATCH_SEEDS]: Record<string, unknown>;
};

/** The store's side of a watched material, which is what its accessors read. */
interface IWatchedMaterial {
  [WATCH_STORE]: WatchStore;
}

/** How a component-compared value's own numeric fields are read back per frame. */
const READ_KEYED = 0;
const READ_RGB = 1;
const READ_XY = 2;
const READ_UNDERSCORE_XYZ = 3;

interface IUniformRecord {
  /** The values as of the last classification, by the position they were enumerated at. */
  values: unknown[];
  /** Flat `[start, end)` pairs covering the positions judged by identity, skips excluded. */
  identityRanges: Int32Array;
  /** The own properties those ranges judge, by name — the keys a watch takes over. */
  identityKeys: string[];
  /** Positions of the component-compared values, in enumeration order, and their names. */
  vectorSlots: number[];
  vectorKeys: string[];
  /** How each of those values is read back, and how many fields of it there are. */
  vectorReads: Uint8Array;
  vectorWidths: Uint8Array;
  /** The own numeric field names of every component-compared value, flattened. */
  vectorFields: string[];
  components: number[];
  /** `defines` keys, in enumeration order, and the value each held. */
  defineKeys: string[];
  defineValues: unknown[];
  signature: string;
  /** The store a watch reads and writes, or `undefined` while this material is unwatched. */
  store: WatchStore | undefined;
}

const records = new WeakMap<Material, IUniformRecord>();
/**
 * A number per opaque value — anything whose components say nothing, from a `ShaderMaterial`'s
 * `uniforms` to a game's own `onBeforeCompile`. Two materials holding the *same* one are as
 * interchangeable as two holding the same texture; two holding different ones are not, and every
 * one of them stringifies to `[object Object]`, so identity has to be spoken for numerically.
 */
const opaqueIds = new WeakMap<object, number>();
let nextOpaqueId = 1;

/**
 * The accessor pair for one key name, shared by every material that watches it.
 *
 * One pair per *name*, not per (material, key): a standard material has 71 own properties a watch
 * takes over, and four thousand of them would otherwise allocate 284,000 closures to install 284,000
 * descriptors — measured at 106 µs per material against 33 µs for this shape. The pair reaches its
 * values through the store on `this`, so one function object serves every material that watches the
 * name, and the store is the only thing that differs between them.
 */
const watchedDescriptors = new Map<string, PropertyDescriptor>();

function watchedDescriptor(key: string): PropertyDescriptor {
  const cached = watchedDescriptors.get(key);
  if (cached !== undefined) return cached;
  const pair: PropertyDescriptor = {
    get(this: object): unknown {
      return (this as IWatchedMaterial)[WATCH_STORE][key];
    },
    set(this: object, next: unknown): void {
      const store = (this as IWatchedMaterial)[WATCH_STORE];
      if (store[key] === next) return;
      store[key] = next;
      store[WATCH_DIRTY] = true;
    },
    enumerable: true,
    configurable: true,
  };
  watchedDescriptors.set(key, pair);
  return pair;
}

/** A value read by name, which is the only way a watched key's value comes back. */
function keyedValue(owner: object, key: string): unknown {
  return (owner as Record<string, unknown>)[key];
}

function colorValueOf(value: unknown): Color | undefined {
  if (value === null || value === undefined) return undefined;
  return (value as { isColor?: boolean }).isColor === true ? (value as Color) : undefined;
}

function isTextureValue(value: unknown): boolean {
  return value !== null && (value as { isTexture?: boolean }).isTexture === true;
}

/**
 * The own **numeric** field names of a value three clones per material and a game then mutates in
 * place — a `Color`, a `Vector2`, an `Euler` — or `undefined` when the value is not one of those.
 *
 * Recognised structurally, by "every own value is a primitive and at least one is a number", rather
 * than by naming each class: that is what a clone of a `MeshStandardMaterial` actually holds, it
 * covers the classes a future three adds, and it refuses anything it cannot read — a `Texture`,
 * which is compared by identity, and anything else, which is opaque. The *numbers* are what come
 * back, because a boolean or a string field is not something the compare could ever see move: a
 * `Color`'s `isColor` reads as `0` before and after, so recording it would cost a read per frame to
 * compare a value against itself. The *names* are recorded rather than the objects so the per-frame
 * read is a handful of field reads: a material animating `normalScale` or an `envMapRotation` is
 * caught, and one that set `needsUpdate` is not mistaken for one that did.
 */
function componentFieldsOf(value: unknown): string[] | undefined {
  if (value === null || typeof value !== "object" || isTextureValue(value)) return undefined;
  const fields = Object.keys(value);
  if (fields.length === 0) return undefined;
  const numbers: string[] = [];
  for (const field of fields) {
    const kind = typeof (value as Record<string, unknown>)[field];
    if (kind === "number") numbers.push(field);
    else if (kind !== "boolean" && kind !== "string") return undefined;
  }
  return numbers.length === 0 ? undefined : numbers;
}

/**
 * How the recorded fields of one component-compared value are read back each frame.
 *
 * A field read by name through a variable — `value[name]` — is a dictionary lookup the engine
 * cannot fold, and it is the single most expensive thing a settled frame did: four small objects
 * per material, and every one of them looked up field by field. Naming the field instead makes it
 * a fixed offset, so the three shapes three actually clones (`Color`, `Vector2`, `Euler`) are read
 * directly and anything a future material brings falls back to the general path rather than being
 * assumed a shape it is not.
 */
function readKindOf(fields: string[]): number {
  if (fields.length === 3) {
    if (fields[0] === "r" && fields[1] === "g" && fields[2] === "b") return READ_RGB;
    if (fields[0] === "_x" && fields[1] === "_y" && fields[2] === "_z") return READ_UNDERSCORE_XYZ;
    return READ_KEYED;
  }
  if (fields.length === 2 && fields[0] === "x" && fields[1] === "y") return READ_XY;
  return READ_KEYED;
}

/** The base colour a tinted group carries per instance, or `undefined` when the material has none. */
export function baseColorOf(material: Material): Color | undefined {
  const color = (material as { color?: Color }).color;
  return color !== undefined && typeof color.r === "number" ? color : undefined;
}

/** Whether a material may be the shared half of a uniform group at all. */
export function uniformEligible(material: Material): boolean {
  return tintableMaterial(material) && baseColorOf(material) !== undefined;
}

function opaqueIdOf(value: object): number {
  const existing = opaqueIds.get(value);
  if (existing !== undefined) return existing;
  const id = nextOpaqueId;
  nextOpaqueId += 1;
  opaqueIds.set(value, id);
  return id;
}

/** How a value speaks for itself in a signature, which is built once per classification. */
function signatureTextOf(
  value: unknown,
  fields: string[] | undefined,
  components: number[],
): string {
  if (fields !== undefined) return `v${components.slice(-fields.length).join(",")}`;
  if (isTextureValue(value)) return `t${(value as { uuid?: string }).uuid ?? ""}`;
  if (value !== null && typeof value === "object") return `o${opaqueIdOf(value)}`;
  return `${typeof value}:${String(value)}`;
}

/**
 * The signature two materials must share to draw in one uniform group, or `undefined` when this
 * material may not be in one. Also refreshes the material's cached values, so the per-frame proof
 * below always compares against what this classification saw.
 */
export function uniformSignatureOf(material: Material): string | undefined {
  if (!uniformEligible(material)) return undefined;
  const existing = records.get(material);
  // A watched member that has provably not moved keeps the signature it was classified with.
  // Re-deriving one builds a string from every property, which measured 4 µs a material — 16 ms for
  // a scene of four thousand — and a single member changing drops the whole plan, so the next frame
  // re-derives every member in the scene. This is what keeps one changed material from costing the
  // scene a re-classification.
  if (
    existing !== undefined &&
    existing.store !== undefined &&
    mutableUnchanged(material, existing)
  ) {
    return existing.signature;
  }
  const keys = Object.keys(material);
  const values = Object.values(material);
  const record = existing ?? {
    values: [],
    identityRanges: new Int32Array(0),
    identityKeys: [],
    vectorSlots: [],
    vectorKeys: [],
    vectorReads: new Uint8Array(0),
    vectorWidths: new Uint8Array(0),
    vectorFields: [],
    components: [],
    defineKeys: [],
    defineValues: [],
    signature: "",
    store: undefined,
  };
  if (existing === undefined) records.set(material, record);
  const {
    vectorSlots,
    vectorKeys,
    vectorFields,
    components,
    defineKeys,
    defineValues,
    identityKeys,
  } = record;
  const reads: number[] = [];
  const widths: number[] = [];
  vectorSlots.length = 0;
  vectorKeys.length = 0;
  vectorFields.length = 0;
  components.length = 0;
  identityKeys.length = 0;
  const ranges: number[] = [];
  let open = -1;
  let signature = "";
  for (let index = 0; index < keys.length; index += 1) {
    const key = keys[index] as string;
    const value = values[index];
    const fields = UNREAD_PROPERTIES.has(key) ? undefined : componentFieldsOf(value);
    if (fields === undefined) {
      // The unread and the component-compared are both left out of the identity walk, and either
      // one ends a run of it: the run is only worth having while the positions are consecutive.
      if (UNREAD_PROPERTIES.has(key)) continue;
      if (open === -1) open = index;
      identityKeys.push(key);
    } else {
      if (open !== -1) {
        ranges.push(open, index);
        open = -1;
      }
      vectorSlots.push(index);
      vectorKeys.push(key);
      reads.push(readKindOf(fields));
      widths.push(fields.length);
      for (const field of fields) {
        vectorFields.push(field);
        components.push((value as Record<string, number>)[field] as number);
      }
    }
    signature += `${key}=${signatureTextOf(value, fields, components)}|`;
  }
  if (open !== -1) ranges.push(open, keys.length);
  record.values = values;
  record.identityRanges = Int32Array.from(ranges);
  record.vectorReads = Uint8Array.from(reads);
  record.vectorWidths = Uint8Array.from(widths);
  defineKeys.length = 0;
  defineValues.length = 0;
  const defines = material.defines as Record<string, unknown> | undefined;
  if (defines !== null && defines !== undefined) {
    for (const key in defines) {
      defineKeys.push(key);
      defineValues.push(defines[key]);
      signature += `defines.${key}=${signatureTextOf(defines[key], undefined, [])}|`;
    }
  }
  record.signature = signature;
  return signature;
}

/** The three shapes three clones per material, read by name rather than through a variable. */
interface IComponents {
  r: number;
  g: number;
  b: number;
  x: number;
  y: number;
  _x: number;
  _y: number;
  _z: number;
}

/**
 * Hands this material's own properties to a watch, and returns whether it installed one.
 *
 * Everything the poll judges by identity becomes an accessor pair over a store keyed by name, plus
 * the two prototype hooks a game can shadow. Everything the poll compares by component stays a
 * plain data property, because a `Color` a game mutates in place is a write to the object the
 * property points at and no accessor on the material could see it.
 *
 * A material that cannot take the accessors — frozen, sealed — keeps its plain properties and keeps
 * the poll, and so does one that is already watched or has no record because it is not eligible for
 * a uniform group at all.
 */
export function installUniformWatch(material: Material): boolean {
  const record = records.get(material);
  if (record === undefined || record.store !== undefined) return false;
  const seeds: Record<string, unknown> = {};
  const store: WatchStore = { [WATCH_DIRTY]: false, [WATCH_SEEDS]: seeds };
  const descriptors: Record<string, PropertyDescriptor> = {};
  for (const key of record.identityKeys) {
    store[key] = keyedValue(material, key);
    descriptors[key] = watchedDescriptor(key);
  }
  for (const key of WATCHED_HOOKS) {
    const held = keyedValue(material, key);
    store[key] = held;
    seeds[key] = held;
    // Non-enumerable, so the watch leaves no trace in what the material enumerates: the signature
    // built above, a spread, a `for...in` and a `toJSON` all see exactly the game author's own
    // properties. An own enumerable accessor here would put a name in the signature that the
    // material did not have.
    const pair = watchedDescriptor(key);
    Object.defineProperty(material, key, {
      get: pair.get,
      set: pair.set,
      enumerable: false,
      configurable: true,
    });
  }
  Reflect.defineProperty(material, WATCH_STORE, {
    value: store,
    enumerable: false,
    configurable: true,
    writable: true,
  });
  try {
    Object.defineProperties(material, descriptors);
  } catch {
    // Unwritable properties, which a frozen or sealed material is. Put back what was taken, within
    // the same synchronous block the values were read in, and let the poll carry the member.
    releaseUniformWatch(material);
    return false;
  }
  record.store = store;
  return true;
}

/**
 * Gives the material its own plain data properties back, and forgets the store behind them.
 *
 * Called from every path a uniform member leaves through — a material that drifted, a lane change, a
 * group disposed, the mirror torn down — because a watch left behind is a material that keeps
 * paying for the notification after nothing is listening for it, and one that never gets its values
 * back is a material the game cannot draw with.
 */
export function releaseUniformWatch(material: Material): void {
  const record = records.get(material);
  if (record === undefined || record.store === undefined) return;
  const store = record.store;
  const seeds = store[WATCH_SEEDS];
  const descriptors: Record<string, PropertyDescriptor> = {};
  // The store holds one entry per name the watch took over, and the store's own bookkeeping is keyed
  // by symbol, so the names are exactly those — no list to keep in step with them.
  for (const key of Object.keys(store)) {
    const held = store[key];
    // A hook the game never shadowed leaves no trace: deleting the accessor is the whole undo. One it
    // did shadow keeps the game's own function as a plain property, or the assignment that ejected
    // the member would be undone along with the watch.
    if (WATCHED_HOOKS.has(key) && held === seeds[key]) Reflect.deleteProperty(material, key);
    else
      descriptors[key] = {
        value: held,
        writable: true,
        enumerable: true,
        configurable: true,
      };
  }
  Object.defineProperties(material, descriptors);
  Reflect.deleteProperty(material, WATCH_STORE);
  record.store = undefined;
  store[WATCH_DIRTY] = false;
}

/**
 * The values a game changes without writing a property at all: the `Color`, `Vector2` and `Euler` a
 * material holds and mutates in place, and the `defines` an object walk.
 *
 * This is the part of the proof a watch cannot take over, so it runs identically either way. The one
 * difference is where a component-compared value comes from: the poll already has the material's own
 * value list in hand and reads its slot, a watch has no list and reads the name.
 */
function mutableUnchanged(
  material: Material,
  record: IUniformRecord,
  current?: unknown[],
): boolean {
  const { vectorSlots, vectorKeys, vectorReads, vectorWidths, vectorFields, components } = record;
  let read = 0;
  for (let slot = 0; slot < vectorSlots.length; slot += 1) {
    const value =
      current !== undefined
        ? current[vectorSlots[slot] as number]
        : keyedValue(material, vectorKeys[slot] as string);
    if (value === null || typeof value !== "object") return false;
    const parts = value as IComponents;
    switch (vectorReads[slot]) {
      case READ_RGB:
        if (
          parts.r !== components[read] ||
          parts.g !== components[read + 1] ||
          parts.b !== components[read + 2]
        )
          return false;
        break;
      case READ_XY:
        if (parts.x !== components[read] || parts.y !== components[read + 1]) return false;
        break;
      case READ_UNDERSCORE_XYZ:
        if (
          parts._x !== components[read] ||
          parts._y !== components[read + 1] ||
          parts._z !== components[read + 2]
        )
          return false;
        break;
      default: {
        const fields = value as Record<string, number>;
        const width = vectorWidths[slot] as number;
        for (let part = 0; part < width; part += 1) {
          if (fields[vectorFields[read + part] as string] !== components[read + part]) return false;
        }
      }
    }
    read += vectorWidths[slot] as number;
  }
  const defines = material.defines as Record<string, unknown> | undefined;
  const defineKeys = record.defineKeys;
  let count = 0;
  if (defines !== null && defines !== undefined) {
    for (const key in defines) {
      if (key !== defineKeys[count] || defines[key] !== record.defineValues[count]) return false;
      count += 1;
    }
  }
  return count === defineKeys.length;
}

/**
 * Whether the material still holds every value its group's shared draw was built from.
 *
 * False is the safe answer: the member leaves the group and is drawn exactly, and the frame's
 * classification is re-derived. True is a claim about the material's whole own value list, read
 * whether or not any of it moved.
 */
export function uniformUnchanged(material: Material): boolean {
  const record = records.get(material);
  // No fingerprint means no group was ever derived from this material, so nothing to have drifted
  // from. Re-deriving the classification is what establishes one.
  if (record === undefined) return true;
  const store = record.store;
  if (store !== undefined) {
    // Watched: the material's own writes are the dirty bit, so a settled frame never enumerates it.
    if (store[WATCH_DIRTY]) {
      store[WATCH_DIRTY] = false;
      return false;
    }
    return mutableUnchanged(material, record);
  }
  // Unwatched, which is either a member whose install has not landed in its budget yet or one whose
  // material could not take an accessor. One read of the material's own values, and the count that
  // says whether a property appeared or disappeared comes with it. Reading each value by name
  // instead is what this replaced, and it is several times slower: an engine cannot fold a lookup
  // through a variable, so eighty-one of them per material is eighty-one dictionary probes, against
  // one copy of eighty-one slots.
  const current = Object.values(material);
  const { values, identityRanges } = record;
  if (current.length !== values.length) return false;
  for (let range = 0; range < identityRanges.length; range += 2) {
    const end = identityRanges[range + 1] as number;
    for (let index = identityRanges[range] as number; index < end; index += 1) {
      if (current[index] !== values[index]) return false;
    }
  }
  return mutableUnchanged(material, record, current);
}

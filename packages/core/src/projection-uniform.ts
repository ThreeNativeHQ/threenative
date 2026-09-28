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
 * - **Per frame**, the material's own values are read back in one `Object.values` call and compared
 *   against that cache. Everything is compared by identity, which is what a swap is, except the
 *   small-object types three clones per material — a `Color`, a `Vector2`, an `Euler` — which a game
 *   mutates in place, so their components are read instead. A property the group cannot carry
 *   (`color` travels per instance, `defines` is walked shallowly beside this, and the identity
 *   fields are no draw's business) is skipped rather than watched, and the number of own properties
 *   is compared, because a game that attaches a draw-affecting one after the fact would otherwise be
 *   invisible here and the group would keep drawing it with a shared material that never had it.
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

/** How a value at one position of a material's own value list is judged. */
const COMPARE_IDENTITY = 0;
const COMPARE_COMPONENTS = 1;
const COMPARE_SKIP = 2;

interface IUniformRecord {
  /** How to judge each of the material's own values, by position. */
  kinds: Uint8Array;
  /** The values as of the last classification, by the same position. */
  values: unknown[];
  /** Positions of the component-compared values, in enumeration order. */
  vectorSlots: number[];
  /** How many fields each component-compared value is read through, in the same order. */
  vectorWidths: number[];
  /** The own field names of every component-compared value, flattened, and what each held. */
  vectorFields: string[];
  components: number[];
  /** `defines` keys, in enumeration order, and the value each held. */
  defineKeys: string[];
  defineValues: unknown[];
  signature: string;
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

function colorValueOf(value: unknown): Color | undefined {
  if (value === null || value === undefined) return undefined;
  return (value as { isColor?: boolean }).isColor === true ? (value as Color) : undefined;
}

function isTextureValue(value: unknown): boolean {
  return value !== null && (value as { isTexture?: boolean }).isTexture === true;
}

/**
 * The own field names of a value three clones per material and a game then mutates in place — a
 * `Color`, a `Vector2`, an `Euler` — or `undefined` when the value is not one of those.
 *
 * Recognised structurally, by "every own value is a primitive and at least one is a number", rather
 * than by naming each class: that is what a clone of a `MeshStandardMaterial` actually holds, it
 * covers the classes a future three adds, and it refuses anything it cannot read — a `Texture`,
 * which is compared by identity, and anything else, which is opaque. The *names* are recorded
 * rather than the values so the per-frame read is a handful of field reads: a material animating
 * `normalScale` or an `envMapRotation` is caught, and one that set `needsUpdate` is not mistaken for
 * one that did.
 */
function componentFieldsOf(value: unknown): string[] | undefined {
  if (value === null || typeof value !== "object" || isTextureValue(value)) return undefined;
  const fields = Object.keys(value);
  if (fields.length === 0) return undefined;
  let numbers = 0;
  for (const field of fields) {
    const kind = typeof (value as Record<string, unknown>)[field];
    if (kind === "number") numbers += 1;
    else if (kind !== "boolean" && kind !== "string") return undefined;
  }
  return numbers === 0 ? undefined : fields;
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

/**
 * A value as the component compare can carry it: a number as itself, and a boolean or a string
 * collapsed to 0. That is all `componentFieldsOf` admits, so the compare never has to look at a
 * type — and two values of different types cannot be confused for each other here, because the
 * field that would have to hold them is not admitted at all unless it agrees with its neighbours.
 */
function scalarOf(value: unknown): number {
  return typeof value === "number" ? value : 0;
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
  const source = material as unknown as Record<string, unknown>;
  const keys = Object.keys(source);
  const values = Object.values(source);
  let record = records.get(material);
  if (record === undefined) {
    record = {
      kinds: new Uint8Array(0),
      values: [],
      vectorSlots: [],
      vectorWidths: [],
      vectorFields: [],
      components: [],
      defineKeys: [],
      defineValues: [],
      signature: "",
    };
    records.set(material, record);
  }
  const { kinds, vectorSlots, vectorWidths, vectorFields, components, defineKeys, defineValues } =
    record;
  const marks = kinds.length === keys.length ? kinds : new Uint8Array(keys.length);
  vectorSlots.length = 0;
  vectorWidths.length = 0;
  vectorFields.length = 0;
  components.length = 0;
  let signature = "";
  for (let index = 0; index < keys.length; index += 1) {
    const key = keys[index] as string;
    if (UNREAD_PROPERTIES.has(key)) {
      marks[index] = COMPARE_SKIP;
      continue;
    }
    const value = values[index];
    const fields = componentFieldsOf(value);
    marks[index] = fields === undefined ? COMPARE_IDENTITY : COMPARE_COMPONENTS;
    if (fields !== undefined) {
      vectorSlots.push(index);
      vectorWidths.push(fields.length);
      for (const field of fields) {
        vectorFields.push(field);
        components.push(scalarOf((value as Record<string, unknown>)[field]));
      }
    }
    signature += `${key}=${signatureTextOf(value, fields, components)}|`;
  }
  record.kinds = marks;
  record.values = values;
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
  const current = Object.values(material as unknown as Record<string, unknown>);
  // A property appearing or disappearing changes what the draw reads, and the count is what says so.
  if (current.length !== record.values.length) return false;
  const { kinds, values, vectorSlots, vectorWidths, vectorFields, components } = record;
  for (let index = 0; index < current.length; index += 1) {
    if ((kinds[index] as number) === COMPARE_IDENTITY && current[index] !== values[index])
      return false;
  }
  let read = 0;
  for (let slot = 0; slot < vectorSlots.length; slot += 1) {
    const value = current[vectorSlots[slot] as number];
    if (value === null || typeof value !== "object") return false;
    const fields = value as Record<string, unknown>;
    const width = vectorWidths[slot] as number;
    for (let part = 0; part < width; part += 1) {
      if (scalarOf(fields[vectorFields[read + part] as string]) !== components[read + part])
        return false;
    }
    read += width;
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

/**
 * Collapsing materials that became identical once their textures shared a page.
 *
 * This is the step the atlas exists to enable, and it is also the step that falsifies the atlas.
 * The reference game's merge found 274 buckets holding 213 singletons because every material owned
 * a private texture; if the singleton count does not fall once those textures share pages, the
 * atlas hypothesis is wrong and everything priced on it has to be repriced. So the signature here
 * is deliberately conservative: two materials collapse only when every field that can change a
 * pixel agrees, and anything the signature does not know about keeps them apart.
 */

/** The material state a signature is taken over. Structural, so a glTF or a three material fits. */
export interface IMaterialState {
  readonly name?: string;
  /** Texture identity per slot *after* atlasing — the page, not the original image. */
  readonly textures: Readonly<Record<string, string | undefined>>;
  /** Scalar and vector uniforms: base colour, metallic, roughness, emissive, alpha cutoff, … */
  readonly uniforms: Readonly<
    Record<string, number | readonly number[] | string | boolean | undefined>
  >;
  /** Anything that changes how the surface is drawn rather than what it samples. */
  readonly flags: Readonly<Record<string, number | string | boolean | undefined>>;
}

function normalise(value: number | readonly number[] | string | boolean | undefined): string {
  if (value === undefined) return "\u0000";
  if (Array.isArray(value)) return value.map((entry) => normalise(entry as number)).join(",");
  if (typeof value === "number") {
    // A signature over floats has to be exact or two materials that differ in the last bit of
    // roughness collapse. `toPrecision` would be a tolerance nobody declared.
    return Object.is(value, -0) ? "0" : String(value);
  }
  return String(value);
}

/**
 * A stable signature over everything that decides how this material looks.
 *
 * The name is deliberately **not** in it: an imported pack names a material per part, and letting
 * the name separate them is exactly the property that made 213 singletons. Every other field is,
 * including ones this pipeline does not understand, because an unknown field that differs is a
 * reason not to collapse.
 */
export function materialSignature(material: IMaterialState): string {
  const parts: string[] = [];
  for (const [slot, texture] of Object.entries(material.textures).sort(([left], [right]) =>
    left < right ? -1 : 1,
  ))
    parts.push(`t:${slot}=${texture ?? "\u0000"}`);
  for (const [name, value] of Object.entries(material.uniforms).sort(([left], [right]) =>
    left < right ? -1 : 1,
  ))
    parts.push(`u:${name}=${normalise(value)}`);
  for (const [name, value] of Object.entries(material.flags).sort(([left], [right]) =>
    left < right ? -1 : 1,
  ))
    parts.push(`f:${name}=${normalise(value)}`);
  return parts.join("|");
}

/** One group of materials that became the same material. */
export interface IMaterialBucket {
  readonly signature: string;
  /** Names in input order, so a report can say which materials collapsed into which. */
  readonly members: readonly string[];
}

export interface IDedupeCensus {
  /** Distinct signatures — the material count after deduplication. */
  readonly buckets: number;
  /** Buckets holding exactly one material: the count the atlas has to move. */
  readonly singletons: number;
  /** Materials in. */
  readonly materials: number;
}

/** Groups materials by signature, in first-seen order so two runs report the same thing. */
export function dedupeMaterials(materials: readonly IMaterialState[]): {
  buckets: readonly IMaterialBucket[];
  census: IDedupeCensus;
} {
  const bySignature = new Map<string, string[]>();
  for (let index = 0; index < materials.length; index += 1) {
    const material = materials[index];
    if (material === undefined) continue;
    const signature = materialSignature(material);
    const members = bySignature.get(signature);
    const name = material.name ?? `material-${String(index)}`;
    if (members === undefined) bySignature.set(signature, [name]);
    else members.push(name);
  }
  const buckets = [...bySignature.entries()].map(([signature, members]) => ({
    members,
    signature,
  }));
  return {
    buckets,
    census: {
      buckets: buckets.length,
      materials: materials.length,
      singletons: buckets.filter((bucket) => bucket.members.length === 1).length,
    },
  };
}

/**
 * The same materials with every texture slot repointed at its atlas page.
 *
 * A slot whose source was excluded from the atlas keeps its original texture, which is what makes
 * the census honest: those materials stay singletons, and the report says how many.
 */
export function withAtlasTextures(
  materials: readonly IMaterialState[],
  pageOf: (texture: string) => string | undefined,
): IMaterialState[] {
  return materials.map((material) => {
    const textures: Record<string, string | undefined> = {};
    for (const [slot, texture] of Object.entries(material.textures))
      textures[slot] = texture === undefined ? undefined : (pageOf(texture) ?? texture);
    return { ...material, textures };
  });
}

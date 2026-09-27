/**
 * A deterministic texture atlas packer.
 *
 * The reference game's carrier is 95 meshes over 76 materials and **73 distinct texture sources** —
 * one texture per material, because an imported model carries a material per part. A per-material
 * merge over content shaped like that has nothing to collapse: it found 274 buckets holding 213
 * singletons and moved no frame time. That null result is the evidence for this file. Materials
 * cannot be deduplicated while each one owns a private texture, so the atlas is the prerequisite
 * and everything downstream — dedupe, merge, instancing — is priced against it.
 *
 * Two properties, both load-bearing:
 *
 *  - **Deterministic.** Two runs over the same inputs place every source at the same pixel. The
 *    order is derived from the sources themselves (taller first, then wider, then the key), never
 *    from map iteration or filesystem order, because a build that packs differently on a rebuild
 *    invalidates every downstream cache and makes a screenshot-parity gate meaningless.
 *  - **It refuses what it cannot do.** A source that tiles is excluded and reported, never packed
 *    and silently clamped: a repeating surface whose UVs leave `[0, 1]` reads neighbouring pages
 *    once it shares one, which is a visible bug that looks like corruption rather than like a
 *    packing decision.
 *
 * Shelf packing, not a perfect bin: sorted by height it wastes a few percent of a page against an
 * optimal solver nobody can read, and the cost of a wasted page is bytes, while the cost of a
 * wrong one is a visual bug. `ponytail: shelf packer, revisit only if page count is measured to
 * matter.`
 */

/** One image offered to the packer. */
export interface IAtlasSource {
  /** Stable identity — the content hash or the texture's URI. Ties in the sort break on this. */
  readonly key: string;
  readonly width: number;
  readonly height: number;
  /**
   * Whether the material samples this source outside `[0, 1]`. A tiling source cannot share a
   * page, and saying so is the source's job, not a guess the packer makes from pixels.
   */
  readonly tiles?: boolean;
}

/** Where one source landed. */
export interface IAtlasPlacement {
  readonly key: string;
  readonly page: number;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** The UV transform for one source: `uv' = uv * scale + offset`. */
export interface IAtlasTransform {
  readonly page: number;
  readonly offsetX: number;
  readonly offsetY: number;
  readonly scaleX: number;
  readonly scaleY: number;
}

/** Why a source was left out. Every exclusion is reported; none is silent. */
export type AtlasExclusionReason = "tiles" | "too-large";

export interface IAtlasExclusion {
  readonly key: string;
  readonly reason: AtlasExclusionReason;
}

export interface IAtlasPage {
  readonly index: number;
  readonly width: number;
  readonly height: number;
  readonly placements: readonly IAtlasPlacement[];
}

export interface IAtlasResult {
  readonly pages: readonly IAtlasPage[];
  /** Keyed by source key, in the packer's own deterministic order. */
  readonly transforms: ReadonlyMap<string, IAtlasTransform>;
  readonly excluded: readonly IAtlasExclusion[];
}

export interface IAtlasOptions {
  /** Page edge in pixels. Default 4096. */
  readonly pageSize?: number;
  /**
   * Transparent pixels kept between neighbours, so a mip level or a bilinear tap cannot reach the
   * next source. Default 4 — two levels of mip bleed at the sizes this packs.
   */
  readonly padding?: number;
}

const DEFAULT_PAGE_SIZE = 4_096;
const DEFAULT_PADDING = 4;

function requirePositiveInteger(value: number, name: string): number {
  if (!Number.isInteger(value) || value < 1)
    throw new Error(`Atlas ${name} must be an integer of at least one, received ${String(value)}.`);
  return value;
}

/**
 * The packing order, derived from the sources and nothing else.
 *
 * Tallest first is what makes shelf packing tight; width then key make the comparison total, which
 * is what makes the result reproducible. A `sort` over the caller's array order would be stable but
 * not *deterministic across callers*, and the caller's order comes from a directory listing.
 */
function packingOrder(sources: readonly IAtlasSource[]): IAtlasSource[] {
  return [...sources].sort(
    (left, right) =>
      right.height - left.height ||
      right.width - left.width ||
      (left.key < right.key ? -1 : left.key > right.key ? 1 : 0),
  );
}

/**
 * Packs sources into pages and answers the UV transform for each.
 *
 * Fails closed on a malformed source: a zero or non-integer dimension is a decoder that did not
 * decode, and packing it would put a divide-by-zero in every UV it rewrites.
 */
export function packAtlas(
  sources: readonly IAtlasSource[],
  options: IAtlasOptions = {},
): IAtlasResult {
  const pageSize = requirePositiveInteger(options.pageSize ?? DEFAULT_PAGE_SIZE, "pageSize");
  const padding = options.padding ?? DEFAULT_PADDING;
  if (!Number.isInteger(padding) || padding < 0)
    throw new Error(`Atlas padding must be a non-negative integer, received ${String(padding)}.`);
  for (const source of sources) {
    requirePositiveInteger(source.width, `source ${source.key} width`);
    requirePositiveInteger(source.height, `source ${source.key} height`);
  }

  const excluded: IAtlasExclusion[] = [];
  const placements: IAtlasPlacement[][] = [];
  const transforms = new Map<string, IAtlasTransform>();
  // Shelves of the page currently being filled, one row per shelf.
  let page = -1;
  let shelfY = 0;
  let shelfHeight = 0;
  let cursorX = 0;

  const openPage = (): void => {
    page += 1;
    placements.push([]);
    shelfY = 0;
    shelfHeight = 0;
    cursorX = 0;
  };

  for (const source of packingOrder(sources)) {
    if (source.tiles === true) {
      excluded.push({ key: source.key, reason: "tiles" });
      continue;
    }
    const width = source.width + padding * 2;
    const height = source.height + padding * 2;
    if (width > pageSize || height > pageSize) {
      excluded.push({ key: source.key, reason: "too-large" });
      continue;
    }
    if (page < 0) openPage();
    if (cursorX + width > pageSize) {
      shelfY += shelfHeight;
      shelfHeight = 0;
      cursorX = 0;
    }
    // Checked for every placement, not only at the start of a shelf. Sorting by height makes the
    // first item on a shelf the tallest, which would make the start-of-shelf check sufficient —
    // and would leave the page bounds resting on the sort order instead of on the packer. A bounds
    // invariant that holds only for sorted input is one refactor away from writing off the page.
    if (shelfY + height > pageSize) openPage();
    const x = cursorX + padding;
    const y = shelfY + padding;
    placements[page]?.push({
      height: source.height,
      key: source.key,
      page,
      width: source.width,
      x,
      y,
    });
    transforms.set(source.key, {
      offsetX: x / pageSize,
      offsetY: y / pageSize,
      page,
      scaleX: source.width / pageSize,
      scaleY: source.height / pageSize,
    });
    cursorX += width;
    if (height > shelfHeight) shelfHeight = height;
  }

  return {
    excluded,
    pages: placements.map((entries, index) => ({
      height: pageSize,
      index,
      placements: entries,
      width: pageSize,
    })),
    transforms,
  };
}

/**
 * The manifest a build writes beside the pages.
 *
 * Sorted by key so two runs produce byte-identical JSON — the same reason the packing order is
 * derived rather than inherited.
 */
export function atlasManifest(result: IAtlasResult): string {
  const transforms = [...result.transforms.entries()]
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([key, transform]) => ({ key, ...transform }));
  return JSON.stringify(
    {
      excluded: [...result.excluded].sort((left, right) =>
        left.key < right.key ? -1 : left.key > right.key ? 1 : 0,
      ),
      pages: result.pages.map((entry) => ({
        height: entry.height,
        index: entry.index,
        placements: [...entry.placements].sort((left, right) =>
          left.key < right.key ? -1 : left.key > right.key ? 1 : 0,
        ),
        width: entry.width,
      })),
      transforms,
    },
    null,
    2,
  );
}

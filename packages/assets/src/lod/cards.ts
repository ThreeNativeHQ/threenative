/**
 * Card thinning — the foliage level reducer, for primitives a triangle simplifier must not touch
 * (PRD-458 §4, §5).
 *
 * A needle card is two triangles. A simplifier asked to cut its triangle count has two bad options
 * and no third: collapse a card (the alpha-tested silhouette is now the wrong shape) or drop a
 * triangle (a hole in the canopy). So the triangle reducer declines needle primitives, and the
 * earlier cook was therefore right to report `insufficient-reduction` for every tree. This reducer
 * works in the unit the geometry is actually authored in — the **card**, a connected component of
 * the index buffer — and spends it the way foliage is spent: by dropping whole cards, spread evenly
 * through the canopy, so the crown keeps its coverage while the triangle count falls.
 *
 * Two properties make the result worth shipping, and both are the reason this is not
 * `indices.filter((_, i) => i % 2 === 0)`:
 *
 * - **Stratified, not sampled.** Cards are bucketed into a deterministic 3D grid keyed by their
 *   centroid, and each occupied cell keeps at least one card at every level. Random thinning
 *   punches visible bald patches exactly where the cards were densest; index-order thinning keeps a
 *   contiguous block of the index buffer, which is one side of the tree. Grid buckets keep every
 *   region of the crown populated.
 * - **Deterministic.** Buckets are ordered by their integer cell key, cards within a bucket by a
 *   hash of their own centroid. The same input bytes always produce the same levels, which is what
 *   `determinism.spec.ts` and a cache keyed on a generation fingerprint both depend on.
 *
 * **No scaling, and why.** A kept card is normally scaled about its centroid by `sqrt(1 / keep)`, so
 * the surviving cards cover the area the dropped ones did. That needs *new vertex positions*, and
 * `TN_discrete_lod` is index-only by construction: a level's POSITION/NORMAL/UV come from the
 * primitive's own accessors and the runtime reader (`packages/core/src/model-lod.ts`) builds each
 * derived level by copying the base's attributes and swapping in only an index buffer. So the scale
 * step is not representable in the chain as it is specified today, and the levels shipped here are
 * the un-scaled subset. The consequence is stated rather than hidden: card *area* coverage falls to
 * the keep ratio, and what the grid buys is cell coverage — every occupied cell still holds a card.
 * Lifting it needs a per-level vertex buffer in the chain (a core schema change, PRD-458 §4), not a
 * different selection.
 */

/**
 * The largest component still treated as a card.
 *
 * A two-triangle quad is the common case and four-to-eight-triangle cards (a bent, a folded, a
 * low-poly cluster) are ordinary. Anything larger is a shell or a trunk fan, where dropping a
 * component would delete a silhouette, so the primitive is left to the triangle reducer.
 */
const MAX_CARD_TRIANGLES = 8;

/**
 * How much of LOD0's cards each derived level keeps.
 *
 * Halving per level, capped by the policy's `maxLevels`. Read as "keep half the cards, then a
 * quarter", which is a *geometric* ladder of the crown's density rather than a triangle-ratio
 * ladder, and it is what the runtime's error-driven selection then chooses between.
 */
export const CARD_KEEP_RATIOS: readonly number[] = [0.5, 0.25];

const TRIANGLE = 3;

/** One card: the triangles of one connected component, its centroid and its area. */
export interface ICard {
  /** Indices into the primitive's index buffer, one entry per triangle of this card. */
  readonly triangles: readonly number[];
  readonly area: number;
  readonly centroid: readonly [number, number, number];
}

/** What one derived level kept, and what it cost the crown. Reported, never inferred. */
export interface ICardLevelSummary {
  /** Kept card area as a fraction of LOD0's total card area — the un-scaled coverage, honestly low. */
  readonly areaCoverage: number;
  readonly cards: number;
  /** Fraction of LOD0's occupied grid cells that still hold at least one kept card. */
  readonly cellCoverage: number;
  /** The fraction of LOD0's cards this level kept. */
  readonly keep: number;
}

/** A card-thinned chain, shaped like the triangle chain so both take the same attachment path. */
export interface ICardChain {
  readonly absoluteErrors: readonly number[];
  readonly counts: readonly number[];
  readonly errors: readonly number[];
  readonly indices: readonly Uint32Array[];
  /** Per derived level, aligned with `counts`. */
  readonly levels: readonly ICardLevelSummary[];
  readonly lod0Cards: number;
  readonly lod0Triangles: number;
}

/**
 * Connected components of the index buffer, or `null` when the primitive is not a card set.
 *
 * Union-find over shared vertices, which is the only cheap definition of "card" that does not need a
 * per-export convention: an exporter that duplicates the four corners of every quad, one that
 * shares a stem vertex, and a folded card all decompose the same way. `null` means a component was
 * too large to be a card, and the caller keeps the primitive's existing behaviour.
 */
function findCards(positions: Float32Array, indices: Uint32Array): ICard[] | null {
  const vertexCount = Math.floor(positions.length / 3);
  const parent = new Int32Array(vertexCount);
  for (let vertex = 0; vertex < vertexCount; vertex += 1) parent[vertex] = vertex;
  const find = (start: number): number => {
    let root = start;
    while (parent[root] !== root) root = parent[root] as number;
    let walk = start;
    while (parent[walk] !== root) {
      const next = parent[walk] as number;
      parent[walk] = root;
      walk = next;
    }
    return root;
  };
  for (let triangle = 0; triangle + 2 < indices.length; triangle += TRIANGLE) {
    const a = find(indices[triangle] as number);
    const b = find(indices[triangle + 1] as number);
    const c = find(indices[triangle + 2] as number);
    if (a === c) continue;
    // Union by lower root: the order is fixed by the index buffer, so the tree is reproducible.
    const low = Math.min(a, b, c);
    for (const root of [a, b, c]) if (root !== low) parent[root] = low;
  }

  const grouped = new Map<number, number[]>();
  for (let triangle = 0; triangle + 2 < indices.length; triangle += TRIANGLE) {
    const root = find(indices[triangle] as number);
    const group = grouped.get(root);
    if (group === undefined) grouped.set(root, [triangle]);
    else group.push(triangle);
    if ((group?.length ?? 1) > MAX_CARD_TRIANGLES) return null;
  }

  const cards: ICard[] = [];
  for (const triangles of grouped.values()) {
    if (triangles.length === 0) continue;
    let area = 0;
    let sx = 0;
    let sy = 0;
    let sz = 0;
    let vertices = 0;
    // Cards are small and vertex sets are tiny, so the exact per-card vertex list is cheaper than a
    // set: a four-vertex card repeats at most three times.
    const seen = new Set<number>();
    for (const triangle of triangles) {
      for (let corner = 0; corner < TRIANGLE; corner += 1) {
        const vertex = indices[triangle + corner] as number;
        if (seen.has(vertex)) continue;
        seen.add(vertex);
        vertices += 1;
        sx += positions[vertex * 3] as number;
        sy += positions[vertex * 3 + 1] as number;
        sz += positions[vertex * 3 + 2] as number;
      }
      const a = (indices[triangle] as number) * 3;
      const b = (indices[triangle + 1] as number) * 3;
      const c = (indices[triangle + 2] as number) * 3;
      const ux = (positions[b] as number) - (positions[a] as number);
      const uy = (positions[b + 1] as number) - (positions[a + 1] as number);
      const uz = (positions[b + 2] as number) - (positions[a + 2] as number);
      const vx = (positions[c] as number) - (positions[a] as number);
      const vy = (positions[c + 1] as number) - (positions[a + 1] as number);
      const vz = (positions[c + 2] as number) - (positions[a + 2] as number);
      const nx = uy * vz - uz * vy;
      const ny = uz * vx - ux * vz;
      const nz = ux * vy - uy * vx;
      area += Math.sqrt(nx * nx + ny * ny + nz * nz) / 2;
    }
    cards.push({
      area,
      centroid: vertices === 0 ? [0, 0, 0] : [sx / vertices, sy / vertices, sz / vertices],
      triangles,
    });
  }
  // A primitive with no triangles, or with fewer cards than levels, has nothing to spend.
  return cards.length > 0 ? cards : null;
}

/**
 * A stable integer hash of a card's position, quantised to `quantum` so float noise cannot change
 * the key and re-order the bake. Avoids `Math.random`, whose sequence would make the artifact depend
 * on call order, and avoids the index order the grid exists to ignore.
 */
function positionKey(centroid: readonly [number, number, number], quantum: number): number {
  const q = (value: number): number => Math.round(value / quantum) | 0;
  let hash =
    (q(centroid[0]) * 73856093) ^ (q(centroid[1]) * 19349663) ^ (q(centroid[2]) * 83492791);
  hash = Math.imul(hash ^ (hash >>> 15), 0x2c1b3c6d);
  hash = Math.imul(hash ^ (hash >>> 12), 0x297a2d39);
  return (hash ^ (hash >>> 15)) | 0;
}

/** One card placed in the stratification grid, with the key its bucket and its rank are derived from. */
interface IPlacedCard {
  readonly card: ICard;
  readonly cell: number;
  readonly key: number;
  readonly first: number;
}

/**
 * Buckets cards into a deterministic grid whose cell is about one card wide, and returns the bucket
 * count. `diag / cbrt(cards)` is the cell that puts roughly one card in each cell of a filled
 * volume, and it stays sane for a flat canopy where a volume-based cell would collapse to zero.
 */
function placeCards(
  cards: readonly ICard[],
  cellSize: number,
): { placed: IPlacedCard[]; cells: number } {
  const placed: IPlacedCard[] = cards.map((card, index) => {
    const [x, y, z] = card.centroid;
    return {
      card,
      // One integer key per cell: the grid is a hash, not a sort order.
      cell:
        (Math.floor(x / cellSize) * 73856093) ^
        (Math.floor(y / cellSize) * 19349663) ^
        (Math.floor(z / cellSize) * 83492791),
      first: index,
      key: positionKey(card.centroid, cellSize / 32),
    };
  });
  return { cells: new Set(placed.map((entry) => entry.cell)).size, placed };
}

/**
 * One level of the card ladder: the cards kept at `keep`, concatenated in a deterministic order.
 *
 * At least one card survives in every occupied cell, so coverage is a property of the selection
 * rather than a hope about it. The returned `cellCoverage` is measured from the kept set anyway,
 * because a level that ships has to *report* the coverage it got.
 */
function thinLevel(
  placed: readonly IPlacedCard[],
  keep: number,
  lod0Area: number,
  lod0Cells: number,
): { cards: ICard[]; summary: ICardLevelSummary } {
  const buckets = new Map<number, IPlacedCard[]>();
  for (const entry of placed) {
    const bucket = buckets.get(entry.cell);
    if (bucket === undefined) buckets.set(entry.cell, [entry]);
    else bucket.push(entry);
  }
  const kept: ICard[] = [];
  let area = 0;
  let cells = 0;
  // Bucket order is by cell key, cards by their own position hash: reproducible, and spread through
  // each bucket rather than clipped from one side of it.
  for (const cell of [...buckets.keys()].sort((a, b) => a - b)) {
    const bucket = buckets.get(cell) as IPlacedCard[];
    const survivors = Math.max(1, Math.min(bucket.length, Math.round(keep * bucket.length)));
    bucket.sort(
      (a, b) =>
        a.key - b.key ||
        a.card.centroid[0] - b.card.centroid[0] ||
        a.card.centroid[1] - b.card.centroid[1] ||
        a.card.centroid[2] - b.card.centroid[2] ||
        a.first - b.first,
    );
    for (const entry of bucket.slice(0, survivors)) {
      kept.push(entry.card);
      area += entry.card.area;
    }
    cells += 1;
  }
  return {
    cards: kept,
    summary: {
      areaCoverage: lod0Area === 0 ? 1 : area / lod0Area,
      cards: kept.length,
      cellCoverage: lod0Cells === 0 ? 1 : cells / lod0Cells,
      keep,
    },
  };
}

/** The index buffer for a set of cards, in the order {@link thinLevel} produced them. */
function indicesOf(cards: readonly ICard[], source: Uint32Array): Uint32Array {
  let length = 0;
  for (const card of cards) length += card.triangles.length * TRIANGLE;
  const out = new Uint32Array(length);
  let at = 0;
  for (const card of cards)
    for (const triangle of card.triangles) {
      out[at] = source[triangle] as number;
      out[at + 1] = source[triangle + 1] as number;
      out[at + 2] = source[triangle + 2] as number;
      at += TRIANGLE;
    }
  return out;
}

/**
 * Builds the card chain for one primitive, or `null` when it is not a card set or cannot save
 * enough to be worth a level.
 *
 * Every level is derived from LOD0, never from the previous level, exactly like the triangle chain:
 * the reported error is then relative to the authored canopy and one level's budget cannot disturb
 * another's. `minSaving` is the same gate the triangle chain uses — a level that does not earn its
 * place is not shipped for its own sake — and `scale` is the same local-space unit the chain's
 * `absoluteError = error * errorScale` contract expects.
 *
 * The reported error is `cellSize * (1 - keep)`: the width of the cell a dropped card leaves behind,
 * which is the distance from a kept card to the nearest surface the level no longer draws. It rises
 * as the level coarsens, which is the monotonicity the runtime's selection requires.
 */
export function generateCardChain(
  positions: Float32Array,
  indices: Uint32Array,
  maxLevels: number,
  minSaving: number,
  scale: number,
  keepRatios: readonly number[] = CARD_KEEP_RATIOS,
): ICardChain | null {
  const cards = findCards(positions, indices);
  if (cards === null) return null;
  const lod0Triangles = Math.floor(indices.length / TRIANGLE);
  if (lod0Triangles <= 0) return null;

  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let minZ = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  let maxZ = Number.NEGATIVE_INFINITY;
  for (let vertex = 0; vertex + 2 < positions.length; vertex += 3) {
    const x = positions[vertex] as number;
    const y = positions[vertex + 1] as number;
    const z = positions[vertex + 2] as number;
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (z < minZ) minZ = z;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
    if (z > maxZ) maxZ = z;
  }
  const diagonal = Math.hypot(maxX - minX, maxY - minY, maxZ - minZ);
  const cellSize = Math.max(diagonal / Math.cbrt(cards.length), 1e-6);
  const { cells: lod0Cells, placed } = placeCards(cards, cellSize);
  const lod0Area = cards.reduce((total, card) => total + card.area, 0);

  const levels: ICardLevelSummary[] = [];
  const counts: number[] = [];
  const errors: number[] = [];
  const absoluteErrors: number[] = [];
  const buffers: Uint32Array[] = [];
  let previousTriangles = lod0Triangles;
  for (const keep of keepRatios.slice(0, Math.max(0, maxLevels - 1))) {
    if (levels.length >= Math.max(0, maxLevels - 1)) break;
    const level = thinLevel(placed, keep, lod0Area, lod0Cells);
    // Never empty: a level that drops the last card draws nothing at all.
    if (level.cards.length === 0 || level.cards.length === cards.length) continue;
    const buffer = indicesOf(level.cards, indices);
    const triangles = Math.floor(buffer.length / TRIANGLE);
    if (triangles >= previousTriangles) continue;
    if ((previousTriangles - triangles) / previousTriangles < minSaving) continue;
    const absoluteError = cellSize * (1 - keep);
    levels.push(level.summary);
    counts.push(triangles);
    absoluteErrors.push(absoluteError);
    errors.push(absoluteError / Math.max(scale, 1e-6));
    buffers.push(buffer);
    previousTriangles = triangles;
  }
  if (levels.length === 0) return null;
  return {
    absoluteErrors,
    counts,
    errors,
    indices: buffers,
    levels,
    lod0Cards: cards.length,
    lod0Triangles,
  };
}

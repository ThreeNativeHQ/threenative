/**
 * The town's map data, with no renderer in it.
 *
 * Split out of `town.ts` so the UI layer can import it. `src/ui/` is loaded by the platform's own
 * web view now, in a page of its own, and `town.ts` imports `three` at module scope — pulling the
 * renderer into the UI bundle to read a dozen rectangles. These are plain numbers, so they live
 * where both sides can reach them and `town.ts` builds its geometry from the same values.
 */

export const TOWN_HALF = 42;
/** Sea level east of this line; the dock pier crosses it. */
export const WATER_X = 42;

export type DeckFootprint = {
  readonly minX: number;
  readonly maxX: number;
  readonly minZ: number;
  readonly maxZ: number;
};

/** One rectangle of overhead-map data: the top-left corner, then the size, in
 * metres. North (-z) draws upward, east (+x) right, so a world point lands at
 * map (x, z) directly. */
export type SchematicRect = readonly [number, number, number, number];

/**
 * Plain JSON-safe map data for overhead views, so the HUD renders the town
 * without restating its numbers. Every field is derived from the same local
 * constants that place the corresponding geometry (see `townSchematic`), which
 * keeps geometry and its map one edit apart. Extents per docs/bayview-design.md:
 * an 84 m playable square centred on the origin, open sea east of x = +42.
 */
export interface ITownSchematic {
  /** Walkable lanes, courtyards and plazas; the gaps between them are buildings. */
  readonly areas: readonly SchematicRect[];
  /** Raised decks drawn dashed overhead: back plat y 2.4, heaven y 4.8, catwalk y 2.4. */
  readonly raised: readonly SchematicRect[];
  /** Callout anchors — the site letters and district names. */
  readonly labels: readonly {
    readonly text: string;
    readonly x: number;
    readonly z: number;
    /** `site` letters name a bomb site; `area` names a district. */
    readonly kind: "site" | "area";
  }[];
  /** Playable deck: a square of half-extent `half` centred on the origin. */
  readonly deck: { readonly half: number };
  /** Open water east of `edgeX`. */
  readonly sea: { readonly edgeX: number };
  /** Dock pier centre-line, quay wall to outer end. */
  readonly pier: {
    readonly ax: number;
    readonly az: number;
    readonly bx: number;
    readonly bz: number;
  };
}

export const A_SITE_PLAZA = { x: [-36, -20], z: [-8, 10], finish: "plazaWarm" } as const;
export const MID_COURTYARD_PLAZA = { x: [-8, 10], z: [-8, 8], finish: "plazaPale" } as const;

export const A_SITE_MARK = { at: [-28, 1], letter: "A", approach: "e" } as const;

export const BACK_PLAT_DECK: DeckFootprint = { minX: 0, maxX: 12, minZ: -22, maxZ: -10 };
export const HEAVEN_DECK: DeckFootprint = { minX: 20, maxX: 30, minZ: -30, maxZ: -20 };
export const CATWALK_DECK: DeckFootprint = { minX: 23.7, maxX: 26.3, minZ: -16.3, maxZ: -1.7 };

/** Dock pier span: plank deck from the quay wall (`x0`) out to `x1`, centred
 * on `z`; both the pier meshes and the minimap line read it. */
export const PIER = { x0: WATER_X - 1, x1: WATER_X + 17, z: -6 } as const;

/** Plaza slabs are placed from x/z ranges; the schematic wants corner + size. */
const plazaRect = ({
  x,
  z,
}: {
  x: readonly [number, number];
  z: readonly [number, number];
}): SchematicRect => [x[0], z[0], x[1] - x[0], z[1] - z[0]];

/** Deck footprints likewise. */
const deckRect = ({ minX, maxX, minZ, maxZ }: DeckFootprint): SchematicRect => [
  minX,
  minZ,
  maxX - minX,
  maxZ - minZ,
];

/**
 * The map picture, emitted beside the map itself. Lane rectangles have no
 * geometry of their own — they are the negative space between BUILDINGS — so
 * their numbers live only here, but beside the plazas, decks, pier and site
 * marks they were traced from, so a layout edit and its minimap update land in
 * one file.
 */
export const townSchematic: ITownSchematic = {
  areas: [
    [-2, -40, 18, 10], // CT spawn
    [-18, -36, 10, 12], // CT ramp
    plazaRect(MID_COURTYARD_PLAZA), // mid courtyard
    [10, 0, 6, 10], // connector
    [16, -20, 16, 24], // B site, including the quay-north pocket
    plazaRect(A_SITE_PLAZA), // A site
    [-20, 4, 8, 14], // short A
    [-12, 12, 10, 14], // T main
    [-9, 26, 18, 12], // T spawn
    [32, 4, 10, 26], // outside long
  ],
  raised: [deckRect(BACK_PLAT_DECK), deckRect(HEAVEN_DECK), deckRect(CATWALK_DECK)],
  labels: [
    { text: "A", x: A_SITE_MARK.at[0], z: A_SITE_MARK.at[1], kind: "site" },
    // B's anchor sits at the site's readable north end rather than on its
    // floor mark (27, 3), which faces the connector approach.
    { text: "B", x: 24, z: -8, kind: "site" },
    { text: "Mid", x: 1, z: 13, kind: "area" },
  ],
  deck: { half: TOWN_HALF },
  sea: { edgeX: WATER_X },
  pier: { ax: PIER.x0, az: PIER.z, bx: PIER.x1, bz: PIER.z },
};

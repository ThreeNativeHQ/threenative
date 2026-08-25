/**
 * The bitmap glyph set the native React overlay draws text with.
 *
 * This is the same mechanism the template geometry HUDs already use
 * (`templates/minimal/src/render/hud.ts`): a 5x7 pixel grid per character, one instanced quad per
 * lit pixel. It needs no font file, no texture, no `document`, and no rasteriser, which is why it
 * is the only text path that works identically in a browser and inside the native host.
 *
 * The set is deliberately a *default*, not a decision: a `text` element may carry its own `font`
 * prop, so a game that wants different letterforms never edits this package. What is fixed here is
 * the grid, because the layout pass measures against it.
 *
 * Unmapped characters are not silently dropped — {@link glyphPixels} returns `undefined` and the host
 * reports `TN_REACT_UNKNOWN_GLYPH` by name, per the PRD's negative control.
 */

/** Pixel columns in one glyph cell. */
export const GLYPH_WIDTH = 5;
/** Pixel rows in one glyph cell. */
export const GLYPH_HEIGHT = 7;
/** Columns from one glyph's left edge to the next, before `letterSpacing`. */
export const GLYPH_ADVANCE = 6;

/**
 * Rows are written as art so a reader can see the letter: `#` is a lit pixel, `.` is empty, and each
 * entry is exactly {@link GLYPH_HEIGHT} rows of {@link GLYPH_WIDTH} characters.
 *
 * Lowercase input is upper-cased before lookup. There is no lowercase form in a 5x7 cell that stays
 * legible at HUD sizes, and pretending otherwise would draw blanks.
 */
const GLYPHS: Readonly<Record<string, string>> = {
  " ": ".".repeat(GLYPH_WIDTH * GLYPH_HEIGHT),
  "0": ".###." + "#...#" + "#..##" + "#.#.#" + "##..#" + "#...#" + ".###.",
  "1": "..#.." + ".##.." + "..#.." + "..#.." + "..#.." + "..#.." + ".###.",
  "2": ".###." + "#...#" + "....#" + "...#." + "..#.." + ".#..." + "#####",
  "3": "#####" + "...#." + "..#.." + "...#." + "....#" + "#...#" + ".###.",
  "4": "...#." + "..##." + ".#.#." + "#..#." + "#####" + "...#." + "...#.",
  "5": "#####" + "#...." + "####." + "....#" + "....#" + "#...#" + ".###.",
  "6": "..##." + ".#..." + "#...." + "####." + "#...#" + "#...#" + ".###.",
  "7": "#####" + "....#" + "...#." + "..#.." + ".#..." + ".#..." + ".#...",
  "8": ".###." + "#...#" + "#...#" + ".###." + "#...#" + "#...#" + ".###.",
  "9": ".###." + "#...#" + "#...#" + ".####" + "....#" + "...#." + ".##..",
  A: "..#.." + ".#.#." + "#...#" + "#...#" + "#####" + "#...#" + "#...#",
  B: "####." + "#...#" + "#...#" + "####." + "#...#" + "#...#" + "####.",
  C: ".####" + "#...." + "#...." + "#...." + "#...." + "#...." + ".####",
  D: "###.." + "#..#." + "#...#" + "#...#" + "#...#" + "#..#." + "###..",
  E: "#####" + "#...." + "#...." + "####." + "#...." + "#...." + "#####",
  F: "#####" + "#...." + "#...." + "####." + "#...." + "#...." + "#....",
  G: ".###." + "#...#" + "#...." + "#..##" + "#...#" + "#...#" + ".###.",
  H: "#...#" + "#...#" + "#...#" + "#####" + "#...#" + "#...#" + "#...#",
  I: ".###." + "..#.." + "..#.." + "..#.." + "..#.." + "..#.." + ".###.",
  J: "..###" + "...#." + "...#." + "...#." + "...#." + "#..#." + ".##..",
  K: "#...#" + "#..#." + "#.#.." + "##..." + "#.#.." + "#..#." + "#...#",
  L: "#...." + "#...." + "#...." + "#...." + "#...." + "#...." + "#####",
  M: "#...#" + "##.##" + "#.#.#" + "#.#.#" + "#...#" + "#...#" + "#...#",
  N: "#...#" + "##..#" + "##..#" + "#.#.#" + "#..##" + "#..##" + "#...#",
  O: ".###." + "#...#" + "#...#" + "#...#" + "#...#" + "#...#" + ".###.",
  P: "####." + "#...#" + "#...#" + "####." + "#...." + "#...." + "#....",
  Q: ".###." + "#...#" + "#...#" + "#...#" + "#.#.#" + "#..#." + ".##.#",
  R: "####." + "#...#" + "#...#" + "####." + "#.#.." + "#..#." + "#...#",
  S: ".####" + "#...." + "#...." + ".###." + "....#" + "....#" + "####.",
  T: "#####" + "..#.." + "..#.." + "..#.." + "..#.." + "..#.." + "..#..",
  U: "#...#" + "#...#" + "#...#" + "#...#" + "#...#" + "#...#" + ".###.",
  V: "#...#" + "#...#" + "#...#" + "#...#" + "#...#" + ".#.#." + "..#..",
  W: "#...#" + "#...#" + "#...#" + "#.#.#" + "#.#.#" + "##.##" + "#...#",
  X: "#...#" + "#...#" + ".#.#." + "..#.." + ".#.#." + "#...#" + "#...#",
  Y: "#...#" + "#...#" + ".#.#." + "..#.." + "..#.." + "..#.." + "..#..",
  Z: "#####" + "....#" + "...#." + "..#.." + ".#..." + "#...." + "#####",
  ":": "....." + "..#.." + "..#.." + "....." + "..#.." + "..#.." + ".....",
  ".": "....." + "....." + "....." + "....." + "....." + "..#.." + "..#..",
  ",": "....." + "....." + "....." + "....." + "..#.." + "..#.." + ".#...",
  "-": "....." + "....." + "....." + "#####" + "....." + "....." + ".....",
  "+": "....." + "..#.." + "..#.." + "#####" + "..#.." + "..#.." + ".....",
  "=": "....." + "....." + "#####" + "....." + "#####" + "....." + ".....",
  "/": "....#" + "....#" + "...#." + "..#.." + ".#..." + "#...." + "#....",
  "|": "..#.." + "..#.." + "..#.." + "..#.." + "..#.." + "..#.." + "..#..",
  "!": "..#.." + "..#.." + "..#.." + "..#.." + "..#.." + "....." + "..#..",
  "?": ".###." + "#...#" + "....#" + "...#." + "..#.." + "....." + "..#..",
  "'": "..#.." + "..#.." + "....." + "....." + "....." + "....." + ".....",
  "(": "...#." + "..#.." + ".#..." + ".#..." + ".#..." + "..#.." + "...#.",
  ")": ".#..." + "..#.." + "...#." + "...#." + "...#." + "..#.." + ".#...",
  "[": ".###." + ".#..." + ".#..." + ".#..." + ".#..." + ".#..." + ".###.",
  "]": ".###." + "...#." + "...#." + "...#." + "...#." + "...#." + ".###.",
  "#": ".#.#." + ".#.#." + "#####" + ".#.#." + "#####" + ".#.#." + ".#.#.",
  $: "..#.." + ".####" + "#.#.." + ".###." + "..#.#" + "####." + "..#..",
  "%": "##..#" + "##.#." + "...#." + "..#.." + ".#..." + ".#.##" + "#..##",
  "*": "....." + "#.#.#" + ".###." + "#####" + ".###." + "#.#.#" + ".....",
  "·": "....." + "....." + "....." + "..#.." + "....." + "....." + ".....",
  "°": ".##.." + "#..#." + ".##.." + "....." + "....." + "....." + ".....",
  "<": "...#." + "..#.." + ".#..." + "#...." + ".#..." + "..#.." + "...#.",
  ">": ".#..." + "..#.." + "...#." + "....#" + "...#." + "..#.." + ".#...",
  _: "....." + "....." + "....." + "....." + "....." + "....." + "#####",
};

/** A glyph's lit pixels, as `[x, y]` offsets inside its 5x7 cell. `undefined` when unmapped. */
export function glyphPixels(character: string): readonly (readonly [number, number])[] | undefined {
  const art = GLYPHS[character] ?? GLYPHS[character.toUpperCase()];
  if (art === undefined) return undefined;
  const pixels: [number, number][] = [];
  for (let index = 0; index < GLYPH_WIDTH * GLYPH_HEIGHT; index += 1) {
    if (art[index] !== "#") continue;
    pixels.push([index % GLYPH_WIDTH, Math.floor(index / GLYPH_WIDTH)]);
  }
  return pixels;
}

/**
 * Every character this glyph set can draw, for error messages and for the templates' AGENTS.md.
 * @situation discover which characters a native React HUD can draw
 * @example supportedGlyphs().includes("A")
 */
export function supportedGlyphs(): string {
  return Object.keys(GLYPHS).join("");
}

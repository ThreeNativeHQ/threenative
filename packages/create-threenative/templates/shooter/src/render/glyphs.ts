/**
 * A 5x7 bitmap font, drawn as geometry rather than as text.
 *
 * The native host has no DOM and no canvas 2D context, so every readable character in this game
 * has to be geometry the renderer already knows how to draw. A bitmap font is the cheapest
 * honest answer: each lit pixel becomes one instance of a shared unit quad, so a whole HUD is a
 * single draw call and needs no texture, no font file, and no `CanvasTexture` (which samples
 * black under `WebGPURenderer` anyway).
 *
 * Rows read top to bottom, `1` is a lit pixel. Anything not in the table — a space, a character
 * this game never shows — emits nothing, which is exactly what a space should do.
 */
const FONT_SOURCE = `
0 01110 10001 10011 10101 11001 10001 01110
1 00100 01100 00100 00100 00100 00100 01110
2 01110 10001 00001 00010 00100 01000 11111
3 11111 00010 00100 00010 00001 10001 01110
4 00010 00110 01010 10010 11111 00010 00010
5 11111 10000 11110 00001 00001 10001 01110
6 00110 01000 10000 11110 10001 10001 01110
7 11111 00001 00010 00100 01000 01000 01000
8 01110 10001 10001 01110 10001 10001 01110
9 01110 10001 10001 01111 00001 00010 01100
A 01110 10001 10001 11111 10001 10001 10001
B 11110 10001 10001 11110 10001 10001 11110
C 01110 10001 10000 10000 10000 10001 01110
D 11100 10010 10001 10001 10001 10010 11100
E 11111 10000 10000 11110 10000 10000 11111
F 11111 10000 10000 11110 10000 10000 10000
G 01110 10001 10000 10111 10001 10001 01111
H 10001 10001 10001 11111 10001 10001 10001
I 01110 00100 00100 00100 00100 00100 01110
J 00111 00010 00010 00010 00010 10010 01100
K 10001 10010 10100 11000 10100 10010 10001
L 10000 10000 10000 10000 10000 10000 11111
M 10001 11011 10101 10101 10001 10001 10001
N 10001 11001 11001 10101 10011 10011 10001
O 01110 10001 10001 10001 10001 10001 01110
P 11110 10001 10001 11110 10000 10000 10000
Q 01110 10001 10001 10001 10101 10010 01101
R 11110 10001 10001 11110 10100 10010 10001
S 01111 10000 10000 01110 00001 00001 11110
T 11111 00100 00100 00100 00100 00100 00100
U 10001 10001 10001 10001 10001 10001 01110
V 10001 10001 10001 10001 10001 01010 00100
W 10001 10001 10001 10101 10101 11011 10001
X 10001 10001 01010 00100 01010 10001 10001
Y 10001 10001 01010 00100 00100 00100 00100
Z 11111 00001 00010 00100 01000 10000 11111
: 00000 00100 00100 00000 00100 00100 00000
. 00000 00000 00000 00000 00000 01100 01100
- 00000 00000 00000 01110 00000 00000 00000
+ 00000 00100 00100 11111 00100 00100 00000
/ 00001 00001 00010 00100 01000 10000 10000
| 00100 00100 00100 00100 00100 00100 00100
% 11001 11010 00010 00100 01000 01011 10011
`;

/** Lit-pixel offsets per character, flattened to `[column, row, …]` so drawing allocates nothing. */
const GLYPHS = new Map<string, readonly number[]>(
  FONT_SOURCE.trim()
    .split("\n")
    .map((line) => {
      const [character, ...rows] = line.split(" ");
      const pixels: number[] = [];
      rows.forEach((bits, row) => {
        for (let column = 0; column < bits.length; column += 1) {
          if (bits[column] === "1") pixels.push(column, row);
        }
      });
      return [character ?? "", pixels] as const;
    }),
);

/** Cell metrics, in glyph pixels: a 5x7 face with one pixel of tracking and two of leading. */
export const GLYPH_COLUMNS = 5;
export const GLYPH_ROWS = 7;
export const GLYPH_ADVANCE = 6;
export const GLYPH_LEADING = 10;

/** Width of a single line, in layout units, at the given pixel size. */
export function textWidth(text: string, pixel: number): number {
  return text.length === 0 ? 0 : (text.length * GLYPH_ADVANCE - 1) * pixel;
}

export function textHeight(pixel: number): number {
  return GLYPH_ROWS * pixel;
}

/**
 * Emit one square per lit pixel of `text`, top-left anchored at (`x`, `y`) in screen units
 * (y down). `plot` receives the top-left corner of each square and its side length.
 *
 * `\n` starts a new line at the same `x`.
 */
export function emitText(
  text: string,
  x: number,
  y: number,
  pixel: number,
  plot: (left: number, top: number, size: number) => void,
): void {
  let line = 0;
  let column = 0;
  for (const character of text) {
    if (character === "\n") {
      line += 1;
      column = 0;
      continue;
    }
    const pixels = GLYPHS.get(character);
    if (pixels !== undefined) {
      const originX = x + column * GLYPH_ADVANCE * pixel;
      const originY = y + line * GLYPH_LEADING * pixel;
      for (let index = 0; index < pixels.length; index += 2) {
        plot(originX + (pixels[index] ?? 0) * pixel, originY + (pixels[index + 1] ?? 0) * pixel, pixel);
      }
    }
    column += 1;
  }
}

// The needle atlas the Temperate starter's foliage cards sample. Pure Node, seeded, and committed
// with its output: `node scripts/make-needle-atlas.mjs` rewrites the PNG byte-for-byte, so the art
// is reproducible rather than a binary nobody can regenerate.
//
// Why generated and not downloaded: a spruce branch card is needles on a visible twig, and the
// silhouette is the whole point of the card — a photograph of foliage does not give you a card with
// the twig down the middle and needles fanning off both sides, which is what makes an alpha-cutout
// branch read as a branch from every angle. Poly Haven's bark set supplies the trunk; the leaves
// are this file's job.
//
// Four 512x512 cells in a 2x2 grid, all of them RGBA with a hard alpha edge:
//
//   0,0  spruce branch, dense  — the whorl cards that build the tree's mass
//   1,0  spruce branch, open  — fewer, longer needles; keeps a crown from reading as one texture
//   0,1  spruce tip          — short, bright new growth for the leader and the crown's outer cards
//   1,1  poppy petal         — one cupped petal, for the red discs in the meadow
//
// Everything here is appearance, so it lives in game source rather than in `packages/`.
import { mkdir, writeFile } from "node:fs/promises";
import { deflateSync } from "node:zlib";

const CELL = 512;
const ATLAS = CELL * 2;
const SEED = 466_468;
// Written beside the downloaded starter maps because that folder is the one this example's Vite
// serves: one root, one provenance file, and `ctx.assets.texture("needle-atlas.png")` reaches the
// same bytes in dev, in a build and through the desktop bundle.
const OUTPUT = new URL(
  "../../../packages/terrain/starter-assets/needle-atlas.png",
  import.meta.url,
);

/** mulberry32: one uint32 seed, identical output on every platform and Node version. */
function random(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Straight-line distance from `point` to segment `a`-`b`, in pixels. */
function distanceToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSquared = dx * dx + dy * dy;
  const t =
    lengthSquared === 0
      ? 0
      : Math.min(1, Math.max(0, ((px - ax) * dx + (py - ay) * dy) / lengthSquared));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/**
 * One cell's RGBA buffer plus the primitives drawn into it.
 *
 * A card is drawn as a list of tapered needles over a twig polyline and rasterised once, so the
 * cost is the sum of the needles' own bounding boxes rather than the whole cell per needle.
 */
function card() {
  return { data: new Uint8Array(CELL * CELL * 4), needles: [] };
}

/** Composite `colour` over the cell at `coverage`, keeping the highest alpha already written. */
function stamp(target, x, y, coverage, colour) {
  if (coverage <= 0) return;
  const index = (y * CELL + x) * 4;
  const alpha = Math.min(1, coverage);
  const existing = target.data[index + 3] / 255;
  const out = alpha + existing * (1 - alpha);
  if (out <= target.data[index + 3] / 255) return;
  for (let channel = 0; channel < 3; channel += 1) {
    const source = colour[channel] / 255;
    const behind = (target.data[index + channel] / 255) * (existing * (1 - alpha));
    target.data[index + channel] = Math.round((source * alpha + behind) * 255);
  }
  target.data[index + 3] = Math.round(out * 255);
}

/** Rasterise one tapered needle: a segment from `from` to `to`, `width` pixels thick at its base. */
function drawNeedle(target, from, to, width, colour) {
  const [ax, ay] = from;
  const [bx, by] = to;
  const minX = Math.max(0, Math.floor(Math.min(ax, bx) - width - 1));
  const maxX = Math.min(CELL - 1, Math.ceil(Math.max(ax, bx) + width + 1));
  const minY = Math.max(0, Math.floor(Math.min(ay, by) - width - 1));
  const maxY = Math.min(CELL - 1, Math.ceil(Math.max(ay, by) + width + 1));
  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      const distance = distanceToSegment(x + 0.5, y + 0.5, ax, ay, bx, by);
      // Half a pixel of coverage ramp: the card is alpha-cutout at draw time, and a hard geometric
      // edge aliases into a staircase that the mip chain then averages into a grey fringe.
      const coverage = width + 0.5 - distance;
      if (coverage <= 0) continue;
      stamp(target, x, y, Math.min(1, coverage), colour);
    }
  }
}

/** Draw the twig every needle hangs off, dark and thin, along a slight arc. */
function drawTwig(target, points, width, colour) {
  for (let i = 0; i + 1 < points.length; i += 1) {
    const [ax, ay] = points[i];
    const [bx, by] = points[i + 1];
    const steps = Math.ceil(Math.hypot(bx - ax, by - ay));
    for (let step = 0; step <= steps; step += 1) {
      const t = step / Math.max(1, steps);
      const x = ax + (bx - ax) * t;
      const y = ay + (by - ay) * t;
      const taper = width * (1 - t * 0.55);
      const minX = Math.max(0, Math.floor(x - taper - 1));
      const maxX = Math.min(CELL - 1, Math.ceil(x + taper + 1));
      const minY = Math.max(0, Math.floor(y - taper - 1));
      const maxY = Math.min(CELL - 1, Math.ceil(y + taper + 1));
      for (let py = minY; py <= maxY; py += 1) {
        for (let px = minX; px <= maxX; px += 1) {
          const distance = distanceToSegment(px + 0.5, py + 0.5, x, y, x, y);
          const coverage = taper + 0.5 - distance;
          if (coverage <= 0) continue;
          stamp(target, px, py, Math.min(1, coverage), colour);
        }
      }
    }
  }
}

const NEEDLE_DARK = [26, 48, 28];
const NEEDLE_MID = [46, 84, 40];
const NEEDLE_TIP = [104, 142, 62];
const TWIG = [58, 42, 30];
const PETAL_RED = [176, 26, 24];
const PETAL_DEEP = [104, 12, 16];

/** Blend the needle's own gradient: dark at the twig, lighter toward the tip. */
function needleColour(rnd) {
  const t = 0.55 + rnd() * 0.45;
  return NEEDLE_DARK.map((dark, i) =>
    Math.round(dark + (NEEDLE_TIP[i] - dark) * t + (NEEDLE_MID[i] - NEEDLE_DARK[i]) * 0.25),
  );
}

/** The twig point at parameter `t` along the branch, in pixels. Droop is a smoothstep. */
function twigAt(t, root, tip) {
  const ease = t * t * (3 - 2 * t);
  return [root[0] + (tip[0] - root[0]) * t, root[1] + (tip[1] - root[1]) * ease];
}

/**
 * A spruce branch card: a drooping twig almost buried under a fringe of needles.
 *
 * `count` and `length` separate the dense whorl card from the open one. The droop is the whole
 * silhouette — a branch that hangs is a spruce, a branch that sticks out is a fir — and the needles
 * are dense enough to hide the twig they grow from, because a card that shows its armature reads
 * as a dead shrub no matter how green the needles are.
 */
function spruceBranch(seed, { count, length, droop, needleWidth, tipOnly = false }) {
  const target = card();
  const rnd = random(seed);
  const root = [CELL * 0.1, tipOnly ? CELL * 0.2 : CELL * 0.12];
  const tip = [CELL * 0.94, root[1] + droop * CELL];
  const segments = 8;
  const twig = [];
  for (let i = 0; i <= segments; i += 1) twig.push(twigAt(i / segments, root, tip));
  for (let i = 0; i + 1 < twig.length; i += 1) {
    drawTwig(target, [twig[i], twig[i + 1]], tipOnly ? 3 : 4, TWIG);
  }
  for (let i = 0; i < count; i += 1) {
    // Needles march from the twig's root to its tip and are longest at mid-branch, which is how a
    // spruce whorl fills out: a bare length of twig, then a fringe, then a bare tip again.
    const t = Math.pow((i + rnd()) / count, 0.78);
    const index = Math.min(segments, Math.floor(t * segments));
    const [x, y] = twig[index] ?? twig[twig.length - 1];
    const side = rnd() < 0.5 ? 1 : -1;
    // Sprays leave the twig between roughly 40 and 140 degrees off its axis and curve toward the
    // tip; a needle that points straight out from the twig is a bottle brush, not a spruce.
    const angle = side * (0.7 + rnd() * 1.5) + 0.55;
    const reach = length * CELL * (0.7 + rnd() * 0.55);
    const from = [x, y];
    const to = [
      x + Math.cos(angle) * reach,
      y + Math.sin(angle) * reach * 0.7 + Math.abs(t - 0.5) * reach * 0.5,
    ];
    drawNeedle(target, from, to, needleWidth * (0.7 + rnd() * 0.6), needleColour(rnd));
  }
  return target;
}

/** One poppy petal: a rounded lobe with a scalloped edge, cupped darker at its base. */
function poppyPetal(seed) {
  const target = card();
  const rnd = random(seed);
  const baseX = CELL * 0.5;
  const baseY = CELL * 0.97;
  const reach = CELL * 0.86;
  // Half-width as a function of height up the petal: pinched at the base, widest at two thirds,
  // rounded over at the tip. The outline is sampled per scanline rather than per angle, which keeps
  // the lobe smooth at the crown where an angular sweep would show its facets.
  const halfWidth = (t) =>
    reach * 0.46 * Math.sin(Math.PI * Math.pow(t, 0.78)) * (1 + 0.05 * Math.sin(t * 11 + seed));
  for (let y = 0; y < CELL; y += 1) {
    const t = 1 - y / (CELL - 1);
    if (t <= 0) continue;
    const width = halfWidth(t);
    if (width <= 0.5) continue;
    const cup = Math.max(0, 0.62 - t * 1.15);
    for (let x = Math.floor(baseX - width); x <= Math.ceil(baseX + width); x += 1) {
      const inside = Math.abs(x + 0.5 - baseX) <= width;
      // Scallops: the edge is chewed inward a little, irregularly, the way a petal is.
      const scallop = inside && Math.abs(Math.abs(x + 0.5 - baseX) - width) < 2 + rnd() * 3;
      if (!inside || scallop) continue;
      const colour = PETAL_RED.map((red, c) =>
        Math.round(red + (PETAL_DEEP[c] - red) * cup),
      );
      stamp(target, x, y, 1, colour);
    }
  }
  return target;
}

/** Minimal PNG encoder: one IDAT, filter 0 on every scanline, 8-bit RGBA. */
function encodePng(width, height, rgba) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (width * 4 + 1)] = 0;
    Buffer.from(rgba.buffer, rgba.byteOffset + y * width * 4, width * 4).copy(
      raw,
      y * (width * 4 + 1) + 1,
    );
  }
  const chunk = (type, body) => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(body.length);
    const typed = Buffer.concat([Buffer.from(type, "latin1"), body]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(typed) >>> 0);
    return Buffer.concat([length, typed, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const CRC_TABLE = Uint32Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/** Lay the four cells out in the 2x2 grid the material's UVs address. */
const cells = [
  [0, 0, spruceBranch(SEED, { count: 900, length: 0.15, droop: 0.42, needleWidth: 2.6 })],
  [1, 0, spruceBranch(SEED + 1, { count: 620, length: 0.2, droop: 0.52, needleWidth: 2.2 })],
  [0, 1, spruceBranch(SEED + 2, { count: 420, length: 0.11, droop: 0.16, needleWidth: 2.8, tipOnly: true })],
  [1, 1, poppyPetal(SEED + 3)],
];
const atlas = new Uint8Array(ATLAS * ATLAS * 4);
for (const [column, row, target] of cells) {
  for (let y = 0; y < CELL; y += 1) {
    const from = y * CELL * 4;
    atlas.set(target.data.subarray(from, from + CELL * 4), ((row * CELL + y) * ATLAS + column * CELL) * 4);
  }
}

await mkdir(new URL("../../../packages/terrain/starter-assets/", import.meta.url), {
  recursive: true,
});
await writeFile(OUTPUT, encodePng(ATLAS, ATLAS, atlas));
console.log(
  `Wrote a ${ATLAS}x${ATLAS} RGBA needle atlas (4 cells) to packages/terrain/starter-assets/needle-atlas.png`,
);
// Generated for you. Keep these roles coherent when you change the look.
// A dark mossy diorama under a warm sun: every tower and every enemy owns one saturated colour, so
// what a thing does reads before it is inspected, and the reactor is the only cold glow on the board.
// Six roles, one of them the accent; the colours inside a role are the game's to add to.
export const palette = {
  /** The board and everything growing on it: the void the diorama floats in, the slab's three layers, the road, the pads, the forest. */
  world: {
    void: 0x183229,
    table: 0x1f382e,
    slabBase: 0x1b302c,
    slabMid: 0x3c5644,
    slabTop: 0x5f8c4d,
    road: 0xc3b48c,
    roadInlay: 0xf1e6c0,
    roadEdge: 0x3a4630,
    pad: 0x86a583,
    padMark: 0xe7c57c,
    pine: 0x3f6a49,
    pineDark: 0x2e5239,
    trunk: 0x5c4a37,
    rock: 0x66786a,
    shrub: 0x6f9459,
    horizon: 0x183229,
  },
  /** What towers, walkers and the reactor are built from: a pale body, dark and metal fittings, and the reactor's cold glow. */
  model: {
    body: 0xd5d7c4,
    dark: 0x293e3c,
    metal: 0x52645e,
    black: 0x1d2c2a,
    reactor: 0x87e4d0,
    reactorGlow: 0xb4ffe7,
  },
  /** One saturated colour per tower: what it does reads before it is inspected. */
  towers: {
    arc: 0xb1a0ef,
    cryo: 0x7acddb,
    mortar: 0xf18c6d,
    sentry: 0xe9c46a,
  },
  /** One per enemy, worn as its shell and its eye-glow. */
  enemies: {
    bulwark: 0xb388b8,
    runner: 0xe9b85e,
    skitter: 0xdc7964,
    titan: 0xe76d68,
  },
  /** Health bars, the strike's light and the pad highlight. */
  effects: {
    barFull: 0xa8e06e,
    barChilled: 0x7acddb,
    barEmpty: 0x0f1a16,
    strike: 0xffd9a0,
    padHover: 0xe1ecae,
  },
  /** Touch-control highlight, the launch button's glow, the pad under the pointer. */
  accent: 0xe1ecae,
} as const;

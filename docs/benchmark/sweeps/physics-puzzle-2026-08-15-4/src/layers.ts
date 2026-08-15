// Collision layers. Rapier needs the pairing to be mutual, so a mask that drops
// a layer here must be matched by the other side dropping this one.
export const LAYER = {
  world: 1,
  solid: 2,
  player: 4,
  ghost: 8,
} as const;

export const MASK = {
  // The room stops everything, including the phase crate.
  world: LAYER.solid | LAYER.player | LAYER.ghost,
  // Solid crates stack on each other, take the player's shove, ignore the ghost.
  solid: LAYER.world | LAYER.solid | LAYER.player,
  // The player is blocked by the room and by solid crates only.
  player: LAYER.world | LAYER.solid,
  // The phase crate falls to the floor and passes through everything else.
  ghost: LAYER.world,
} as const;

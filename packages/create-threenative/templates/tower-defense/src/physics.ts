/**
 * Collision layers, and only collision layers. Which bit means what is a game decision — the
 * framework never names your layers. Towers do not collide with anything: they only *ask* who is in
 * range, and this is the one layer that question looks at.
 */
export const ENEMY_LAYER = 1;

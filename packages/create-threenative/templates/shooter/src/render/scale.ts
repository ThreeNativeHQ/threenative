// Generated for you. The one place this game writes a real-world size.
//
// One metre is one metre. Every silhouette, every collider and every weapon reads its size from
// here, so a thing that comes out wrong is fixed once rather than nudged at each site. A model
// that arrives in centimetres is normalised on load with `normaliseToMetres` — never accommodated
// by tuning a literal beside it.
export const scale = {
  /** Adult figure, boots to head-top. Sets the target silhouettes and the player capsule. */
  humanHeight: 1.78,
  /** Eye above the floor, standing. The camera sits here, not at an invented "camera height". */
  eyeHeight: 1.66,
  /** Shoulder width. Sets the capsule radius and therefore what fits through a gap. */
  shoulderWidth: 0.5,
  /** How far the eye drops crouched. A crouch that only slows you reads as a bug. */
  crouchDrop: 0.56,
  /** Carbine, muzzle to stock. The viewmodel is normalised to this. */
  rifleLength: 0.78,
  /** Visible muzzle flame. Anything larger reads as a bug rather than a flash. */
  muzzleFlash: 0.3,
  /** Bullet hole edge length. */
  bulletHole: 0.14,
} as const;

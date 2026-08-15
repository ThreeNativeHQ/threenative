import { Vector2 } from "three";

/**
 * The deterministic replay check.
 *
 * `KeyV` rebuilds the room from world seed 6132 into a pristine simulation, feeds
 * it the fixed action table below over a fixed number of fixed-length steps,
 * digests every body's final transform, and then does the whole thing again. Two
 * equal digests mean the simulation is reproducible; `state.replayMatch` is that
 * comparison and nothing else.
 *
 * Nothing here is a shortcut around the simulation: both runs drive the same
 * `Player.update` the keyboard drives, and both are stepped by the same
 * fixed-step loop. The only difference is where the action vector comes from.
 */

/**
 * Ticks per run. Short on purpose.
 *
 * Under a playtest the fixed-step loop only advances when the harness asks it
 * to, so every tick this check spends is a tick the harness has to grant before
 * it can read `state.replayMatch`. Ninety-six covers the whole drop and the
 * whole scripted walk, and the drop is where a simulation that carried state
 * from the previous run diverges first — so a shorter window is a sharper test
 * here, not a weaker one.
 */
export const REPLAY_TICKS = 96;

const SETTLE_UNTIL = 18;
const RIGHT_UNTIL = 70;
const UP_UNTIL = 88;

const action = new Vector2();

/** The scripted action vector for a tick, in the same +y-is-up form as input. */
export function replayAction(tick: number): Vector2 {
  if (tick < SETTLE_UNTIL) return action.set(0, 0);
  if (tick < RIGHT_UNTIL) return action.set(1, 0);
  if (tick < UP_UNTIL) return action.set(0, 1);
  return action.set(0, 0);
}

/** Human-readable label for whatever the scripted table is doing right now. */
export function replayActionLabel(tick: number): string {
  if (tick < SETTLE_UNTIL) return "settle";
  if (tick < RIGHT_UNTIL) return "ArrowRight";
  if (tick < UP_UNTIL) return "ArrowUp";
  return "rest";
}

export interface IHashable {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface IHashableRotation {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly w: number;
}

/**
 * FNV-1a over quantised transforms, in a fixed body order.
 *
 * Quantising to a tenth of a millimetre keeps the digest from turning a
 * last-bit difference in a value nobody can see into a failed replay, while
 * still catching the real divergence this check exists for: a solver that
 * carries state from the previous run settles a stack in a visibly different
 * pose, not a different last bit.
 */
export function digestTransforms(
  bodies: readonly { readonly position: IHashable; readonly quaternion: IHashableRotation }[],
): string {
  let hash = 0x811c9dc5;
  const push = (value: number): void => {
    const quantised = Math.round(value * 1e4) | 0;
    for (let shift = 0; shift < 32; shift += 8) {
      hash ^= (quantised >>> shift) & 0xff;
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }
  };
  for (const { position, quaternion } of bodies) {
    push(position.x);
    push(position.y);
    push(position.z);
    push(quaternion.x);
    push(quaternion.y);
    push(quaternion.z);
    push(quaternion.w);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

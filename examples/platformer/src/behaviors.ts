/**
 * Enemy movement, such as it is. A ping-pong walk over a straight segment is
 * everything the reference image asks for — no navmesh, no pathfinder.
 */
export function patrolOffset(elapsed: number, distance: number, speed: number): number {
  if (distance <= 0 || speed <= 0) return 0;
  const period = (2 * distance) / speed;
  const phase = elapsed % period;
  return phase < period / 2 ? phase * speed : distance * 2 - phase * speed;
}

/** +1 while walking out, -1 while walking back; used to face the walk. */
export function patrolDirection(elapsed: number, distance: number, speed: number): number {
  if (distance <= 0 || speed <= 0) return 1;
  const period = (2 * distance) / speed;
  return elapsed % period < period / 2 ? 1 : -1;
}

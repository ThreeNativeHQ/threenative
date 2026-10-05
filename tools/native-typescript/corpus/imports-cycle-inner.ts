import { pong } from "./imports-cycle-outer";

export function ping(n: number): number {
  if (n <= 0) return 0;
  return 1 + pong(n - 1);
}

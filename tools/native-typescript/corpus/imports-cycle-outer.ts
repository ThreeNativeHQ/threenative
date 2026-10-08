import { ping } from "./imports-cycle-inner";

export function pong(n: number): number {
  if (n <= 0) return 0;
  return 2 + ping(n - 1);
}

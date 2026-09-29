/**
 * The shared ABI's transform layout, in one place.
 *
 * The joint stride is a contract, not an implementation detail of either backend: ten floats per
 * joint, `[tx, ty, tz, qx, qy, qz, qw, sx, sy, sz]`, whatever built them. Keeping the number
 * here is what lets `metahuman.ts` read joint output without importing an evaluator — and
 * therefore without dragging a WASM binary into a native bundle that must not carry one.
 */
export const JOINT_STRIDE = 10;

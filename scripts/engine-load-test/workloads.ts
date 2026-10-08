// PRD-533 phase 1: the four qualification workloads (Solution §1) and the one rule every arm of a
// workload answers to: it must present the same work. The benchmark never assumes that; each arm
// reports what it presented and `assertEqualPresentedWork` refuses a run where a figure is missing
// or differs.
import { BenchError } from "./report.js";

export const WORKLOADS = ["heterogeneous", "skinned-crowd", "holdout", "machinefall"] as const;
export type Workload = (typeof WORKLOADS)[number];

/** Workloads that cannot run, each with who unblocks it (PRD-533 `## Blocked on`). */
export const BLOCKED_WORKLOADS: Readonly<Partial<Record<Workload, string>>> = {
  machinefall:
    "Machinefall's source is not in this repository (PRD-498 owner blocker); João supplies it",
};

/** Workloads the plan names but nobody has defined yet: no scene, no arms. */
export const UNDEFINED_WORKLOADS: Readonly<Partial<Record<Workload, string>>> = {
  holdout:
    "no GPU-heavy visual holdout scene is defined yet; it needs a scene both arms can load plus a per-frame meter on the native render driver",
};

export function parseWorkloads(value: string): Workload[] {
  const names = value.split(",").map((name) => name.trim());
  if (names.length === 0 || names.some((name) => name === ""))
    throw new BenchError("TN_BENCH_BAD_WORKLOAD", `workloads must be a non-empty list: '${value}'`);
  // `all` is every workload the plan names. Blocked and undefined ones fail by name rather than
  // being dropped, so "all" can never pass on fewer workloads than the plan lists.
  const requested = names.includes("all") ? [...WORKLOADS] : names;
  if (names.includes("all") && names.length > 1)
    throw new BenchError("TN_BENCH_BAD_WORKLOAD", `'all' stands alone, got '${value}'`);
  for (const name of requested) {
    if (!(WORKLOADS as readonly string[]).includes(name))
      throw new BenchError(
        "TN_BENCH_BAD_WORKLOAD",
        `workload ${name} is not one of ${WORKLOADS.join(", ")}`,
      );
    const blocked = BLOCKED_WORKLOADS[name as Workload];
    if (blocked !== undefined)
      throw new BenchError("TN_BENCH_WORKLOAD_BLOCKED", `${name}: ${blocked}`);
    const undefinedWorkload = UNDEFINED_WORKLOADS[name as Workload];
    if (undefinedWorkload !== undefined)
      throw new BenchError("TN_BENCH_WORKLOAD_UNDEFINED", `${name}: ${undefinedWorkload}`);
  }
  if (new Set(requested).size !== requested.length)
    throw new BenchError("TN_BENCH_BAD_WORKLOAD", `workloads must be distinct: '${value}'`);
  return requested as Workload[];
}

/** What one arm presented in its measured frames. Draw calls are not here: batching may differ. */
export interface IPresentedWork {
  objects: number | undefined;
  triangles: number | undefined;
}

export function assertEqualPresentedWork(
  workload: Workload,
  arms: readonly { arm: string; presented: IPresentedWork }[],
): void {
  if (arms.length === 0)
    throw new BenchError("TN_BENCH_PRESENTED_EMPTY", `${workload}: no arm reported anything`);
  for (const { arm, presented } of arms)
    for (const field of ["objects", "triangles"] as const)
      if (presented[field] === undefined || !Number.isFinite(presented[field]))
        throw new BenchError(
          "TN_BENCH_PRESENTED_UNREPORTED",
          `${workload}: ${arm} did not report presented ${field}`,
        );
  const [first, ...rest] = arms;
  for (const { arm, presented } of rest)
    for (const field of ["objects", "triangles"] as const)
      if (presented[field] !== first?.presented[field])
        throw new BenchError(
          "TN_BENCH_WORKLOAD_MISMATCH",
          `${workload}: ${arm} presents ${presented[field]} ${field}, ${first?.arm} ${first?.presented[field]}`,
        );
}

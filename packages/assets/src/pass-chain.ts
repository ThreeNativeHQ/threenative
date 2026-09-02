import type { IAssetAuxiliaryOutput, IAssetPass, IAssetPassOutput } from "./compile.js";

/**
 * The pass chain the driver — or a worker — runs for one input. Extracted from the compile
 * driver so the worker entry can run the identical code a sequential bake runs: a concurrent
 * apply that drifted from the sequential one would be two implementations of the pipeline.
 */

/** What the driver measured for one pass on one input. */
export interface IPassTiming {
  readonly durationMs: number;
  readonly name: string;
}

export interface IAppliedPasses {
  readonly auxiliaryOutputs: readonly IAssetAuxiliaryOutput[];
  readonly buffer: Buffer;
  readonly entry: Record<string, unknown> | undefined;
  readonly extension: string | undefined;
  /** One duration per pass, opened and closed by the driver around each `apply`. */
  readonly timings: readonly IPassTiming[];
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * The driver — never the pass — owns the clock: each `apply` is bracketed here, so a pass cannot
 * opt out of measurement and cannot report a number of its own choosing. A pass that ends without
 * a closed record is a driver bug and throws rather than emitting a report with a hole in it.
 */
export async function applyPasses(
  passes: readonly IAssetPass[],
  input: Buffer,
  logical: string,
): Promise<IAppliedPasses> {
  let buffer = input;
  const auxiliaryOutputs: IAssetAuxiliaryOutput[] = [];
  const timings: IPassTiming[] = [];
  let entry: Record<string, unknown> | undefined;
  let extension: string | undefined;
  for (const pass of passes) {
    const started = performance.now();
    let result: Buffer | IAssetPassOutput;
    try {
      result = await pass.apply(buffer, logical);
    } catch (error) {
      throw new Error(
        `TN_ASSETS_PASS_FAILED: pass '${pass.name}' failed for '${logical}': ${messageOf(error)}`,
      );
    }
    timings.push({ durationMs: performance.now() - started, name: pass.name });
    if (Buffer.isBuffer(result)) {
      buffer = result;
      continue;
    }
    buffer = result.buffer;
    if (result.auxiliaryOutputs !== undefined) auxiliaryOutputs.push(...result.auxiliaryOutputs);
    if (result.entry !== undefined) entry = { ...(entry ?? {}), ...result.entry };
    if (result.outputExtension !== undefined) extension = result.outputExtension;
  }
  if (timings.length !== passes.length) {
    throw new Error(
      `TN_ASSETS_PASS_COST_UNCLOSED: ${logical}: ${passes.length - timings.length} of ${passes.length} pass record(s) left open; refusing to report a partial cost.`,
    );
  }
  return { auxiliaryOutputs, buffer, entry, extension, timings };
}

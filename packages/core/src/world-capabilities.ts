export type WorldGenerationPath = "gpu" | "cpu-fallback" | "unsupported";

export interface IWorldComputeLimits {
  readonly maxComputeInvocationsPerWorkgroup: number;
  readonly maxComputeWorkgroupsPerDimension: number;
  readonly maxStorageBufferBindingSize: number;
}

export interface IWorldCapabilities {
  readonly compute: boolean;
  /** Whether the host exposed a GPU adapter, even when its limits cannot run the world pass. */
  readonly gpu: boolean;
  readonly generation: WorldGenerationPath;
  readonly limits: IWorldComputeLimits;
  readonly cpuFallbackIterations: number;
  readonly reason?: string;
}

export interface IWorldCapabilitiesOptions {
  /** Explicitly supplied by a host that already probed its adapter. */
  readonly gpuAvailable?: boolean;
  readonly limits?: Partial<IWorldComputeLimits>;
  readonly minimumWorkgroupsPerDimension?: number;
  readonly minimumStorageBufferBindingSize?: number;
  /** A positive value makes CPU generation an explicit, reduced fallback. */
  readonly cpuFallbackIterations?: number;
}

const DEFAULT_LIMITS: IWorldComputeLimits = {
  maxComputeInvocationsPerWorkgroup: 0,
  maxComputeWorkgroupsPerDimension: 0,
  maxStorageBufferBindingSize: 0,
};

function finite(value: number, name: string, minimum = 0): number {
  if (!Number.isFinite(value) || value < minimum)
    throw new Error(`World capabilities ${name} must be finite and at least ${String(minimum)}.`);
  return value;
}

function integer(value: number, name: string, minimum = 0): number {
  if (!Number.isInteger(value) || value < minimum)
    throw new Error(
      `World capabilities ${name} must be an integer of at least ${String(minimum)}.`,
    );
  return value;
}

function resolveLimits(limits: Partial<IWorldComputeLimits> | undefined): IWorldComputeLimits {
  return {
    maxComputeInvocationsPerWorkgroup: finite(
      limits?.maxComputeInvocationsPerWorkgroup ?? DEFAULT_LIMITS.maxComputeInvocationsPerWorkgroup,
      "maxComputeInvocationsPerWorkgroup",
    ),
    maxComputeWorkgroupsPerDimension: finite(
      limits?.maxComputeWorkgroupsPerDimension ?? DEFAULT_LIMITS.maxComputeWorkgroupsPerDimension,
      "maxComputeWorkgroupsPerDimension",
    ),
    maxStorageBufferBindingSize: finite(
      limits?.maxStorageBufferBindingSize ?? DEFAULT_LIMITS.maxStorageBufferBindingSize,
      "maxStorageBufferBindingSize",
    ),
  };
}

/**
 * Resolve the active world-generation path from host capability facts.
 *
 * The function accepts the adapter facts instead of reaching through a renderer-specific global,
 * so browser and native hosts can report the same object. Missing limits are not treated as
 * infinite: a host must either provide a valid GPU limit report or explicitly choose CPU fallback.
 * GPU generation remains unavailable until a GPU readback can own the canonical field; a host
 * adapter report therefore never upgrades a CPU fallback into a GPU generation claim.
 *
 * @situation decide whether generated terrain can use GPU compute
 * @situation report why terrain generation is using a reduced CPU fallback
 * @constraint unsupported is returned when compute limits are unknown or below the requirement; callers must not silently continue
 * @override minimumWorkgroupsPerDimension, minimumStorageBufferBindingSize, and cpuFallbackIterations
 * @example const capabilities = getWorldCapabilities({ limits: adapter.limits, cpuFallbackIterations: 8 });
 */
export function getWorldCapabilities(options: IWorldCapabilitiesOptions = {}): IWorldCapabilities {
  const minimumWorkgroups = integer(
    options.minimumWorkgroupsPerDimension ?? 1,
    "minimumWorkgroupsPerDimension",
    1,
  );
  const minimumStorage = finite(
    options.minimumStorageBufferBindingSize ?? 1,
    "minimumStorageBufferBindingSize",
    1,
  );
  const fallbackIterations = integer(options.cpuFallbackIterations ?? 0, "cpuFallbackIterations");
  const limits = resolveLimits(options.limits);
  const hasReportedLimits =
    options.limits?.maxComputeInvocationsPerWorkgroup !== undefined &&
    options.limits?.maxComputeWorkgroupsPerDimension !== undefined &&
    options.limits?.maxStorageBufferBindingSize !== undefined;
  // Limits describe what an adapter can do, not whether this host actually exposed one. An
  // omitted adapter probe is deliberately conservative so a browser global or a test stub can
  // never turn CPU generation into a reported GPU path.
  const gpuAvailable = options.gpuAvailable ?? false;
  const meetsRequirements =
    hasReportedLimits &&
    limits.maxComputeInvocationsPerWorkgroup > 0 &&
    limits.maxComputeWorkgroupsPerDimension >= minimumWorkgroups &&
    limits.maxStorageBufferBindingSize >= minimumStorage;
  const reason = !gpuAvailable
    ? "GPU compute is unavailable on this host."
    : !hasReportedLimits
      ? "GPU compute limits were not reported by the host."
      : !meetsRequirements
        ? `GPU limits are below the required workgroup (${String(minimumWorkgroups)}) or storage-buffer (${String(minimumStorage)}) floor.`
        : "GPU compute is available, but canonical GPU world-field readback is unsupported.";
  if (fallbackIterations > 0)
    return {
      compute: false,
      cpuFallbackIterations: fallbackIterations,
      generation: "cpu-fallback",
      gpu: gpuAvailable,
      limits,
      reason: `${reason} Using ${String(fallbackIterations)} reduced CPU erosion iterations.`,
    };
  return {
    compute: false,
    cpuFallbackIterations: 0,
    generation: "unsupported",
    gpu: gpuAvailable,
    limits,
    reason,
  };
}

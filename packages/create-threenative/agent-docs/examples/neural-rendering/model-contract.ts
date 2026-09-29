/** Data-only preflight for the opt-in experiment. This module never fetches or allocates. */
export interface INeuralModelStage {
  readonly path: string;
  readonly bytes: number;
  readonly sha256: string;
}

export interface INeuralModelManifest {
  readonly version: 1;
  readonly provider: string;
  readonly revision: string;
  readonly graph: string;
  readonly stages: readonly INeuralModelStage[];
}

/** Supplied by reviewed provider code, never read from an untrusted manifest. */
export interface INeuralModelLayout {
  readonly provider: string;
  readonly revision: string;
  readonly graph: string;
  readonly stageBytes: Readonly<Record<string, number>>;
}

export interface INeuralMemoryEstimate {
  readonly liveBytes: number;
  readonly peakBytes: number;
  readonly largestBufferBytes: number;
  readonly largestStorageBindingBytes: number;
}

/** Snapshot the renderer DEVICE, not its adapter's potentially higher limits. */
export interface INeuralDeviceCapabilities {
  readonly kind: string;
  readonly features: ReadonlySet<string>;
  readonly limits: Readonly<Record<string, number>>;
}

export interface INeuralInputRequirements {
  readonly features: readonly string[];
  /** Maximum-type WebGPU limits only; minimum-offset alignment is not a >= comparison. */
  readonly limits: Readonly<Record<string, number>>;
  readonly alignment: number;
  readonly minimumDimension: number;
  /** Include weights, repacking, activations, staging, and both history/output sets. */
  readonly estimateMemory: (width: number, height: number) => INeuralMemoryEstimate;
}

export interface INeuralInputRequest {
  readonly width: number;
  readonly height: number;
  /** Explicit incremental allocation cap, not an estimate of available VRAM. */
  readonly maxBytes: number;
}

export interface INeuralInputPlan extends INeuralMemoryEstimate {
  readonly width: number;
  readonly height: number;
  readonly paddedWidth: number;
  readonly paddedHeight: number;
}

function fail(code: string, detail: string): never {
  throw new Error(`NEURAL_${code}: ${detail}`);
}

function integer(value: unknown, name: string, minimum = 0, maximum = Number.MAX_SAFE_INTEGER): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < minimum || value > maximum) {
    fail("NUMBER", `${name} must be an integer in [${minimum}, ${maximum}]`);
  }
  return value;
}

function record(value: unknown, keys: readonly string[], name: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) fail("MANIFEST", name);
  const prototype: unknown = Object.getPrototypeOf(value);
  if (prototype !== null && prototype !== Object.prototype) fail("MANIFEST", name);
  const object = value as Record<string, unknown>;
  if (Object.keys(object).length !== keys.length || keys.some((key) => !Object.hasOwn(object, key))) {
    fail("MANIFEST", `${name} has missing or unknown keys`);
  }
  return object;
}

function stagePath(value: unknown): string {
  // Relative, canonical asset keys only. No URLs, escapes, query strings, or dot segments.
  if (typeof value !== "string" || value.length > 240 ||
      !/^[A-Za-z0-9_-][A-Za-z0-9_.-]*(?:\/[A-Za-z0-9_-][A-Za-z0-9_.-]*)*\.bin$/.test(value)) {
    fail("PATH", "expected a canonical relative .bin asset key");
  }
  return value;
}

function hash(value: unknown): string {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) fail("HASH", "expected lowercase SHA-256");
  return value;
}

/** Exact fixed graph; rejects executable extensions and normalizes order to the reviewed layout. */
export function validateNeuralManifest(raw: unknown, layout: INeuralModelLayout): INeuralModelManifest {
  const value = record(raw, ["version", "provider", "revision", "graph", "stages"], "manifest");
  if (!/^[a-f0-9]{40}$/.test(layout.revision) ||
      !/^[A-Za-z0-9_-]{1,128}$/.test(layout.provider) || !/^[A-Za-z0-9_-]{1,128}$/.test(layout.graph)) {
    fail("LAYOUT", "provider code must pin a provider, graph, and full source revision");
  }
  if (value.version !== 1 || value.provider !== layout.provider ||
      value.revision !== layout.revision || value.graph !== layout.graph) {
    fail("IDENTITY", "manifest version/provider/revision/graph does not match the pinned layout");
  }
  const expected = Object.entries(layout.stageBytes);
  integer(expected.length, "stage count", 1, 1024);
  let totalBytes = 0;
  for (const [path, bytes] of expected) {
    stagePath(path);
    totalBytes = integer(totalBytes + integer(bytes, path, 1), "total model bytes", 1);
  }
  if (!Array.isArray(value.stages) || value.stages.length !== expected.length) fail("STAGES", "wrong stage count");
  const found = new Map<string, INeuralModelStage>();
  for (const rawStage of value.stages) {
    const stage = record(rawStage, ["path", "bytes", "sha256"], "stage");
    const path = stagePath(stage.path);
    if (!Object.hasOwn(layout.stageBytes, path) || found.has(path)) fail("STAGES", `unknown or duplicate ${path}`);
    const bytes = integer(stage.bytes, path, 1);
    if (bytes !== layout.stageBytes[path]) fail("LENGTH", `unexpected byte length for ${path}`);
    found.set(path, Object.freeze({ path, bytes, sha256: hash(stage.sha256) }));
  }
  const stages = expected.map(([path]) => {
    const stage = found.get(path);
    if (stage === undefined) fail("STAGES", `missing ${path}`);
    return stage;
  });
  return Object.freeze({ version: 1, provider: layout.provider, revision: layout.revision,
    graph: layout.graph, stages: Object.freeze(stages) });
}

/** Inject a platform SHA-256 implementation; no browser crypto/fetch dependency in game source. */
export async function verifyNeuralStage(
  stage: INeuralModelStage,
  bytes: Uint8Array,
  sha256: (data: Uint8Array) => Promise<string>,
): Promise<void> {
  stagePath(stage.path);
  integer(stage.bytes, "stage bytes", 1);
  const expected = hash(stage.sha256);
  if (!(bytes instanceof Uint8Array) || bytes.byteLength !== stage.bytes) fail("LENGTH", stage.path);
  if (await sha256(bytes) !== expected) fail("HASH", `digest mismatch for ${stage.path}`);
}

/** First-smoke policy: at most 512 valid pixels per axis; padded working size is reported separately. */
export function planNeuralInput(
  input: INeuralInputRequest,
  device: INeuralDeviceCapabilities,
  requirements: INeuralInputRequirements,
): INeuralInputPlan {
  const width = integer(input.width, "width", 1, 512);
  const height = integer(input.height, "height", 1, 512);
  const maxBytes = integer(input.maxBytes, "maxBytes", 1);
  const alignment = integer(requirements.alignment, "alignment", 1);
  const minimum = integer(requirements.minimumDimension, "minimumDimension", 1);
  const pad = (size: number) => integer(Math.ceil(Math.max(size, minimum) / alignment) * alignment, "padded size", 1);
  const paddedWidth = pad(width);
  const paddedHeight = pad(height);
  if (device.kind !== "webgpu") fail("BACKEND", "WebGPU renderer required");
  for (const feature of requirements.features) {
    if (!device.features.has(feature)) fail("FEATURE", feature);
  }
  const limit = (name: string, required: number) => {
    const actual = device.limits[name];
    if (actual === undefined || !Number.isSafeInteger(actual) || actual < required) {
      fail("DEVICE_LIMIT", `${name} requires ${required}, actual ${actual ?? "unavailable"}`);
    }
  };
  for (const [name, value] of Object.entries(requirements.limits)) {
    if (!/^max[A-Z]/.test(name)) fail("DEVICE_LIMIT", `unsupported minimum-type limit ${name}`);
    limit(name, integer(value, name));
  }
  limit("maxTextureDimension2D", Math.max(paddedWidth, paddedHeight));
  // The estimator is trusted provider code. No estimate or shader is taken from model JSON.
  const estimate = requirements.estimateMemory(paddedWidth, paddedHeight);
  const liveBytes = integer(estimate.liveBytes, "liveBytes");
  const peakBytes = integer(estimate.peakBytes, "peakBytes", liveBytes);
  const largestBufferBytes = integer(estimate.largestBufferBytes, "largestBufferBytes", 0, peakBytes);
  const largestStorageBindingBytes = integer(estimate.largestStorageBindingBytes, "largestStorageBindingBytes", 0, largestBufferBytes);
  if (peakBytes > maxBytes) fail("MEMORY_BUDGET", `peak ${peakBytes} exceeds cap ${maxBytes}`);
  limit("maxBufferSize", largestBufferBytes);
  limit("maxStorageBufferBindingSize", largestStorageBindingBytes);
  return Object.freeze({ width, height, paddedWidth, paddedHeight, liveBytes, peakBytes,
    largestBufferBytes, largestStorageBindingBytes });
}

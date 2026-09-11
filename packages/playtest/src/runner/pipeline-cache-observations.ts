/** Host observations, not cache hits. A successful import alone says nothing about speed. */
export interface IPipelineCacheObservation {
  readonly version: 1;
  readonly phase: "device" | "store" | "shutdown" | "api-probe";
  readonly mode?: "attached" | "disabled" | "unavailable" | "unsupported";
  readonly load?: "accepted" | "missing" | "rejected" | "unavailable" | "disabled";
  readonly store?: "stored" | "not-attempted" | "rejected" | "unavailable";
  readonly identity?: string;
  readonly reason?: string;
  readonly storeReason?: string;
  readonly emptyBytes?: number;
  readonly serializedBytes?: number;
  readonly loadedBytes?: number;
  readonly storedBytes?: number;
  readonly loadMs?: number;
  readonly storeMs?: number;
  readonly snapshotMs?: number;
}
const marker = "TN_PIPELINE_CACHE:";
const malformed = (): never => { throw new Error("TN_PERF_PIPELINE_CACHE_MALFORMED"); };
export function parsePipelineCacheObservations(text: string): IPipelineCacheObservation[] {
  const observations: IPipelineCacheObservation[] = [];
  const seen = new Set<string>();
  for (const line of text.split("\n")) {
    const at = line.indexOf(marker);
    if (at < 0) continue;
    let value: unknown;
    try { value = JSON.parse(line.slice(at + marker.length)); } catch { malformed(); }
    if (value === null || typeof value !== "object" || Array.isArray(value)) malformed();
    const record = value as Record<string, unknown>;
    if (record.version !== 1 || !["device", "store", "shutdown", "api-probe"].includes(String(record.phase))) malformed();
    if (record.phase !== "api-probe" && !["attached", "disabled", "unavailable", "unsupported"].includes(String(record.mode))) malformed();
    if (record.load !== undefined && !["accepted", "missing", "rejected", "unavailable", "disabled"].includes(String(record.load))) malformed();
    if (record.store !== undefined && !["stored", "not-attempted", "rejected", "unavailable"].includes(String(record.store))) malformed();
    for (const field of ["emptyBytes", "serializedBytes", "loadedBytes", "storedBytes", "loadMs", "storeMs", "snapshotMs", "renderAttached", "computeAttached"]) {
      const number = record[field];
      if (number !== undefined && (typeof number !== "number" || !Number.isFinite(number) || number < 0)) malformed();
    }
    for (const field of ["reason", "storeReason"]) if (record[field] !== undefined && typeof record[field] !== "string") malformed();
    if (record.identity !== undefined && (typeof record.identity !== "string" || !/^[a-f0-9]{64}$/u.test(record.identity))) malformed();
    const key = JSON.stringify(record);
    if (!seen.has(key)) { seen.add(key); observations.push(record as unknown as IPipelineCacheObservation); }
  }
  return observations;
}
export function formatPipelineCacheObservations(values: readonly IPipelineCacheObservation[]): string {
  if (values.length === 0) return "pipeline cache: not reported — no hit or persistence claim";
  return values.map((value) => `pipeline cache ${value.phase}: ${value.mode ?? "API probe"}, ` +
    `load ${value.load ?? "unreported"} (${value.loadedBytes ?? "unreported"} bytes), ` +
    `store ${value.store ?? "unreported"} (${value.storedBytes ?? "unreported"} bytes)` +
    (value.reason ? `, ${value.reason}` : "") + (value.storeReason ? `, ${value.storeReason}` : "")).join("\n") +
    "\npipeline cache observations are not hits; compare same-build process-cold pairs for benefit";
}

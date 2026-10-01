import type { IPlaytestObservations } from "../assertion-report.js";
import type { IPlaytestCaptureProvenance, IPlaytestReport } from "../report.js";
import { softwareAdapterName } from "../runner/browser.js";
import type { PlaytestAdapterClass } from "../scenario/schema-base.js";

export interface IAdapterClassification {
  /** Absent when this run reported no adapter to classify. Never defaulted to `hardware`. */
  readonly adapterClass?: PlaytestAdapterClass;
  /** The `adapter.info` field value that named a CPU rasteriser. */
  readonly softwareAdapter?: string;
}

/**
 * What this run's adapter is, decided by the harness's own reading and by nothing the game said.
 *
 * The classifier is the one every capture lane already refuses to run without, so this cannot be a
 * second opinion that disagrees with the gate the run passed. A run that reached assertions on a
 * WebGPU renderer is `software` when a field named a CPU rasteriser and `hardware` otherwise,
 * which is the same distinction `captureSession` makes before it lets a run count as evidence.
 *
 * A run with no `adapter.info` at all — a WebGL renderer, or a lane that reported no capture — is
 * unclassified rather than hardware: a CPU rasteriser that named itself in no known field is the
 * case a hardware verdict would silently pass.
 *
 * Native runs carry their provenance in `capture` too, read by `nativeCaptureProvenance` at the
 * point the report is built. It is the same four fields off the same `requestAdapter()` read, from
 * the renderer rather than a browser's capture session — which is why it is produced there and not
 * derived here. Nothing in this function reads a console marker, a tier the game chose, or any
 * other game-visible text: a browser report that arrived without its own capture stays
 * unclassified, exactly as before.
 */
export function classifyAdapter(report: IPlaytestReport): IAdapterClassification {
  const capture = report.capture;
  if (capture === undefined || capture.rendererKind !== "webgpu") return {};
  // `capture.rendererKind` is a fact about the canvas, not about the device behind it: a run can
  // carry a webgpu marker and an adapter object that named nothing — absent, `{}`, or every field
  // an empty string. Reading that as hardware would hand the run a hardware verdict from a
  // provenance that observed no adapter at all, which is the one answer this classifier exists to
  // refuse. A named identity is required first; only then does the existing software classifier
  // decide which class that identity is.
  if (adapterIdentity(capture.adapter) === undefined) return {};
  const software = softwareAdapterName(capture.adapter);
  return software === undefined
    ? { adapterClass: "hardware" }
    : { adapterClass: "software", softwareAdapter: software };
}

/** The same four `adapter.info` fields core's `softwareAdapter` reads, in that order. */
const ADAPTER_IDENTITY_KEYS = ["architecture", "description", "device", "vendor"] as const;

/**
 * One independently observed `adapter.info` identity field, or none when the run named nothing.
 *
 * Exactly those four keys, never every key present: `readCaptureProvenance` records `features` and
 * `limit.*` beside them, so scanning the object's values read a real capture full of non-identity
 * text — a `timestamp-query` feature and a bind-group limit — as an adapter that named itself, and
 * handed a run with an empty identity a hardware verdict.
 */
function adapterIdentity(adapter: Readonly<Record<string, string>> | undefined): string | undefined {
  if (adapter === undefined) return undefined;
  for (const key of ADAPTER_IDENTITY_KEYS) {
    const value = adapter[key];
    if (typeof value === "string" && value.trim() !== "") return value;
  }
  return undefined;
}

/**
 * The four `adapter.info` fields back out of a native adapter identity, or none.
 *
 * The renderer builds one string from its own `requestAdapter().info` read and hands it to the
 * pipeline census: `webgpu:` then `field=encodeURIComponent(value)` joined by `|`. Both separators
 * are encoded inside a value, so the split is unambiguous and this is a decode, not a guess.
 *
 * All four keys must be present and non-blank, which is the same requirement `adapterIdentity`
 * places on a browser capture. A string that is not this shape — an empty identity, a `webgl2`
 * census, a truncated one — yields `undefined`, and the run stays unclassified. There is no
 * partial answer here: three fields out of four would classify a machine from the identity of
 * somebody else.
 */
export function adapterFieldsFromIdentity(identity: unknown): Record<string, string> | undefined {
  if (typeof identity !== "string") return undefined;
  const prefix = "webgpu:";
  if (!identity.startsWith(prefix)) return undefined;
  const fields: Record<string, string> = {};
  for (const pair of identity.slice(prefix.length).split("|")) {
    const separator = pair.indexOf("=");
    if (separator <= 0) return undefined;
    const key = pair.slice(0, separator);
    let value: string;
    try {
      value = decodeURIComponent(pair.slice(separator + 1));
    } catch {
      return undefined;
    }
    if (value.trim() === "") return undefined;
    fields[key] = value;
  }
  const complete = Object.keys(fields).sort().join(",");
  if (complete !== [...ADAPTER_IDENTITY_KEYS].sort().join(",")) return undefined;
  return fields;
}

/**
 * Native adapter provenance for a run report, from what the engine measured on the host.
 *
 * `observations.pipelineCensus.adapter.identity` is core's own read of `adapter.info` on this
 * machine, already riding every WebGPU report. It is engine measurement, not a game-visible marker
 * and not something the game can influence, so it is an honest origin for the same classification a
 * browser capture provides. Anything that is not that shape yields `undefined`, and the caller
 * leaves `capture` unset — which is the unclassified answer, not a hardware one.
 */
export function nativeCaptureProvenance(
  census: IPlaytestObservations["pipelineCensus"],
  target: string,
  viewport: { readonly height: number; readonly width: number },
): IPlaytestCaptureProvenance | undefined {
  if (census === undefined || census === null || typeof census !== "object" || Array.isArray(census)) return undefined;
  const adapterRecord = census.adapter;
  if (adapterRecord === undefined || adapterRecord === null || typeof adapterRecord !== "object"
    || Array.isArray(adapterRecord)) return undefined;
  const adapter = adapterFieldsFromIdentity(adapterRecord.identity);
  if (adapter === undefined) return undefined;
  return {
    adapter,
    // A native launch carries no browser command line; there is no argument list to report and
    // inventing one would be a flag nobody can check.
    browserArgs: [],
    captureMethod: "device.screenshot",
    rendererKind: "webgpu",
    target,
    viewport,
  };
}
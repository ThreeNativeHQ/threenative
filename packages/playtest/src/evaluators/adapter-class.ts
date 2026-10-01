import type { IPlaytestReport } from "../report.js";
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

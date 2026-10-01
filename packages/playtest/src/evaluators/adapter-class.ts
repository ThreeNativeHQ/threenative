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

/** One independently observed `adapter.info` field, or none when the run named nothing. */
function adapterIdentity(adapter: Readonly<Record<string, string>> | undefined): string | undefined {
  if (adapter === undefined) return undefined;
  for (const value of Object.values(adapter)) {
    if (typeof value === "string" && value.trim() !== "") return value;
  }
  return undefined;
}

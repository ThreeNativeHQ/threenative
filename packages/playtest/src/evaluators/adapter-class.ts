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
  const software = softwareAdapterName(capture.adapter);
  return software === undefined
    ? { adapterClass: "hardware" }
    : { adapterClass: "software", softwareAdapter: software };
}

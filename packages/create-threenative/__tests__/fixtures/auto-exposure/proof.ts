interface IExposureProofReport {
  pass: boolean;
  capture?: { rendererKind: string; adapter: Record<string, string> };
  diagnostics: readonly { code: string }[];
  observations?: { console: readonly { text: string }[] };
}

interface IExposureMeasurement {
  measured: true;
  applied: boolean;
  luminance: number;
  exposureStops: number;
  targetStops: number;
  settled: boolean;
}

function settledAtNewTarget(
  value: { settled: boolean; targetStops: number },
  start: number,
  stops: number,
): boolean {
  return (
    value.settled === true &&
    Number.isFinite(value.targetStops) &&
    Math.abs(Math.abs(value.targetStops - start) - stops) <= 0.25
  );
}

function validElapsed(value: { renderedUpdates: number; consumedSeconds: number }): boolean {
  return (
    Number.isInteger(value.renderedUpdates) &&
    value.renderedUpdates > 0 &&
    Number.isFinite(value.consumedSeconds) &&
    value.consumedSeconds > 0
  );
}

function cutEntries(report: IExposureProofReport) {
  const entries = report.observations?.console ?? [];
  const cuts = entries.filter(({ text }) => text.startsWith("TN_EXPOSURE_CUT:"));
  if (cuts.length !== 1) throw new Error("Exposure proof needs exactly one observed cut.");
  const cutEntry = cuts[0];
  if (cutEntry === undefined) throw new Error("Exposure cut missing.");
  const cut = JSON.parse(cutEntry.text.slice("TN_EXPOSURE_CUT:".length));
  if (
    cut.settled !== true ||
    ![cut.updates, cut.consumedSeconds, cut.targetStops].every(Number.isFinite)
  )
    throw new Error("Exposure cut needs one observed, settled starting pose.");
  return { cut, after: entries.slice(entries.indexOf(cutEntry) + 1) };
}

/** Readback arrival is a conservative upper bound on the frame that produced the settled value. */
export function exposureCutTiming(
  report: IExposureProofReport,
  stops: number,
  frameBudget: number,
) {
  const { cut, after } = cutEntries(report);
  let elapsed = { renderedUpdates: 0, consumedSeconds: 0 };
  for (const { text } of after) {
    if (text.startsWith("TN_EXPOSURE_TIMING:")) {
      const value = JSON.parse(text.slice("TN_EXPOSURE_TIMING:".length));
      elapsed = {
        renderedUpdates: value.updates - cut.updates,
        consumedSeconds: value.consumedSeconds - cut.consumedSeconds,
      };
      if (!validElapsed(elapsed)) throw new Error("Exposure cut timing is invalid.");
      continue;
    }
    if (!text.startsWith("TN_AUTO_EXPOSURE:") || elapsed.renderedUpdates === 0) continue;
    const value = JSON.parse(text.slice("TN_AUTO_EXPOSURE:".length));
    if (!settledAtNewTarget(value, cut.targetStops, stops)) continue;
    if (elapsed.renderedUpdates > frameBudget)
      throw new Error(
        `Exposure settled after ${elapsed.renderedUpdates} rendered updates; budget ${frameBudget}.`,
      );
    return elapsed;
  }
  throw new Error(
    `Exposure did not settle within ${frameBudget} rendered updates; observed ${elapsed.renderedUpdates} updates and ${elapsed.consumedSeconds} seconds.`,
  );
}

/** A downgraded lost software device can pass harness plumbing, but never pixel qualification. */
export function assertExposureProof(
  report: IExposureProofReport,
  applied: boolean,
): IExposureMeasurement {
  if (report.diagnostics.some(({ code }) => code === "TN_PLAYTEST_SOFTWARE_DEVICE_LOST"))
    throw new Error(
      "Exposure proof rejected software device loss; these pixels are not render evidence.",
    );
  if (!report.pass)
    throw new Error(`Exposure scenario failed: ${JSON.stringify(report.diagnostics)}`);
  if (
    report.capture?.rendererKind !== "webgpu" ||
    !Object.values(report.capture.adapter).some((value) => value.length > 0)
  )
    throw new Error("Exposure proof requires observed WebGPU adapter provenance.");
  const last = report.observations?.console
    .filter(({ text }) => text.startsWith("TN_AUTO_EXPOSURE:"))
    .at(-1);
  if (last === undefined) throw new Error("GPU exposure observation missing.");
  const measurement = JSON.parse(last.text.slice("TN_AUTO_EXPOSURE:".length));
  if (
    measurement.measured !== true ||
    measurement.applied !== applied ||
    ![measurement.luminance, measurement.exposureStops, measurement.targetStops].every(
      (value) => typeof value === "number" && Number.isFinite(value),
    ) ||
    measurement.luminance <= 0 ||
    (applied &&
      (measurement.settled !== true ||
        Math.abs(measurement.targetStops - measurement.exposureStops) > 0.25)) ||
    (!applied && measurement.exposureStops !== 0)
  )
    throw new Error(`Exposure measurement failed: ${JSON.stringify(measurement)}`);
  return measurement;
}

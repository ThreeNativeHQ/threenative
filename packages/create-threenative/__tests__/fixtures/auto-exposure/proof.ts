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

import type { IPlaytestDeviceMetricsObservation } from "../runner/deviceMetrics.js";
import type { IEvaluationContext } from "./context.js";

/**
 * Judges the host-measured device thermal/power observation.
 *
 * The measured numbers are always reported, including — especially — for a run the verdict
 * calls confounded. What fails is the claim of comparability, never the measurement.
 */
export function emitDeviceMetrics(ctx: IEvaluationContext): void {
  const assertion = ctx.scenarioAssertions.deviceMetrics;
  if (assertion === undefined) return;
  const { assertions, diagnostics, input } = ctx;
  const observation = input.report.observations?.deviceMetrics;
  const sourcePath = input.scenario.sourcePath;

  if (observation === undefined || observation.samples.length === 0) {
    assertions.push({
      details: {
        errors: observation?.errors ?? [],
        reason: observation === undefined ? "no-device-metrics-observation" : "no-device-metrics-samples",
      },
      id: "deviceMetrics.observed",
      pass: false,
    });
    diagnostics.push({
      code: "TN_PLAYTEST_DEVICE_METRICS_UNAVAILABLE",
      message: `Scenario '${input.scenario.name}' asserts deviceMetrics, but this run produced no device thermal, power or battery samples.`,
      observedRuntimePath: "observations.json/deviceMetrics",
      severity: "error",
      ...(sourcePath === undefined ? {} : { sourcePath }),
      suggestion:
        "Run this scenario with --target android against a reachable device; the browser, desktop and iOS lanes have no device metrics probe.",
    });
    return;
  }

  const { verdict } = observation;
  assertions.push({
    details: measuredDetails(observation),
    id: "deviceMetrics.observed",
    pass: observation.errors.length === 0,
  });
  if (observation.errors.length > 0) {
    diagnostics.push({
      code: "TN_PLAYTEST_DEVICE_METRICS_INCOMPLETE",
      message: `Device metric probes failed during the run: ${observation.errors.join("; ")}.`,
      observedRuntimePath: "observations.json/deviceMetrics",
      severity: "error",
      ...(sourcePath === undefined ? {} : { sourcePath }),
      suggestion: "Check the device is reachable over adb for the whole run, then rerun the scenario.",
    });
  }

  if (assertion.notThermallyConfounded === true) {
    assertions.push({
      details: measuredDetails(observation),
      id: "deviceMetrics.notThermallyConfounded",
      pass: !verdict.thermallyConfounded,
    });
    if (verdict.thermallyConfounded) {
      diagnostics.push({
        code: "TN_PLAYTEST_DEVICE_THERMALLY_CONFOUNDED",
        message: `This run is not comparable with a cool one (${verdict.reasons.join(", ")}): it started at ${format(verdict.startTemperatureC)} °C at thermal status ${verdict.startThermalStatus ?? "unknown"} and ended at ${format(verdict.endTemperatureC)} °C at status ${verdict.endThermalStatus ?? "unknown"}.`,
        observedRuntimePath: "observations.json/deviceMetrics",
        severity: "error",
        ...(sourcePath === undefined ? {} : { sourcePath }),
        suggestion:
          "Let the device cool until it reads below the hot-start threshold at thermal status 0, keep it discharging, then rerun. The numbers this run measured are still in the report.",
      });
    }
  }

  if (assertion.maxTemperatureRiseC !== undefined) {
    const observed = verdict.temperatureRiseC;
    assertions.push({
      details: { expected: assertion.maxTemperatureRiseC, ...measuredDetails(observation), observed },
      id: "deviceMetrics.maxTemperatureRiseC",
      pass: observed !== null && observed <= assertion.maxTemperatureRiseC,
    });
    if (observed === null || observed > assertion.maxTemperatureRiseC) {
      diagnostics.push({
        code: "TN_PLAYTEST_DEVICE_TEMPERATURE_ROSE",
        message: observed === null
          ? "deviceMetrics.maxTemperatureRiseC could not be evaluated: the run recorded no start and end temperature."
          : `deviceMetrics.maxTemperatureRiseC expected at most ${assertion.maxTemperatureRiseC} °C, observed ${observed} °C.`,
        observedRuntimePath: "observations.json/deviceMetrics",
        severity: "error",
        ...(sourcePath === undefined ? {} : { sourcePath }),
        suggestion: "Shorten the workload, cool the device before the run, or raise the declared ceiling deliberately.",
      });
    }
  }

  if (assertion.maxThermalStatus !== undefined) {
    const observed = verdict.maxThermalStatus;
    assertions.push({
      details: { expected: assertion.maxThermalStatus, ...measuredDetails(observation), observed },
      id: "deviceMetrics.maxThermalStatus",
      pass: observed !== null && observed <= assertion.maxThermalStatus,
    });
    if (observed === null || observed > assertion.maxThermalStatus) {
      diagnostics.push({
        code: "TN_PLAYTEST_DEVICE_THERMAL_STATUS",
        message: observed === null
          ? "deviceMetrics.maxThermalStatus could not be evaluated: the run recorded no thermal status."
          : `deviceMetrics.maxThermalStatus expected at most ${assertion.maxThermalStatus}, observed ${observed}.`,
        observedRuntimePath: "observations.json/deviceMetrics",
        severity: "error",
        ...(sourcePath === undefined ? {} : { sourcePath }),
        suggestion: "Cool the device to thermal status 0 before the run; a throttled device measures the cooler, not the build.",
      });
    }
  }
}

/** The measured numbers ride into every result, so a failing verdict still carries its evidence. */
function measuredDetails(observation: IPlaytestDeviceMetricsObservation): Record<string, unknown> {
  const { verdict } = observation;
  return {
    endTemperatureC: verdict.endTemperatureC,
    endThermalStatus: verdict.endThermalStatus,
    errors: observation.errors,
    maxThermalStatus: verdict.maxThermalStatus,
    peakTemperatureC: verdict.peakTemperatureC,
    powerRailWindowAdvanced: verdict.powerRailWindowAdvanced,
    reasons: verdict.reasons,
    sampleCount: observation.samples.length,
    startTemperatureC: verdict.startTemperatureC,
    startThermalStatus: verdict.startThermalStatus,
    temperatureRiseC: verdict.temperatureRiseC,
    thermallyConfounded: verdict.thermallyConfounded,
  };
}

function format(value: number | null): string {
  return value === null ? "unknown" : String(value);
}

import { NodeFrame } from "three/webgpu";
import { AutoExposureNode } from "../../../template-assets/autoExposure.js";

/** Only the fixture's adaptation input is controlled; the renderer's shared frame stays real. */
export function exposureFrameSnapshot(frame: NodeFrame): NodeFrame {
  return Object.assign(new NodeFrame(), frame, { deltaTime: 1 / 60 });
}

/** Diagnostic instrumentation around the actual generated GPU graph, never a CPU exposure model. */
export class ObservedExposureNode extends AutoExposureNode {
  deterministic = false;
  onProgress = () => {};
  timing = {
    updates: 0,
    consumedSeconds: 0,
    realConsumedSeconds: 0,
    nodeFrameId: 0,
    nodeTime: 0,
    deltaSeconds: 0,
    clock: "live",
  };
  #cutStart: number | undefined;
  #sampleUpdates = 0;
  #pending = false;
  #disposed = false;

  beginCut(): void {
    this.#cutStart = this.timing.updates;
  }

  getProgress() {
    return {
      sampleFrames: this.#sampleUpdates,
      cutSampleFrames:
        this.#cutStart === undefined ? 0 : Math.max(0, this.#sampleUpdates - this.#cutStart),
    };
  }

  override updateBefore(frame: NodeFrame): undefined {
    // Bound each deterministic pose to exactly 180 actual graph updates. Wait for its real
    // GPU readback before the next update, including the terminal update; then hold that history.
    if (this.deterministic && (this.#pending || this.timing.updates - (this.#cutStart ?? 0) >= 180))
      return;
    const input = this.deterministic ? exposureFrameSnapshot(frame) : frame;
    const next = {
      updates: this.timing.updates + 1,
      consumedSeconds:
        this.timing.consumedSeconds + Math.min(input.deltaTime, this.settings.maxDelta),
      realConsumedSeconds: this.timing.realConsumedSeconds + frame.deltaTime,
      nodeFrameId: frame.frameId,
      nodeTime: frame.time,
      deltaSeconds: input.deltaTime,
      clock: this.deterministic ? "deterministic-per-render" : "live",
    };
    const renderer = frame.renderer;
    if (renderer === null) throw new Error("Exposure fixture renderer missing.");
    const read = renderer.readRenderTargetPixelsAsync;
    let sampleRead: ReturnType<typeof read> | undefined;
    if (this.deterministic) {
      renderer.readRenderTargetPixelsAsync = (...args) => {
        this.#pending = true;
        sampleRead = read.apply(renderer, args);
        return sampleRead;
      };
    }
    try {
      super.updateBefore(input);
      this.timing = next;
      console.info(`TN_EXPOSURE_TIMING:${JSON.stringify(this.timing)}`);
      if (sampleRead !== undefined) {
        // Subscribe after super has attached its production acceptance callback. Returning the
        // original promise preserves that order even for an already resolved GPU readback.
        void sampleRead
          .then(
            (values) => {
              if (this.#disposed) return;
              const measurement = this.getObservation();
              if (
                !(values instanceof Float32Array) ||
                values.length < 4 ||
                !Array.from(values).every(Number.isFinite) ||
                measurement.measured !== true ||
                measurement.luminance !== values[1] ||
                measurement.targetStops !== values[2] ||
                measurement.settled !== (values[3] === 1) ||
                (measurement.applied === true && measurement.exposureStops !== values[0])
              )
                return;
              this.#sampleUpdates = next.updates;
              console.info(`TN_EXPOSURE_SAMPLE:${JSON.stringify({ ...next, measurement })}`);
            },
            () => {},
          )
          .finally(() => {
            if (this.#disposed) return;
            this.#pending = false;
            this.onProgress();
          });
      }
      this.onProgress();
    } finally {
      renderer.readRenderTargetPixelsAsync = read;
    }
  }

  override dispose(): void {
    this.#disposed = true;
    super.dispose();
  }
}

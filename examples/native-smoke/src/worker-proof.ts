const WORKER_ITERATIONS = 120_000_000;
const WORKER_SEED = 0x12345678;

export const WORKER_INPUT_CHECKSUM = (WORKER_ITERATIONS ^ WORKER_SEED) >>> 0;
export const WORKER_OUTPUT_CHECKSUM = 2_624_713_848;
export const WORKER_MINIMUM_FRAMES = 2;

const WORKER_SOURCE = `
self.onmessage = function(event) {
  var input = event.data;
  var checksum = input.seed >>> 0;
  for (var index = 0; index < input.iterations; index += 1) {
    checksum = (Math.imul((checksum ^ index) >>> 0, 1664525) + 1013904223) >>> 0;
  }
  postMessage({
    kind: "result",
    order: input.order,
    inputChecksum: (input.iterations ^ input.seed) >>> 0,
    outputChecksum: checksum,
    workerIdentity: typeof document === "undefined" ? "dedicated-worker" : "game-thread"
  });
  postMessage({ kind: "late", order: input.order + 1 });
};
`;

export interface IWorkerProofResult {
  callbacksAfterTerminate: number;
  completionOrder: number[];
  framesAdvanced: number;
  inputChecksum: number;
  outputChecksum: number;
  sourceForm: "classic-blob";
  workerIdentity: "dedicated-worker";
}

export interface IWorkerProof {
  observeFrame(frame: number): void;
}

interface IWorkerResultMessage {
  inputChecksum: number;
  kind: "late" | "result";
  order: number;
  outputChecksum?: number;
  workerIdentity?: "dedicated-worker" | "game-thread";
}

function fail(worker: Worker, reason: string): never {
  worker.terminate();
  const marker = `RED observed: ${reason}`;
  console.error(`TN_NATIVE_WORKER_PROOF_FAIL:${marker}`);
  throw new Error(marker);
}

export function startWorkerProof(
  initialFrame: number,
  onPass: (result: IWorkerProofResult) => void,
): IWorkerProof {
  const sourceUrl = URL.createObjectURL(new Blob([WORKER_SOURCE], { type: "text/javascript" }));
  const worker = new Worker(sourceUrl);
  URL.revokeObjectURL(sourceUrl);

  let callbacksAfterTerminate = 0;
  let completionFrame: number | undefined;
  let currentFrame = initialFrame;
  let result: IWorkerResultMessage | undefined;
  let terminated = false;
  let published = false;

  worker.onerror = (event) => fail(worker, `worker error: ${event.message}`);
  worker.onmessage = (event: MessageEvent<IWorkerResultMessage>) => {
    if (terminated) {
      callbacksAfterTerminate += 1;
      return;
    }
    if (event.data.kind !== "result") {
      fail(worker, `worker completion order was ${event.data.order}, expected result first`);
    }
    result = event.data;
    completionFrame = currentFrame;
    terminated = true;
    worker.terminate();
  };

  worker.postMessage({ iterations: WORKER_ITERATIONS, order: 1, seed: WORKER_SEED });

  const publishResult = (): void => {
    if (result === undefined || completionFrame === undefined) return;
    if (callbacksAfterTerminate !== 0) {
      fail(worker, `${callbacksAfterTerminate} callback(s) fired after termination`);
    }
    const framesAdvanced = completionFrame - initialFrame;
    if (result.workerIdentity !== "dedicated-worker") {
      fail(worker, "worker executed on the game thread");
    }
    if (framesAdvanced < WORKER_MINIMUM_FRAMES) {
      fail(
        worker,
        `only ${framesAdvanced} frame(s) advanced while worker computation was in flight`,
      );
    }
    if (
      result.inputChecksum !== WORKER_INPUT_CHECKSUM ||
      result.outputChecksum !== WORKER_OUTPUT_CHECKSUM
    ) {
      fail(
        worker,
        `checksum mismatch: input=${result.inputChecksum} output=${result.outputChecksum}`,
      );
    }

    const observation: IWorkerProofResult = {
      callbacksAfterTerminate,
      completionOrder: [result.order],
      framesAdvanced,
      inputChecksum: result.inputChecksum,
      outputChecksum: result.outputChecksum,
      sourceForm: "classic-blob",
      workerIdentity: result.workerIdentity,
    };
    published = true;
    console.info(`TN_NATIVE_WORKER_PROOF_PASS:${JSON.stringify(observation)}`);
    onPass(observation);
  };

  return {
    observeFrame(frame) {
      currentFrame = frame;
      if (published) return;
      if (result === undefined) {
        if (frame - initialFrame >= 240) {
          fail(worker, "worker result was not delivered before the frame bound");
        }
        return;
      }
      if (completionFrame === undefined || frame - completionFrame < 2) return;
      publishResult();
    },
  };
}

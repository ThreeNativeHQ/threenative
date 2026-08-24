import { interruptedPlaytestError } from "./shared.js";

export async function withTargetAbortSignal<T>(
  target: string,
  run: (abortSignal: AbortSignal) => Promise<T>,
  abortSignal?: AbortSignal,
): Promise<T> {
  const controller = abortSignal === undefined ? new AbortController() : undefined;
  const signal = abortSignal ?? controller!.signal;
  const handleSignal = (): void => {
    controller?.abort();
  };
  if (controller !== undefined) {
    process.once("SIGINT", handleSignal);
    process.once("SIGTERM", handleSignal);
  }
  try {
    const result = await run(signal);
    if (signal.aborted) throw interruptedPlaytestError(target);
    return result;
  } finally {
    if (controller !== undefined) {
      process.off("SIGINT", handleSignal);
      process.off("SIGTERM", handleSignal);
    }
  }
}

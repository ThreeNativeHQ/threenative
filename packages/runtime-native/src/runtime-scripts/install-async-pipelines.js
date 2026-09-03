// The deferred half of PRD-327's off-loop pipeline compilation.
//
// This file used to *be* the implementation: `createRenderPipelineAsync` was the synchronous
// create wrapped in `Promise.resolve()`. Nothing left the thread, so `renderer.compileAsync()`
// behind a loading screen compiled every pipeline on the main loop anyway, `TN_WARMUP` reported
// `{"compiled":0,"abandoned":1,"timedOut":true}`, and the first world frame then compiled the same
// pipelines again — 8,038 ms across 105 calls on a Pixel 8.
//
// The create is now a native binding that hands the descriptor to a host compile pool. What is
// still JavaScript is the deferred: the engine abstraction has no primitive for a promise the host
// can settle later, so the resolvers live here and the host calls in through the two globals below.
// `bindings_pipelines.cpp` asks `__tnPipelinePending` for a promise when it enqueues a compile, and
// `drainAsyncPipelineCompiles` calls `__tnPipelineSettle` from `pollEvents()` when one lands.
(device) => {
  const pending = new Map();

  globalThis.__tnPipelinePending = (id) =>
    new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
    });

  globalThis.__tnPipelineSettle = (id, pipeline, error) => {
    const deferred = pending.get(id);
    // A settle for an unknown id means the host and this map disagree about what is outstanding,
    // which is a bug in the drain rather than something to paper over. Report it, never throw:
    // the drain is mid-loop and an exception there would take the frame with it.
    if (deferred === undefined) return false;
    pending.delete(id);
    if (error === undefined || error === null) deferred.resolve(pipeline);
    else deferred.reject(new Error(String(error)));
    return true;
  };

  // How many compiles are still outstanding. `warmUpScene` uses this to tell "nothing has
  // finished yet" apart from "nothing was ever started", which is the difference between a
  // warm-up that is working and one that is broken.
  globalThis.__tnPipelinePendingCount = () => pending.size;

  // The natives are installed before this script runs, so this is a real assertion rather than a
  // description of what this file just did.
  return (
    typeof device.createRenderPipelineAsync === "function" &&
    typeof device.createComputePipelineAsync === "function"
  );
};

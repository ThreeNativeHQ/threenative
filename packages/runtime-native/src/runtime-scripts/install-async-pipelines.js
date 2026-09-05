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

  // Buffer mapping is also deferred on the native side. The backend callback may arrive from a
  // device thread, so `__tnBufferMapSettle` is called by `pollEvents()` on the game thread. Keep
  // the resolver in this map until settlement. The buffer wrapper below owns the observable
  // `mapState`, while this map owns only the Promise continuation.
  // requestDevice can install another facade over the same native device. Existing requests
  // must retain their resolvers across that installation.
  if (typeof globalThis.__tnBufferMapPending !== "function") {
  const pendingBufferMaps = new Map();
  globalThis.__tnBufferMapPending = (id) =>
    new Promise((resolve, reject) => {
      pendingBufferMaps.set(id, { resolve, reject });
    });

  globalThis.__tnBufferMapSettle = (id, success, error) => {
    const deferred = pendingBufferMaps.get(id);
    if (deferred === undefined) return false;
    pendingBufferMaps.delete(id);
    if (success) deferred.resolve();
    else deferred.reject(new Error(String(error || "Buffer map failed")));
    return true;
  };

  globalThis.__tnBufferMapPendingCount = () => pendingBufferMaps.size;
  }

  // Keep the WebGPU-visible state correct without passing a JS wrapper through an asynchronous
  // native callback. The native promise is still the source of completion; these handlers only
  // mirror its state at the same Promise boundary.
  const createBuffer = device.createBuffer.bind(device);
  device.createBuffer = (descriptor) => {
    const buffer = createBuffer(descriptor);
    // Native descriptor validation can leave the original JS exception pending while returning
    // undefined. Do not replace that useful error with a wrapper access error.
    if (buffer === undefined) return buffer;
    const mapAsync = buffer.mapAsync.bind(buffer);
    const unmap = buffer.unmap.bind(buffer);
    const destroy = buffer.destroy.bind(buffer);
    let generation = 0;
    let destroyed = false;
    let mapState = buffer.mapState;
    Object.defineProperty(buffer, "mapState", { get: () => mapState });
    buffer.mapAsync = (...args) => {
      if (destroyed || mapState !== "unmapped")
        return Promise.reject(new Error("Buffer is destroyed, mapped or already mapping"));
      const requestGeneration = ++generation;
      mapState = "pending";
      return mapAsync(...args).then(
        (value) => {
          if (generation === requestGeneration) mapState = "mapped";
          return value;
        },
        (error) => {
          if (generation === requestGeneration) mapState = "unmapped";
          throw error;
        },
      );
    };
    buffer.unmap = (...args) => {
      ++generation;
      mapState = "unmapped";
      const value = unmap(...args);
      return value;
    };
    buffer.destroy = (...args) => {
      ++generation;
      destroyed = true;
      mapState = "unmapped";
      return destroy(...args);
    };
    return buffer;
  };

  // The natives are installed before this script runs, so this is a real assertion rather than a
  // description of what this file just did.
  return (
    typeof device.createRenderPipelineAsync === "function" &&
    typeof device.createComputePipelineAsync === "function" &&
    typeof globalThis.__tnBufferMapPending === "function" &&
    typeof globalThis.__tnBufferMapSettle === "function"
  );
};

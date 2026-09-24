// The deferred half of decoding audio off the frame thread.
//
// `decodeAudioData` used to decode inline and hand back a settled promise, because the promise
// contract could not be met any other way: the hand-rolled thenable it used returned `undefined`
// from `then`, so `.then(use).catch(report)` threw on `undefined.catch`. A real `Promise` has no
// such problem, so the decode can leave the thread and settle when it lands.
//
// The resolvers live here, and the host calls in through the two globals below. `audio_bindings.cpp`
// asks `__tnAudioDecodePending` for a promise when it queues a decode, and the runtime's
// `pollEvents()` calls `__tnAudioDecodeSettle` for each completion on the game thread.
//
// Order matches a browser: the legacy `successCallback`/`errorCallback` arguments fire at
// settlement, not at the call, and they fire before the promise handler runs for the same result.
(() => {
  const pending = new Map();

  globalThis.__tnAudioDecodePending = (id, onSuccess, onError) =>
    new Promise((resolve, reject) => {
      pending.set(id, {
        resolve,
        reject,
        success: typeof onSuccess === "function" ? onSuccess : undefined,
        failure: typeof onError === "function" ? onError : undefined,
      });
    });

  globalThis.__tnAudioDecodeSettle = (id, buffer, error) => {
    const entry = pending.get(id);
    // A settle for an unknown id means the host and this map disagree about what is outstanding,
    // which is a bug in the drain rather than something to paper over. Report, never throw: the
    // drain runs mid-frame and an exception there would take the frame with it.
    if (entry === undefined) return false;
    pending.delete(id);
    if (error === undefined || error === null || error === "") {
      if (entry.success !== undefined) entry.success(buffer);
      entry.resolve(buffer);
    } else {
      const failure = new Error(String(error));
      if (entry.failure !== undefined) entry.failure(failure);
      entry.reject(failure);
    }
    return true;
  };

  // How many decodes are still outstanding. A test uses this to tell "nothing has finished yet"
  // apart from "nothing was ever queued", which is the difference between a working drain and a
  // broken one.
  globalThis.__tnAudioDecodePendingCount = () => pending.size;
})();

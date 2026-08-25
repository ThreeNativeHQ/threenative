globalThis.AudioContext = function AudioContext() {
  const native = globalThis.__tnCreateAudioContext();
  Object.defineProperties(this, Object.getOwnPropertyDescriptors(native));
  Object.defineProperty(this, 'currentTime', {
    get: function() {
      return this._getCurrentTime();
    },
  });
  return this;
};
globalThis.webkitAudioContext = globalThis.AudioContext;

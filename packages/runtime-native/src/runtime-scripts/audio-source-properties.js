((source) => {
  let buffer = null;
  let loop = false;
  Object.defineProperty(source, 'buffer', {
    get: () => buffer,
    set: (value) => { buffer = value; source._setBuffer(value); },
  });
  Object.defineProperty(source, 'loop', {
    get: () => loop,
    set: (value) => { loop = Boolean(value); source._setLoop(loop); },
  });
})(globalThis.__tnAudioSourceTemp);

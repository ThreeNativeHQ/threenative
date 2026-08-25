((panner) => {
  function numberProperty(name, initial, setter) {
    let value = initial;
    Object.defineProperty(panner, name, {
      get: () => value,
      set: (next) => { value = Number(next); panner[setter](value); },
    });
  }
  numberProperty('refDistance', 1.0, '_setRefDistance');
  numberProperty('maxDistance', 10000.0, '_setMaxDistance');
  numberProperty('rolloffFactor', 1.0, '_setRolloffFactor');
  let distanceModel = 'inverse';
  Object.defineProperty(panner, 'distanceModel', {
    get: () => distanceModel,
    set: (next) => {
      distanceModel = String(next);
      panner._setDistanceModel(distanceModel);
    },
  });
  panner.panningModel = 'equalpower';
  panner.coneInnerAngle = 360;
  panner.coneOuterAngle = 360;
  panner.coneOuterGain = 0;
})(globalThis.__tnAudioPannerTemp);

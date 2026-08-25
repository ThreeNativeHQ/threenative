((param) => {
  let value = 1.0;
  Object.defineProperty(param, 'value', {
    get: () => value,
    set: (next) => { value = Number(next); param._setValue(value); },
  });
  param.setTargetAtTime = (next, time, constant) => {
    value = Number(next); param._setTargetAtTime(value, time, constant); return param;
  };
  param.setValueAtTime = (next, time) => {
    value = Number(next); param._setValueAtTime(value, time); return param;
  };
  param.linearRampToValueAtTime = (next, time) => {
    value = Number(next); param._linearRampToValueAtTime(value, time); return param;
  };
})(globalThis.__tnAudioGainParamTemp);

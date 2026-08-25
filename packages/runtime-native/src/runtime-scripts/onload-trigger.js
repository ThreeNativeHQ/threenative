setTimeout(() => {
  const onload = globalThis.__tnOnloadCallback;
  globalThis.__tnOnloadCallback = undefined;
  onload?.();
}, 0);

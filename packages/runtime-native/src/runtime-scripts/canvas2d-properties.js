((ctx) => {
  let fillStyle = '#000000';
  let strokeStyle = '#000000';
  let lineWidth = 1.0;
  let globalAlpha = 1.0;
  let font = '10px sans-serif';
  let textAlign = 'start';
  let textBaseline = 'alphabetic';

  Object.defineProperty(ctx, 'fillStyle', {
    get: () => fillStyle,
    set: (value) => {
      fillStyle = value;
      ctx.__nativeSetFillStyle(value);
    },
  });

  Object.defineProperty(ctx, 'strokeStyle', {
    get: () => strokeStyle,
    set: (value) => {
      strokeStyle = value;
      ctx.__nativeSetStrokeStyle(value);
    },
  });

  Object.defineProperty(ctx, 'lineWidth', {
    get: () => lineWidth,
    set: (value) => {
      lineWidth = value;
      ctx.__nativeSetLineWidth(value);
    },
  });

  Object.defineProperty(ctx, 'globalAlpha', {
    get: () => globalAlpha,
    set: (value) => {
      globalAlpha = value;
      ctx.__nativeSetGlobalAlpha(value);
    },
  });

  Object.defineProperty(ctx, 'font', {
    get: () => font,
    set: (value) => {
      font = value;
      ctx.__nativeSetFont(value);
    },
  });

  Object.defineProperty(ctx, 'textAlign', {
    get: () => textAlign,
    set: (value) => {
      textAlign = value;
      ctx.__nativeSetTextAlign(value);
    },
  });

  Object.defineProperty(ctx, 'textBaseline', {
    get: () => textBaseline,
    set: (value) => {
      textBaseline = value;
      ctx.__nativeSetTextBaseline(value);
    },
  });
})(globalThis.__canvas2dContextTemp);

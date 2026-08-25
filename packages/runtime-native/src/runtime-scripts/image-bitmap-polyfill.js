// ImageBitmap class (web-compatible)
class ImageBitmap {
  constructor(width, height, data) {
    this.width = width;
    this.height = height;
    this._data = data; // Internal RGBA pixel data
    this._closed = false;
  }

  close() {
    this._closed = true;
    this._data = null;
  }
}

// createImageBitmap - Standard Web API
// Supports: Blob, ArrayBuffer, Response, or object with arrayBuffer() method
async function createImageBitmap(source, options) {
  let arrayBuffer;

  if (source instanceof ArrayBuffer) {
    arrayBuffer = source;
  } else if (source instanceof Uint8Array) {
    arrayBuffer = source.buffer;
  } else if (source && typeof source.arrayBuffer === "function") {
    // Blob or Response
    arrayBuffer = await source.arrayBuffer();
  } else if (source?._data) {
    // Already an ImageBitmap-like object
    return source;
  } else {
    throw new Error("createImageBitmap: unsupported source type");
  }

  // Decode using native function
  const decoded = __decodeImageData(arrayBuffer);

  if (!decoded) {
    throw new Error("createImageBitmap: failed to decode image");
  }

  // Create ImageBitmap
  const bitmap = new ImageBitmap(decoded.width, decoded.height, decoded._data);
  return bitmap;
}

globalThis.createImageBitmap = createImageBitmap;
globalThis.ImageBitmap = ImageBitmap;

// CanvasRenderingContext2D - Placeholder class for instanceof checks
// The actual implementation is in Canvas2D bindings, this is just for type checking
class CanvasRenderingContext2D {}
globalThis.CanvasRenderingContext2D = CanvasRenderingContext2D;

// HTMLCanvasElement - Placeholder class for instanceof checks
class HTMLCanvasElement {}
globalThis.HTMLCanvasElement = HTMLCanvasElement;

// OffscreenCanvas - For type checking
class OffscreenCanvas {
  constructor(width, height) {
    this.width = width || 300;
    this.height = height || 150;
    this._contextType = null;
    this._context = null;
  }

  getContext(type, options) {
    if (type === "2d") {
      // For basic 2D context needs
      if (!this._context) {
        this._context = { canvas: this };
      }
      return this._context;
    }
    return null;
  }
}
globalThis.OffscreenCanvas = OffscreenCanvas;

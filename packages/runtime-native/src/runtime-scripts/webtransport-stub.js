globalThis.WebTransport = class WebTransport {
  constructor() {
    const err = new Error('WebTransport is not supported in this build (quiche not compiled in)');
    this.ready = Promise.reject(err);
    this.closed = Promise.reject(err);
    this.ready.catch(() => {});
    this.closed.catch(() => {});
  }
  close() {}
};

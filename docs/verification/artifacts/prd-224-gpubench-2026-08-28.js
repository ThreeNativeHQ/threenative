// Prices one JS -> WebGPU binding round trip. Identical file in the native host and in Chrome.
(async () => {
  const adapter = await navigator.gpu.requestAdapter();
  const device = await adapter.requestDevice();
  const buf = device.createBuffer({ size: 256, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const data = new Float32Array(4);
  // PRD-224 phase 2: price the beginRenderPass round trip (the call that creates a
  // GPURenderPassEncoder and, on the legacy path, installs its whole method table).
  // begin+end per iteration: a pass left open across the loop is unbounded resource
  // growth in both engines, and end() must be paid for the encoder to stay usable.
  const passTexture = device.createTexture({ size: [4, 4], format: 'rgba8unorm', usage: GPUTextureUsage.RENDER_ATTACHMENT });
  const passView = passTexture.createView();
  const passEncoder = device.createCommandEncoder();
  const passDescriptor = {
    colorAttachments: [{ view: passView, clearValue: { r: 0, g: 0, b: 0, a: 1 }, loadOp: 'clear', storeOp: 'store' }],
  };
  const N = 200000;
  const bench = (label, fn) => {
    for (let i = 0; i < 2000; i++) fn(i);          // warm the JIT and the binding path
    const t0 = performance.now();
    for (let i = 0; i < N; i++) fn(i);
    const t1 = performance.now();
    console.log(`GPUBENCH\t${label}\t${(((t1 - t0) * 1e6) / N).toFixed(0)}`);   // ns per call
  };
  bench("writeBuffer-16B", () => device.queue.writeBuffer(buf, 0, data));
  bench("createCommandEncoder", () => device.createCommandEncoder());
  bench("beginRenderPass+end", () => { const pass = passEncoder.beginRenderPass(passDescriptor); pass.end(); });
  bench("buffer.size-getter", () => buf.size);
  console.log("GPUBENCH_DONE");
})();

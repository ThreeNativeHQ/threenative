/** Game-owned shader dispatch. Compilation stays inside the caller's validation/error scopes. */
export class ImageKernel {
  #pipeline: GPUComputePipeline | undefined;
  #closed = false;
  constructor(
    private readonly device: GPUDevice,
    private readonly code: string,
    private readonly entryPoint: string,
  ) {}

  encode(encoder: GPUCommandEncoder, entries: GPUBindGroupEntry[], width: number, height: number): void {
    if (this.#closed) throw new Error("NEURAL_CLOSED: image kernel disposed");
    if (this.#pipeline === undefined) {
      this.#pipeline = this.device.createComputePipeline({
        label: this.entryPoint, layout: "auto",
        compute: { module: this.device.createShaderModule({ label: this.entryPoint, code: this.code }),
          entryPoint: this.entryPoint },
      });
    }
    const group = this.device.createBindGroup({ layout: this.#pipeline.getBindGroupLayout(0), entries });
    const pass = encoder.beginComputePass({ label: this.entryPoint });
    pass.setPipeline(this.#pipeline);
    pass.setBindGroup(0, group);
    pass.dispatchWorkgroups(Math.ceil(width / 8), Math.ceil(height / 8));
    pass.end();
  }

  dispose(): void { this.#closed = true; this.#pipeline = undefined; }
}

export function validateImagePair(original: GPUTexture, enhanced: GPUTexture, width: number, height: number): void {
  if (original === enhanced) throw new Error("NEURAL_TEXTURE: input and output must not alias");
  for (const [texture, usage] of [[original, 4], [enhanced, 8]] as const) {
    if (texture.width !== width || texture.height !== height || texture.format !== "rgba16float" ||
        texture.sampleCount !== 1 || texture.dimension !== "2d" || texture.depthOrArrayLayers !== 1 ||
        (texture.usage & usage) !== usage) throw new Error("NEURAL_TEXTURE: incompatible frame texture");
  }
}

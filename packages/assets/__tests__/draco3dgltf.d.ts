/** Minimal surface of the untyped draco3dgltf module the model pass and its tests use. */
declare module "draco3dgltf" {
  /** Creates a WASM Draco encoder module (resolves once the WASM is instantiated). */
  export function createEncoderModule(): Promise<unknown>;
  /** Creates a WASM Draco decoder module (resolves once the WASM is instantiated). */
  export function createDecoderModule(): Promise<unknown>;
}

import { fileURLToPath } from "node:url";

/**
 * Paths to three's shipped Basis transcoder inside this workspace, for tests that inject a
 * `transcoder` option instead of resolving it from a temp project directory.
 */
export function basisTranscoderPaths(): {
  javascriptPath: string;
  wasmPath: string;
} {
  const directory = new URL(
    "../packages/core/node_modules/three/examples/jsm/libs/basis/",
    import.meta.url,
  );
  return {
    javascriptPath: fileURLToPath(new URL("basis_transcoder.js", directory)),
    wasmPath: fileURLToPath(new URL("basis_transcoder.wasm", directory)),
  };
}

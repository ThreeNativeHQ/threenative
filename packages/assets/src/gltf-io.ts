import { type Document, type GLTF, NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { MeshoptDecoder } from "meshoptimizer";
import { TNVirtualGeometry } from "./virtual/extension.js";

const DRACO_EXTENSION = "KHR_draco_mesh_compression";

/** Reads the glTF JSON header out of a `.glb`/`.gltf` buffer without full parsing. */
export function peekExtensions(input: Buffer): ReadonlySet<string> {
  try {
    const json =
      input.subarray(0, 4).toString("ascii") === "glTF"
        ? (JSON.parse(
            input.subarray(20, 20 + input.readUInt32LE(12)).toString("utf8"),
          ) as GLTF.IGLTF)
        : (JSON.parse(input.toString("utf8")) as GLTF.IGLTF);
    return new Set([...(json.extensionsUsed ?? []), ...(json.extensionsRequired ?? [])]);
  } catch {
    // Full parsing reports malformed input with a proper named error; the peek only
    // decides which codecs to prepare.
    return new Set();
  }
}

/**
 * The one reader every pass that opens a source model shares.
 *
 * Registers every glTF-Transform extension plus this package's own virtual-geometry extension,
 * and the codecs a compressed input needs: the Meshopt decoder always (its WebAssembly module is
 * awaited first — registering it before it instantiates does not fail, it fails later inside the
 * reader as an unreadable-file error on a well-formed file), Draco only when the header names
 * it, so projects without a Draco input never pay for the codec.
 *
 * The health report once built its own bare `NodeIO` and refused every Meshopt-compressed
 * source — which is what an asset importer or a previous compile writes — with
 * `Please install extension dependency, "meshopt.decoder"`, killing `models: "none"` builds
 * from a report that only measures.
 */
export async function createGltfReader(input: Buffer): Promise<NodeIO> {
  await MeshoptDecoder.ready;
  let io = new NodeIO()
    .registerExtensions([...ALL_EXTENSIONS, TNVirtualGeometry])
    .registerDependencies({ "meshopt.decoder": MeshoptDecoder });
  if (peekExtensions(input).has(DRACO_EXTENSION)) {
    const { createDecoderModule } = await import("draco3dgltf");
    io = io.registerDependencies({ "draco3d.decoder": await createDecoderModule() });
  }
  return io;
}

/**
 * Parse a self-contained `.glb` or `.gltf` buffer. Throws the reader's own error; callers wrap
 * it with their `TN_ASSETS_MODEL_UNREADABLE` message so the failure names the pass and the file.
 */
export async function readGltfDocument(io: NodeIO, input: Buffer): Promise<Document> {
  // readJSON resolves to the Document itself; binaryToJSON only unwraps the container.
  if (input.subarray(0, 4).toString("ascii") === "glTF") {
    return io.readJSON(await io.binaryToJSON(input));
  }
  return io.readJSON({ json: JSON.parse(input.toString("utf8")) as GLTF.IGLTF, resources: {} });
}

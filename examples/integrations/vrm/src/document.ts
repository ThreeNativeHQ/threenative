export interface IAvatarDocument {
  readonly kind: "gltf" | "vrm1";
  readonly json: Record<string, unknown>;
}
function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
/** Validates the container and supported format boundary. This is not a complete glTF validator. */
export function inspectAvatarDocument(bytes: Uint8Array): IAvatarDocument {
  if (!bytes.length) throw new Error("VRM asset is empty.");
  let jsonBytes = bytes;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length >= 4 && view.getUint32(0, true) === 0x46546c67) {
    if (
      bytes.length < 20 ||
      view.getUint32(4, true) !== 2 ||
      view.getUint32(8, true) !== bytes.length
    )
      throw new Error("VRM GLB header has an unsupported version or invalid length.");
    let offset = 12;
    let jsonSeen = false;
    let binarySeen = false;
    while (offset < bytes.length) {
      if (offset + 8 > bytes.length) throw new Error("VRM GLB chunk header is truncated.");
      const length = view.getUint32(offset, true);
      const type = view.getUint32(offset + 4, true);
      if (length % 4 || offset + 8 + length > bytes.length)
        throw new Error("VRM GLB chunk length is invalid.");
      if (offset === 12 && type !== 0x4e4f534a)
        throw new Error("VRM GLB first chunk must be JSON.");
      if (type === 0x4e4f534a) {
        if (jsonSeen) throw new Error("VRM GLB has duplicate JSON chunks.");
        jsonSeen = true;
        jsonBytes = bytes.subarray(offset + 8, offset + 8 + length);
      } else if (type === 0x004e4942) {
        if (binarySeen) throw new Error("VRM GLB has duplicate binary chunks.");
        binarySeen = true;
      }
      offset += 8 + length;
    }
    if (!jsonSeen) throw new Error("VRM GLB is missing JSON.");
  }
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(jsonBytes));
  } catch (cause) {
    throw new Error("VRM asset has invalid UTF-8 or JSON.", { cause });
  }
  if (!record(value) || !record(value.asset) || value.asset.version !== "2.0")
    throw new Error("VRM requires a glTF 2.0 document.");
  if (value.extensions !== undefined && !record(value.extensions))
    throw new Error("VRM extensions must be an object.");
  const extensions = value.extensions as Record<string, unknown> | undefined;
  if (extensions && "VRM" in extensions)
    throw new Error("Legacy VRM 0.x is not supported by this integration.");
  if (!extensions || !("VRMC_vrm" in extensions)) return { kind: "gltf", json: value };
  const vrm = extensions.VRMC_vrm;
  if (!record(vrm) || vrm.specVersion !== "1.0")
    throw new Error("VRM spec version must be exactly 1.0.");
  if (
    !record(vrm.meta) ||
    typeof vrm.meta.name !== "string" ||
    !Array.isArray(vrm.meta.authors) ||
    vrm.meta.authors.length === 0 ||
    vrm.meta.authors.some((author) => typeof author !== "string" || !author.trim())
  )
    throw new Error("VRM metadata must name the avatar and its authors.");
  if (!record(vrm.humanoid) || !record(vrm.humanoid.humanBones))
    throw new Error("VRM humanoid bone mapping is required.");
  return { kind: "vrm1", json: value };
}

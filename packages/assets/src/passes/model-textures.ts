import type { Document, Texture } from "@gltf-transform/core";
import { KHRTextureBasisu } from "@gltf-transform/extensions";
import { getTextureColorSpace, listTextureInfo, listTextureSlots } from "@gltf-transform/functions";
import { read as readKTX2 } from "ktx-parse";
import { encodeToKTX2 } from "ktx2-encoder";
import { textureStats } from "../health.js";
import { decodeImageBytes } from "./decode-image.js";
import type { TextureCodec } from "./texture.js";

/**
 * Compresses the images embedded *inside* a `.glb` — the half of a model the geometry passes
 * never touched. A prop carrying three 2048x2048 JPEGs is a small file and 67 MB of VRAM once
 * the driver decodes it; meshopt shrinks the other, cheaper half. This stage transcodes each
 * embedded image to KTX2/Basis and declares `KHR_texture_basisu`, so the GPU stores blocks
 * instead of RGBA, and caps the resolution so a 4K texture an image model produced cannot
 * silently eat a phone's whole budget.
 *
 * Codec choice follows the declared use of the image, never a guess: a config override on the
 * glTF slot wins, then normal-map slots (UASTC survives normal data; ETC1S does not), then
 * alpha in the decoded pixels. Colour space comes from the slot too — `getTextureColorSpace`
 * knows base colour and emissive are sRGB and that metallic-roughness and normals are data —
 * so a linear map is never encoded through a perceptual metric.
 *
 * The encoder is the same in-process Basis WASM the standalone texture pass uses, so no new
 * dependency and nothing extra to install. Everything fails closed: an image no decoder reads,
 * an image whose dimensions are not a whole number of 4x4 blocks, and a texture whose binding
 * did not survive the round trip all throw naming the model and the image.
 */

export interface IModelTextureOverride {
  readonly codec: TextureCodec;
  /** glTF slot the override applies to, e.g. `normalTexture` or `baseColorTexture`. */
  readonly slot: string;
}

export interface IModelTexturesOptions {
  /**
   * Longest edge an embedded image may keep, default 2048. Larger images are box-resampled
   * down preserving aspect ratio; smaller ones are never upscaled.
   */
  readonly maxSize?: number;
  readonly overrides?: readonly IModelTextureOverride[];
  /** ETC1S encoder quality 1–255, default 150. Ignored for UASTC. */
  readonly quality?: number;
}

/** What the stage did, recorded in the manifest and printed by the size report. */
export interface IEmbeddedTextureSummary {
  readonly bytesAfter: number;
  readonly bytesBefore: number;
  readonly count: number;
  /** Chosen codec per embedded image, keyed by texture name. */
  readonly formats: Readonly<Record<string, string>>;
  readonly gpuBytesAfter: number;
  readonly gpuBytesBefore: number;
  /** How many images the resolution cap actually downsampled. */
  readonly resized: number;
}

/** One embedded image as the verification compares it, source against re-read output. */
export interface IModelTextureBinding {
  readonly height: number;
  readonly key: string;
  /** KTX2 mip levels; 1 for a still-uncompressed source image. */
  readonly levels: number;
  readonly mimeType: string;
  readonly slots: readonly string[];
  readonly texCoords: readonly number[];
  readonly width: number;
}

export interface IModelTextureBindings {
  /** `material -> slot=textureIndex@uvN` for the five core glTF slots, in document order. */
  readonly materials: readonly string[];
  readonly textures: readonly IModelTextureBinding[];
}

type RootOf = ReturnType<Document["getRoot"]>;

const DEFAULT_MAX_SIZE = 2048;
const DEFAULT_ETC1S_QUALITY = 150;
/** BC1, BC7, ETC2 and ASTC 4x4 all address pixels in 4x4 blocks. */
const BLOCK_SIZE = 4;
/** A full mip pyramid is 4/3 of the base level. */
const MIP_FACTOR = 4 / 3;
/** Bytes per pixel of the format each codec transcodes to on a desktop GPU. */
const GPU_BYTES_PER_PIXEL: Readonly<Record<string, number>> = {
  // BC1 from ETC1S, BC7 from UASTC, RGBA8 for anything left uncompressed.
  etc1s: 0.5,
  none: 4,
  uastc: 1,
};

/** Slots whose content is a tangent-space normal: data, and ETC1S destroys it. */
const NORMAL_SLOTS: ReadonlySet<string> = new Set(["clearcoatNormalTexture", "normalTexture"]);

/** The five slots every glTF material declares directly; extension slots are covered by
 * the per-texture `slots` snapshot, which walks whatever parents actually reference it. */
const CORE_SLOTS = [
  "baseColorTexture",
  "emissiveTexture",
  "metallicRoughnessTexture",
  "normalTexture",
  "occlusionTexture",
] as const;

type CoreSlot = (typeof CORE_SLOTS)[number];

type MaterialOf = ReturnType<RootOf["listMaterials"]>[number];

function coreSlotTexture(material: MaterialOf, slot: CoreSlot): Texture | null {
  switch (slot) {
    case "baseColorTexture":
      return material.getBaseColorTexture();
    case "emissiveTexture":
      return material.getEmissiveTexture();
    case "metallicRoughnessTexture":
      return material.getMetallicRoughnessTexture();
    case "normalTexture":
      return material.getNormalTexture();
    default:
      return material.getOcclusionTexture();
  }
}

function coreSlotTexCoord(material: MaterialOf, slot: CoreSlot): number | undefined {
  switch (slot) {
    case "baseColorTexture":
      return material.getBaseColorTextureInfo()?.getTexCoord();
    case "emissiveTexture":
      return material.getEmissiveTextureInfo()?.getTexCoord();
    case "metallicRoughnessTexture":
      return material.getMetallicRoughnessTextureInfo()?.getTexCoord();
    case "normalTexture":
      return material.getNormalTextureInfo()?.getTexCoord();
    default:
      return material.getOcclusionTextureInfo()?.getTexCoord();
  }
}

/** Stable per-texture key: the authored name, disambiguated by index when it is not unique. */
export function textureKeys(root: RootOf): readonly string[] {
  const textures = root.listTextures();
  const seen = new Map<string, number>();
  return textures.map((texture, index) => {
    const name = texture.getName();
    const base = name === "" ? `texture#${String(index)}` : name;
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    return count === 0 ? base : `${base}#${String(index)}`;
  });
}

/** Dimensions and mip levels of an embedded image, whichever container it is in. */
function imageShape(
  bytes: Uint8Array,
  mimeType: string,
): { height: number; levels: number; width: number } {
  if (mimeType === "image/ktx2") {
    const container = readKTX2(bytes);
    return {
      height: container.pixelHeight,
      levels: container.levelCount,
      width: container.pixelWidth,
    };
  }
  const stats = textureStats(Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength));
  return { height: stats.height, levels: 1, width: stats.width };
}

/**
 * Snapshot of every embedded image and the material slots that bind it. Taken before the
 * stage runs and again from the re-read output, so a texture the encoder or the writer
 * silently dropped, rebound or moved to another UV set fails the build.
 */
export function textureBindings(root: RootOf): IModelTextureBindings {
  const textures = root.listTextures();
  const keys = textureKeys(root);
  return {
    materials: root.listMaterials().flatMap((material, materialIndex) => {
      const name = material.getName();
      const label = name === "" ? `material#${String(materialIndex)}` : name;
      return CORE_SLOTS.flatMap((slot) => {
        const texture = coreSlotTexture(material, slot);
        if (texture === null) return [];
        const index = textures.indexOf(texture);
        const texCoord = coreSlotTexCoord(material, slot) ?? 0;
        return [`${label}.${slot}=${String(index)}@uv${String(texCoord)}`];
      });
    }),
    textures: textures.map((texture, index) => {
      const image = texture.getImage();
      const mimeType = texture.getMimeType();
      const shape =
        image === null ? { height: 0, levels: 0, width: 0 } : imageShape(image, mimeType);
      return {
        height: shape.height,
        key: keys[index] ?? `texture#${String(index)}`,
        levels: shape.levels,
        mimeType,
        slots: [...listTextureSlots(texture)].sort(),
        texCoords: [...new Set(listTextureInfo(texture).map((info) => info.getTexCoord()))].sort(
          (left, right) => left - right,
        ),
        width: shape.width,
      };
    }),
  };
}

function describeBinding(binding: IModelTextureBinding): string {
  return `${binding.key} (${binding.mimeType} ${String(binding.width)}x${String(binding.height)}, slots ${binding.slots.join("+") || "none"}, uv ${binding.texCoords.join("+") || "none"})`;
}

/**
 * Compares the re-read output against what went in and throws naming the difference. The
 * existing geometry self-verify proves no mesh was lost; this proves no *image* was, and
 * that every one is still bound to the same slot on the same material with the same UV set.
 */
export function assertNoTextureDrift(
  source: IModelTextureBindings,
  output: IModelTextureBindings,
  logicalPath: string,
): void {
  const failures: string[] = [];
  if (source.textures.length !== output.textures.length) {
    failures.push(
      `texture count ${String(source.textures.length)} -> ${String(output.textures.length)}`,
    );
  }
  const count = Math.min(source.textures.length, output.textures.length);
  for (let index = 0; index < count; index += 1) {
    const before = source.textures[index];
    const after = output.textures[index];
    if (before === undefined || after === undefined) continue;
    if (before.key !== after.key) {
      failures.push(`texture ${String(index)} renamed ${before.key} -> ${after.key}`);
      continue;
    }
    if (after.levels === 0) {
      failures.push(`${before.key} lost its image`);
      continue;
    }
    if (before.slots.join(",") !== after.slots.join(",")) {
      failures.push(`${describeBinding(before)} -> slots ${after.slots.join("+") || "none"}`);
    }
    if (before.texCoords.join(",") !== after.texCoords.join(",")) {
      failures.push(`${describeBinding(before)} -> uv ${after.texCoords.join("+") || "none"}`);
    }
  }
  const missing = source.materials.filter((binding) => !output.materials.includes(binding));
  const added = output.materials.filter((binding) => !source.materials.includes(binding));
  if (missing.length > 0) failures.push(`material bindings lost: ${missing.join(", ")}`);
  if (added.length > 0) failures.push(`material bindings appeared: ${added.join(", ")}`);
  if (failures.length > 0) {
    throw new Error(
      `TN_ASSETS_MODEL_TEXTURE_DRIFT: embedded-texture self-verification failed for '${logicalPath}': ${failures.join("; ")}.`,
    );
  }
}

/** sRGB decode table; averaging in sRGB space darkens a downsampled colour map. */
const SRGB_TO_LINEAR = new Float32Array(256);
for (let value = 0; value < 256; value += 1) {
  const channel = value / 255;
  SRGB_TO_LINEAR[value] = channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
}

function linearToSrgb(channel: number): number {
  const encoded = channel <= 0.0031308 ? channel * 12.92 : 1.055 * channel ** (1 / 2.4) - 0.055;
  return Math.max(0, Math.min(255, Math.round(encoded * 255)));
}

/**
 * Box-resamples tight RGBA down to the target size, averaging over the exact source area each
 * destination texel covers. Colour channels of an sRGB image are averaged in linear light —
 * the naive average of encoded values is visibly darker — while alpha is always linear.
 */
export function resampleRgba(
  data: Uint8Array,
  width: number,
  height: number,
  targetWidth: number,
  targetHeight: number,
  srgb: boolean,
): Uint8Array {
  const output = new Uint8Array(targetWidth * targetHeight * 4);
  const scaleX = width / targetWidth;
  const scaleY = height / targetHeight;
  for (let ty = 0; ty < targetHeight; ty += 1) {
    const y0 = ty * scaleY;
    const y1 = (ty + 1) * scaleY;
    for (let tx = 0; tx < targetWidth; tx += 1) {
      const x0 = tx * scaleX;
      const x1 = (tx + 1) * scaleX;
      let red = 0;
      let green = 0;
      let blue = 0;
      let alpha = 0;
      let total = 0;
      for (let sy = Math.floor(y0); sy < Math.min(height, Math.ceil(y1)); sy += 1) {
        const weightY = Math.min(y1, sy + 1) - Math.max(y0, sy);
        if (weightY <= 0) continue;
        for (let sx = Math.floor(x0); sx < Math.min(width, Math.ceil(x1)); sx += 1) {
          const weightX = Math.min(x1, sx + 1) - Math.max(x0, sx);
          if (weightX <= 0) continue;
          const weight = weightX * weightY;
          const offset = (sy * width + sx) * 4;
          const r = data[offset] ?? 0;
          const g = data[offset + 1] ?? 0;
          const b = data[offset + 2] ?? 0;
          red += (srgb ? (SRGB_TO_LINEAR[r] ?? 0) : r) * weight;
          green += (srgb ? (SRGB_TO_LINEAR[g] ?? 0) : g) * weight;
          blue += (srgb ? (SRGB_TO_LINEAR[b] ?? 0) : b) * weight;
          alpha += (data[offset + 3] ?? 255) * weight;
          total += weight;
        }
      }
      const divisor = total === 0 ? 1 : total;
      const target = (ty * targetWidth + tx) * 4;
      output[target] = srgb ? linearToSrgb(red / divisor) : Math.round(red / divisor);
      output[target + 1] = srgb ? linearToSrgb(green / divisor) : Math.round(green / divisor);
      output[target + 2] = srgb ? linearToSrgb(blue / divisor) : Math.round(blue / divisor);
      output[target + 3] = Math.round(alpha / divisor);
    }
  }
  return output;
}

/** Longest edge clamped to the cap, aspect preserved, each edge a whole number of blocks. */
export function cappedSize(
  width: number,
  height: number,
  maxSize: number,
): { height: number; width: number } {
  const longest = Math.max(width, height);
  if (longest <= maxSize) return { height, width };
  const scale = maxSize / longest;
  const snap = (value: number): number =>
    Math.max(BLOCK_SIZE, Math.round((value * scale) / BLOCK_SIZE) * BLOCK_SIZE);
  return { height: snap(height), width: snap(width) };
}

function rgbaHasAlpha(rgba: Uint8Array): boolean {
  for (let offset = 3; offset < rgba.length; offset += 4) {
    if ((rgba[offset] ?? 255) !== 255) return true;
  }
  return false;
}

function chooseCodec(
  slots: readonly string[],
  alpha: boolean,
  options: IModelTexturesOptions,
): TextureCodec {
  for (const override of options.overrides ?? []) {
    if (slots.includes(override.slot)) return override.codec;
  }
  if (slots.some((slot) => NORMAL_SLOTS.has(slot))) return "uastc";
  return alpha ? "uastc" : "etc1s";
}

function gpuBytes(width: number, height: number, codec: string): number {
  return Math.round(width * height * (GPU_BYTES_PER_PIXEL[codec] ?? 4) * MIP_FACTOR);
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Transcodes every embedded image in place and returns what it did. Mutates the document:
 * each compressed texture gets KTX2 bytes and the `image/ktx2` mime type, and the document
 * declares `KHR_texture_basisu` as required — a loader without a transcoder cannot read the
 * result, and saying so is the honest declaration.
 */
/** An image the shared store supplied already encoded, with what its source measured. */
export interface IRecalledTexture {
  readonly codec: string;
  readonly sourceBytes: number;
}

export async function compressEmbeddedTextures(
  document: Document,
  logicalPath: string,
  options: IModelTexturesOptions = {},
  recalled: ReadonlyMap<number, IRecalledTexture> = new Map(),
): Promise<IEmbeddedTextureSummary | undefined> {
  const root = document.getRoot();
  const textures = root.listTextures();
  if (textures.length === 0) return undefined;
  const maxSize = options.maxSize ?? DEFAULT_MAX_SIZE;
  const quality = Math.min(255, Math.max(1, Math.round(options.quality ?? DEFAULT_ETC1S_QUALITY)));
  const keys = textureKeys(root);
  const formats: Record<string, string> = {};
  let bytesBefore = 0;
  let bytesAfter = 0;
  let gpuBytesBefore = 0;
  let gpuBytesAfter = 0;
  let resized = 0;
  let compressed = 0;

  for (const [index, texture] of textures.entries()) {
    const key = keys[index] ?? `texture#${String(index)}`;
    const image = texture.getImage();
    if (image === null) {
      throw new Error(
        `TN_ASSETS_MODEL_TEXTURE_MISSING: '${logicalPath}' declares texture '${key}' with no image data.`,
      );
    }
    // Already compressed upstream: left exactly as authored, and still counted so the
    // reported GPU total is the whole model rather than only the part this stage touched.
    if (texture.getMimeType() === "image/ktx2") {
      const shape = imageShape(image, "image/ktx2");
      const fromStore = recalled.get(index);
      if (fromStore !== undefined) {
        // Recalled from the shared store: the summary reports what this model's source carried
        // and what the store's encode saved, exactly as if the encode had run here — so the
        // manifest entry is the same whether the image was encoded or found.
        bytesBefore += fromStore.sourceBytes;
        bytesAfter += image.byteLength;
        gpuBytesBefore += gpuBytes(shape.width, shape.height, "none");
        gpuBytesAfter += gpuBytes(shape.width, shape.height, fromStore.codec);
        formats[key] = fromStore.codec;
        compressed += 1;
        continue;
      }
      bytesBefore += image.byteLength;
      bytesAfter += image.byteLength;
      const already = gpuBytes(shape.width, shape.height, "uastc");
      gpuBytesBefore += already;
      gpuBytesAfter += already;
      continue;
    }

    const slots = listTextureSlots(texture);
    let decoded: { data: Uint8Array; height: number; width: number };
    try {
      decoded = await decodeImageBytes(
        Buffer.from(image.buffer, image.byteOffset, image.byteLength),
        `${logicalPath}#${key}`,
      );
    } catch (error) {
      throw new Error(
        `TN_ASSETS_MODEL_TEXTURE_UNDECODABLE: could not decode embedded texture '${key}' of '${logicalPath}': ${messageOf(error)}`,
      );
    }
    const codec = chooseCodec(slots, rgbaHasAlpha(decoded.data), options);
    bytesBefore += image.byteLength;
    gpuBytesBefore += gpuBytes(decoded.width, decoded.height, "none");
    if (codec === "none") {
      bytesAfter += image.byteLength;
      gpuBytesAfter += gpuBytes(decoded.width, decoded.height, "none");
      formats[key] = "none";
      continue;
    }

    const target = cappedSize(decoded.width, decoded.height, maxSize);
    const srgb = getTextureColorSpace(texture) === "srgb";
    let data = decoded.data;
    if (target.width !== decoded.width || target.height !== decoded.height) {
      data = resampleRgba(
        decoded.data,
        decoded.width,
        decoded.height,
        target.width,
        target.height,
        srgb,
      );
      resized += 1;
    }
    if (target.width % BLOCK_SIZE !== 0 || target.height % BLOCK_SIZE !== 0) {
      throw new Error(
        `TN_ASSETS_MODEL_TEXTURE_BLOCK_SIZE: embedded texture '${key}' of '${logicalPath}' is ${String(target.width)}x${String(target.height)}, which is not a multiple of the ${String(BLOCK_SIZE)}x${String(BLOCK_SIZE)} block the ${codec} codec transcodes to; WebGPU rejects such a texture at draw time. Resize the source to a multiple of ${String(BLOCK_SIZE)} inside the model, or declare an override with codec "none" for its slot.`,
      );
    }

    const normalMap = slots.some((slot) => NORMAL_SLOTS.has(slot));
    const encoded = await encodeToKTX2(new Uint8Array([0]), {
      generateMipmap: true,
      imageDecoder: async () => ({ data, height: target.height, width: target.width }),
      isPerceptual: srgb,
      isSetKTX2SRGBTransferFunc: srgb,
      ...(codec === "uastc"
        ? { isUASTC: true, ...(normalMap ? { isNormalMap: true } : {}) }
        : { isUASTC: false, qualityLevel: quality }),
    });
    const container = readKTX2(encoded);
    if (container.levelCount < 2) {
      throw new Error(
        `TN_ASSETS_MIP_CHAIN_INCOMPLETE: embedded texture '${key}' of '${logicalPath}' encoded without a mip chain (${String(container.levelCount)} level(s)).`,
      );
    }
    texture.setImage(encoded).setMimeType("image/ktx2");
    formats[key] = codec;
    bytesAfter += encoded.byteLength;
    gpuBytesAfter += gpuBytes(target.width, target.height, codec);
    compressed += 1;
  }

  if (compressed > 0) {
    // Required, not merely used: a reader with no Basis transcoder cannot draw this model,
    // and a glTF that pretends otherwise fails at the first frame instead of at load.
    document.createExtension(KHRTextureBasisu).setRequired(true);
  }
  return {
    bytesAfter,
    bytesBefore,
    count: textures.length,
    formats,
    gpuBytesAfter,
    gpuBytesBefore,
    resized,
  };
}

import { read as readKTX2 } from "ktx-parse";
import { type IAssetPass, type IAssetPassOutput, classify } from "../compile.js";
import { textureStats } from "../health.js";
import { encodeToKTX2 } from "../ktx2-encoder.js";
import { decodeImageBytes } from "./decode-image.js";
import { globMatch } from "./glob.js";
import { cappedSize, resampleRgba } from "./model-textures.js";

/**
 * Encodes compiled textures to KTX2/Basis so the GPU stores them compressed instead of as
 * decoded RGBA (a 2048x2048 PNG is 16 MB in VRAM; BC7/ASTC hold it in a quarter of that).
 *
 * Codec choice is a declared property of the asset, never a guess: a config override wins,
 * then the `*_normal.*` / `_nrm.*` filename convention, then alpha presence (UASTC keeps
 * exact alpha and survives normal-map data; ETC1S does not). Mip chains are generated at
 * encode time — always — because an uploaded compressed texture without mips looks worse
 * than the PNG it replaced.
 *
 * The encoder is Basis Universal through `ktx2-encoder`'s in-process WASM build; users
 * install nothing extra. Sources it cannot decode (anything but PNG/JPEG today) fail the
 * build naming the file rather than shipping uncompressed behind the user's back.
 */

export type TextureCodec = "etc1s" | "none" | "uastc";

/**
 * Why a source shipped uncompressed although its pass ran. `not-smaller` means encoding would
 * have grown the download; `block-size` means no block codec can address the source's
 * dimensions. Both keep the authored bytes; neither is a silent decision — the manifest carries
 * the reason and the report prints it.
 */
export type TextureSkipReason = "block-size" | "not-smaller";

export interface ITextureOverride {
  readonly codec: TextureCodec;
  /** First matching override wins; matched against the logical path, e.g. "ui/x.png". */
  readonly glob: string;
  /** ETC1S encoder quality 1–255. Ignored for UASTC, which uses its own fixed defaults. */
  readonly quality?: number;
}

export interface ITexturePassOptions {
  /** Longest edge to retain; larger sources are downsampled without upscaling. */
  readonly maxSize?: number;
  readonly overrides?: readonly ITextureOverride[];
  /** ETC1S encoder quality 1–255, default 150. Ignored for UASTC. */
  readonly quality?: number;
}

/** Formats three transcodes to per codec, recorded in the manifest next to `format`. */
const TRANSCODE_TARGETS: Readonly<Record<Exclude<TextureCodec, "none">, readonly string[]>> = {
  etc1s: ["bc1", "etc2"],
  uastc: ["astc4x4", "bc7"],
};

const DEFAULT_ETC1S_QUALITY = 150;
/** BC1, BC7, ETC2 and ASTC 4x4 all address pixels in 4x4 blocks. */
const BLOCK_SIZE = 4;
/** Normal maps are data, not colour: no sRGB transfer function, non-perceptual encode. */
const NORMAL_MAP_BASENAME = /(?:^|[_-])(?:normal|nrm)$/iu;

export async function encodeLinearRgbaKtx2(
  data: Uint8Array,
  width: number,
  height: number,
): Promise<Buffer> {
  const encoded = await encodeToKTX2(new Uint8Array([0]), {
    generateMipmap: true,
    imageDecoder: async () => ({ data, height, width }),
    isPerceptual: false,
    isSetKTX2SRGBTransferFunc: false,
    isUASTC: false,
    qualityLevel: DEFAULT_ETC1S_QUALITY,
  });
  const container = readKTX2(encoded);
  if (container.levelCount < 2) {
    throw new Error(
      `TN_ASSETS_MIP_CHAIN_INCOMPLETE: generated lightmap encoded without a mip chain (${String(container.levelCount)} level(s)).`,
    );
  }
  return Buffer.from(encoded);
}

/**
 * Encodes source textures as mipmapped KTX2/Basis data and declares their runtime transcode targets.
 * @constraint every compressed source width and height must be divisible by 4 because BC7, BC1, ETC2, and ASTC 4x4 use 4x4 blocks; WebGPU rejects an unaligned texture at draw time
 * @constraint automatic cooking retains an unaligned source unchanged and reports block-size; an explicit compression codec override fails, while codec "none" remains available
 * @example const pass = texturePass({ overrides: [{ glob: "ui/*", codec: "none" }] });
 */
export function texturePass(options: ITexturePassOptions = {}): IAssetPass {
  return {
    configuration: {
      keepSmallerSource: true,
      ...(options.maxSize === undefined ? {} : { maxSize: options.maxSize }),
      overrides: options.overrides ?? [],
      quality: options.quality ?? DEFAULT_ETC1S_QUALITY,
    },
    apply: async (input: Buffer, logicalPath: string): Promise<Buffer | IAssetPassOutput> => {
      if (classify(logicalPath) !== "texture") return input;
      const stats = textureStats(input);
      if (stats.width <= 0 || stats.height <= 0) {
        throw new Error(
          `TN_ASSETS_TEXTURE_UNREADABLE: '${logicalPath}' has no readable PNG/JPEG header; the KTX2 pass cannot encode it.`,
        );
      }
      // Decoded up front so the codec is chosen from the alpha actually present in the
      // pixels, not from the container colour type every RGBA PNG carries; the memoised
      // result feeds the encoder, so the source is decoded exactly once either way.
      const decoded = await decodeImageBytes(input, logicalPath);
      const choice = chooseCodec(logicalPath, rgbaHasAlpha(decoded.data), options);
      if (choice.codec === "none") return input;
      const { data, resized, target } = resizeForEncoding(
        decoded,
        choice.normalMap,
        options.maxSize,
      );
      // Decided before `encodeToKTX2`, because Basis accepts an unaligned source and stamps the
      // odd size into the KTX2 header: that silence is how this reached a draw call.
      if (target.width % BLOCK_SIZE !== 0 || target.height % BLOCK_SIZE !== 0) {
        return unalignedOutcome(input, logicalPath, choice.codec, choice.explicit, target);
      }
      const encoded = await encodeToKTX2(
        resized
          ? new Uint8Array([0])
          : new Uint8Array(input.buffer, input.byteOffset, input.byteLength),
        {
          generateMipmap: true,
          imageDecoder: async () => ({ data, height: target.height, width: target.width }),
          ...encodeSettingsFor(choice),
        },
      );
      if (!resized && encoded.byteLength >= input.byteLength && !choice.explicit) {
        return { buffer: input, entry: { compressionSkipped: "not-smaller" } };
      }
      const container = readKTX2(encoded);
      if (container.levelCount < 2) {
        throw new Error(
          `TN_ASSETS_MIP_CHAIN_INCOMPLETE: '${logicalPath}' encoded without a mip chain (${String(container.levelCount)} level(s)).`,
        );
      }
      return {
        buffer: Buffer.from(encoded),
        entry: { format: choice.codec, transcodeTargets: TRANSCODE_TARGETS[choice.codec] },
        outputExtension: ".ktx2",
      };
    },
    name: "ktx2",
  };
}

function resizeForEncoding(
  decoded: { data: Uint8Array; height: number; width: number },
  normalMap: boolean,
  maxSize: number | undefined,
): {
  readonly data: Uint8Array;
  readonly resized: boolean;
  readonly target: { readonly height: number; readonly width: number };
} {
  const target =
    maxSize === undefined
      ? { height: decoded.height, width: decoded.width }
      : cappedSize(decoded.width, decoded.height, Math.floor(maxSize / 4) * 4);
  const resized = target.width !== decoded.width || target.height !== decoded.height;
  return {
    data: resized
      ? resampleRgba(
          decoded.data,
          decoded.width,
          decoded.height,
          target.width,
          target.height,
          !normalMap,
        )
      : decoded.data,
    resized,
    target,
  };
}

/**
 * Every codec here transcodes to a 4x4 block format, and WebGPU refuses a compressed texture
 * whose base level is not a whole number of blocks. Basis encodes an unaligned source without
 * complaint and stamps the odd size into the KTX2 header, so the build reports success and the
 * game dies at its first draw call with a GPUValidationError. Padding would move every UV the
 * model was authored against and resampling would silently change the pixels, so neither is the
 * pipeline's to decide. So an automatic cook — the one every project gets with no `assets` block
 * at all — retains the authored bytes and reports `block-size` rather than ending a build over
 * art nobody asked it to compress. A codec named by an override is a request that cannot be
 * honoured: that names the dimension and the block size, and `codec: "none"` is the way to say
 * it out loud.
 */
function unalignedOutcome(
  input: Buffer,
  logicalPath: string,
  codec: Exclude<TextureCodec, "none">,
  explicit: boolean,
  target: { readonly height: number; readonly width: number },
): IAssetPassOutput {
  if (explicit) {
    throw new Error(
      `TN_ASSETS_TEXTURE_BLOCK_SIZE: '${logicalPath}' is ${target.width}x${target.height}, which is not a multiple of the ${BLOCK_SIZE}x${BLOCK_SIZE} block the ${codec} codec transcodes to (${TRANSCODE_TARGETS[codec].join(", ")}); WebGPU rejects such a texture at draw time. Resize the source to a multiple of ${BLOCK_SIZE}, or declare a texture override with codec "none" for it.`,
    );
  }
  // `resizeForEncoding` only ever lands on multiples of four, so an unaligned target is the
  // source's own size and `input` is exactly the bytes and dimensions that were authored.
  return { buffer: input, entry: { compressionSkipped: "block-size" } };
}

function rgbaHasAlpha(rgba: Uint8Array): boolean {
  for (let offset = 3; offset < rgba.length; offset += 4) {
    if ((rgba[offset] ?? 255) !== 255) return true;
  }
  return false;
}

interface IChosenCodec {
  readonly codec: TextureCodec;
  /** True when an override named this codec, so the pass may not quietly substitute another. */
  readonly explicit: boolean;
  readonly normalMap: boolean;
  readonly quality: number;
}

function chooseCodec(
  logicalPath: string,
  alpha: boolean,
  options: ITexturePassOptions,
): IChosenCodec {
  const normalMap = NORMAL_MAP_BASENAME.test(baseNameOf(logicalPath));
  const fallbackQuality = options.quality ?? DEFAULT_ETC1S_QUALITY;
  for (const override of options.overrides ?? []) {
    if (!globMatch(override.glob, logicalPath)) continue;
    return {
      codec: override.codec,
      explicit: true,
      normalMap,
      quality: clampQuality(override.quality ?? fallbackQuality),
    };
  }
  return {
    codec: alpha || normalMap ? "uastc" : "etc1s",
    explicit: false,
    normalMap,
    quality: clampQuality(fallbackQuality),
  };
}

function encodeSettingsFor(choice: IChosenCodec): Record<string, unknown> {
  if (choice.codec === "none") return {};
  if (choice.codec === "uastc") {
    return {
      isUASTC: true,
      ...(!choice.normalMap
        ? {}
        : // Quality is an ETC1S knob (qualityLevel 1–255); UASTC runs documented defaults.
          { isPerceptual: false, isNormalMap: true, isSetKTX2SRGBTransferFunc: false }),
    };
  }
  return { isUASTC: false, qualityLevel: choice.quality };
}

function clampQuality(quality: number): number {
  return Math.min(255, Math.max(1, Math.round(quality)));
}

function baseNameOf(logicalPath: string): string {
  const file = logicalPath.replaceAll("\\", "/").split("/").pop() ?? logicalPath;
  const dot = file.lastIndexOf(".");
  return dot <= 0 ? file : file.slice(0, dot);
}

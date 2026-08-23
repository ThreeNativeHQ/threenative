import { read as readKTX2 } from "ktx-parse";
import { encodeToKTX2 } from "ktx2-encoder";
import { type IAssetPass, type IAssetPassOutput, classify } from "../compile.js";
import { textureStats } from "../health.js";
import { decodeImageBytes } from "./decode-image.js";
import { globMatch } from "./glob.js";

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

export interface ITextureOverride {
  readonly codec: TextureCodec;
  /** First matching override wins; matched against the logical path, e.g. "ui/x.png". */
  readonly glob: string;
  /** ETC1S encoder quality 1–255. Ignored for UASTC, which uses its own fixed defaults. */
  readonly quality?: number;
}

export interface ITexturePassOptions {
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
/** Normal maps are data, not colour: no sRGB transfer function, non-perceptual encode. */
const NORMAL_MAP_BASENAME = /(?:^|[_-])(?:normal|nrm)$/iu;

export function texturePass(options: ITexturePassOptions = {}): IAssetPass {
  return {
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
      const encoded = await encodeToKTX2(
        new Uint8Array(input.buffer, input.byteOffset, input.byteLength),
        {
          generateMipmap: true,
          imageDecoder: async () => decoded,
          ...encodeSettingsFor(choice),
        },
      );
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

function rgbaHasAlpha(rgba: Uint8Array): boolean {
  for (let offset = 3; offset < rgba.length; offset += 4) {
    if ((rgba[offset] ?? 255) !== 255) return true;
  }
  return false;
}

interface IChosenCodec {
  readonly codec: TextureCodec;
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
      normalMap,
      quality: clampQuality(override.quality ?? fallbackQuality),
    };
  }
  return {
    codec: alpha || normalMap ? "uastc" : "etc1s",
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

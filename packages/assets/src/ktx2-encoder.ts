import BASIS from "../vendor/basis-encoder/basis_encoder.js";

/** Included in both pass and shared-image cache keys whenever encoded bytes can change. */
export const KTX2_ENCODER_VERSION = "basis-v2.5-ldr16m-zstd-v1";

const OUTPUT_HEADER_SLACK = 64 * 1024;
const MAX_SOURCE_TEXELS = 16 * 1024 * 1024;

interface IEncodeOptions {
  readonly generateMipmap?: boolean;
  readonly imageDecoder: (
    input: Uint8Array,
  ) => Promise<{ readonly data: Uint8Array; readonly height: number; readonly width: number }>;
  readonly isNormalMap?: boolean;
  readonly isPerceptual?: boolean;
  readonly isSetKTX2SRGBTransferFunc?: boolean;
  readonly isUASTC?: boolean;
  readonly needSupercompression?: boolean;
  readonly qualityLevel?: number;
}

interface IBasisEncoder {
  delete(): void;
  encode(output: Uint8Array): number;
  setCreateKTX2File(enabled: boolean): void;
  setDebug(enabled: boolean): void;
  setKTX2AndBasisSRGBTransferFunc(enabled: boolean): void;
  setKTX2UASTCSupercompression(enabled: boolean): void;
  setMipGen(enabled: boolean): void;
  setNormalMapPreset(): void;
  setPerceptual(enabled: boolean): void;
  setQualityLevel(quality: number): void;
  setSliceSourceImage(
    slice: number,
    input: Uint8Array,
    width: number,
    height: number,
    sourceType: number,
  ): boolean;
  setTexType(type: number): void;
  setUASTC(enabled: boolean): void;
}

interface IBasisModule {
  readonly BasisEncoder: new () => IBasisEncoder;
  initializeBasis(): void;
}

let modulePromise: Promise<IBasisModule> | undefined;

async function basisModule(): Promise<IBasisModule> {
  modulePromise ??= BASIS().then((value) => {
    const module = value as IBasisModule;
    module.initializeBasis();
    return module;
  });
  return modulePromise;
}

/**
 * Private LDR KTX2 encoder for the asset compiler. Its WASM32 build raises Basis v2.5's
 * conservative LDR ceiling from 12 to 16 Mi texels so an ordinary 4096² source is retained.
 * The codecs and appearance settings remain wholly caller-owned.
 */
export async function encodeToKTX2(
  input: Uint8Array,
  options: IEncodeOptions,
): Promise<Uint8Array> {
  const decoded = await options.imageDecoder(input);
  const texels = decoded.width * decoded.height;
  if (!Number.isSafeInteger(texels) || texels <= 0 || texels > MAX_SOURCE_TEXELS) {
    throw new Error(
      `TN_ASSETS_KTX2_SOURCE_SIZE: ${String(decoded.width)}x${String(decoded.height)} is ${String(texels)} texels; the bundled WASM32 encoder supports 1–${String(MAX_SOURCE_TEXELS)} texels.`,
    );
  }

  const encoder = new (await basisModule()).BasisEncoder();
  try {
    const generateMipmap = options.generateMipmap ?? true;
    encoder.setDebug(false);
    encoder.setUASTC(options.isUASTC ?? true);
    encoder.setCreateKTX2File(true);
    encoder.setKTX2AndBasisSRGBTransferFunc(options.isSetKTX2SRGBTransferFunc ?? true);
    encoder.setMipGen(generateMipmap);
    if (options.isNormalMap === true) encoder.setNormalMapPreset();
    encoder.setQualityLevel(options.qualityLevel ?? 150);
    // Preserve ktx2-encoder@0.6.0's omitted-option default; this is lossless, not UASTC RDO.
    encoder.setKTX2UASTCSupercompression(options.needSupercompression ?? true);
    if (options.isPerceptual !== undefined) encoder.setPerceptual(options.isPerceptual);
    encoder.setTexType(0);

    const accepted = encoder.setSliceSourceImage(
      0,
      new Uint8Array(decoded.data),
      decoded.width,
      decoded.height,
      0,
    );
    if (!accepted) {
      throw new Error(
        `TN_ASSETS_KTX2_SOURCE_REJECTED: the encoder rejected ${String(decoded.width)}x${String(decoded.height)} RGBA input.`,
      );
    }

    const mipFactor = generateMipmap ? 4 / 3 : 1;
    let capacity = Math.ceil(texels * 4 * mipFactor) + OUTPUT_HEADER_SLACK;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const output = new Uint8Array(capacity);
      const byteLength = encoder.encode(output);
      if (byteLength > 0) return output.slice(0, byteLength);
      capacity *= 2;
    }
    throw new Error(
      `TN_ASSETS_KTX2_ENCODE_FAILED: Basis returned no bytes for ${String(decoded.width)}x${String(decoded.height)} input after two output-buffer attempts.`,
    );
  } finally {
    encoder.delete();
  }
}

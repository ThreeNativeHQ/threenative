import { PNG } from "pngjs";
import { parsePng } from "../png.js";

/**
 * Decodes an encoded image's bytes to tight 8-bit RGBA for the Basis encoder, which takes
 * decoded pixels through its Node-side `imageDecoder` hook. Pure-JS decoders on purpose:
 * this package is Node-only and must never grow a native dependency. Containers neither
 * decoder reads throw — a source this step cannot encode fails the build naming the file,
 * never silently ships uncompressed.
 */
export async function decodeImageBytes(
  bytes: Buffer,
  logicalPath: string,
): Promise<{ data: Uint8Array; height: number; width: number }> {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    const { decode } = await import("jpeg-js");
    const image = decode(bytes, { useTArray: true });
    assertRgba(image.data.length, image.width, image.height, logicalPath);
    return { data: new Uint8Array(image.data), height: image.height, width: image.width };
  }
  if (parsePng(bytes) !== undefined) {
    const image = PNG.sync.read(bytes);
    assertRgba(image.data.length, image.width, image.height, logicalPath);
    return { data: new Uint8Array(image.data), height: image.height, width: image.width };
  }
  throw new Error(
    `TN_ASSETS_TEXTURE_CONTAINER: '${logicalPath}' is not a PNG or JPEG the KTX2 encoder can read; convert it to .png or .jpg.`,
  );
}

function assertRgba(length: number, width: number, height: number, logicalPath: string): void {
  if (width <= 0 || height <= 0 || length !== width * height * 4) {
    throw new Error(
      `TN_ASSETS_TEXTURE_UNDECODABLE: '${logicalPath}' did not decode to 8-bit RGBA (${width}x${height}, ${length} bytes).`,
    );
  }
}

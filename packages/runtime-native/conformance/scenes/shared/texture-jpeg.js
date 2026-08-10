import { THREE, assertCondition, startVisualScene } from "./scene-support.js";

const JPEG_HEX =
  "ffd8ffe000104a46494600010100006000600000ffdb00430001010101010101010101010101010101010101010101010101010101010101010101010101010101010101010101010101010101010101010101010101010101ffdb00430101010101010101010101010101010101010101010101010101010101010101010101010101010101010101010101010101010101010101010101010101010101ffc00011080008000803011100021101031101ffc40014000100000000000000000000000000000008ffc40020100001030207000000000000000000000015131416050717232543456365ffc4001501010100000000000000000000000000000207ffc40023110001030302070000000000000000000015141617072444066408181925456365ffda000c03010002110311003f006d58db638c928d6e391c09c6987860bfa14b6edc5f7acbed25990fe31f4df2531cdec9725bbf199a159ad7f7eab2449d7b046832955b1aab52baa501ecb05c1653c949ce993876c29e84091efd7245f0105eff00ffd9";

export function decodeJpegBytes(source = JPEG_HEX) {
  assertCondition(
    typeof source === "string" && source.length % 2 === 0 && /^[0-9a-f]+$/u.test(source),
    "JPEG fixture must be an even-length lowercase hexadecimal string",
  );
  const bytes = new Uint8Array(source.length / 2);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(source.slice(index * 2, index * 2 + 2), 16);
  }
  assertCondition(bytes.length === 393, "JPEG fixture byte length mismatch");
  assertCondition(bytes[0] === 0xff && bytes[1] === 0xd8, "JPEG start marker is missing");
  assertCondition(bytes.at(-2) === 0xff && bytes.at(-1) === 0xd9, "JPEG end marker is missing");
  assertCondition(source.includes("ffc000110800080008"), "JPEG 8x8 frame header is missing");
  assertCondition(source.includes("ffda000c"), "JPEG scan payload is missing");
  return bytes;
}

export function assertJpegBitmap(bitmap) {
  assertCondition(bitmap?.width === 8 && bitmap?.height === 8, "decoded JPEG must be 8x8");
}

export async function startScene(canvas, dimensions) {
  assertCondition(typeof Blob === "function", "Blob must exist for JPEG decode");
  assertCondition(typeof createImageBitmap === "function", "createImageBitmap must exist");
  const blob = new Blob([decodeJpegBytes()], { type: "image/jpeg" });
  assertCondition(blob.type === "image/jpeg" && blob.size === 393, "JPEG Blob is invalid");
  const bitmap = await createImageBitmap(blob);
  assertJpegBitmap(bitmap);

  return startVisualScene(canvas, dimensions, "texture-jpeg", ({ scene }) => {
    const texture = new THREE.CanvasTexture(bitmap);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.magFilter = THREE.NearestFilter;
    texture.minFilter = THREE.NearestFilter;
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(2.25, 2.25),
      new THREE.MeshBasicMaterial({ map: texture }),
    );
    scene.add(mesh);
    return { mesh, texture, bitmap, detail: { width: bitmap.width, height: bitmap.height } };
  });
}

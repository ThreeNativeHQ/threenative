import {
  type CompressedTexture,
  type Material,
  type Mesh,
  type Object3D,
  RGBAFormat,
  Source,
  Texture,
  UnsignedByteType,
} from "three";
import { decompress } from "three/addons/utils/WebGPUTextureUtils.js";

async function starterExportTexture(texture: Texture, slot: string): Promise<Texture> {
  let image = texture.image as {
    data?: unknown;
    width: number;
    height: number;
    decode?: () => Promise<void>;
  } | null;
  if (Reflect.get(texture, "isCompressedTexture"))
    // Use a separate renderer: the legacy renderer is paused and its frame must survive.
    image = (await decompress(texture as CompressedTexture)).image as typeof image;
  if (!image) throw new Error(`TN_VISUAL_TEXTURE_IMAGE_MISSING: ${slot}`);
  if (image.data !== undefined) {
    if (
      texture.format !== RGBAFormat ||
      texture.type !== UnsignedByteType ||
      !(image.data instanceof Uint8Array || image.data instanceof Uint8ClampedArray) ||
      !Number.isSafeInteger(image.width) ||
      !Number.isSafeInteger(image.height) ||
      image.width < 1 ||
      image.height < 1 ||
      image.data.length !== image.width * image.height * 4
    )
      throw new Error(`TN_VISUAL_TEXTURE_RGBA8_REQUIRED: ${slot}`);
    const canvas = document.createElement("canvas");
    canvas.width = image.width;
    canvas.height = image.height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error(`TN_VISUAL_TEXTURE_CANVAS_MISSING: ${slot}`);
    context.putImageData(
      new ImageData(new Uint8ClampedArray(image.data), image.width, image.height),
      0,
      0,
    );
    image = canvas;
  } else if (typeof image.decode === "function") await image.decode();
  if (image === texture.image) return texture;
  const copy = new Texture().copy(texture);
  copy.source = new Source(image);
  copy.format = RGBAFormat;
  copy.type = UnsignedByteType;
  copy.mipmaps = [];
  return copy;
}

/** r185's normal/metal-rough baking calls drawImage even for raw DataTexture images. */
export async function prepareStarterExportTextures(source: Object3D): Promise<void> {
  const materials = new Map<Material, Material>();
  source.traverse((object) => {
    const mesh = object as Mesh;
    if (!mesh.material) return;
    const copy = (material: Material) => {
      let result = materials.get(material);
      if (!result) {
        result = material.clone();
        materials.set(material, result);
      }
      return result;
    };
    mesh.material = Array.isArray(mesh.material) ? mesh.material.map(copy) : copy(mesh.material);
  });
  const textures = new Map<Texture, Texture>();
  for (const material of materials.values()) {
    for (const [key, value] of Object.entries(material)) {
      if (!value?.isTexture) continue;
      const texture = value as Texture;
      let copy = textures.get(texture);
      if (!copy) {
        copy = await starterExportTexture(texture, key);
        textures.set(texture, copy);
      }
      Reflect.set(material, key, copy);
    }
  }
}

export interface IStarterVisualSnapshot {
  gltf: Record<string, unknown>;
  postGraph: unknown;
  tier: string;
  shadowMap: boolean;
  /** The renderer's own output transform, applied after the installed graph: three's constant and exposure. */
  toneMapping: number;
  toneMappingExposure: number;
  nodes: { name: string; castShadow: boolean; receiveShadow: boolean }[];
  world: {
    textures: {
      node: string;
      width: number;
      height: number;
      mapping: number;
      colorSpace: string;
      flipY: boolean;
      wrapS: number;
      wrapT: number;
      magFilter: number;
      minFilter: number;
    }[];
    background: number | number[] | null;
    environment: number | null;
    backgroundIntensity: number;
    environmentIntensity: number;
    backgroundBlurriness: number;
    backgroundRotation: number[];
    environmentRotation: number[];
    fog: { type: string; color: number[]; near: number; far: number; density: number } | null;
  };
  lights: {
    type: string;
    color: number[];
    intensity: number;
    position: number[];
    target: number[];
    castShadow: boolean;
    shadow: Record<string, number>;
  }[];
  camera: {
    fov: number;
    aspect: number;
    near: number;
    far: number;
    zoom: number;
    position: number[];
    quaternion: number[];
  };
}

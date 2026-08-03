// Ordinary Three.js. Everything a screenshot shows lives here, in the game.
// The palette is read off examples/REFERENCE.png: saturated midday colours,
// warm rock, and faceted shading on anything stony.
import { CanvasTexture, MeshStandardMaterial, RepeatWrapping, SRGBColorSpace } from "three";

/** The orange `?` crate: a painted 96px face with rivets and a hard shadow. */
function questionTexture(): CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 96;
  canvas.height = 96;
  const context = canvas.getContext("2d");
  if (context === null) throw new Error("Question block needs a 2D canvas context.");
  context.fillStyle = "#e79127";
  context.fillRect(0, 0, 96, 96);
  context.fillStyle = "#c26e14";
  context.fillRect(0, 0, 96, 9);
  context.fillRect(0, 87, 96, 9);
  context.fillRect(0, 0, 9, 96);
  context.fillRect(87, 0, 9, 96);
  context.fillStyle = "#f7cd8c";
  for (const [x, y] of [
    [10, 10],
    [78, 10],
    [10, 78],
    [78, 78],
  ] as const) {
    context.beginPath();
    context.arc(x + 4, y + 4, 4.5, 0, Math.PI * 2);
    context.fill();
  }
  context.font = "bold 62px system-ui, sans-serif";
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillStyle = "rgba(120, 62, 8, 0.55)";
  context.fillText("?", 50, 54);
  context.fillStyle = "#fff8ec";
  context.fillText("?", 48, 51);
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  return texture;
}

/** Plank grain: vertical streaks that keep big wooden surfaces from reading flat. */
function plankTexture(): CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 32;
  const context = canvas.getContext("2d");
  if (context === null) throw new Error("Plank grain needs a 2D canvas context.");
  context.fillStyle = "#cf8f4a";
  context.fillRect(0, 0, 128, 32);
  for (let index = 0; index < 26; index += 1) {
    const x = (index * 37) % 128;
    context.fillStyle = index % 2 === 0 ? "rgba(140, 84, 32, 0.22)" : "rgba(255, 216, 168, 0.22)";
    context.fillRect(x, 0, 1 + (index % 3), 32);
  }
  context.fillStyle = "rgba(110, 64, 22, 0.35)";
  context.fillRect(0, 0, 128, 2);
  context.fillRect(0, 30, 128, 2);
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.wrapS = RepeatWrapping;
  texture.wrapT = RepeatWrapping;
  return texture;
}

/** Rock strata: horizontal bands, the layered cliffs under every island. */
function strataTexture(): CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 32;
  canvas.height = 128;
  const context = canvas.getContext("2d");
  if (context === null) throw new Error("Rock strata needs a 2D canvas context.");
  context.fillStyle = "#94897b";
  context.fillRect(0, 0, 32, 128);
  for (const [index, y] of [0, 22, 41, 63, 88, 110].entries()) {
    context.fillStyle = index % 2 === 0 ? "rgba(74, 66, 56, 0.28)" : "rgba(198, 186, 168, 0.3)";
    context.fillRect(0, y, 32, 6 + (index % 3) * 2);
  }
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.wrapS = RepeatWrapping;
  texture.wrapT = RepeatWrapping;
  return texture;
}

export type Materials = ReturnType<typeof createMaterials>;

export function createMaterials() {
  return {
    block: new MeshStandardMaterial({ map: questionTexture(), roughness: 0.62 }),
    cloud: new MeshStandardMaterial({ color: 0xffffff, fog: false, roughness: 1 }),
    coin: new MeshStandardMaterial({
      color: 0xffc72e,
      emissive: 0x7a5300,
      metalness: 0.55,
      roughness: 0.24,
    }),
    cream: new MeshStandardMaterial({ color: 0xfff3e0, roughness: 0.72 }),
    dark: new MeshStandardMaterial({ color: 0x2a1c12, roughness: 0.45 }),
    distant: new MeshStandardMaterial({ color: 0x8fb6d8, fog: false, roughness: 1 }),
    flower: new MeshStandardMaterial({ color: 0xf27ba8, roughness: 0.8 }),
    foxCoat: new MeshStandardMaterial({ color: 0x3b8fe0, roughness: 0.62 }),
    foxCoatDark: new MeshStandardMaterial({ color: 0x2a6db3, roughness: 0.6 }),
    foxFur: new MeshStandardMaterial({ color: 0xf2a13c, roughness: 0.72 }),
    foxFurDark: new MeshStandardMaterial({ color: 0xd8802a, roughness: 0.74 }),
    gem: new MeshStandardMaterial({
      color: 0x4fc3f7,
      emissive: 0x0f5a7a,
      metalness: 0.35,
      roughness: 0.12,
    }),
    grass: new MeshStandardMaterial({ color: 0x62c23c, roughness: 0.94 }),
    grassBright: new MeshStandardMaterial({ color: 0x7ed44f, roughness: 0.9 }),
    grassDark: new MeshStandardMaterial({ color: 0x3f8f2e, roughness: 0.96 }),
    leaf: new MeshStandardMaterial({ color: 0x3f9c34, flatShading: true, roughness: 0.9 }),
    leafDark: new MeshStandardMaterial({ color: 0x2d7a28, flatShading: true, roughness: 0.92 }),
    mushroomCap: new MeshStandardMaterial({ color: 0xe0453a, roughness: 0.62 }),
    pack: new MeshStandardMaterial({ color: 0x2f6fb0, roughness: 0.6 }),
    rock: new MeshStandardMaterial({ flatShading: true, map: strataTexture(), roughness: 1 }),
    rockDark: new MeshStandardMaterial({ color: 0x6d6256, flatShading: true, roughness: 1 }),
    rope: new MeshStandardMaterial({ color: 0xc9a86a, roughness: 0.95 }),
    shell: new MeshStandardMaterial({ color: 0xb3372f, roughness: 0.42 }),
    snail: new MeshStandardMaterial({ color: 0xa8c98a, roughness: 0.8 }),
    trunk: new MeshStandardMaterial({ color: 0x8a5a2b, flatShading: true, roughness: 0.95 }),
    water: new MeshStandardMaterial({
      color: 0x8fe3f7,
      emissive: 0x2b8fb5,
      opacity: 0.82,
      roughness: 0.2,
      transparent: true,
    }),
    wood: new MeshStandardMaterial({ map: plankTexture(), roughness: 0.85 }),
    woodDark: new MeshStandardMaterial({ color: 0xa06a30, roughness: 0.88 }),
  };
}

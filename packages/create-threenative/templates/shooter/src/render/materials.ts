// Generated for you. This is ordinary Three.js — edit or delete it freely.
// ThreeNative does not read this file.
//
// The prototype look every engine ships a new project with: a metre grid on neutral greys, one
// saturated colour for things you can touch, and a metal figure. It reads as "a real engine" only
// because `sky.ts` gives every surface an environment to reflect — roughness then decides how much
// sky a surface mirrors, so keep it varied between neighbours.
import {
  type BufferGeometry,
  DataTexture,
  Float32BufferAttribute,
  LinearMipmapLinearFilter,
  MeshStandardMaterial,
  RepeatWrapping,
  SRGBColorSpace,
  Vector3,
} from "three";
import { palette } from "./palette.js";

/**
 * One metre of grid: a heavy line on the metre, faint lines every 25 cm, a faint per-texel grain so
 * large areas do not band. Built from bytes rather than a canvas so it runs the same in the browser
 * and in the native host.
 */
function gridTexture(base: number, line: number, size = 256): DataTexture {
  const data = new Uint8Array(size * size * 4);
  const minorEvery = size / 4;
  let seed = 7;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const major = x < 3 || y < 3;
      const minor = x % minorEvery < 1 || y % minorEvery < 1;
      const weight = major ? 0.92 : minor ? 0.22 : 0;
      seed = (seed * 16807) % 2147483647;
      const grain = 1 + (seed / 2147483647 - 0.5) * 0.04;
      const index = (y * size + x) * 4;
      for (let channel = 0; channel < 3; channel += 1) {
        const shift = 16 - channel * 8;
        const from = ((base >> shift) & 0xff) * grain;
        const to = (line >> shift) & 0xff;
        data[index + channel] = Math.min(255, Math.round(from * (1 - weight) + to * weight));
      }
      data[index + 3] = 255;
    }
  }
  const texture = new DataTexture(data, size, size);
  texture.colorSpace = SRGBColorSpace;
  texture.wrapS = RepeatWrapping;
  texture.wrapT = RepeatWrapping;
  texture.generateMipmaps = true;
  texture.minFilter = LinearMipmapLinearFilter;
  texture.anisotropy = 16;
  texture.needsUpdate = true;
  return texture;
}

const _normal = new Vector3();

/**
 * Rewrites a geometry's UVs as world metres, projected along each face's dominant axis, so one grid
 * tile is one metre on every face of every prop regardless of its size. Call it after the geometry
 * is translated into place (merged geometry included), before it is given to a mesh.
 */
export function worldGridUVs<T extends BufferGeometry>(geometry: T): T {
  const position = geometry.getAttribute("position");
  const normal = geometry.getAttribute("normal");
  const uv = new Float32Array(position.count * 2);
  for (let index = 0; index < position.count; index += 1) {
    _normal.fromBufferAttribute(normal, index);
    const x = position.getX(index);
    const y = position.getY(index);
    const z = position.getZ(index);
    const ax = Math.abs(_normal.x);
    const ay = Math.abs(_normal.y);
    const az = Math.abs(_normal.z);
    const [u, v] = ay >= ax && ay >= az ? [x, z] : ax >= az ? [z, y] : [x, y];
    uv[index * 2] = u;
    uv[index * 2 + 1] = v;
  }
  geometry.setAttribute("uv", new Float32BufferAttribute(uv, 2));
  return geometry;
}

/** Light grid: floors and the ground. */
export const floorMaterial = new MeshStandardMaterial({
  map: gridTexture(palette.floor, palette.gridLine),
  roughness: 0.62,
  metalness: 0,
});

/** Dark grid: walls, pillars, anything structural. */
export const structureMaterial = new MeshStandardMaterial({
  map: gridTexture(palette.structure, palette.gridLine),
  roughness: 0.7,
  metalness: 0,
});

/** The one saturated colour: things you can push, pick up or stand on. */
export const propMaterial = new MeshStandardMaterial({
  color: palette.prop,
  roughness: 0.45,
  metalness: 0,
});

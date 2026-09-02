import {
  effekseerFire01Layers,
  effekseerFire02Layers,
  effekseerFire03Layers,
  effekseerHoly01Layers,
  effekseerIce01Layers,
  effekseerIce02Layers,
  effekseerIce03Layers,
  effekseerLightning01Layers,
  effekseerLightning02Layers,
  effekseerLightning03Layers,
  healingAuraLayers,
  magicBeamLayers,
  magicOrbLayers,
  magicWispLayers,
} from "./archivePresets.js";
import { type IParticleOptions, createDonorEffect } from "./fireSmokeWeather.js";

export function createMagicWisp(seed = 103): readonly IParticleOptions[] {
  return createDonorEffect(magicWispLayers, seed);
}
export function createMagicOrb(seed = 107): readonly IParticleOptions[] {
  return createDonorEffect(magicOrbLayers, seed);
}
export function createMagicBeam(seed = 109): readonly IParticleOptions[] {
  return createDonorEffect(magicBeamLayers, seed);
}
export function createHealingAura(seed = 113): readonly IParticleOptions[] {
  return createDonorEffect(healingAuraLayers, seed);
}
export function createEffekseerFire01(seed = 127): readonly IParticleOptions[] {
  return createDonorEffect(effekseerFire01Layers, seed);
}
export function createEffekseerFire02(seed = 131): readonly IParticleOptions[] {
  return createDonorEffect(effekseerFire02Layers, seed);
}
export function createEffekseerFire03(seed = 137): readonly IParticleOptions[] {
  return createDonorEffect(effekseerFire03Layers, seed);
}
export function createEffekseerLightning01(seed = 139): readonly IParticleOptions[] {
  return createDonorEffect(effekseerLightning01Layers, seed);
}
export function createEffekseerLightning02(seed = 149): readonly IParticleOptions[] {
  return createDonorEffect(effekseerLightning02Layers, seed);
}
export function createEffekseerLightning03(seed = 151): readonly IParticleOptions[] {
  return createDonorEffect(effekseerLightning03Layers, seed);
}
export function createEffekseerIce01(seed = 157): readonly IParticleOptions[] {
  return createDonorEffect(effekseerIce01Layers, seed);
}
export function createEffekseerIce02(seed = 163): readonly IParticleOptions[] {
  return createDonorEffect(effekseerIce02Layers, seed);
}
export function createEffekseerIce03(seed = 167): readonly IParticleOptions[] {
  return createDonorEffect(effekseerIce03Layers, seed);
}
export function createEffekseerHoly01(seed = 173): readonly IParticleOptions[] {
  return createDonorEffect(effekseerHoly01Layers, seed);
}

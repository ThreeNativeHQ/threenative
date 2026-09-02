import {
  burstFlashLayers,
  effekseerHit01Layers,
  effekseerHit02Layers,
  emberFountainLayers,
  impactSparksLayers,
  muzzleFlashLayers,
  sparkStreaksLayers,
} from "./archivePresets.js";
import { type IParticleOptions, createDonorEffect } from "./fireSmokeWeather.js";

export function createBurstFlash(seed = 71): readonly IParticleOptions[] {
  return createDonorEffect(burstFlashLayers, seed);
}
export function createMuzzleFlash(seed = 73): readonly IParticleOptions[] {
  return createDonorEffect(muzzleFlashLayers, seed);
}
export function createSparkStreaks(seed = 79): readonly IParticleOptions[] {
  return createDonorEffect(sparkStreaksLayers, seed);
}
export function createImpactSparks(seed = 83): readonly IParticleOptions[] {
  return createDonorEffect(impactSparksLayers, seed);
}
export function createEmberFountain(seed = 89): readonly IParticleOptions[] {
  return createDonorEffect(emberFountainLayers, seed);
}
export function createEffekseerHit01(seed = 97): readonly IParticleOptions[] {
  return createDonorEffect(effekseerHit01Layers, seed);
}
export function createEffekseerHit02(seed = 101): readonly IParticleOptions[] {
  return createDonorEffect(effekseerHit02Layers, seed);
}

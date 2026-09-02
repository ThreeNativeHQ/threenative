import {
  godotBloodSplashLayers,
  godotFirefliesLayers,
  godotShieldBreakLayers,
  godotWaterfallMistLayers,
  kenneyConfettiBurstLayers,
  kenneyLeafSwirlLayers,
  kenneySlashArcLayers,
  pixiBubbleStreamLayers,
  pixiCartoonSmokeBlastLayers,
} from "./archivePresets.js";
import { type IParticleOptions, createDonorEffect } from "./fireSmokeWeather.js";

export function createKenneySlashArc(seed = 179): readonly IParticleOptions[] {
  return createDonorEffect(kenneySlashArcLayers, seed);
}
export function createKenneyConfettiBurst(seed = 181): readonly IParticleOptions[] {
  return createDonorEffect(kenneyConfettiBurstLayers, seed);
}
export function createKenneyLeafSwirl(seed = 191): readonly IParticleOptions[] {
  return createDonorEffect(kenneyLeafSwirlLayers, seed);
}
export function createPixiBubbleStream(seed = 193): readonly IParticleOptions[] {
  return createDonorEffect(pixiBubbleStreamLayers, seed);
}
export function createPixiCartoonSmokeBlast(seed = 197): readonly IParticleOptions[] {
  return createDonorEffect(pixiCartoonSmokeBlastLayers, seed);
}
export function createGodotFireflies(seed = 199): readonly IParticleOptions[] {
  return createDonorEffect(godotFirefliesLayers, seed);
}
export function createGodotBloodSplash(seed = 211): readonly IParticleOptions[] {
  return createDonorEffect(godotBloodSplashLayers, seed);
}
export function createGodotShieldBreak(seed = 223): readonly IParticleOptions[] {
  return createDonorEffect(godotShieldBreakLayers, seed);
}
export function createGodotWaterfallMist(seed = 227): readonly IParticleOptions[] {
  return createDonorEffect(godotWaterfallMistLayers, seed);
}

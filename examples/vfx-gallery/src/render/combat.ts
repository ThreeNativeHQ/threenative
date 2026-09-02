import { type IParticleOptions, createArchivedEffect } from "./fireSmokeWeather.js";

export function createBurstFlash(seed = 71): readonly IParticleOptions[] {
  return createArchivedEffect("burst-flash", seed);
}
export function createMuzzleFlash(seed = 73): readonly IParticleOptions[] {
  return createArchivedEffect("muzzle-flash", seed);
}
export function createSparkStreaks(seed = 79): readonly IParticleOptions[] {
  return createArchivedEffect("spark-streaks", seed);
}
export function createImpactSparks(seed = 83): readonly IParticleOptions[] {
  return createArchivedEffect("impact-sparks", seed);
}
export function createEmberFountain(seed = 89): readonly IParticleOptions[] {
  return createArchivedEffect("ember-fountain", seed);
}
export function createEffekseerHit01(seed = 97): readonly IParticleOptions[] {
  return createArchivedEffect("effekseer-hit01", seed);
}
export function createEffekseerHit02(seed = 101): readonly IParticleOptions[] {
  return createArchivedEffect("effekseer-hit02", seed);
}

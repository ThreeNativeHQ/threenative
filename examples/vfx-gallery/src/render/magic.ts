import { type IParticleOptions, createArchivedEffect } from "./fireSmokeWeather.js";

export function createMagicWisp(seed = 103): readonly IParticleOptions[] {
  return createArchivedEffect("magic-wisp", seed);
}
export function createMagicOrb(seed = 107): readonly IParticleOptions[] {
  return createArchivedEffect("magic-orb", seed);
}
export function createMagicBeam(seed = 109): readonly IParticleOptions[] {
  return createArchivedEffect("magic-beam", seed);
}
export function createHealingAura(seed = 113): readonly IParticleOptions[] {
  return createArchivedEffect("healing-aura", seed);
}
export function createEffekseerFire01(seed = 127): readonly IParticleOptions[] {
  return createArchivedEffect("effekseer-fire01", seed);
}
export function createEffekseerFire02(seed = 131): readonly IParticleOptions[] {
  return createArchivedEffect("effekseer-fire02", seed);
}
export function createEffekseerFire03(seed = 137): readonly IParticleOptions[] {
  return createArchivedEffect("effekseer-fire03", seed);
}
export function createEffekseerLightning01(seed = 139): readonly IParticleOptions[] {
  return createArchivedEffect("effekseer-lightning01", seed);
}
export function createEffekseerLightning02(seed = 149): readonly IParticleOptions[] {
  return createArchivedEffect("effekseer-lightning02", seed);
}
export function createEffekseerLightning03(seed = 151): readonly IParticleOptions[] {
  return createArchivedEffect("effekseer-lightning03", seed);
}
export function createEffekseerIce01(seed = 157): readonly IParticleOptions[] {
  return createArchivedEffect("effekseer-ice01", seed);
}
export function createEffekseerIce02(seed = 163): readonly IParticleOptions[] {
  return createArchivedEffect("effekseer-ice02", seed);
}
export function createEffekseerIce03(seed = 167): readonly IParticleOptions[] {
  return createArchivedEffect("effekseer-ice03", seed);
}
export function createEffekseerHoly01(seed = 173): readonly IParticleOptions[] {
  return createArchivedEffect("effekseer-holy01", seed);
}

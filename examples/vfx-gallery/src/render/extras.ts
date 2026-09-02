import { type IParticleOptions, createArchivedEffect } from "./fireSmokeWeather.js";

export function createKenneySlashArc(seed = 179): readonly IParticleOptions[] {
  return createArchivedEffect("kenney-slash-arc", seed);
}
export function createKenneyConfettiBurst(seed = 181): readonly IParticleOptions[] {
  return createArchivedEffect("kenney-confetti-burst", seed);
}
export function createKenneyLeafSwirl(seed = 191): readonly IParticleOptions[] {
  return createArchivedEffect("kenney-leaf-swirl", seed);
}
export function createPixiBubbleStream(seed = 193): readonly IParticleOptions[] {
  return createArchivedEffect("pixi-bubble-stream", seed);
}
export function createPixiCartoonSmokeBlast(seed = 197): readonly IParticleOptions[] {
  return createArchivedEffect("pixi-cartoon-smoke-blast", seed);
}
export function createGodotFireflies(seed = 199): readonly IParticleOptions[] {
  return createArchivedEffect("godot-fireflies", seed);
}
export function createGodotBloodSplash(seed = 211): readonly IParticleOptions[] {
  return createArchivedEffect("godot-blood-splash", seed);
}
export function createGodotShieldBreak(seed = 223): readonly IParticleOptions[] {
  return createArchivedEffect("godot-shield-break", seed);
}
export function createGodotWaterfallMist(seed = 227): readonly IParticleOptions[] {
  return createArchivedEffect("godot-waterfall-mist", seed);
}

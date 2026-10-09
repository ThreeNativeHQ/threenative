/** Bundles a portable game entry against the native engine's imports (PRD-531). */
export function bundleNativeEngine(options: {
  entry: string;
  outfile: string;
  boot?: boolean;
}): Promise<{ outfile: string; bytes: number; profile: { engine: "native"; gameRuntime: "v8" } }>;

/** Cooks a project's assets decoder-free into `<bundle dir>/native/assets.tnpk`; returns that path. */
export function cookNativeEngineAssets(options: {
  project: string;
  outfile: string;
}): Promise<string>;

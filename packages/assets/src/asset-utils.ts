export const ASSET_MANIFEST_NAME = "assets.manifest.json";
export const DEFAULT_ASSET_OUTPUT = "public";
export const DEFAULT_ASSET_SOURCE = "assets";
export function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function packageSourcesMatch(
  localPackageSources: Readonly<Record<string, string>>,
  installedSources: Readonly<Record<string, string | undefined>>,
): boolean {
  return Object.entries(localPackageSources).every(
    ([name, source]) => installedSources[name] === `file:${source}`,
  );
}

export function selectHotReloadServerProject(
  environmentTarget: string | undefined,
  sharedTarget: string | undefined,
): string | undefined {
  return environmentTarget ?? sharedTarget;
}

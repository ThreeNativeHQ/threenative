import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

export type CatalogViolation = { file: string; dependency: string; value: unknown };

export async function catalogViolations(root: string): Promise<CatalogViolation[]> {
  const violations: CatalogViolation[] = [];
  for (const group of ["packages", "examples"]) {
    const directory = path.join(root, group);
    const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const file = path.join(directory, entry.name, "package.json");
      try {
        const manifest = JSON.parse(await readFile(file, "utf8")) as Record<
          string,
          Record<string, unknown>
        >;
        // Peer ranges describe the host application's compatible API surface;
        // they are not resolved by pnpm's catalog and must remain semver ranges.
        for (const section of ["dependencies", "devDependencies"]) {
          const value = manifest[section]?.three;
          if (value !== undefined && value !== "catalog:")
            violations.push({ file, dependency: "three", value });
        }
      } catch {
        // Non-package directories do not participate in the workspace catalog check.
      }
    }
  }
  return violations;
}

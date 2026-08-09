import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const roots = [
  "core",
  "physics",
  "playtest",
  "ui",
  "runtime-native",
  "create-threenative",
] as const;

interface Manifest {
  bin?: Record<string, string>;
  exports?: Record<string, string | Record<string, string>>;
  name: string;
  private?: boolean;
  publishConfig?: { access?: string };
  version: string;
}

async function manifest(root: (typeof roots)[number]): Promise<Manifest> {
  return JSON.parse(
    await readFile(path.resolve("packages", root, "package.json"), "utf8"),
  ) as Manifest;
}

function shippedTargets(value: string | Record<string, string>): string[] {
  return typeof value === "string" ? [value] : Object.values(value);
}

describe("registry publication", () => {
  it("keeps every template package publishable as public npm content", async () => {
    for (const root of roots) {
      const packageJson = await manifest(root);
      expect(packageJson.private, packageJson.name).not.toBe(true);
      expect(packageJson.publishConfig?.access, packageJson.name).toBe("public");
    }
  });

  it("reserves a UI version newer than the immutable legacy registry package", async () => {
    const packageJson = await manifest("ui");
    expect(packageJson.version).toBe("0.1.12");
    for (const template of ["starter", "platformer"]) {
      const templateManifest = JSON.parse(
        await readFile(
          path.resolve("packages", "create-threenative", "templates", template, "package.json"),
          "utf8",
        ),
      ) as { dependencies: Record<string, string> };
      expect(templateManifest.dependencies["@threenative/ui"], template).toBe("0.1.12");
    }
  });

  it("points every explicit export and binary at a built file", async () => {
    for (const root of roots) {
      const packageJson = await manifest(root);
      for (const [entry, value] of Object.entries(packageJson.exports ?? {})) {
        expect(entry, packageJson.name).not.toContain("*");
        for (const target of shippedTargets(value))
          await expect(
            access(path.resolve("packages", root, target)),
            `${packageJson.name} ${entry} -> ${target}`,
          ).resolves.toBeUndefined();
      }
      for (const [name, target] of Object.entries(packageJson.bin ?? {}))
        await expect(
          access(path.resolve("packages", root, target)),
          `${packageJson.name} bin ${name} -> ${target}`,
        ).resolves.toBeUndefined();
    }
  });
});

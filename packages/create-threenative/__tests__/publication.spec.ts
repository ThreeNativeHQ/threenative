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

interface IManifest {
  bin?: Record<string, string>;
  exports?: Record<string, string | Record<string, string>>;
  name: string;
  private?: boolean;
  publishConfig?: { access?: string };
  version: string;
}

async function manifest(root: (typeof roots)[number]): Promise<IManifest> {
  return JSON.parse(
    await readFile(path.resolve("packages", root, "package.json"), "utf8"),
  ) as IManifest;
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
    // `@threenative/ui` 0.1.12 is on the public registry and npm cannot replace a publish, so
    // the package can only ever move above it. Asserted as an ordering against that floor
    // rather than as an equality: pinning the exact version made every release bump fail a
    // test that then says nothing about the constraint it exists to enforce.
    const [major, minor, patch] = packageJson.version.split("-")[0]?.split(".").map(Number) ?? [];
    if (major === undefined || minor === undefined || patch === undefined)
      throw new Error(`Not a three-part version: '${packageJson.version}'.`);
    expect(
      major > 0 || minor > 1 || (minor === 1 && patch > 12),
      `@threenative/ui ${packageJson.version} must be newer than the published 0.1.12`,
    ).toBe(true);
    for (const template of ["starter", "platformer"]) {
      const templateManifest = JSON.parse(
        await readFile(
          path.resolve("packages", "create-threenative", "templates", template, "package.json"),
          "utf8",
        ),
      ) as { dependencies: Record<string, string> };
      // And a template must pin whatever that version is, exactly — a scaffold pinning a
      // version the workspace no longer publishes cannot install.
      expect(templateManifest.dependencies["@threenative/ui"], template).toBe(packageJson.version);
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

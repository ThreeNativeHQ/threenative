import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { renderCapabilityReference } from "../generate-capability-reference.js";

interface IManifestPackageEntry {
  readonly package: string;
}

describe("generated capability reference", () => {
  it("describes every package represented by the manifest", async () => {
    const manifest = JSON.parse(
      await readFile(
        path.join(process.cwd(), "packages/create-threenative/capabilities.json"),
        "utf8",
      ),
    ) as {
      entries: Array<
        IManifestPackageEntry & Parameters<typeof renderCapabilityReference>[0][number]
      >;
    };
    const page = renderCapabilityReference(manifest.entries);
    const description = page.slice(0, page.indexOf("\n## "));
    const packages = [...new Set(manifest.entries.map((entry) => entry.package))].sort();

    expect(packages).toContain("@threenative/assets");
    for (const packageName of packages) {
      expect(description, packageName).toContain(`\`${packageName}\``);
    }
  });
});

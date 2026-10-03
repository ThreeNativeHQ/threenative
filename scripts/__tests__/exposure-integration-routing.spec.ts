import { readFile } from "node:fs/promises";
import { expect, it } from "vitest";

it.each(["exposure", "cold-boot"])(
  "routes actual generated exposure sources to %s",
  async (lane) => {
    const source = await readFile(
      new URL("../../.github/workflows/integration.yml", import.meta.url),
      "utf8",
    );
    const pattern = source.match(new RegExp(`lane ${lane} '([^']+)'`))?.[1];
    expect(pattern).toBeDefined();
    const filter = new RegExp(pattern ?? "(?!)");
    for (const file of [
      "autoExposure",
      "exposure",
      "exposureGraph",
      "exposureReadback",
      "worldEnvironment",
    ]) {
      expect(filter.test(`packages/create-threenative/template-assets/${file}.ts`), file).toBe(
        true,
      );
    }
    for (const file of [
      "autoExposure",
      "exposure",
      "exposureGraph",
      "exposureReadback",
      "worldEnvironment",
    ]) {
      expect(
        filter.test(`packages/create-threenative/templates/starter/src/render/${file}.ts`),
        file,
      ).toBe(true);
    }
    expect(filter.test("packages/create-threenative/template-assets/vegetation.ts")).toBe(false);
    expect(
      filter.test("packages/create-threenative/templates/starter/src/render/lighting.ts"),
    ).toBe(false);
  },
);

/**
 * No shipped template may configure a compile pass off.
 *
 * `templates/starter` and `templates/sailing` both carried `assets: { models: "none", textures:
 * "none" }`, written for two proof files that grew slightly under compression — the PNG is 150
 * bytes and compresses to 542. Scaffolded games inherit that object verbatim and no game revisits
 * it: one shipped 2,003 MB of manifest output containing 53 PNG, 35 JPG and not one `.ktx2`,
 * where the pipeline emits 10.5 MB for every 38 MB of real game texture. A 392-byte regression on
 * a proof asset bought a 27.5 MB one on every real one.
 *
 * `/AGENTS.md`: *if the engine can measure the right value at the point of use, it decides.* The
 * compile step's default is compression on; the template's job is to leave it alone. This gate
 * holds it there, and proves the default actually compiles what the templates ship.
 *
 */

import { readdirSync, statSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { compileAssets } from "@threenative/assets";
import { describe, expect, it } from "vitest";
import { rgbaPng } from "../../../test-support/png.js";
import { makeTempDir } from "../../../test-support/temp-dir.js";
import { basisTranscoderPaths } from "../../../test-support/three-basis.js";
import { loadConfig } from "../src/config.js";
import { createProject } from "../src/index.js";

const templatesRoot = fileURLToPath(new URL("../templates", import.meta.url));
const templates = readdirSync(templatesRoot).filter((entry) =>
  statSync(join(templatesRoot, entry)).isDirectory(),
);

describe("shipped templates", () => {
  it.each(templates)(
    "%s reaches the uncooked budget with an eligible source probe",
    async (template) => {
      const root = await makeTempDir(`threenative-template-budget-${template}-`);
      const { target } = await createProject({ install: false, target: template, template }, root);
      const config = await loadConfig(target);
      await mkdir(join(target, "assets"), { recursive: true });
      await writeFile(join(target, "assets/budget-probe.png"), rgbaPng({ width: 16, height: 16 }));
      // Empty and fully cooked templates should pass any uncooked ceiling. The planted raw
      // source makes the negative control meaningful for every scaffold, including empty kits.
      const options = {
        cwd: target,
        transcoder: basisTranscoderPaths(),
        config: { ...config.assets, textures: "none" as const },
      };
      await expect(compileAssets(options)).resolves.toBeDefined();
      await expect(
        compileAssets({ ...options, config: { ...options.config, budget: 1 } }),
      ).rejects.toThrow("TN_ASSETS_BUDGET_EXCEEDED");
    },
  );

  it("should name at least one template, or this gate is measuring nothing", () => {
    expect(templates.length).toBeGreaterThan(0);
  });

  it.each(templates)("%s should compile with compression on by default", async (template) => {
    const source = await readFile(join(templatesRoot, template, "threenative.config.ts"), "utf8");

    // Narrow on purpose: an override that *configures* a pass is welcome, and only the "none"
    // shorthand — the one that ships bytes as authored forever — is refused here.
    expect(source).not.toMatch(/\bmodels:\s*"none"/u);
    expect(source).not.toMatch(/\btextures:\s*"none"/u);
  });

  it.each(templates)("%s assets should compile under the default config", async (template) => {
    const root = await makeTempDir(`threenative-template-assets-${template}-`);
    const { target } = await createProject({ install: false, target: template, template }, root);
    const config = await loadConfig(target);
    expect(config.assets).toBeUndefined();
    // Exercise the actual scaffold's config seam, including kits with no source assets.
    const result = await compileAssets({
      cwd: target,
      config: config.assets,
      transcoder: basisTranscoderPaths(),
    });
    if (result.written === 0) {
      await expect(
        readFile(path.join(target, "public", "assets.manifest.json")),
      ).rejects.toMatchObject({
        code: "ENOENT",
      });
      return;
    }

    const manifest = JSON.parse(
      await readFile(path.join(target, "public", "assets.manifest.json"), "utf8"),
    ) as { entries: Record<string, { output: string }> };
    expect(Object.keys(manifest.entries).length).toBeGreaterThan(0);
  });
});

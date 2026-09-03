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
 */

import { readdirSync, statSync } from "node:fs";
import { cp, mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { compileAssets } from "@threenative/assets";
import { describe, expect, it } from "vitest";
import { makeTempDir } from "../../../test-support/temp-dir.js";
import { basisTranscoderPaths } from "../../../test-support/three-basis.js";

const templatesRoot = fileURLToPath(new URL("../templates", import.meta.url));
const templates = readdirSync(templatesRoot).filter((entry) =>
  statSync(join(templatesRoot, entry)).isDirectory(),
);

function assetsDirectory(template: string): string | undefined {
  const directory = join(templatesRoot, template, "assets");
  try {
    return statSync(directory).isDirectory() ? directory : undefined;
  } catch {
    return undefined;
  }
}

describe("shipped templates", () => {
  it("should name at least one template, or this gate is measuring nothing", () => {
    expect(templates.length).toBeGreaterThan(0);
  });

  it.each(templates)("%s should not switch a compile pass off", async (template) => {
    const source = await readFile(join(templatesRoot, template, "threenative.config.ts"), "utf8");

    // Narrow on purpose: an override that *configures* a pass is welcome, and only the "none"
    // shorthand — the one that ships bytes as authored forever — is refused here.
    expect(source).not.toMatch(/\bmodels:\s*"none"/u);
    expect(source).not.toMatch(/\btextures:\s*"none"/u);
  });

  it.each(templates)("%s assets should compile under the default config", async (template) => {
    const directory = assetsDirectory(template);
    if (directory === undefined) return;
    const root = await makeTempDir(`threenative-template-assets-${template}-`);
    await mkdir(join(root, "assets"), { recursive: true });
    await cp(directory, join(root, "assets"), { recursive: true });

    // No `config`: exactly the defaults a scaffolded project now gets.
    await compileAssets({ cwd: root, transcoder: basisTranscoderPaths() });

    const manifest = JSON.parse(
      await readFile(path.join(root, "public", "assets.manifest.json"), "utf8"),
    ) as { entries: Record<string, { output: string }> };
    expect(Object.keys(manifest.entries).length).toBeGreaterThan(0);
  });
});

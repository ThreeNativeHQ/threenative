import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The projected-size gate ships on, so every scaffolded project must be told it exists.
 *
 * A convention missing from a template's `AGENTS.md` does not exist: the user's agent reads those
 * files, not this repository's. This fails if the default, its threshold, its project-level knob or
 * its per-object override drops out of any shipped template or its generated `CLAUDE.md` mirror.
 */
const TEMPLATES = path.resolve("packages/create-threenative/templates");
const REQUIRED = [
  { name: "on-by-default threshold", pattern: /0\.5 px/u },
  { name: "project-level threshold knob", pattern: /minimumProjectedPixels/u },
  { name: "per-object override", pattern: /alwaysRender/u },
];

function templateDirectories(): string[] {
  return readdirSync(TEMPLATES, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name !== "template-assets")
    .map((entry) => entry.name)
    .sort();
}

describe("projected-size cull template documentation", () => {
  it("names the default, the knob and the override in every template and its mirror", () => {
    const templates = templateDirectories();
    expect(templates.length).toBeGreaterThan(0);
    for (const template of templates) {
      for (const file of ["AGENTS.md", "CLAUDE.md"] as const) {
        const source = readFileSync(path.join(TEMPLATES, template, file), "utf8");
        for (const { name, pattern } of REQUIRED) {
          expect(source, `${template}/${file} is missing the ${name}`).toMatch(pattern);
        }
      }
    }
  });
});

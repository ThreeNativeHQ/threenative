/**
 * PRD-304 evidence, run by hand and not part of any gate.
 *
 * Proves the default look did not move without relying on a capture: for every template, the
 * `high` preset this branch resolves must deep-equal the `desktopPreset` literal on `origin/main`,
 * and `low` must deep-equal `mobilePreset`. Captures on this machine are not bit-deterministic —
 * two identical runs move 65% of pixels — so the object the chain is handed is the honest subject.
 *
 *   pnpm exec tsx scripts/preset-neutrality.local.ts
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const REPO_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const TEMPLATES = path.join("packages", "create-threenative", "templates");

/**
 * Reduces `origin/main`'s postprocessing module to its preset declarations: every import is
 * dropped (the presets reference none of them) and everything from `export function setupPost`
 * onwards is cut, leaving the constants and the two literals, which are then exported.
 */
function presetModuleSource(template: string): string {
  const original = execFileSync(
    "git",
    ["show", `origin/main:${TEMPLATES}/${template}/src/render/postprocessing.ts`],
    { cwd: REPO_ROOT, encoding: "utf8" },
  );
  const withoutImports = original
    .split("\n")
    .filter((line) => !line.startsWith("import "))
    .join("\n");
  const cut = withoutImports.indexOf("export function setupPost");
  assert.ok(cut > 0, `${template}: no setupPost in the origin/main module`);
  return `${withoutImports.slice(0, cut)}\nexport { desktopPreset, mobilePreset };\n`;
}

async function main(): Promise<void> {
  const scratch = await mkdtemp(path.join(os.tmpdir(), "prd304-neutrality-"));
  const names = execFileSync("git", ["ls-tree", "--name-only", `origin/main:${TEMPLATES}`], {
    cwd: REPO_ROOT,
    encoding: "utf8",
  })
    .split("\n")
    .map((entry) => entry.replace(/\/$/u, ""))
    .filter((entry) => entry.length > 0)
    .sort();
  assert.ok(names.length >= 8, `expected at least 8 templates, saw ${names.length}`);

  let checked = 0;
  for (const template of names) {
    const modulePath = path.join(scratch, `${template}.ts`);
    await writeFile(modulePath, presetModuleSource(template));
    const incumbent = (await import(modulePath)) as {
      desktopPreset: Record<string, unknown>;
      mobilePreset: Record<string, unknown>;
    };
    const { qualityPreset } = (await import(
      path.join(REPO_ROOT, TEMPLATES, template, "src", "render", "quality.ts")
    )) as { qualityPreset: (tier: string) => Record<string, unknown> };

    assert.deepEqual(
      { ...qualityPreset("high") },
      { ...incumbent.desktopPreset },
      `${template}: high tier is not the incumbent desktopPreset`,
    );
    assert.deepEqual(
      { ...qualityPreset("low") },
      { ...incumbent.mobilePreset },
      `${template}: low tier is not the incumbent mobilePreset`,
    );
    console.log(`${template.padEnd(12)} high == origin/main desktopPreset, low == mobilePreset`);
    checked += 1;
  }
  console.log(`\n${checked} templates: the default look at either platform is byte-identical.`);
}

await main();

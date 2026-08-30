#!/usr/bin/env node
// Prints the scenarios in a scaffolded project that prove behaviour without needing a rendered
// frame. golden-path proves that a stranger can scaffold, install, build and play — its runner has
// no GPU, and the pixel scenarios it cannot serve are already covered by test-browser and visuals.
//
// The split is derived from the scenario files, never listed here: a scenario is visual when it
// captures a screenshot or names a baseline image. A hand-maintained list is the drift that leaves
// a newly added pixel scenario running on a machine that cannot render it.
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

const [projectRoot] = process.argv.slice(2);
if (projectRoot === undefined) {
  process.stderr.write("usage: non-visual-scenarios.mjs <project-root>\n");
  process.exit(2);
}
const directory = path.join(projectRoot, "playtests");
const entries = readdirSync(directory).filter((name) => name.endsWith(".playtest.json"));
if (entries.length === 0) {
  process.stderr.write(`no scenarios found in ${directory}\n`);
  process.exit(1);
}

const visual = (source) => {
  const scenario = JSON.parse(source);
  if (scenario.artifacts?.screenshots !== undefined && scenario.artifacts.screenshots !== false)
    return true;
  if (JSON.stringify(scenario.assert ?? {}).includes("baseline")) return true;
  return (scenario.steps ?? []).some((step) => step.screenshot !== undefined);
};

const kept = [];
const skipped = [];
for (const name of entries.sort()) {
  const file = path.join(directory, name);
  (visual(readFileSync(file, "utf8")) ? skipped : kept).push(name);
}
// Never a silent narrowing: what this drops is printed where the job's log will carry it.
process.stderr.write(
  `non-visual scenarios: ${kept.length} kept, ${skipped.length} left to the pixel lanes (${skipped.join(", ")})\n`,
);
if (kept.length === 0) {
  process.stderr.write("every scenario is visual; nothing would run\n");
  process.exit(1);
}
process.stdout.write(kept.map((name) => `playtests/${name}`).join("\n"));

// Fails when the game can reach an authoring-only dependency.
//
// The whole point of the integration is that the generator is a tool, not a runtime: a game that
// loads the cooked GLB must be able to delete `examples/integrations/csg` and keep working. This
// check is that sentence, executable.
//
// Two claims, both cheap and both real:
//   1. the donor packages are not installed into this project at all;
//   2. the built bundles contain no donor module reference.
// A bundler inlines code, so the module name is the marker that survives only when the module was
// actually pulled into the graph. `three-mesh-bvh` is deliberately NOT forbidden: the engine's own
// raycast uses it, so it is a legitimate engine dependency of every game.
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

const FORBIDDEN_PACKAGES = ["three-bvh-csg", "@gltf-transform/core", "gltf-validator"];
const BUNDLE_ROOTS = ["dist/assets", "dist/csg-doorway-native.js"];

const installed = FORBIDDEN_PACKAGES.filter((name) => existsSync(resolve("node_modules", name)));
if (installed.length > 0) {
  console.error(`TN_CSG_AUTHORING_DEPENDENCY_INSTALLED: ${installed.join(", ")}`);
  process.exit(1);
}

function filesAt(root) {
  let stat;
  try {
    stat = statSync(root);
  } catch {
    return [];
  }
  if (!stat.isDirectory()) return [root];
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) =>
    filesAt(join(root, entry.name)),
  );
}

let scanned = 0;
const offenders = [];
for (const root of BUNDLE_ROOTS) {
  for (const file of filesAt(resolve(root))) {
    if (!/\.(js|mjs|css|html)$/u.test(file)) continue;
    scanned += 1;
    const source = readFileSync(file, "utf8");
    for (const name of FORBIDDEN_PACKAGES) if (source.includes(name)) offenders.push(`${file}: ${name}`);
  }
}

if (scanned === 0) {
  console.error("TN_CSG_NO_GENERATOR_NOT_BUILT: run `pnpm build` and `pnpm build:native` first.");
  process.exit(2);
}
if (offenders.length > 0) {
  console.error(`TN_CSG_GENERATOR_IN_GAME_BUNDLE:\n${offenders.join("\n")}`);
  process.exit(1);
}
console.log(`no authoring dependency installed; none referenced in ${scanned} built file(s).`);

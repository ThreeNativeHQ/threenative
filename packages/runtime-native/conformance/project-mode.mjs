import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";

function projectError(code, message) {
  return new Error(`${code}: ${message}`);
}

export function resolveParityProject(projectArgument) {
  const root = resolve(projectArgument);
  if (!existsSync(root) || !statSync(root).isDirectory()) {
    throw projectError("TN_PARITY_PROJECT_MISSING", `project directory does not exist: ${root}`);
  }
  const manifestPath = join(root, "package.json");
  if (!existsSync(manifestPath)) {
    throw projectError("TN_PARITY_PROJECT_MANIFEST_MISSING", `package.json is missing: ${root}`);
  }
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  } catch (error) {
    throw projectError(
      "TN_PARITY_PROJECT_MANIFEST_INVALID",
      error instanceof Error ? error.message : String(error),
    );
  }
  const configuredEntry = manifest.threenative?.nativeEntry;
  if (configuredEntry !== undefined && (typeof configuredEntry !== "string" || !configuredEntry)) {
    throw projectError(
      "TN_PARITY_NATIVE_ENTRY_INVALID",
      "threenative.nativeEntry must be a non-empty project-relative path",
    );
  }
  const nativeEntry = configuredEntry || "src/game.ts";
  const entry = resolve(root, nativeEntry);
  const rootPrefix = root.endsWith(sep) ? root : `${root}${sep}`;
  if (!entry.startsWith(rootPrefix)) {
    throw projectError(
      "TN_PARITY_NATIVE_ENTRY_OUTSIDE_PROJECT",
      `threenative.nativeEntry resolves outside the project: ${nativeEntry}`,
    );
  }
  if (!existsSync(entry) || !statSync(entry).isFile()) {
    throw projectError("TN_PARITY_NATIVE_ENTRY_MISSING", `native entry does not exist: ${entry}`);
  }
  return {
    root,
    entry,
    nativeEntry: relative(root, entry).replaceAll("\\", "/"),
    publicDir: join(root, "public"),
  };
}

export function writeProjectScene(project, output) {
  const source = `import game from ${JSON.stringify(project.entry)};

export async function startScene(canvas) {
  if (!game || typeof game.start !== "function") {
    throw new Error("TN_PARITY_NATIVE_ENTRY_INVALID_EXPORT: native entry must default-export a game");
  }
  const createElement = document.createElement.bind(document);
  document.createElement = (tag, ...args) =>
    String(tag).toLowerCase() === "canvas" ? canvas : createElement(tag, ...args);
  await game.start();
  const state = game.ctx;
  if (!state?.renderer || !state?.scene || !state?.camera) {
    throw new Error("TN_PARITY_GAME_CONTEXT_MISSING: started game did not expose renderer, scene, and camera");
  }
  return state;
}
`;
  writeFileSync(output, source);
  return output;
}

export function projectId(project) {
  return `project-${createHash("sha256").update(project.root).digest("hex").slice(0, 12)}`;
}

export function createProjectRegistry(baseRegistry, scene, project) {
  const id = projectId(project);
  return {
    schemaVersion: baseRegistry.schemaVersion,
    threeVersion: baseRegistry.threeVersion,
    tests: [
      {
        id,
        title: `Project native entry: ${project.nativeEntry}`,
        category: "project",
        status: "implemented",
        scene,
        captureFrames: 60,
        tolerance: { pixelMismatchRatio: 0.03, perceptualDeltaE: 6 },
      },
    ],
    exclusions: baseRegistry.exclusions,
  };
}

import { readFile } from "node:fs/promises";
import path from "node:path";

interface IBuildMatrixConfiguration {
  readonly cacheVariables: Readonly<Record<string, string>>;
  readonly directory: string;
  readonly owner: string;
  readonly preset: string;
  readonly runs: readonly string[];
}

interface IBuildMatrix {
  readonly configurations: readonly IBuildMatrixConfiguration[];
  readonly version: number;
}

interface ICmakeFacts {
  readonly configurePresetNames: ReadonlySet<string>;
  readonly declaredVariables: ReadonlySet<string>;
  readonly testTargets: ReadonlySet<string>;
}

const RUNTIME_PACKAGE = path.join("packages", "runtime-native");

function isTestTarget(name: string): boolean {
  return /^threenative-[a-z0-9-]+-test$/u.test(name);
}

function collectTestTargets(cmake: string): Set<string> {
  const targets = new Set<string>();
  for (const [, name] of cmake.matchAll(/add_executable\(\s*(threenative-[a-z0-9-]+)\b/gu)) {
    if (name !== undefined && isTestTarget(name)) targets.add(name);
  }
  return targets;
}

/**
 * Options and cache variables the matrix may legitimately set. `CMAKE_*` and `ANDROID_*` are
 * toolchain built-ins CMake itself defines, so they are exempt; anything project-prefixed must
 * be declared, because a variable CMake never declares fails silently — the configuration then
 * believes it turned a feature on and did not.
 */
function collectDeclaredVariables(cmake: string): Set<string> {
  const declared = new Set<string>();
  for (const [, name] of cmake.matchAll(/\boption\(\s*([A-Z][A-Z0-9_]+)\b/gu)) {
    if (name !== undefined) declared.add(name);
  }
  for (const [, name] of cmake.matchAll(
    /\bset\(\s*([A-Z][A-Z0-9_]+)\b[^)]*\bCACHE\s+(?:BOOL|PATH|FILE|STRING|INTERNAL)\b/gu,
  )) {
    if (name !== undefined) declared.add(name);
  }
  return declared;
}

function isToolchainVariable(name: string): boolean {
  return name.startsWith("CMAKE_") || name.startsWith("ANDROID_");
}

async function readCmakeFacts(packageDir: string): Promise<ICmakeFacts> {
  const [cmake, presetsJson] = await Promise.all([
    readFile(path.join(packageDir, "CMakeLists.txt"), "utf8"),
    readFile(path.join(packageDir, "CMakePresets.json"), "utf8"),
  ]);
  const presets = JSON.parse(presetsJson) as {
    configurePresets?: ReadonlyArray<{ name?: string }>;
  };
  return {
    configurePresetNames: new Set(
      (presets.configurePresets ?? []).map((preset) => preset.name ?? ""),
    ),
    declaredVariables: collectDeclaredVariables(cmake),
    testTargets: collectTestTargets(cmake),
  };
}

/**
 * PRD-235 Phase 1: which build directory a test executable lives in is one documented thing,
 * enforced. The matrix at `packages/runtime-native/build-matrix.json` is the contract; the
 * facts it names — presets, options, test executables — are read from CMake here, so either
 * side drifting from the other is a named failure instead of tribal knowledge.
 *
 * Fixture roots carry no core package (the census gate's signal for "not a real tree") and no-op;
 * a real tree without the matrix fails closed.
 */
export async function buildMatrixErrors(root: string): Promise<string[]> {
  const packageDir = path.join(root, RUNTIME_PACKAGE);
  const coreManifest = path.join(root, "packages", "core", "package.json");
  try {
    await readFile(path.join(packageDir, "CMakeLists.txt"), "utf8");
    await readFile(coreManifest, "utf8");
  } catch {
    // Budget-gate fixture roots build minimal trees; there is no native contract to enforce.
    return [];
  }

  const matrixPath = path.join(packageDir, "build-matrix.json");
  let matrix: IBuildMatrix;
  try {
    matrix = JSON.parse(await readFile(matrixPath, "utf8")) as IBuildMatrix;
  } catch {
    return [
      "packages/runtime-native/build-matrix.json is missing or unparseable: the build-directory contract has no file to enforce",
    ];
  }

  const facts = await readCmakeFacts(packageDir);
  const errors: string[] = [];
  const seenDirectories = new Set<string>();
  const claimedTargets = new Set<string>();

  for (const configuration of matrix.configurations) {
    const { directory } = configuration;
    if (seenDirectories.has(directory)) {
      errors.push(`build-matrix declares directory ${directory} twice`);
    }
    seenDirectories.add(directory);

    if (configuration.owner.trim().length === 0) {
      errors.push(
        `configuration ${directory} has an empty owner: every documented build directory names the lane that needs it`,
      );
    }
    if (!facts.configurePresetNames.has(configuration.preset)) {
      errors.push(
        `configuration ${directory} names preset "${configuration.preset}", which CMakePresets.json does not declare`,
      );
    }
    for (const [name] of Object.entries(configuration.cacheVariables)) {
      if (isToolchainVariable(name)) continue;
      if (!facts.declaredVariables.has(name)) {
        errors.push(
          `configuration ${directory} sets ${name}, which CMakeLists.txt never declares as an option or cache variable`,
        );
      }
    }
    for (const target of configuration.runs) {
      if (!facts.testTargets.has(target)) {
        errors.push(
          `configuration ${directory} runs ${target}, which CMakeLists.txt never declares as a test executable`,
        );
      }
      claimedTargets.add(target);
    }
  }

  for (const target of facts.testTargets) {
    if (!claimedTargets.has(target)) {
      errors.push(
        `${target} is registered in CMakeLists.txt but no build-matrix configuration claims it (add it to a configuration's "runs" in packages/runtime-native/build-matrix.json)`,
      );
    }
  }

  return errors;
}

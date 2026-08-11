import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import {
  type ProofFile,
  type SandboxArm,
  type SweepManifest,
  readManifest,
  sealedProofFiles,
  sealedProofHash,
} from "./make-sandbox.js";
import { type SweepMeasurement, measureSandbox } from "./measure-sandbox.js";

const REPO = path.resolve(import.meta.dirname, "..");
const SOURCE_EXTENSIONS = new Set([".css", ".js", ".jsx", ".mjs", ".ts", ".tsx"]);
const DEPENDENCY_SECTIONS = [
  "dependencies",
  "devDependencies",
  "optionalDependencies",
  "peerDependencies",
] as const;
const VANILLA_BRIDGE_PACKAGE = "@threenative/playtest";
const FORBIDDEN_FRAMEWORK_REFERENCE = /@threenative\/(?:core|physics|ui)(?:[\/@#?]|$)/;

interface StoredProof {
  readonly arm: SandboxArm;
  readonly genre: string;
  readonly passed: number;
  readonly proofHash: string;
  readonly scenarios: readonly StoredProofScenario[];
  readonly total: number;
}

interface StoredProofScenario {
  readonly assertions: readonly StoredProofAssertion[];
  readonly diagnostics: readonly StoredProofDiagnostic[];
  readonly name: string;
  readonly verdict: "pass" | "fail";
}

interface StoredProofAssertion {
  readonly id: string;
  readonly pass: boolean;
}

interface StoredProofDiagnostic {
  readonly code: string;
  readonly message: string;
  readonly severity: "error" | "warning";
}

interface SealedProofExpectation {
  readonly assertionIds: readonly string[];
  readonly name: string;
}

export interface PairArmResult {
  readonly archive: string;
  readonly authoredBytes: number;
  readonly authoredLoc: number;
  readonly frameworkFiles: number;
  readonly passed: number;
  readonly reachRate: number;
  readonly sourceFiles: number;
  readonly sourceBytes: number;
  readonly threeOnlyFiles: number;
  readonly starterBytes: number;
  readonly starterFiles: number;
  readonly starterLoc: number;
  readonly starterSurvivedLoc: number;
  readonly total: number;
  readonly userLoc: number;
  readonly unusedExports: readonly string[];
  readonly usedExports: readonly string[];
}

export interface SweepPair {
  readonly briefHash: string;
  readonly delta: {
    /** Fair authored-cost delta: framework minus vanilla. */
    readonly authoredBytes: number;
    readonly authoredLoc: number;
    /** Final totals retained for maintenance context, not the fair cost score. */
    readonly sourceBytes: number;
    readonly sourceFiles: number;
    readonly userLoc: number;
  };
  readonly framework: PairArmResult;
  readonly genre: string;
  readonly proofHash: string;
  readonly vanilla: PairArmResult;
}

function isDirectory(directory: string): boolean {
  return fs.existsSync(directory) && fs.statSync(directory).isDirectory();
}

function isFile(file: string): boolean {
  return fs.existsSync(file) && fs.statSync(file).isFile();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStoredProofAssertion(value: unknown): value is StoredProofAssertion {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    value.id.trim() !== "" &&
    typeof value.pass === "boolean"
  );
}

function isStoredProofDiagnostic(value: unknown): value is StoredProofDiagnostic {
  return (
    isRecord(value) &&
    typeof value.code === "string" &&
    value.code.trim() !== "" &&
    typeof value.message === "string" &&
    value.message.trim() !== "" &&
    (value.severity === "error" || value.severity === "warning")
  );
}

function isMissingCapabilityPreflight(
  scenario: Pick<StoredProofScenario, "assertions" | "diagnostics" | "verdict">,
): boolean {
  return (
    scenario.verdict === "fail" &&
    scenario.assertions.length === 0 &&
    scenario.diagnostics.some(
      ({ code, severity }) => code === "TN_PLAYTEST_CAPABILITY_MISSING" && severity === "error",
    )
  );
}

function recordField(
  value: Record<string, unknown>,
  key: string,
  context: string,
): Record<string, unknown> {
  const field = value[key];
  if (!isRecord(field))
    throw new Error(`Cannot pair '${context}': sealed proof field '${key}' must be an object.`);
  return field;
}

function recordArray(
  value: Record<string, unknown>,
  key: string,
  context: string,
): Record<string, unknown>[] {
  const field = value[key];
  if (!Array.isArray(field) || !field.every(isRecord))
    throw new Error(
      `Cannot pair '${context}': sealed proof field '${key}' must be an array of objects.`,
    );
  return field;
}

function stringField(value: Record<string, unknown>, key: string, context: string): string {
  const field = value[key];
  if (typeof field !== "string" || field.trim() === "")
    throw new Error(
      `Cannot pair '${context}': sealed proof field '${key}' must be a non-empty string.`,
    );
  return field;
}

function hasField(value: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function pathAssertionIds(
  kind: "component" | "hud" | "resource",
  assertion: Record<string, unknown>,
  context: string,
): string[] {
  const id = stringField(assertion, "id", context);
  const path = assertion.path === undefined ? "value" : stringField(assertion, "path", context);
  const finalPath = assertion.path === undefined ? "" : `.${path}`;
  const ids: string[] = [];
  if (
    hasField(assertion, "equals") ||
    typeof assertion.gte === "number" ||
    typeof assertion.textIncludes === "string" ||
    typeof assertion.changed === "boolean"
  )
    ids.push(`${kind}.${id}${finalPath}`);
  if (assertion.throughoutSteps === true) ids.push(`${kind}.${id}.${path}.throughoutSteps`);
  if (Array.isArray(assertion.atSteps) && assertion.atSteps.length > 0)
    ids.push(`${kind}.${id}.${path}.atSteps`);
  return ids;
}

function sealedAssertionIds(scenario: Record<string, unknown>, context: string): string[] {
  const assertions = recordField(scenario, "assert", context);
  const subject = typeof scenario.subject === "string" ? scenario.subject : "";
  const ids: string[] = [];
  const add = (id: string): void => {
    ids.push(id);
  };

  if (hasField(assertions, "reachability")) {
    const reachability = recordField(assertions, "reachability", context);
    const entities = reachability.entities;
    if (
      !Array.isArray(entities) ||
      !entities.every((entity) => typeof entity === "string" && entity.trim() !== "")
    )
      throw new Error(`Cannot pair '${context}': reachability.entities must contain entity ids.`);
    for (let index = 0; index < entities.length - 1; index += 1)
      add(`reachability.${index}.${entities[index]}.${entities[index + 1]}`);
  }
  if (hasField(assertions, "overlayNodes")) {
    for (const assertion of recordArray(assertions, "overlayNodes", context)) {
      const overlayId = stringField(assertion, "overlayId", context);
      const selector = stringField(assertion, "selector", context);
      add(`overlayNode.${overlayId}:${selector}`);
    }
  }
  if (hasField(assertions, "visual")) {
    for (const [index, assertion] of recordArray(assertions, "visual", context).entries()) {
      if (assertion.frameDiff !== undefined) add(`visual.${index}.frameDiff`);
      const region = assertion.region;
      if (region !== undefined) {
        if (!isRecord(region))
          throw new Error(`Cannot pair '${context}': visual.region must be an object.`);
        add(`visual.${index}.region`);
        if (region.minDarkPixelRatio !== undefined) add(`visual.${index}.region.darkPixels`);
      }
      if (assertion.entityVisible !== undefined) add(`visual.${index}.entityVisible`);
    }
  }
  if (hasField(assertions, "resources")) {
    for (const assertion of recordArray(assertions, "resources", context)) {
      if (hasField(assertion, "anyOf")) {
        stringField(assertion, "id", context);
        add(`resource.${assertion.id}.anyOf`);
      } else {
        for (const id of pathAssertionIds("resource", assertion, context)) add(id);
      }
    }
  }
  if (hasField(assertions, "world")) add("world.seed");
  if (hasField(assertions, "components")) {
    for (const assertion of recordArray(assertions, "components", context)) {
      const entity = stringField(assertion, "entity", context);
      const component = stringField(assertion, "component", context);
      const path = assertion.path === undefined ? "value" : stringField(assertion, "path", context);
      if (
        hasField(assertion, "equals") ||
        typeof assertion.gte === "number" ||
        typeof assertion.changed === "boolean"
      )
        add(`component.${entity}.${component}.${path}`);
      if (Array.isArray(assertion.atSteps) && assertion.atSteps.length > 0)
        add(`component.${entity}.${component}.${path}.atSteps`);
    }
  }
  if (hasField(assertions, "aerodynamics")) {
    for (const [index] of recordArray(assertions, "aerodynamics", context).entries())
      add(`aerodynamics.${index}`);
  }
  if (hasField(assertions, "hud")) {
    for (const assertion of recordArray(assertions, "hud", context))
      for (const id of pathAssertionIds("hud", assertion, context)) add(id);
  }
  if (hasField(assertions, "tags")) {
    for (const assertion of recordArray(assertions, "tags", context))
      add(`tags.${stringField(assertion, "tag", context)}`);
  }
  if (hasField(assertions, "states")) {
    for (const assertion of recordArray(assertions, "states", context))
      add(`states.${stringField(assertion, "entity", context)}`);
  }
  if (hasField(assertions, "diagnostics")) add("diagnostics");
  if (hasField(assertions, "movement")) {
    const movement = recordField(assertions, "movement", context);
    if (movement.minVelocity !== undefined) add("movement.velocity");
    if (movement.minDistance !== undefined) add("movement.distance");
    if (movement.maxDistance !== undefined) add("movement.maxDistance");
    if (movement.pathLength !== undefined) add("movement.pathLength");
    if (movement.minAxisDelta !== undefined) add("movement.axisDelta");
    if (movement.minResolvedAxisDelta !== undefined) add("movement.resolvedAxisDelta");
    if (movement.rotationChanged === true) add("movement.rotation");
    if (movement.maxTiltDegrees !== undefined) add("movement.tilt");
    if (movement.closesDistanceToPosition !== undefined) add("movement.closesDistance");
    if (movement.reachesPositionWithin !== undefined) add("movement.reachesPosition");
    if (movement.facesMovementWithinDegrees !== undefined) add("movement.facing");
    if (movement.notFacing !== undefined) add("movement.notFacing");
    if (movement.notFacingPosition !== undefined) add("movement.notFacingPosition");
  }
  if (hasField(assertions, "camera")) add("camera");
  if (hasField(assertions, "visibility")) {
    for (const assertion of recordArray(assertions, "visibility", context))
      add(`visibility.${typeof assertion.entity === "string" ? assertion.entity : subject}`);
  }
  if (hasField(assertions, "contacts")) {
    for (const assertion of recordArray(assertions, "contacts", context))
      add(`contact.${typeof assertion.entity === "string" ? assertion.entity : subject}`);
  }
  if (hasField(assertions, "settled")) {
    for (const assertion of recordArray(assertions, "settled", context))
      add(`settled.${stringField(assertion, "entity", context)}`);
  }
  if (hasField(assertions, "occluded")) {
    for (const assertion of recordArray(assertions, "occluded", context))
      add(`occluded.${typeof assertion.entity === "string" ? assertion.entity : "ray"}`);
  }
  if (hasField(assertions, "animation")) {
    for (const assertion of recordArray(assertions, "animation", context))
      add(`animation.${typeof assertion.entity === "string" ? assertion.entity : subject}`);
  }

  if (ids.length === 0)
    throw new Error(`Cannot pair '${context}': sealed proof has no evaluable assertion ids.`);
  return ids;
}

function sealedProofExpectations(repo: string, genre: string): SealedProofExpectation[] {
  return sealedProofFiles(repo, genre).map((file: ProofFile) => {
    let value: unknown;
    try {
      value = JSON.parse(fs.readFileSync(file.absolutePath, "utf8"));
    } catch (error) {
      throw new Error(`Cannot read sealed proof '${file.relativePath}': ${String(error)}.`);
    }
    if (
      typeof value !== "object" ||
      value === null ||
      Array.isArray(value) ||
      typeof (value as { name?: unknown }).name !== "string" ||
      (value as { name: string }).name.trim() === ""
    )
      throw new Error(`Cannot pair '${genre}': sealed proof '${file.relativePath}' has no name.`);
    const scenario = value as Record<string, unknown>;
    const name = scenario.name as string;
    return { assertionIds: sealedAssertionIds(scenario, file.relativePath), name };
  });
}

function requireScenarioSet(
  root: string,
  actual: readonly StoredProofScenario[],
  expected: readonly SealedProofExpectation[],
): void {
  const names = actual.map(({ name }) => name);
  const expectedNames = expected.map(({ name }) => name);
  if (new Set(names).size !== names.length)
    throw new Error(`Cannot pair '${root}': proof.json has duplicate scenario names.`);
  if (names.length !== expectedNames.length || names.some((name) => !expectedNames.includes(name)))
    throw new Error(
      `Cannot pair '${root}': proof.json scenario names do not match the sealed proof set.`,
    );
  for (const scenario of actual) {
    const sealed = expected.find(({ name }) => name === scenario.name);
    if (sealed === undefined) continue;
    const actualIds = scenario.assertions.map(({ id }) => id);
    if (isMissingCapabilityPreflight(scenario)) continue;
    if (
      new Set(actualIds).size !== actualIds.length ||
      new Set(sealed.assertionIds).size !== sealed.assertionIds.length ||
      actualIds.length !== sealed.assertionIds.length ||
      actualIds.some((id) => !sealed.assertionIds.includes(id))
    )
      throw new Error(
        `Cannot pair '${root}': proof.json scenario '${scenario.name}' assertion ids do not match the sealed proof.`,
      );
  }
}

function resolveArchive(source: string): string {
  const root = path.resolve(source);
  if (isFile(path.join(root, "sweep.json"))) return root;
  throw new Error(`Sweep archive does not exist or has no sweep.json: ${root}`);
}

function sourceFiles(directory: string): string[] {
  if (!isDirectory(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(file);
    return SOURCE_EXTENSIONS.has(path.extname(entry.name)) ? [file] : [];
  });
}

function lineCount(source: string): number {
  if (source.length === 0) return 0;
  const normalized = source.replaceAll("\r\n", "\n");
  return normalized.endsWith("\n")
    ? normalized.slice(0, -1).split("\n").length
    : normalized.split("\n").length;
}

function packageNameFromImport(specifier: string): string {
  const parts = specifier.split("/");
  return parts[0]?.startsWith("@") ? parts.slice(0, 2).join("/") : (parts[0] ?? specifier);
}

function isAllowedVanillaPackage(name: string): boolean {
  return !name.startsWith("@threenative/") || name === VANILLA_BRIDGE_PACKAGE;
}

function localPackageJson(target: string): string {
  if (isDirectory(target)) {
    const packageFile = path.join(target, "package.json");
    if (!isFile(packageFile))
      throw new Error(`local dependency target '${target}' has no package.json.`);
    return fs.readFileSync(packageFile, "utf8");
  }
  if (!isFile(target)) throw new Error(`local dependency target '${target}' does not exist.`);
  let entries: string;
  try {
    entries = execFileSync("tar", ["-tzf", target], { encoding: "utf8" });
  } catch (error) {
    throw new Error(
      `local dependency target '${target}' is not a readable package archive: ${String(error)}.`,
    );
  }
  const packageEntry = entries.split("\n").find((entry) => /(?:^|\/)package\.json$/.test(entry));
  if (packageEntry === undefined)
    throw new Error(`local dependency target '${target}' has no package.json.`);
  try {
    return execFileSync("tar", ["-xOzf", target, packageEntry], { encoding: "utf8" });
  } catch (error) {
    throw new Error(
      `local dependency target '${target}' has an unreadable package.json: ${String(error)}.`,
    );
  }
}

function validateLocalPackageIdentity(
  root: string,
  section: string,
  name: string,
  version: string,
): void {
  const prefix = /^(?:file|link):/.exec(version)?.[0];
  if (prefix === undefined) return;
  const target = path.resolve(root, version.slice(prefix.length));
  let packageJson: unknown;
  try {
    packageJson = JSON.parse(localPackageJson(target));
  } catch (error) {
    throw new Error(
      `Cannot measure '${root}' as vanilla: package.json ${section}.${name} has an invalid local package identity: ${error instanceof Error ? error.message : String(error)}.`,
    );
  }
  if (
    !isRecord(packageJson) ||
    typeof packageJson.name !== "string" ||
    packageJson.name.trim() === ""
  )
    throw new Error(
      `Cannot measure '${root}' as vanilla: package.json ${section}.${name} local target '${version}' has no package name.`,
    );
  const packageName = packageJson.name;
  if (packageName.startsWith("@threenative/") && packageName !== VANILLA_BRIDGE_PACKAGE)
    throw new Error(
      `Cannot measure '${root}' as vanilla: package.json ${section}.${name} local target '${version}' embeds forbidden framework package '${packageName}'.`,
    );
  if (name === VANILLA_BRIDGE_PACKAGE && packageName !== VANILLA_BRIDGE_PACKAGE)
    throw new Error(
      `Cannot measure '${root}' as vanilla: package.json ${section}.${name} local target '${version}' is package '${packageName}', not the playtest bridge.`,
    );
}

function validateVanillaDependency(
  root: string,
  section: string,
  name: string,
  version: unknown,
): void {
  if (typeof version !== "string" || version.trim() === "")
    throw new Error(
      `Cannot measure '${root}' as vanilla: package.json ${section}.${name} must be a non-empty string.`,
    );
  if (FORBIDDEN_FRAMEWORK_REFERENCE.test(version))
    throw new Error(
      `Cannot measure '${root}' as vanilla: package.json ${section}.${name} points to a forbidden framework package through '${version}'.`,
    );
  if (
    name === VANILLA_BRIDGE_PACKAGE &&
    version.startsWith("npm:") &&
    !/^npm:@threenative\/playtest(?:@|\/|$)/.test(version)
  )
    throw new Error(
      `Cannot measure '${root}' as vanilla: package.json ${section}.${name} aliases a different package through '${version}'.`,
    );
  if (
    name === VANILLA_BRIDGE_PACKAGE &&
    /^(?:file|link):/.test(version) &&
    /(?:^|[\\/])(?:threenative-)?(?:core|physics|ui)(?:[\\/.\-]|$)/i.test(
      version.slice(version.indexOf(":") + 1),
    )
  )
    throw new Error(
      `Cannot measure '${root}' as vanilla: package.json ${section}.${name} points to a forbidden framework path through '${version}'.`,
    );
  validateLocalPackageIdentity(root, section, name, version);
}

function validateVanillaArchive(root: string, files: readonly string[]): void {
  const packageFile = path.join(root, "package.json");
  if (!isFile(packageFile))
    throw new Error(`Cannot measure '${root}' as vanilla: missing package.json.`);
  let packageJson: unknown;
  try {
    packageJson = JSON.parse(fs.readFileSync(packageFile, "utf8"));
  } catch (error) {
    throw new Error(
      `Cannot measure '${root}' as vanilla: package.json is invalid JSON: ${String(error)}.`,
    );
  }
  if (!isRecord(packageJson))
    throw new Error(`Cannot measure '${root}' as vanilla: package.json must contain an object.`);
  for (const section of DEPENDENCY_SECTIONS) {
    const rawDependencies = packageJson[section];
    if (rawDependencies === undefined) continue;
    if (!isRecord(rawDependencies))
      throw new Error(
        `Cannot measure '${root}' as vanilla: package.json ${section} must be an object.`,
      );
    for (const [name, version] of Object.entries(rawDependencies)) {
      if (!isAllowedVanillaPackage(name))
        throw new Error(
          `Cannot measure '${root}' as vanilla: package.json declares forbidden framework dependency '${name}'.`,
        );
      validateVanillaDependency(root, section, name, version);
    }
  }
  const importPattern =
    /(?:\bfrom\s*|\bimport\s*\(|\brequire\s*\(\s*|\bimport\s*)["'](@threenative\/[^"']+)["']/g;
  for (const file of files) {
    const source = fs.readFileSync(file, "utf8");
    for (const match of source.matchAll(importPattern)) {
      const specifier = match[1];
      if (specifier === undefined || isAllowedVanillaPackage(packageNameFromImport(specifier)))
        continue;
      throw new Error(
        `Cannot measure '${root}' as vanilla: source import '${specifier}' uses a forbidden framework package in '${file}'.`,
      );
    }
  }
}

function measureVanilla(root: string): SweepMeasurement {
  const files = sourceFiles(path.join(root, "src")).sort();
  if (files.length === 0) throw new Error(`Cannot measure '${root}': src/ has no source files.`);
  validateVanillaArchive(root, files);
  if (fs.existsSync(path.join(root, "starter-baseline")))
    throw new Error(
      `Cannot measure '${root}' as vanilla: it carries a starter-baseline/. The vanilla arm is authored from an empty src/.`,
    );
  let userLoc = 0;
  let sourceBytes = 0;
  let threeOnlyFiles = 0;
  for (const file of files) {
    const source = fs.readFileSync(file, "utf8");
    userLoc += lineCount(source);
    sourceBytes += Buffer.byteLength(source, "utf8");
    if (/(?:from\s*|import\s*\(|require\s*\(\s*)["']three["']/.test(source)) threeOnlyFiles += 1;
  }
  return {
    authoredBytes: sourceBytes,
    authoredLoc: userLoc,
    frameworkFiles: 0,
    reachRate: 0,
    sourceFiles: files.length,
    sourceBytes,
    threeOnlyFiles,
    starterBytes: 0,
    starterFiles: 0,
    starterLoc: 0,
    starterSource: "none",
    starterSurvivedLoc: 0,
    unusedExports: [],
    usedExports: [],
    userLoc,
  };
}

function measurement(root: string, arm: SandboxArm): SweepMeasurement {
  return arm === "vanilla" ? measureVanilla(root) : measureSandbox(root);
}

function readProof(root: string, manifest: SweepManifest): StoredProof {
  const file = path.join(root, "proof.json");
  if (!isFile(file)) throw new Error(`Cannot pair '${root}': missing proof.json.`);
  let value: unknown;
  try {
    value = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    throw new Error(`Cannot pair '${root}': proof.json is invalid JSON: ${String(error)}.`);
  }
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new Error(`Cannot pair '${root}': proof.json must contain an object.`);
  const proof = value as Partial<StoredProof>;
  if (
    proof.genre !== manifest.genre ||
    proof.arm !== manifest.arm ||
    proof.proofHash !== manifest.proofHash
  )
    throw new Error(`Cannot pair '${root}': proof.json does not match its sweep manifest.`);
  if (!Array.isArray(proof.scenarios) || proof.scenarios.length === 0)
    throw new Error(`Cannot pair '${root}': proof.json has no scenarios.`);
  const total = proof.total;
  const passed = proof.passed;
  if (
    typeof total !== "number" ||
    !Number.isInteger(total) ||
    total <= 0 ||
    total !== proof.scenarios.length ||
    typeof passed !== "number" ||
    !Number.isInteger(passed) ||
    passed < 0 ||
    passed > total
  )
    throw new Error(`Cannot pair '${root}': proof.json has an invalid passed/total result.`);
  for (const [index, scenario] of proof.scenarios.entries()) {
    if (
      typeof scenario !== "object" ||
      scenario === null ||
      Array.isArray(scenario) ||
      typeof scenario.name !== "string" ||
      scenario.name.trim() === "" ||
      !["pass", "fail"].includes(scenario.verdict) ||
      !Array.isArray(scenario.assertions) ||
      !Array.isArray(scenario.diagnostics)
    )
      throw new Error(
        `Cannot pair '${root}': proof.json has a malformed scenario entry at ${index}.`,
      );
    if (!scenario.assertions.every(isStoredProofAssertion))
      throw new Error(
        `Cannot pair '${root}': proof.json scenario ${index} has malformed assertions.`,
      );
    if (!scenario.diagnostics.every(isStoredProofDiagnostic))
      throw new Error(
        `Cannot pair '${root}': proof.json scenario ${index} has malformed diagnostics.`,
      );
    const assertions = scenario.assertions as readonly StoredProofAssertion[];
    const diagnostics = scenario.diagnostics as readonly StoredProofDiagnostic[];
    if (
      assertions.length === 0 &&
      !isMissingCapabilityPreflight({ ...scenario, assertions, diagnostics })
    )
      throw new Error(`Cannot pair '${root}': proof.json scenario ${index} has no assertions.`);
    if (scenario.verdict === "pass" && assertions.some(({ pass }) => !pass))
      throw new Error(
        `Cannot pair '${root}': proof.json scenario ${index} is marked pass with a failed assertion.`,
      );
    if (scenario.verdict === "pass" && diagnostics.some(({ severity }) => severity === "error"))
      throw new Error(
        `Cannot pair '${root}': proof.json scenario ${index} is marked pass with an error diagnostic.`,
      );
    if (
      scenario.verdict === "fail" &&
      assertions.every(({ pass }) => pass) &&
      diagnostics.every(({ severity }) => severity !== "error")
    )
      throw new Error(
        `Cannot pair '${root}': proof.json scenario ${index} is marked fail without failed evidence.`,
      );
  }
  const observedPassed = proof.scenarios.filter(({ verdict }) => verdict === "pass").length;
  if (passed !== observedPassed || total < passed)
    throw new Error(`Cannot pair '${root}': proof.json passed/total does not match its scenarios.`);
  return { ...proof, passed, scenarios: proof.scenarios, total } as StoredProof;
}

function armResult(root: string, manifest: SweepManifest, proof: StoredProof): PairArmResult {
  const measured = measurement(root, manifest.arm);
  return {
    archive: root,
    authoredBytes: measured.authoredBytes,
    authoredLoc: measured.authoredLoc,
    frameworkFiles: measured.frameworkFiles,
    passed: proof.passed,
    reachRate: measured.reachRate,
    sourceFiles: measured.sourceFiles,
    sourceBytes: measured.sourceBytes,
    threeOnlyFiles: measured.threeOnlyFiles,
    starterBytes: measured.starterBytes,
    starterFiles: measured.starterFiles,
    starterLoc: measured.starterLoc,
    starterSurvivedLoc: measured.starterSurvivedLoc,
    total: proof.total,
    userLoc: measured.userLoc,
    unusedExports: measured.unusedExports,
    usedExports: measured.usedExports,
  };
}

export function pairSweeps(leftDirectory: string, rightDirectory: string, repo = REPO): SweepPair {
  const left = resolveArchive(leftDirectory);
  const right = resolveArchive(rightDirectory);
  if (left === right) throw new Error("Cannot pair a sweep archive with itself.");
  const leftManifest = readManifest(path.join(left, "sweep.json"));
  const rightManifest = readManifest(path.join(right, "sweep.json"));
  if (leftManifest.arm === rightManifest.arm)
    throw new Error(`Cannot pair two ${leftManifest.arm} archives; arms must differ.`);
  if (leftManifest.genre !== rightManifest.genre)
    throw new Error(
      `Cannot pair sweeps from different genres: '${leftManifest.genre}' and '${rightManifest.genre}'.`,
    );
  if (leftManifest.briefHash !== rightManifest.briefHash)
    throw new Error("Cannot pair sweeps with different brief hashes.");
  if (leftManifest.proofHash !== rightManifest.proofHash)
    throw new Error("Cannot pair sweeps with different proof hashes.");
  const expectedProofHash = sealedProofHash(repo, leftManifest.genre);
  if (leftManifest.proofHash !== expectedProofHash || rightManifest.proofHash !== expectedProofHash)
    throw new Error("Cannot pair sweeps whose proof hash does not match the sealed proof set.");
  const leftProof = readProof(left, leftManifest);
  const rightProof = readProof(right, rightManifest);
  const expectedScenarios = sealedProofExpectations(repo, leftManifest.genre);
  requireScenarioSet(left, leftProof.scenarios, expectedScenarios);
  requireScenarioSet(right, rightProof.scenarios, expectedScenarios);
  if (leftProof.scenarios.some(({ name }, index) => name !== rightProof.scenarios[index]?.name))
    throw new Error("Cannot pair sweeps with different proof scenario names.");
  const framework =
    leftManifest.arm === "framework"
      ? armResult(left, leftManifest, leftProof)
      : armResult(right, rightManifest, rightProof);
  const vanilla =
    leftManifest.arm === "vanilla"
      ? armResult(left, leftManifest, leftProof)
      : armResult(right, rightManifest, rightProof);
  return {
    briefHash: leftManifest.briefHash,
    delta: {
      authoredBytes: framework.authoredBytes - vanilla.authoredBytes,
      authoredLoc: framework.authoredLoc - vanilla.authoredLoc,
      sourceBytes: framework.sourceBytes - vanilla.sourceBytes,
      sourceFiles: framework.sourceFiles - vanilla.sourceFiles,
      userLoc: framework.userLoc - vanilla.userLoc,
    },
    framework,
    genre: leftManifest.genre,
    proofHash: leftManifest.proofHash,
    vanilla,
  };
}

function main(): void {
  const left = process.argv[2];
  const right = process.argv[3];
  if (left === undefined || right === undefined)
    throw new Error("Usage: pnpm sweep:pair <framework-archive> <vanilla-archive>.");
  const pair = pairSweeps(left, right);
  process.stdout.write(`${JSON.stringify(pair, null, 2)}\n`);
  const cells = (name: string, arm: PairArmResult): string[] => [
    name,
    `${arm.passed}/${arm.total}`,
    String(arm.authoredLoc),
    String(arm.userLoc),
    String(arm.starterLoc),
    String(arm.starterSurvivedLoc),
    String(arm.sourceFiles),
    String(arm.reachRate),
  ];
  const table = [
    ["arm", "proof", "authored", "final", "starter", "survived", "files", "reach"],
    cells("framework", pair.framework),
    cells("vanilla", pair.vanilla),
  ];
  const widths = (table[0] as string[]).map((_, index) =>
    Math.max(...table.map((line) => (line[index] as string).length)),
  );
  for (const line of table) {
    process.stdout.write(
      `${line
        .map((cell, index) => cell.padEnd((widths[index] as number) + 2))
        .join("")
        .trimEnd()}\n`,
    );
  }
  process.stdout.write(
    `authored cost delta (framework - vanilla): ${pair.delta.authoredLoc} LOC, ${pair.delta.authoredBytes} bytes\n`,
  );
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}

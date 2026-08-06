import fs from "node:fs";
import path from "node:path";
import {
  type ProofFile,
  type SandboxArm,
  type SweepManifest,
  readManifest,
  sealedProofFiles,
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

export interface PairArmResult {
  readonly archive: string;
  readonly passed: number;
  readonly reachRate: number;
  readonly sourceFiles: number;
  readonly total: number;
  readonly userLoc: number;
}

export interface SweepPair {
  readonly briefHash: string;
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

function sealedScenarioNames(repo: string, genre: string): string[] {
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
    return (value as { name: string }).name;
  });
}

function requireScenarioSet(
  root: string,
  actual: readonly StoredProofScenario[],
  expected: readonly string[],
): void {
  const names = actual.map(({ name }) => name);
  if (new Set(names).size !== names.length)
    throw new Error(`Cannot pair '${root}': proof.json has duplicate scenario names.`);
  if (names.length !== expected.length || names.some((name) => !expected.includes(name)))
    throw new Error(
      `Cannot pair '${root}': proof.json scenario names do not match the sealed proof set.`,
    );
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
    for (const name of Object.keys(rawDependencies)) {
      if (!isAllowedVanillaPackage(name))
        throw new Error(
          `Cannot measure '${root}' as vanilla: package.json declares forbidden framework dependency '${name}'.`,
        );
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
  let userLoc = 0;
  let threeOnlyFiles = 0;
  for (const file of files) {
    const source = fs.readFileSync(file, "utf8");
    userLoc += lineCount(source);
    if (/(?:from\s*|import\s*\(|require\s*\(\s*)["']three["']/.test(source)) threeOnlyFiles += 1;
  }
  return {
    frameworkFiles: 0,
    reachRate: 0,
    sourceFiles: files.length,
    threeOnlyFiles,
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
    if (scenario.assertions.length === 0)
      throw new Error(`Cannot pair '${root}': proof.json scenario ${index} has no assertions.`);
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
    if (scenario.verdict === "pass" && assertions.some(({ pass }) => !pass))
      throw new Error(
        `Cannot pair '${root}': proof.json scenario ${index} is marked pass with a failed assertion.`,
      );
    if (scenario.verdict === "pass" && diagnostics.some(({ severity }) => severity === "error"))
      throw new Error(
        `Cannot pair '${root}': proof.json scenario ${index} is marked pass with an error diagnostic.`,
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
    passed: proof.passed,
    reachRate: measured.reachRate,
    sourceFiles: measured.sourceFiles,
    total: proof.total,
    userLoc: measured.userLoc,
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
  const leftProof = readProof(left, leftManifest);
  const rightProof = readProof(right, rightManifest);
  const expectedScenarios = sealedScenarioNames(repo, leftManifest.genre);
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
  process.stdout.write("arm       passed/total  source LOC  files  reach rate\n");
  process.stdout.write(
    `framework ${pair.framework.passed}/${pair.framework.total}         ${pair.framework.userLoc}        ${pair.framework.sourceFiles}      ${pair.framework.reachRate}\n`,
  );
  process.stdout.write(
    `vanilla   ${pair.vanilla.passed}/${pair.vanilla.total}         ${pair.vanilla.userLoc}        ${pair.vanilla.sourceFiles}      ${pair.vanilla.reachRate}\n`,
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

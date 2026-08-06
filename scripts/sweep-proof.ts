import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  type ProofFile,
  type SandboxArm,
  hashProofFiles,
  readManifest,
  sealedProofFiles,
  sealedProofHash,
} from "./make-sandbox.js";

const REPO = path.resolve(import.meta.dirname, "..");
const RUNNER = path.join(REPO, "packages", "playtest", "dist", "runner", "cli.js");
const PROOF_PORT = 5190;

interface PlaytestReport {
  readonly assertionResults?: readonly unknown[];
  readonly diagnostics?: readonly unknown[];
  readonly pass?: boolean;
}

export interface ProofScenarioResult {
  readonly assertions: readonly unknown[];
  readonly diagnostics: readonly unknown[];
  readonly name: string;
  readonly verdict: "pass" | "fail";
}

export interface ProofResult {
  readonly arm: SandboxArm;
  readonly genre: string;
  readonly passed: number;
  readonly proofHash: string;
  readonly scenarios: readonly ProofScenarioResult[];
  readonly total: number;
}

function isDirectory(directory: string): boolean {
  return fs.existsSync(directory) && fs.statSync(directory).isDirectory();
}

function isFile(file: string): boolean {
  return fs.existsSync(file) && fs.statSync(file).isFile();
}

export function proofArtifactDirectory(source: string, scenarioIndex?: number): string {
  const root = path.join(path.resolve(source), "proof-artifacts");
  return scenarioIndex === undefined ? root : path.join(root, String(scenarioIndex));
}

function resolveSandbox(source: string): string {
  const root = path.resolve(source);
  if (isDirectory(path.join(root, "src")) && isFile(path.join(root, "sweep.json"))) return root;
  if (!isDirectory(root)) throw new Error(`Sandbox does not exist: ${root}`);
  const children = fs.readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const child = path.join(root, entry.name);
    return entry.isDirectory() &&
      isDirectory(path.join(child, "src")) &&
      isFile(path.join(child, "sweep.json"))
      ? [child]
      : [];
  });
  if (children.length === 1) return children[0] as string;
  if (children.length === 0)
    throw new Error(`Sandbox '${root}' has no project with src/ and sweep.json.`);
  throw new Error(`Sandbox '${root}' contains multiple projects; pass the project path.`);
}

function scenarioValue(file: ProofFile): Record<string, unknown> {
  let value: unknown;
  try {
    value = JSON.parse(fs.readFileSync(file.absolutePath, "utf8"));
  } catch (error) {
    throw new Error(`Sealed proof '${file.relativePath}' is not valid JSON: ${String(error)}.`);
  }
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new Error(`Sealed proof '${file.relativePath}' must contain a JSON object.`);
  const scenario = value as Record<string, unknown>;
  const assertions = scenario.assert;
  if (typeof assertions !== "object" || assertions === null || Object.keys(assertions).length === 0)
    throw new Error(`Sealed proof '${file.relativePath}' has no assertions.`);
  return scenario;
}

export function verifySealedProof(manifestFile: string, repo = REPO): readonly ProofFile[] {
  const manifest = readManifest(manifestFile);
  const files = sealedProofFiles(repo, manifest.genre);
  const expected = sealedProofHash(repo, manifest.genre);
  if (manifest.proofHash !== expected)
    throw new Error(
      `Proof hash mismatch for '${manifestFile}': manifest has ${manifest.proofHash}, sealed set has ${expected}.`,
    );
  if (hashProofFiles(files) !== manifest.proofHash)
    throw new Error(`Proof hash changed while reading the sealed set for '${manifest.genre}'.`);
  files.forEach(scenarioValue);
  return files;
}

function copyProofFiles(files: readonly ProofFile[]): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "threenative-proof-"));
  try {
    for (const file of files) {
      const destination = path.join(root, file.relativePath);
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      fs.copyFileSync(file.absolutePath, destination);
      fs.chmodSync(destination, 0o444);
    }
    return root;
  } catch (error) {
    fs.rmSync(root, { recursive: true, force: true });
    throw error;
  }
}

function isArchiveProject(source: string): boolean {
  return (
    isFile(path.join(source, "package.json")) &&
    isFile(path.join(source, "sweep.json")) &&
    !isFile(path.join(source, "brief.md")) &&
    !isFile(path.join(source, "reference.png"))
  );
}

export function ensureArchiveIndex(project: string): void {
  const index = path.join(project, "index.html");
  if (isFile(index)) return;
  const entry = ["src/main.tsx", "src/main.ts"].find((candidate) =>
    isFile(path.join(project, candidate)),
  );
  if (entry === undefined)
    throw new Error(`Archived project '${project}' has no src/main.tsx or src/main.ts entry.`);
  fs.writeFileSync(
    index,
    `<!doctype html>\n<html lang="en">\n  <head><meta charset="UTF-8" /><title>Archived sweep</title></head>\n  <body><div id="root"></div><script type="module" src="/${entry}"></script></body>\n</html>\n`,
  );
}

function prepareProject(source: string, archive: boolean): { project: string; cleanup?: string } {
  if (isDirectory(path.join(source, "node_modules"))) return { project: source };
  const project = fs.mkdtempSync(path.join(os.tmpdir(), "threenative-proof-project-"));
  try {
    fs.cpSync(source, project, { recursive: true });
    if (archive) ensureArchiveIndex(project);
    execFileSync(
      "pnpm",
      ["install", "--ignore-scripts", "--store-dir", path.join(project, ".pnpm-store")],
      { cwd: project, stdio: "inherit" },
    );
    return { cleanup: project, project };
  } catch (error) {
    fs.rmSync(project, { recursive: true, force: true });
    throw error;
  }
}

function reportFromOutput(
  name: string,
  stdout: string,
  stderr: string,
  pass: boolean,
): ProofScenarioResult {
  try {
    const report = JSON.parse(stdout.trim()) as PlaytestReport;
    return {
      assertions: report.assertionResults ?? [],
      diagnostics: report.diagnostics ?? (stderr.length === 0 ? [] : [{ message: stderr }]),
      name,
      verdict: report.pass === true && pass ? "pass" : "fail",
    };
  } catch {
    return {
      assertions: [],
      diagnostics: [{ message: stderr || stdout || "Playtest runner returned no report." }],
      name,
      verdict: "fail",
    };
  }
}

function runScenario(
  project: string,
  scenario: string,
  artifactDirectory: string,
  port: number,
): ProofScenarioResult {
  const scenarioData = JSON.parse(fs.readFileSync(scenario, "utf8")) as { name?: unknown };
  const name = typeof scenarioData.name === "string" ? scenarioData.name : path.basename(scenario);
  const serverCommand = `pnpm dev --host 127.0.0.1 --port ${port} --strictPort`;
  const args = [
    RUNNER,
    scenario,
    "--project",
    project,
    "--url",
    `http://127.0.0.1:${port}`,
    "--server-command",
    serverCommand,
    "--server-timeout",
    "30000",
    "--timeout",
    "30000",
    "--artifacts",
    artifactDirectory,
    "--browser-arg",
    "--enable-unsafe-webgpu",
    "--browser-arg",
    "--disable-gpu-sandbox",
    "--browser-arg",
    "--ignore-gpu-blocklist",
  ];
  try {
    const stdout = execFileSync("node", args, {
      cwd: REPO,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return reportFromOutput(name, stdout, "", true);
  } catch (error) {
    const failure = error as { stderr?: string; stdout?: string; status?: number };
    return reportFromOutput(
      name,
      failure.stdout ?? "",
      failure.stderr ?? String(error),
      failure.status === 0,
    );
  }
}

export function runProof(sourceDirectory: string, repo = REPO): ProofResult {
  const source = resolveSandbox(sourceDirectory);
  const manifestFile = path.join(source, "sweep.json");
  const manifest = readManifest(manifestFile);
  const files = verifySealedProof(manifestFile, repo);
  if (!isFile(RUNNER))
    throw new Error(
      `Playtest runner is not built: ${RUNNER}. Run pnpm --filter @threenative/playtest build.`,
    );

  const scenarioRoot = copyProofFiles(files);
  let prepared: { project: string; cleanup?: string } | undefined;
  try {
    const artifactRoot = proofArtifactDirectory(source);
    fs.mkdirSync(artifactRoot, { recursive: true });
    const preparedProject = prepareProject(source, isArchiveProject(source));
    prepared = preparedProject;
    const scenarios = files.map((file, index) => {
      const scenarioArtifacts = proofArtifactDirectory(source, index);
      fs.mkdirSync(scenarioArtifacts, { recursive: true });
      return runScenario(
        preparedProject.project,
        path.join(scenarioRoot, file.relativePath),
        scenarioArtifacts,
        PROOF_PORT + index,
      );
    });
    const passed = scenarios.filter(({ verdict }) => verdict === "pass").length;
    const result: ProofResult = {
      arm: manifest.arm,
      genre: manifest.genre,
      passed,
      proofHash: manifest.proofHash,
      scenarios,
      total: scenarios.length,
    };
    fs.writeFileSync(path.join(source, "proof.json"), `${JSON.stringify(result, null, 2)}\n`);
    if (passed !== result.total)
      throw new Error(
        `Sealed proof failed for ${manifest.arm}/${manifest.genre}: ${passed}/${result.total} scenarios passed.`,
      );
    return result;
  } finally {
    if (prepared?.cleanup !== undefined)
      fs.rmSync(prepared.cleanup, { recursive: true, force: true });
    fs.rmSync(scenarioRoot, { recursive: true, force: true });
  }
}

function main(): void {
  const source = process.argv[2];
  if (source === undefined) throw new Error("Usage: pnpm sweep:proof <sandbox-or-archive>.");
  process.stdout.write(`${JSON.stringify(runProof(source), null, 2)}\n`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}

import fs from "node:fs";
import path from "node:path";
import { type CaptureFrameStats, assertFrameShowsSomething } from "./capture-guard.js";
import {
  type ProofResult,
  proofArtifactDirectory,
  runProof,
  verifySealedProof,
} from "./sweep-proof.js";

const REPO = path.resolve(import.meta.dirname, "..");

export interface CaptureIndexEntry extends CaptureFrameStats {
  readonly bytes: number;
  readonly capture: string;
  readonly scenario: string;
  readonly source: string;
}

export interface CaptureResult {
  readonly captures: readonly CaptureIndexEntry[];
  readonly proof: ProofResult;
}

function pngFiles(directory: string): string[] {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) return pngFiles(file);
    return entry.isFile() && entry.name.endsWith(".png") ? [file] : [];
  });
}

function safePart(value: string): string {
  const safe = value.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  return safe === "" ? "scenario" : safe;
}

export function captureSweep(sourceDirectory: string, repo = REPO): CaptureResult {
  const source = path.resolve(sourceDirectory);
  const proofFiles = verifySealedProof(path.join(source, "sweep.json"), repo);
  const proof = runProof(source, repo, { headed: true });
  const capturesDirectory = path.join(source, "captures");
  const hadCaptures = fs.existsSync(capturesDirectory);
  fs.mkdirSync(capturesDirectory, { recursive: true });
  const captures: CaptureIndexEntry[] = [];

  try {
    for (const [index, file] of proofFiles.entries()) {
      const scenario =
        proof.scenarios[index]?.name ?? path.basename(file.relativePath, ".playtest.json");
      const artifactDirectory = proofArtifactDirectory(source, index);
      const files = pngFiles(artifactDirectory).sort();
      if (files.length === 0) {
        throw new Error(`TN_CAPTURE_MISSING: ${scenario}: proof produced no PNG artifacts.`);
      }
      for (const file of files) {
        const stats = assertFrameShowsSomething(
          fs.readFileSync(file),
          `${scenario}/${path.basename(file)}`,
        );
        const capture = `${safePart(scenario)}-${safePart(path.basename(file))}`;
        const destination = path.join(capturesDirectory, capture);
        fs.copyFileSync(file, destination);
        captures.push({
          ...stats,
          bytes: fs.statSync(destination).size,
          capture,
          scenario,
          source: path.relative(source, file),
        });
      }
    }

    fs.writeFileSync(
      path.join(capturesDirectory, "index.json"),
      `${JSON.stringify({ recipe: "webgpu-xvfb-headed", captures }, null, 2)}\n`,
    );
    return { captures, proof };
  } catch (error) {
    if (!hadCaptures) fs.rmSync(capturesDirectory, { force: true, recursive: true });
    throw error;
  }
}

function main(): void {
  const source = process.argv[2];
  if (source === undefined) throw new Error("Usage: pnpm sweep:capture <archive>.");
  process.stdout.write(`${JSON.stringify(captureSweep(source), null, 2)}\n`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}

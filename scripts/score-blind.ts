import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";

export interface ScoringArtifact {
  readonly arm: string;
  readonly id: string;
  readonly content: string;
}

export interface BlindArtifact {
  readonly label: string;
  readonly content: string;
}

export interface PromptHashCheck {
  readonly verdict: "valid" | "void";
  readonly reason: string;
}

export interface BlindBundle {
  readonly promptSha256: string;
  readonly verdict: "ready" | "void";
  readonly reason?: string;
  readonly artifacts: readonly BlindArtifact[];
}

const ARM_IDENTIFIERS = [
  /@threenative(?:\/[a-z0-9_-]+)*/gi,
  /three[\s_-]*native/gi,
  /abyss[\s_-]*(?:framework|vanilla)/gi,
  /\b(?:vanilla|framework|control|arm\s*[ab])\b/gi,
] as const;

export function sha256Text(source: string): string {
  return createHash("sha256").update(source, "utf8").digest("hex");
}

export function hashPromptFile(path: string): string {
  return sha256Text(readFileSync(path, "utf8"));
}

export function stripArmIdentifiers(value: string): string {
  return ARM_IDENTIFIERS.reduce((result, pattern) => result.replace(pattern, "[redacted]"), value);
}

export function validatePromptHash(expected: string, actual: string): PromptHashCheck {
  if (expected.toLowerCase() === actual.toLowerCase()) {
    return { verdict: "valid", reason: "Prompt hash matches the sealed prompt." };
  }
  return {
    verdict: "void",
    reason: `Prompt hash mismatch: expected ${expected}, received ${actual}.`,
  };
}

function seededRandom(seed: string): () => number {
  let value = 0;
  for (const character of seed) value = (value * 31 + character.charCodeAt(0)) >>> 0;
  return () => {
    value = (value + 0x6d2b79f5) | 0;
    let result = Math.imul(value ^ (value >>> 15), 1 | value);
    result ^= result + Math.imul(result ^ (result >>> 7), 61 | result);
    return ((result ^ (result >>> 14)) >>> 0) / 4_294_967_296;
  };
}

export function createBlindBundle(
  promptSha256: string,
  artifacts: readonly ScoringArtifact[],
  seed = "threenative-blind-v1",
): BlindBundle {
  const random = seededRandom(seed);
  const shuffled = artifacts
    .map((artifact) => ({
      sort: random(),
      content: stripArmIdentifiers(artifact.content),
    }))
    .sort((left, right) => left.sort - right.sort)
    .map(({ content }, index) => ({
      label: `sample-${String(index + 1).padStart(2, "0")}`,
      content,
    }));

  return {
    artifacts: shuffled,
    promptSha256,
    verdict: "ready",
  };
}

function argumentValue(args: readonly string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

function printUsage(): void {
  console.log(
    "Usage: pnpm tsx scripts/score-blind.ts --prompt <file> --expected-hash <sha256> --artifact <arm:path> [--artifact <arm:path>] [--out <file>]",
  );
}

export function runCli(args: readonly string[]): BlindBundle | undefined {
  if (args.includes("--help")) {
    printUsage();
    return undefined;
  }
  const promptPath = argumentValue(args, "--prompt");
  const expectedHash = argumentValue(args, "--expected-hash");
  const artifactArgs = args.flatMap((arg, index) =>
    arg === "--artifact" ? [args[index + 1] ?? ""] : [],
  );
  if (
    promptPath === undefined ||
    expectedHash === undefined ||
    artifactArgs.some((value) => !value.includes(":"))
  ) {
    printUsage();
    return undefined;
  }

  const actualHash = hashPromptFile(promptPath);
  const hashCheck = validatePromptHash(expectedHash, actualHash);
  const artifacts = artifactArgs.map((value, index) => {
    const separator = value.indexOf(":");
    const arm = value.slice(0, separator);
    const path = value.slice(separator + 1);
    return { arm, id: `${arm}-${index + 1}`, content: readFileSync(path, "utf8") };
  });
  const bundle: BlindBundle =
    hashCheck.verdict === "void"
      ? { artifacts: [], promptSha256: actualHash, reason: hashCheck.reason, verdict: "void" }
      : createBlindBundle(actualHash, artifacts, argumentValue(args, "--seed"));
  const outputPath = argumentValue(args, "--out");
  if (outputPath !== undefined) writeFileSync(outputPath, `${JSON.stringify(bundle, null, 2)}\n`);
  console.log(JSON.stringify(bundle, null, 2));
  return bundle;
}

if (import.meta.url === `file://${process.argv[1]}`) runCli(process.argv.slice(2));

import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

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

export interface ImageScoringArtifact {
  readonly arm: string;
  readonly content: Buffer;
  readonly id: string;
}

export interface BlindImageSample {
  readonly image: string;
  readonly label: string;
}

export interface BlindImageBundle {
  readonly promptSha256: string;
  readonly reason?: string;
  readonly samples: readonly BlindImageSample[];
  readonly verdict: "ready" | "void";
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

export function hasArmIdentifier(value: string): boolean {
  return ARM_IDENTIFIERS.some((pattern) => {
    pattern.lastIndex = 0;
    return pattern.test(value);
  });
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

export function stripPngAncillaryChunks(png: Buffer): Buffer {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  if (!png.subarray(0, signature.length).equals(signature)) {
    throw new Error("PNG image is missing its signature.");
  }

  const chunks: Uint8Array[] = [signature];
  let offset = signature.length;
  let foundEnd = false;
  while (offset < png.length) {
    if (offset + 12 > png.length) throw new Error("PNG chunk header is truncated.");
    const length = png.readUInt32BE(offset);
    const typeOffset = offset + 4;
    const end = typeOffset + 4 + length + 4;
    if (end > png.length) throw new Error("PNG chunk data is truncated.");
    const type = png.toString("ascii", typeOffset, typeOffset + 4);
    if (type.charCodeAt(0) < 97 || type === "IEND") chunks.push(png.subarray(offset, end));
    offset = end;
    if (type === "IEND") {
      foundEnd = true;
      break;
    }
  }
  if (!foundEnd || offset !== png.length) throw new Error("PNG is missing a final IEND chunk.");
  return Buffer.concat(chunks);
}

export function createImageBlindBundle(
  promptSha256: string,
  artifacts: readonly ImageScoringArtifact[],
  bundleDirectory: string,
  revealPath: string,
  seed = "threenative-blind-v1",
  requiredArms: readonly string[] = ["framework", "vanilla"],
): BlindImageBundle {
  if (artifacts.length < requiredArms.length) {
    throw new Error("TN_BLIND_IMAGE_VOID: fewer image samples than required arms.");
  }
  const availableArms = new Set(artifacts.map((artifact) => artifact.arm));
  const missingArms = requiredArms.filter((arm) => !availableArms.has(arm));
  if (missingArms.length > 0) {
    throw new Error(`TN_BLIND_IMAGE_VOID: missing required arm(s): ${missingArms.join(", ")}.`);
  }

  const bundle = path.resolve(bundleDirectory);
  const reveal = path.resolve(revealPath);
  const relativeReveal = path.relative(bundle, reveal);
  if (
    relativeReveal === "" ||
    (!relativeReveal.startsWith(`..${path.sep}`) && !path.isAbsolute(relativeReveal))
  ) {
    throw new Error("TN_BLIND_IMAGE_VOID: reveal mapping must be outside the blind bundle.");
  }

  const random = seededRandom(seed);
  const shuffled = artifacts
    .map((artifact) => ({ artifact, sort: random() }))
    .sort((left, right) => left.sort - right.sort);
  const samples: BlindImageSample[] = [];
  const revealEntries: Array<{ arm: string; id: string; label: string }> = [];
  mkdirSync(bundle, { recursive: true });
  for (const [index, { artifact }] of shuffled.entries()) {
    const label = `sample-${String(index + 1).padStart(2, "0")}`;
    const image = `${label}/image.png`;
    const destination = path.join(bundle, label, "image.png");
    mkdirSync(path.dirname(destination), { recursive: true });
    writeFileSync(destination, stripPngAncillaryChunks(artifact.content));
    samples.push({ image, label });
    revealEntries.push({ arm: artifact.arm, id: artifact.id, label });
  }

  const manifest: BlindImageBundle = { promptSha256, samples, verdict: "ready" };
  writeFileSync(path.join(bundle, "bundle.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  mkdirSync(path.dirname(reveal), { recursive: true });
  writeFileSync(reveal, `${JSON.stringify(revealEntries, null, 2)}\n`);
  return manifest;
}

function argumentValue(args: readonly string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

function printUsage(): void {
  console.log(
    "Usage: pnpm tsx scripts/score-blind.ts --prompt <file> --expected-hash <sha256> --artifact <arm:path> [--artifact <arm:path>] [--out <file>] | --image <arm:path> [--image <arm:path>] --out <bundle-dir> --reveal <path>",
  );
}

export function runCli(args: readonly string[]): BlindBundle | BlindImageBundle | undefined {
  if (args.includes("--help")) {
    printUsage();
    return undefined;
  }
  const promptPath = argumentValue(args, "--prompt");
  const expectedHash = argumentValue(args, "--expected-hash");
  const artifactArgs = args.flatMap((arg, index) =>
    arg === "--artifact" ? [args[index + 1] ?? ""] : [],
  );
  const imageArgs = args.flatMap((arg, index) =>
    arg === "--image" ? [args[index + 1] ?? ""] : [],
  );
  if (
    promptPath === undefined ||
    expectedHash === undefined ||
    artifactArgs.some((value) => !value.includes(":")) ||
    imageArgs.some((value) => !value.includes(":")) ||
    (artifactArgs.length > 0 && imageArgs.length > 0)
  ) {
    printUsage();
    return undefined;
  }

  const actualHash = hashPromptFile(promptPath);
  const hashCheck = validatePromptHash(expectedHash, actualHash);
  const outputPath = argumentValue(args, "--out");
  if (imageArgs.length > 0) {
    const revealPath = argumentValue(args, "--reveal");
    if (outputPath === undefined || revealPath === undefined) {
      printUsage();
      return undefined;
    }
    if (hashCheck.verdict === "void") {
      const bundle: BlindImageBundle = {
        promptSha256: actualHash,
        reason: hashCheck.reason,
        samples: [],
        verdict: "void",
      };
      mkdirSync(outputPath, { recursive: true });
      writeFileSync(path.join(outputPath, "bundle.json"), `${JSON.stringify(bundle, null, 2)}\n`);
      console.log(JSON.stringify(bundle, null, 2));
      return bundle;
    }
    const images = imageArgs.map((value, index) => {
      const separator = value.indexOf(":");
      const arm = value.slice(0, separator);
      const imagePath = value.slice(separator + 1);
      return { arm, content: readFileSync(imagePath), id: `${arm}-${index + 1}` };
    });
    const bundle = createImageBlindBundle(
      actualHash,
      images,
      outputPath,
      revealPath,
      argumentValue(args, "--seed"),
    );
    console.log(JSON.stringify(bundle, null, 2));
    return bundle;
  }
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
  if (outputPath !== undefined) writeFileSync(outputPath, `${JSON.stringify(bundle, null, 2)}\n`);
  console.log(JSON.stringify(bundle, null, 2));
  return bundle;
}

if (import.meta.url === `file://${process.argv[1]}`) runCli(process.argv.slice(2));

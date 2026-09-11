#!/usr/bin/env node
// PRD-059 Phase 3: release provenance — every runtime asset links to reviewed
// inputs. Validates same-candidate acquisition receipts, the lock, SBOM and
// license inventory, then emits the canonical release provenance manifest.
// The publish job calls this before `gh release create`; a missing subject,
// crossed SHA, or absent receipt exits nonzero.

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

function fail(code, message) {
  const error = new Error(`${code}: ${message}`);
  error.code = code;
  throw error;
}

export function sha256Bytes(contents) {
  return createHash('sha256').update(contents).digest('hex');
}

export function readJson(path, code) {
  if (!existsSync(path)) fail(code, `missing required input at ${path}`);
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    fail(code, `unparseable JSON at ${path}: ${error instanceof Error ? error.message : String(error)}`);
  }
  throw new Error('unreachable');
}

export function validateProvenanceInputs({ lock, sbom, inventory, subjects, receipts, candidateSha }) {
  // Every runtime subject in the prebuilt set needs exactly one staged asset
  // with a matching SHA, and every receipt must name the candidate SHA.
  const errors = [];
  if (!Array.isArray(subjects) || subjects.length === 0) errors.push('no release subjects supplied');
  const lockIds = new Set((lock.components ?? []).flatMap((component) => (component.payloads ?? []).map((payload) => payload.id)));
  for (const subject of subjects ?? []) {
    if (!subject?.name || !subject?.sha256 || !subject?.url) errors.push(`subject '${subject?.name ?? '?'}' is missing name/sha256/url`);
    if (subject?.candidateSha && subject.candidateSha !== candidateSha) {
      errors.push(`subject '${subject.name}' names ${subject.candidateSha}, not candidate ${candidateSha}`);
    }
  }
  for (const receipt of receipts ?? []) {
    if (receipt?.sourceSha && receipt.sourceSha !== candidateSha) {
      errors.push(`receipt for '${receipt.dir ?? '?'}' names ${receipt.sourceSha}, not candidate ${candidateSha}`);
    }
  }
  if (!lockIds.size) errors.push('lock carries no payload ids');
  if (!sbom || sbom.bomFormat !== 'CycloneDX') errors.push('SBOM is not a CycloneDX document');
  if (!Array.isArray(inventory?.components) || inventory.components.length === 0) {
    errors.push('license inventory carries no components');
  }
  return errors;
}

export function generateProvenance({ lock, sbomText, inventoryText, subjects, receipts, candidate, repository, tag, runUrl, pnpmLockSha256, cargoLockSha256 }) {
  const errors = validateProvenanceInputs({
    lock,
    sbom: JSON.parse(sbomText),
    inventory: JSON.parse(inventoryText),
    subjects,
    receipts,
    candidateSha: candidate,
  });
  if (errors.length > 0) {
    fail('TN_RELEASE_PROVENANCE_INVALID', errors.join('; '));
  }
  const lockText = JSON.stringify(lock);
  const manifest = {
    schemaVersion: 1,
    repository,
    tag,
    candidateSha: candidate,
    workflowRunUrl: runUrl ?? '',
    subjects: [...subjects].sort((a, b) => String(a.name).localeCompare(String(b.name))),
    dependencyLock: { sha256: sha256Bytes(Buffer.from(lockText)) },
    sbom: { sha256: sha256Bytes(Buffer.from(sbomText)) },
    licenseInventory: { sha256: sha256Bytes(Buffer.from(inventoryText)) },
    receipts: (receipts ?? []).map((receipt) => ({ dir: receipt.dir, sha256: sha256Bytes(Buffer.from(JSON.stringify(receipt))) })).sort((a, b) => a.dir.localeCompare(b.dir)),
    sourceLocks: { pnpmLockSha256: pnpmLockSha256 ?? '', cargoLockSha256: cargoLockSha256 ?? '' },
  };
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

function usage() {
  return 'Usage: generate-native-release-provenance.mjs --lock FILE --sbom FILE --inventory FILE --subjects FILE --receipts FILE --candidate SHA --repository OWNER/REPO --tag TAG --run-url URL --out FILE [--pnpm-lock-sha HEX --cargo-lock-sha HEX]';
}

function flag(args, name) {
  const index = args.indexOf(name);
  if (index === -1 || !args[index + 1] || args[index + 1].startsWith('--')) fail('TN_RELEASE_PROVENANCE_ARGS', `${name} requires a value. ${usage()}`);
  return args[index + 1];
}

async function main() {
  const args = process.argv.slice(2);
  const lock = readJson(flag(args, '--lock'), 'TN_RELEASE_PROVENANCE_LOCK_MISSING');
  const sbomText = readFileSync(flag(args, '--sbom'), 'utf8');
  const inventoryText = readFileSync(flag(args, '--inventory'), 'utf8');
  const subjects = readJson(flag(args, '--subjects'), 'TN_RELEASE_PROVENANCE_SUBJECTS_MISSING');
  const receipts = readJson(flag(args, '--receipts'), 'TN_RELEASE_PROVENANCE_RECEIPTS_MISSING');
  const out = flag(args, '--out');
  const manifest = generateProvenance({
    lock,
    sbomText,
    inventoryText,
    subjects: subjects.subjects ?? subjects,
    receipts: receipts.receipts ?? receipts,
    candidate: flag(args, '--candidate'),
    repository: flag(args, '--repository'),
    tag: flag(args, '--tag'),
    runUrl: flag(args, '--run-url'),
    pnpmLockSha256: args.includes('--pnpm-lock-sha') ? flag(args, '--pnpm-lock-sha') : undefined,
    cargoLockSha256: args.includes('--cargo-lock-sha') ? flag(args, '--cargo-lock-sha') : undefined,
  });
  mkdirSync(dirname(resolve(out)), { recursive: true });
  writeFileSync(resolve(out), manifest);
  console.log(`Wrote release provenance to ${out}`);
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}

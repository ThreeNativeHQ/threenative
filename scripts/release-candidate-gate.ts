import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const REQUIRED_CREDENTIALS = [
  "npmPublish",
  "linuxAttestation",
  "windowsSigning",
  "macosSigning",
  "macosNotarization",
  "androidSigning",
  "iosSigning",
  "iosExport",
] as const;

export const REQUIRED_HOSTED_CAPABILITIES = [
  "ubuntuRunner",
  "windowsRunner",
  "macosRunner",
  "androidSdk",
  "xcode",
  "timestampService",
] as const;

type CredentialName = (typeof REQUIRED_CREDENTIALS)[number];
type HostedCapabilityName = (typeof REQUIRED_HOSTED_CAPABILITIES)[number];
type RegistryState = "absent" | "matching";

export interface IReleasePackage {
  readonly name: string;
  readonly version: string;
  readonly registryState: RegistryState;
  readonly integrity?: string;
  readonly packedSha256?: string;
}

export interface IReleaseRun {
  readonly databaseId: number;
  readonly status: string;
  readonly conclusion: string;
  readonly event: string;
  readonly headBranch: string;
  readonly headSha: string;
}

export interface IReleaseReport {
  readonly candidateSha: string;
  readonly verdict?: "PASS";
  readonly reportSha256: string;
  readonly subjects?: readonly string[];
}

export interface IReleaseCandidate {
  readonly schemaVersion: 1;
  readonly repository: string;
  readonly tag: string;
  readonly candidateSha: string;
  readonly runtimeVersion: string;
  readonly packageCohort: readonly IReleasePackage[];
  readonly requiredRuns: { readonly ci: IReleaseRun; readonly native: IReleaseRun };
  readonly parity: IReleaseReport & { readonly verdict: "PASS" };
  readonly provenance: IReleaseReport & { readonly subjects: readonly string[] };
  readonly subjects: { readonly github: readonly string[]; readonly npm: readonly string[] };
  readonly credentials: Readonly<Record<CredentialName, boolean>>;
  readonly hostedCapabilities: Readonly<Record<HostedCapabilityName, boolean>>;
}

export type ReleaseCandidateStatus = "PASS" | "FAIL" | "BLOCKED";

export interface IReleaseCandidateValidation {
  readonly status: ReleaseCandidateStatus;
  readonly exitCode: 0 | 1 | 2;
  readonly errors: readonly string[];
  readonly blockers: readonly string[];
}

type RecordValue = Record<string, unknown>;

const SHA256_PATTERN = /^[a-f0-9]{64}$/iu;
const SHA1_PATTERN = /^[a-f0-9]{40}$/iu;
const VERSION_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u;
const PACKAGE_NAME_PATTERN = /^\S+$/u;

const CANDIDATE_KEYS = [
  "schemaVersion",
  "repository",
  "tag",
  "candidateSha",
  "runtimeVersion",
  "packageCohort",
  "requiredRuns",
  "parity",
  "provenance",
  "subjects",
  "credentials",
  "hostedCapabilities",
];
const PACKAGE_KEYS = ["name", "version", "registryState", "integrity", "packedSha256"];
const RUN_KEYS = ["databaseId", "status", "conclusion", "event", "headBranch", "headSha"];
const REPORT_KEYS = ["candidateSha", "verdict", "reportSha256", "subjects"];

function isRecord(value: unknown): value is RecordValue {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function keysOf(value: RecordValue): string[] {
  return Object.keys(value);
}

function checkKeys(
  value: RecordValue,
  expected: readonly string[],
  where: string,
  errors: string[],
  required = expected,
): void {
  const expectedSet = new Set(expected);
  for (const key of keysOf(value)) {
    if (!expectedSet.has(key)) errors.push(`${where} has unknown key '${key}'.`);
  }
  for (const key of required) {
    if (!(key in value)) errors.push(`${where} is missing '${key}'.`);
  }
}

function stringValue(value: unknown, where: string, errors: string[]): string | undefined {
  if (typeof value !== "string" || value.length === 0) {
    errors.push(`${where} must be a non-empty string.`);
    return undefined;
  }
  return value;
}

function shaValue(value: unknown, where: string, errors: string[]): string | undefined {
  const result = stringValue(value, where, errors);
  if (result !== undefined && !SHA1_PATTERN.test(result)) {
    errors.push(`${where} must be a 40-character hexadecimal commit SHA.`);
    return undefined;
  }
  return result;
}

function sha256Value(value: unknown, where: string, errors: string[]): string | undefined {
  const result = stringValue(value, where, errors);
  if (result !== undefined && !SHA256_PATTERN.test(result)) {
    errors.push(`${where} must be a 64-character hexadecimal SHA-256.`);
    return undefined;
  }
  return result;
}

function validateRun(
  value: unknown,
  where: string,
  candidateSha: string | undefined,
  errors: string[],
): value is IReleaseRun {
  if (!isRecord(value)) {
    errors.push(`${where} must be an object.`);
    return false;
  }
  checkKeys(value, RUN_KEYS, where, errors);
  const databaseId = value.databaseId;
  if (typeof databaseId !== "number" || !Number.isSafeInteger(databaseId) || databaseId <= 0)
    errors.push(`${where}.databaseId must be a positive safe integer.`);
  for (const field of ["status", "conclusion", "event", "headBranch"] as const)
    stringValue(value[field], `${where}.${field}`, errors);
  const headSha = shaValue(value.headSha, `${where}.headSha`, errors);
  if (
    headSha !== undefined &&
    candidateSha !== undefined &&
    headSha.toLowerCase() !== candidateSha.toLowerCase()
  )
    errors.push(`${where}.headSha must equal candidateSha.`);
  if (value.status !== "completed") errors.push(`${where}.status must be 'completed'.`);
  if (value.conclusion !== "success") errors.push(`${where}.conclusion must be 'success'.`);
  if (value.event !== "push") errors.push(`${where}.event must be 'push'.`);
  if (value.headBranch !== "main") errors.push(`${where}.headBranch must be 'main'.`);
  return true;
}

function validateReport(
  value: unknown,
  where: string,
  candidateSha: string | undefined,
  errors: string[],
  requireVerdict: boolean,
  requireSubjects: boolean,
): value is IReleaseReport {
  if (!isRecord(value)) {
    errors.push(`${where} must be an object.`);
    return false;
  }
  checkKeys(value, REPORT_KEYS, where, errors, [
    "candidateSha",
    "reportSha256",
    ...(requireVerdict ? ["verdict"] : []),
    ...(requireSubjects ? ["subjects"] : []),
  ]);
  const reportCandidateSha = shaValue(value.candidateSha, `${where}.candidateSha`, errors);
  if (
    reportCandidateSha !== undefined &&
    candidateSha !== undefined &&
    reportCandidateSha.toLowerCase() !== candidateSha.toLowerCase()
  )
    errors.push(`${where}.candidateSha must equal candidateSha.`);
  sha256Value(value.reportSha256, `${where}.reportSha256`, errors);
  if (requireVerdict && value.verdict !== "PASS") errors.push(`${where}.verdict must be 'PASS'.`);
  if (requireSubjects) {
    if (!Array.isArray(value.subjects) || value.subjects.length === 0) {
      errors.push(`${where}.subjects must contain at least one provenance subject.`);
    } else {
      for (const [index, subject] of value.subjects.entries())
        stringValue(subject, `${where}.subjects[${index}]`, errors);
    }
  }
  return true;
}

function validateBooleanMap(
  value: unknown,
  where: string,
  expected: readonly string[],
  errors: string[],
  blockers: string[],
): void {
  if (!isRecord(value)) {
    errors.push(`${where} must be an object.`);
    return;
  }
  checkKeys(value, expected, where, errors);
  for (const key of expected) {
    if (typeof value[key] !== "boolean") errors.push(`${where}.${key} must be boolean.`);
    else if (value[key] === false) blockers.push(`${where}.${key}`);
  }
}

function registryStateValue(
  value: unknown,
  where: string,
  errors: string[],
): RegistryState | undefined {
  if (value === "absent" || value === "matching") return value;
  errors.push(`${where} must be 'absent' or 'matching'.`);
  return undefined;
}

function validatePackageMetadata(
  value: RecordValue,
  where: string,
  registryState: RegistryState | undefined,
  errors: string[],
): void {
  if (
    value.integrity !== undefined &&
    (typeof value.integrity !== "string" || !/^sha(512|256)-\S+$/u.test(value.integrity))
  )
    errors.push(`${where}.integrity must be an npm integrity value.`);
  if (value.packedSha256 !== undefined)
    sha256Value(value.packedSha256, `${where}.packedSha256`, errors);
  if (registryState !== "matching") return;
  if (value.integrity === undefined)
    errors.push(`${where}.integrity is required for matching registry bytes.`);
  if (value.packedSha256 === undefined)
    errors.push(`${where}.packedSha256 is required for matching registry bytes.`);
}

function validatePackageEntry(
  value: unknown,
  index: number,
  names: Set<string>,
  errors: string[],
): IReleasePackage | undefined {
  const where = `packageCohort[${index}]`;
  if (!isRecord(value)) {
    errors.push(`${where} must be an object.`);
    return undefined;
  }
  checkKeys(value, PACKAGE_KEYS, where, errors, ["name", "version", "registryState"]);
  const name = stringValue(value.name, `${where}.name`, errors);
  if (name !== undefined && !PACKAGE_NAME_PATTERN.test(name))
    errors.push(`${where}.name must not contain whitespace.`);
  if (name !== undefined && names.has(name)) errors.push(`${where}.name is duplicated.`);
  if (name !== undefined) names.add(name);
  const version = stringValue(value.version, `${where}.version`, errors);
  if (version !== undefined && !VERSION_PATTERN.test(version))
    errors.push(`${where}.version must be a publishable semantic version.`);
  const registryState = registryStateValue(value.registryState, `${where}.registryState`, errors);
  validatePackageMetadata(value, where, registryState, errors);
  if (name === undefined || version === undefined || registryState === undefined) return undefined;
  return {
    name,
    version,
    registryState,
    ...(typeof value.integrity === "string" ? { integrity: value.integrity } : {}),
    ...(typeof value.packedSha256 === "string" ? { packedSha256: value.packedSha256 } : {}),
  };
}

function validatePackageCohort(
  value: unknown,
  runtimeVersion: string | undefined,
  errors: string[],
): readonly IReleasePackage[] {
  if (!Array.isArray(value) || value.length === 0) {
    errors.push("packageCohort must contain at least one package.");
    return [];
  }
  const packages: IReleasePackage[] = [];
  const names = new Set<string>();
  for (const [index, entry] of value.entries()) {
    const packageEntry = validatePackageEntry(entry, index, names, errors);
    if (packageEntry !== undefined) {
      if (runtimeVersion !== undefined && packageEntry.version !== runtimeVersion)
        errors.push(`packageCohort[${index}].version must equal runtimeVersion.`);
      packages.push(packageEntry);
    }
  }
  return packages;
}

function uniqueStrings(value: unknown, where: string, errors: string[]): readonly string[] {
  if (!Array.isArray(value) || value.length === 0) {
    errors.push(`${where} must contain at least one subject.`);
    return [];
  }
  const result: string[] = [];
  const seen = new Set<string>();
  for (const [index, entry] of value.entries()) {
    const subject = stringValue(entry, `${where}[${index}]`, errors);
    if (subject !== undefined) {
      if (seen.has(subject)) errors.push(`${where} contains duplicate '${subject}'.`);
      seen.add(subject);
      result.push(subject);
    }
  }
  return result;
}

interface ICandidateIdentity {
  readonly candidateSha: string | undefined;
  readonly runtimeVersion: string | undefined;
}

function validateCandidateIdentity(
  input: RecordValue,
  expectedRepository: string | undefined,
  errors: string[],
): ICandidateIdentity {
  checkKeys(input, CANDIDATE_KEYS, "release candidate", errors);
  if (input.schemaVersion !== 1) errors.push("release candidate.schemaVersion must be 1.");
  const repository = stringValue(input.repository, "repository", errors);
  if (
    expectedRepository !== undefined &&
    repository !== undefined &&
    repository !== expectedRepository
  )
    errors.push(`repository must equal '${expectedRepository}'.`);
  const candidateSha = shaValue(input.candidateSha, "candidateSha", errors);
  const runtimeVersion = stringValue(input.runtimeVersion, "runtimeVersion", errors);
  if (runtimeVersion !== undefined && !VERSION_PATTERN.test(runtimeVersion))
    errors.push("runtimeVersion must be a publishable semantic version.");
  if (
    typeof input.tag !== "string" ||
    runtimeVersion === undefined ||
    input.tag !== `runtime-native-v${runtimeVersion}`
  )
    errors.push("tag must equal runtime-native-v<runtimeVersion>.");
  return { candidateSha, runtimeVersion };
}

function validateRequiredEvidence(
  input: RecordValue,
  candidateSha: string | undefined,
  errors: string[],
  blockers: string[],
): void {
  if (isRecord(input.requiredRuns)) {
    checkKeys(input.requiredRuns, ["ci", "native"], "requiredRuns", errors);
    validateRun(input.requiredRuns.ci, "requiredRuns.ci", candidateSha, errors);
    validateRun(input.requiredRuns.native, "requiredRuns.native", candidateSha, errors);
  } else errors.push("requiredRuns must contain ci and native objects.");
  validateReport(input.parity, "parity", candidateSha, errors, true, false);
  validateReport(input.provenance, "provenance", candidateSha, errors, false, true);
  validateBooleanMap(input.credentials, "credentials", REQUIRED_CREDENTIALS, errors, blockers);
  validateBooleanMap(
    input.hostedCapabilities,
    "hostedCapabilities",
    REQUIRED_HOSTED_CAPABILITIES,
    errors,
    blockers,
  );
}

function validateSubjectSet(
  value: unknown,
  packages: readonly IReleasePackage[],
  errors: string[],
): void {
  if (!isRecord(value)) {
    errors.push("subjects must contain github and npm arrays.");
    return;
  }
  checkKeys(value, ["github", "npm"], "subjects", errors);
  const githubSubjects = uniqueStrings(value.github, "subjects.github", errors);
  const npmSubjects = uniqueStrings(value.npm, "subjects.npm", errors);
  const expectedNpmSubjects = packages.map((item) => `${item.name}@${item.version}`).sort();
  if (JSON.stringify([...npmSubjects].sort()) !== JSON.stringify(expectedNpmSubjects))
    errors.push("subjects.npm must exactly equal the package cohort versions.");
  if (githubSubjects.length === 0) errors.push("subjects.github must contain release subjects.");
}

export function validateReleaseCandidate(
  input: unknown,
  expectedRepository?: string,
  expectedInvokingSha?: string,
): IReleaseCandidateValidation {
  const errors: string[] = [];
  const blockers: string[] = [];
  if (!isRecord(input)) {
    return {
      status: "FAIL",
      exitCode: 1,
      errors: ["release candidate must be a JSON object."],
      blockers: [],
    };
  }
  const { candidateSha, runtimeVersion } = validateCandidateIdentity(
    input,
    expectedRepository,
    errors,
  );
  const invokingSha =
    expectedInvokingSha === undefined
      ? undefined
      : shaValue(expectedInvokingSha, "invoking commit SHA", errors);
  if (
    candidateSha !== undefined &&
    invokingSha !== undefined &&
    candidateSha.toLowerCase() !== invokingSha.toLowerCase()
  )
    errors.push("candidateSha must equal invoking commit SHA.");
  const packages = validatePackageCohort(input.packageCohort, runtimeVersion, errors);
  validateRequiredEvidence(input, candidateSha, errors, blockers);
  validateSubjectSet(input.subjects, packages, errors);

  if (errors.length > 0) return { status: "FAIL", exitCode: 1, errors, blockers: [] };
  if (blockers.length > 0) return { status: "BLOCKED", exitCode: 2, errors: [], blockers };
  return { status: "PASS", exitCode: 0, errors: [], blockers: [] };
}

export function formatReleaseCandidateValidation(result: IReleaseCandidateValidation): string {
  const lines = [`${result.status}: releaseCandidateV1`];
  for (const error of result.errors) lines.push(`FAIL ${error}`);
  for (const blocker of result.blockers) lines.push(`BLOCKED ${blocker} is unavailable.`);
  if (result.status === "PASS")
    lines.push("Exact candidate, dependency evidence, subject set, and release inputs are ready.");
  return `${lines.join("\n")}\n`;
}

function cliError(message: string, exitCode: 1 | 2): never {
  process.stderr.write(`${message}\n`);
  process.exitCode = exitCode;
  throw new Error(message);
}

export function main(argv: readonly string[] = process.argv.slice(2)): void {
  if (argv[0] !== "validate")
    cliError("TN_RELEASE_CANDIDATE_USAGE: expected 'validate --candidate <path>'.", 1);
  const candidateIndex = argv.indexOf("--candidate");
  const candidateArgument = candidateIndex >= 0 ? argv[candidateIndex + 1] : undefined;
  if (candidateArgument === undefined)
    cliError("TN_RELEASE_CANDIDATE_USAGE: --candidate requires a JSON path.", 1);
  const unknown = argv.filter(
    (argument, index) =>
      argument !== "validate" &&
      argument !== "--candidate" &&
      argument !== candidateArgument &&
      argument !== "--repository" &&
      (index === 0 || argument !== argv[argv.indexOf("--repository") + 1]),
  );
  if (unknown.length > 0)
    cliError(`TN_RELEASE_CANDIDATE_USAGE: unknown argument '${unknown[0]}'.`, 1);
  const candidatePath = resolve(candidateArgument);
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(candidatePath, "utf8"));
  } catch (error: unknown) {
    const code =
      typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT"
        ? 2
        : 1;
    cliError(
      code === 2
        ? `TN_RELEASE_CANDIDATE_BLOCKED: candidate file '${candidatePath}' is missing; prepare releaseCandidateV1 before the tag.`
        : `TN_RELEASE_CANDIDATE_FAIL: candidate file '${candidatePath}' is not valid JSON.`,
      code,
    );
  }
  const repositoryIndex = argv.indexOf("--repository");
  const expectedRepository =
    repositoryIndex >= 0 ? argv[repositoryIndex + 1] : process.env.GITHUB_REPOSITORY;
  const result = validateReleaseCandidate(parsed, expectedRepository, process.env.GITHUB_SHA);
  process.stdout.write(formatReleaseCandidateValidation(result));
  process.exitCode = result.exitCode;
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  try {
    main();
  } catch {
    // cliError has already emitted the actionable message and set process.exitCode.
  }
}

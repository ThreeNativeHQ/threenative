import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  type IRegistryObservation,
  type IReleaseCandidate,
  type IReleaseCandidateRequest,
  type IReleaseReport,
  type IReleaseReportReference,
  type IReleaseRun,
  REQUIRED_CREDENTIALS,
  REQUIRED_HOSTED_CAPABILITIES,
  expectedGithubSubjects,
  expectedReleasePackages,
  expectedReleaseReportReference,
  expectedReleaseReportSubjects,
  normalizedPackageTreeHash,
  parseGithubRun,
  parseEvidenceReport,
  registryPackageObservation,
  resolveReleaseCandidate,
  validateReleaseCandidate,
  verifyRegistryCohort,
} from "../release-candidate-gate.js";

const CANDIDATE_SHA = "a".repeat(40);

function packageTarball(): Buffer {
  const root = mkdtempSync(join(tmpdir(), "threenative-release-test-"));
  try {
    mkdirSync(join(root, "package"));
    writeFileSync(
      join(root, "package", "package.json"),
      JSON.stringify({ name: "@threenative/core", version: "0.3.0" }),
    );
    writeFileSync(join(root, "package", "README.md"), "release fixture\n");
    const archive = join(root, "package.tgz");
    execFileSync("tar", ["-czf", archive, "-C", root, "package"]);
    return readFileSync(archive);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function candidate(overrides: Partial<IReleaseCandidate> = {}): IReleaseCandidate {
  const packages = expectedReleasePackages().map((item) => ({
    ...item,
    registryState: "absent" as const,
  }));
  return {
    schemaVersion: 1,
    repository: "ThreeNativeHQ/threenative",
    tag: "runtime-native-v0.3.0",
    candidateSha: CANDIDATE_SHA,
    runtimeVersion: "0.3.0",
    packageCohort: packages,
    requiredRuns: {
      ci: {
        databaseId: 101,
        status: "completed",
        conclusion: "success",
        event: "push",
        headBranch: "main",
        headSha: CANDIDATE_SHA,
        workflowPath: ".github/workflows/ci.yml",
      },
      native: {
        databaseId: 102,
        status: "completed",
        conclusion: "success",
        event: "push",
        headBranch: "main",
        headSha: CANDIDATE_SHA,
        workflowPath: ".github/workflows/native-platforms.yml",
      },
    },
    parity: {
      reportSchemaVersion: 1,
      reportType: "parity",
      candidateSha: CANDIDATE_SHA,
      verdict: "PASS",
      reportSha256: "b".repeat(64),
      sourceRunId: 102,
      sourceWorkflowPath: ".github/workflows/native-platforms.yml",
      artifactName: "native-release-parity",
      artifactPath: "reports/parity.json",
      subjects: expectedReleaseReportSubjects("parity"),
    },
    provenance: {
      reportSchemaVersion: 1,
      reportType: "provenance",
      candidateSha: CANDIDATE_SHA,
      verdict: "PASS",
      reportSha256: "c".repeat(64),
      sourceRunId: 102,
      sourceWorkflowPath: ".github/workflows/native-platforms.yml",
      artifactName: "native-release-provenance",
      artifactPath: "reports/provenance.json",
      subjects: expectedReleaseReportSubjects("provenance"),
    },
    subjects: {
      github: expectedGithubSubjects(),
      npm: packages.map((item) => `${item.name}@${item.version}`).sort(),
    },
    credentials: Object.fromEntries(
      REQUIRED_CREDENTIALS.map((name) => [name, true]),
    ) as IReleaseCandidate["credentials"],
    hostedCapabilities: Object.fromEntries(
      REQUIRED_HOSTED_CAPABILITIES.map((name) => [name, true]),
    ) as IReleaseCandidate["hostedCapabilities"],
    resolution: {
      producerRunId: 103,
      source: "release-candidate-workflow",
      packageSource: "workspace-manifests",
      githubSubjectSource: "runtime-native-prebuilt-keys",
      evidenceSource: "github-api-and-artifacts",
      registrySource: "npm-version-metadata-and-tarballs",
      availabilitySource: "workflow-inputs",
      registryVerified: true,
      evidenceVerified: true,
    },
    ...overrides,
  };
}

describe("release candidate gate", () => {
  it("should accept a complete exact-candidate release input", () => {
    expect(validateReleaseCandidate(candidate(), "ThreeNativeHQ/threenative")).toEqual({
      status: "PASS",
      exitCode: 0,
      errors: [],
      blockers: [],
    });
  });

  it("should reject a report wrapper with an arbitrary artifact contract or subject set", () => {
    const invalid = candidate({
      parity: {
        ...candidate().parity,
        artifactName: "arbitrary-report",
        artifactPath: "arbitrary.json",
        subjects: ["arbitrary.json"],
      },
    });

    const result = validateReleaseCandidate(invalid, "ThreeNativeHQ/threenative");

    expect(result.status).toBe("FAIL");
    expect(result.exitCode).toBe(1);
    expect(result.errors.join("\n")).toMatch(/parity|artifact|subject/i);
  });

  it("should reject a minimal PASS payload that omits the parity target evidence", () => {
    const payload = {
      candidateSha: CANDIDATE_SHA,
      verdict: "PASS",
      subjects: expectedReleaseReportSubjects("parity"),
    };

    expect(() =>
      parseEvidenceReport(
        Buffer.from(JSON.stringify(payload)),
        CANDIDATE_SHA,
        "reports/parity.json",
        "parity",
      ),
    ).toThrow(/schemaVersion|targetReports|registrySha256/i);
  });

  it("should reject provenance evidence with an incomplete subject hash set", () => {
    const subjects = expectedReleaseReportSubjects("provenance");
    const payload = {
      schemaVersion: 1,
      reportType: "provenance",
      candidateSha: CANDIDATE_SHA,
      verdict: "PASS",
      subjects,
      subjectHashes: Object.fromEntries(
        subjects.slice(1).map((subject) => [subject, "a".repeat(64)]),
      ),
      dependencyLockSha256: "a".repeat(64),
      sbomSha256: "a".repeat(64),
      licenseInventorySha256: "a".repeat(64),
      pnpmLockSha256: "a".repeat(64),
      cargoLockSha256: "a".repeat(64),
    };

    expect(() =>
      parseEvidenceReport(
        Buffer.from(JSON.stringify(payload)),
        CANDIDATE_SHA,
        "reports/provenance.json",
        "provenance",
      ),
    ).toThrow(/subjectHashes/i);
  });

  it("should reject unknown missing or secret-bearing release candidate fields", () => {
    const invalid = {
      ...candidate(),
      // Deliberately model the mistake as an unknown top-level key rather than accepting a secret.
      npmToken: "do-not-serialize",
      provenance: { ...candidate().provenance, subjects: [] },
    } as unknown as IReleaseCandidate;
    const result = validateReleaseCandidate(invalid, "ThreeNativeHQ/threenative");

    expect(result.status).toBe("FAIL");
    expect(result.exitCode).toBe(1);
    expect(result.errors.join("\n")).toMatch(/unknown key.*npmToken|provenance.*subject/i);
  });

  it("should require successful CI parity and provenance evidence from the tag commit", () => {
    const stale = candidate({
      requiredRuns: {
        ...candidate().requiredRuns,
        ci: { ...candidate().requiredRuns.ci, headSha: "d".repeat(40) },
      },
      parity: { ...candidate().parity, candidateSha: "d".repeat(40) },
    });
    const result = validateReleaseCandidate(stale, "ThreeNativeHQ/threenative");

    expect(result.status).toBe("FAIL");
    expect(result.exitCode).toBe(1);
    expect(result.errors.join("\n")).toMatch(/candidate.*SHA|headSha|parity/i);
  });

  it("should reject incomplete package and GitHub subject sets", () => {
    const complete = candidate();
    const firstPackage = complete.packageCohort[0];
    const firstGithubSubject = complete.subjects.github[0];
    if (firstPackage === undefined || firstGithubSubject === undefined)
      throw new Error("complete candidate fixture is unexpectedly empty");
    const invalid = candidate({
      packageCohort: [firstPackage],
      subjects: {
        github: [firstGithubSubject],
        npm: ["@threenative/core@0.2.3"],
      },
    });
    const result = validateReleaseCandidate(invalid, "ThreeNativeHQ/threenative");

    expect(result.status).toBe("FAIL");
    expect(result.exitCode).toBe(1);
    expect(result.errors.join("\n")).toMatch(/packageCohort|subjects\.github/i);
  });

  it("should require every public package to use its manifest version", () => {
    const complete = candidate();
    const firstPackage = complete.packageCohort[0];
    if (firstPackage === undefined)
      throw new Error("complete candidate fixture is unexpectedly empty");
    const invalid = candidate({
      packageCohort: complete.packageCohort.map((item) =>
        item.name === firstPackage.name ? { ...item, version: "9.9.9" } : item,
      ),
    });
    const result = validateReleaseCandidate(invalid, "ThreeNativeHQ/threenative");

    expect(result.status).toBe("FAIL");
    expect(result.errors.join("\n")).toContain(
      `packageCohort.${firstPackage.name} must use workspace version ${firstPackage.version}`,
    );
  });

  it("should bind the candidate file to the commit that invokes the gate", () => {
    const result = validateReleaseCandidate(
      candidate(),
      "ThreeNativeHQ/threenative",
      "d".repeat(40),
    );

    expect(result.status).toBe("FAIL");
    expect(result.exitCode).toBe(1);
    expect(result.errors.join("\n")).toContain("candidateSha must equal invoking commit SHA");
  });

  it("should block before signing or publication when any required credential is absent", () => {
    const credentials = { ...candidate().credentials, iosSigning: false };
    const result = validateReleaseCandidate(
      candidate({ credentials }),
      "ThreeNativeHQ/threenative",
    );

    expect(result).toEqual({
      status: "BLOCKED",
      exitCode: 2,
      errors: [],
      blockers: ["credentials.iosSigning"],
    });
  });

  it("should block when a hosted platform capability is unavailable", () => {
    const hostedCapabilities = { ...candidate().hostedCapabilities, macosRunner: false };
    const result = validateReleaseCandidate(
      candidate({ hostedCapabilities }),
      "ThreeNativeHQ/threenative",
    );

    expect(result.status).toBe("BLOCKED");
    expect(result.exitCode).toBe(2);
    expect(result.blockers).toEqual(["hostedCapabilities.macosRunner"]);
  });

  it("should reject a mismatched package subject set or a non-publishable registry state", () => {
    const invalid = candidate({
      packageCohort: [
        {
          name: "@threenative/core",
          version: "0.2.3",
          registryState: "matching",
        },
      ],
      subjects: { ...candidate().subjects, npm: ["@threenative/core@0.2.3"] },
    });
    const result = validateReleaseCandidate(invalid, "ThreeNativeHQ/threenative");

    expect(result.status).toBe("FAIL");
    expect(result.exitCode).toBe(1);
    expect(result.errors.join("\n")).toMatch(/packedSha256|cohort|subject/i);
  });

  it("should require a producer resolution record instead of trusting a handwritten candidate", () => {
    const invalid = { ...candidate(), resolution: undefined } as unknown as IReleaseCandidate;
    const result = validateReleaseCandidate(invalid, "ThreeNativeHQ/threenative");

    expect(result.status).toBe("FAIL");
    expect(result.exitCode).toBe(1);
    expect(result.errors.join("\n")).toContain("resolution must be an object");
  });

  it("should map the GitHub REST run id into the candidate run identity", () => {
    expect(
      parseGithubRun(
        {
          id: 204,
          status: "completed",
          conclusion: "success",
          event: "push",
          head_branch: "main",
          head_sha: CANDIDATE_SHA,
          path: ".github/workflows/ci.yml",
        },
        204,
        CANDIDATE_SHA,
        ".github/workflows/ci.yml",
      ),
    ).toEqual({
      databaseId: 204,
      status: "completed",
      conclusion: "success",
      event: "push",
      headBranch: "main",
      headSha: CANDIDATE_SHA,
      workflowPath: ".github/workflows/ci.yml",
    });
  });

  it("should compare matching registry claims with downloaded tarball observations", async () => {
    const item = candidate().packageCohort[0];
    if (item === undefined) throw new Error("complete candidate fixture is unexpectedly empty");
    const matching: IRegistryObservation = {
      state: "matching",
      integrity: "sha512-actual",
      packedSha256: "d".repeat(64),
      normalizedSha256: "a".repeat(64),
    };
    const invalid = candidate({
      packageCohort: [
        {
          ...item,
          registryState: "matching",
          integrity: "sha512-claimed",
          packedSha256: "e".repeat(64),
          normalizedSha256: "f".repeat(64),
        },
        ...candidate().packageCohort.slice(1),
      ],
    });
    const result = await verifyRegistryCohort(invalid, async () => matching);

    expect(result.blockers).toEqual([]);
    expect(result.errors.join("\n")).toMatch(/integrity|tarball SHA-256/i);
  });

  it("should hash the registry tarball against npm integrity metadata", async () => {
    const contents = packageTarball();
    const integrity = `sha512-${createHash("sha512").update(contents).digest("base64")}`;
    const fetchMock = vi.fn(async (input: string | URL) => {
      if (String(input).startsWith("https://registry.npmjs.org/%40threenative%2Fcore"))
        return new Response(
          JSON.stringify({
            versions: {
              "0.3.0": {
                name: "@threenative/core",
                version: "0.3.0",
                dist: { integrity, tarball: "https://registry.npmjs.org/core-fixture.tgz" },
              },
            },
          }),
        );
      return new Response(new Uint8Array(contents));
    });
    vi.stubGlobal("fetch", fetchMock);
    try {
      await expect(registryPackageObservation("@threenative/core", "0.3.0")).resolves.toEqual({
        state: "matching",
        integrity,
        packedSha256: createHash("sha256").update(contents).digest("hex"),
        normalizedSha256: normalizedPackageTreeHash(contents, "@threenative/core", "0.3.0"),
      });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("should derive the package, run, report, subject, and availability fields", async () => {
    const request: IReleaseCandidateRequest = {
      schemaVersion: 1,
      repository: "ThreeNativeHQ/threenative",
      tag: "runtime-native-v0.3.0",
      candidateSha: CANDIDATE_SHA,
      runtimeVersion: "0.3.0",
      requiredRunIds: { ci: 201, native: 202 },
      reportArtifacts: {
        parity: {
          ...expectedReleaseReportReference("parity", 202),
        },
        provenance: {
          ...expectedReleaseReportReference("provenance", 202),
        },
      },
    };
    const availability = {
      credentials: Object.fromEntries(REQUIRED_CREDENTIALS.map((name) => [name, true])),
      hostedCapabilities: Object.fromEntries(
        REQUIRED_HOSTED_CAPABILITIES.map((name) => [name, true]),
      ),
    };
    const run = (
      _repository: string,
      runId: number,
      _sha: string,
      workflowPath: string,
    ): IReleaseRun => ({
      databaseId: runId,
      status: "completed",
      conclusion: "success",
      event: "push",
      headBranch: "main",
      headSha: CANDIDATE_SHA,
      workflowPath,
    });
    const report = (
      _repository: string,
      sha: string,
      reference: IReleaseReportReference,
      reportType: "parity" | "provenance",
    ): IReleaseReport => ({
      reportSchemaVersion: 1,
      reportType,
      candidateSha: sha,
      verdict: "PASS",
      reportSha256: "f".repeat(64),
      sourceRunId: reference.runId,
      sourceWorkflowPath: reference.workflowPath,
      artifactName: reference.artifactName,
      artifactPath: reference.artifactPath,
      subjects: expectedReleaseReportSubjects(reportType),
    });
    const absent = async (): Promise<IRegistryObservation> => ({ state: "absent" });

    const resolved = await resolveReleaseCandidate({
      request,
      availability,
      invokingSha: CANDIDATE_SHA,
      producerRunId: 203,
      resolveRun: run,
      resolveReport: report,
      registryLookup: absent,
    });

    expect(resolved.packageCohort.map(({ name }) => name)).toEqual(
      expectedReleasePackages().map(({ name }) => name),
    );
    expect(resolved.subjects.github).toEqual(expectedGithubSubjects());
    expect(resolved.requiredRuns.ci.databaseId).toBe(201);
    expect(resolved.provenance.reportSha256).toBe("f".repeat(64));
    expect(validateReleaseCandidate(resolved, request.repository, CANDIDATE_SHA, 203).status).toBe(
      "PASS",
    );
  });

  it("should reject registry bytes whose normalized package tree differs from the workspace", async () => {
    const request: IReleaseCandidateRequest = {
      schemaVersion: 1,
      repository: "ThreeNativeHQ/threenative",
      tag: "runtime-native-v0.3.0",
      candidateSha: CANDIDATE_SHA,
      runtimeVersion: "0.3.0",
      requiredRunIds: { ci: 201, native: 202 },
      reportArtifacts: {
        parity: {
          ...expectedReleaseReportReference("parity", 202),
        },
        provenance: {
          ...expectedReleaseReportReference("provenance", 202),
        },
      },
    };
    const availability = {
      credentials: Object.fromEntries(REQUIRED_CREDENTIALS.map((name) => [name, true])),
      hostedCapabilities: Object.fromEntries(
        REQUIRED_HOSTED_CAPABILITIES.map((name) => [name, true]),
      ),
    };
    const run = (
      _repository: string,
      runId: number,
      _sha: string,
      workflowPath: string,
    ): IReleaseRun => ({
      databaseId: runId,
      status: "completed",
      conclusion: "success",
      event: "push",
      headBranch: "main",
      headSha: CANDIDATE_SHA,
      workflowPath,
    });
    const report = (
      _repository: string,
      sha: string,
      reference: IReleaseReportReference,
      reportType: "parity" | "provenance",
    ): IReleaseReport => ({
      reportSchemaVersion: 1,
      reportType,
      candidateSha: sha,
      verdict: "PASS",
      reportSha256: "f".repeat(64),
      sourceRunId: reference.runId,
      sourceWorkflowPath: reference.workflowPath,
      artifactName: reference.artifactName,
      artifactPath: reference.artifactPath,
      subjects: expectedReleaseReportSubjects(reportType),
    });
    const matching = async (): Promise<IRegistryObservation> => ({
      state: "matching",
      integrity: "sha512-actual",
      packedSha256: "d".repeat(64),
      normalizedSha256: "e".repeat(64),
    });

    await expect(
      resolveReleaseCandidate({
        request,
        availability,
        invokingSha: CANDIDATE_SHA,
        producerRunId: 203,
        resolveRun: run,
        resolveReport: report,
        registryLookup: matching,
        workspacePackageHash: async () => "f".repeat(64),
      }),
    ).rejects.toThrow(/normalized|workspace|package/i);
  });
});

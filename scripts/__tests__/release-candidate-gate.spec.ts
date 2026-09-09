import { describe, expect, it } from "vitest";
import {
  type IReleaseCandidate,
  REQUIRED_CREDENTIALS,
  REQUIRED_HOSTED_CAPABILITIES,
  validateReleaseCandidate,
} from "../release-candidate-gate.js";

const CANDIDATE_SHA = "a".repeat(40);

function candidate(overrides: Partial<IReleaseCandidate> = {}): IReleaseCandidate {
  return {
    schemaVersion: 1,
    repository: "ThreeNativeHQ/threenative",
    tag: "runtime-native-v0.2.3",
    candidateSha: CANDIDATE_SHA,
    runtimeVersion: "0.2.3",
    packageCohort: [
      { name: "@threenative/core", version: "0.2.3", registryState: "absent" },
      { name: "create-threenative", version: "0.2.3", registryState: "absent" },
    ],
    requiredRuns: {
      ci: {
        databaseId: 101,
        status: "completed",
        conclusion: "success",
        event: "push",
        headBranch: "main",
        headSha: CANDIDATE_SHA,
      },
      native: {
        databaseId: 102,
        status: "completed",
        conclusion: "success",
        event: "push",
        headBranch: "main",
        headSha: CANDIDATE_SHA,
      },
    },
    parity: {
      candidateSha: CANDIDATE_SHA,
      verdict: "PASS",
      reportSha256: "b".repeat(64),
    },
    provenance: {
      candidateSha: CANDIDATE_SHA,
      reportSha256: "c".repeat(64),
      subjects: ["sbom.json", "provenance.json"],
    },
    subjects: {
      github: ["prebuilt-lock.json", "threenative-runtime-linux-x64"],
      npm: ["@threenative/core@0.2.3", "create-threenative@0.2.3"],
    },
    credentials: Object.fromEntries(
      REQUIRED_CREDENTIALS.map((name) => [name, true]),
    ) as IReleaseCandidate["credentials"],
    hostedCapabilities: Object.fromEntries(
      REQUIRED_HOSTED_CAPABILITIES.map((name) => [name, true]),
    ) as IReleaseCandidate["hostedCapabilities"],
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

  it("should require every package cohort version to equal the runtime version", () => {
    const invalid = candidate({
      packageCohort: [
        { name: "@threenative/core", version: "0.2.4", registryState: "absent" },
        { name: "create-threenative", version: "0.2.3", registryState: "absent" },
      ],
      subjects: {
        github: candidate().subjects.github,
        npm: ["@threenative/core@0.2.4", "create-threenative@0.2.3"],
      },
    });
    const result = validateReleaseCandidate(invalid, "ThreeNativeHQ/threenative");

    expect(result.status).toBe("FAIL");
    expect(result.exitCode).toBe(1);
    expect(result.errors.join("\n")).toContain("must equal runtimeVersion");
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
});

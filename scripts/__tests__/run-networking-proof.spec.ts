import { describe, expect, it } from "vitest";

const { countEvaluatedAssertions, validateNetworkingProofConfig } = await import(
  // @ts-expect-error The executable JavaScript module is the row's runtime boundary; its behavior is tested here.
  "../run-networking-proof.mjs"
);

const hashes = {
  clientBundleHash: "a".repeat(64),
  nativeBinaryHash: null,
  serverBinaryHash: "b".repeat(64),
};

function config(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    buildHashes: hashes,
    certificates: {
      certPath: "/tmp/networking-cert.pem",
      keyPath: "/tmp/networking-key.pem",
    },
    endpoint: "https://localhost:4433/game",
    laneId: "browser-local",
    partner: {
      args: ["--scenario", "partner.playtest.json"],
      assetDir: "/tmp/networking-partner",
      origin: "https://localhost:5174",
      playerId: "bravo",
    },
    profile: "local",
    server: {
      args: ["--listen", "127.0.0.1:4433"],
      command: "tn-network-server",
    },
    subject: {
      args: ["--scenario", "subject.playtest.json"],
      assetDir: "/tmp/networking-subject",
      origin: "https://localhost:5173",
      playerId: "alpha",
    },
    ...overrides,
  };
}

describe("networking proof contract", () => {
  it("rejects a missing server", () => {
    const value = config();
    value.server = undefined;
    expect(() => validateNetworkingProofConfig(value)).toThrow(/server/u);
  });

  it("rejects a missing partner client", () => {
    const value = config();
    value.partner = undefined;
    expect(() => validateNetworkingProofConfig(value)).toThrow(/partner/u);
  });

  it("rejects mismatched or duplicate client identities", () => {
    expect(() =>
      validateNetworkingProofConfig(
        config({
          partner: {
            args: ["--scenario", "partner.playtest.json"],
            assetDir: "/tmp/networking-partner",
            playerId: "alpha",
          },
        }),
      ),
    ).toThrow(/distinct/u);
  });

  it("rejects a run that evaluated zero assertions", () => {
    expect(() =>
      countEvaluatedAssertions([{ assertionResults: [] }, { assertionResults: [] }]),
    ).toThrow(/zero assertions/u);
  });
});

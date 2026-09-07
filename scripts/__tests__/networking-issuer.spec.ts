import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { makeTempDirSync } from "../../test-support/temp-dir.js";
const { createNetworkingIssuer, networkingSessionFile, validateIssuerConfig } = await import(
  // @ts-expect-error The executable JavaScript module is the row's runtime boundary; its behavior is tested here.
  "../networking-issuer.mjs"
);

function config(assetDir: string) {
  return {
    adminUrl: "http://127.0.0.1:39871",
    bind: "127.0.0.1:0",
    certPath: "/tmp/test-cert.pem",
    keyPath: "/tmp/test-key.pem",
    allowedOrigins: ["https://localhost:5173"],
    room: "networking-proof",
    clients: [{ playerId: "alpha", assetDir }],
  };
}

describe("networking issuer", () => {
  it("rejects missing grant", async () => {
    const issuer = createNetworkingIssuer(config(makeTempDirSync("tn-issuer-")), {
      fetchImpl: async () => new Response("unexpected", { status: 500 }),
    });
    const response = await issuer.requestToken({
      authorization: "",
      origin: "https://localhost:5173",
    });
    expect(response.status).toBe(401);
    expect(response.body).toEqual({ error: "missing or invalid grant" });
  });

  it("rejects expired grant", async () => {
    const assetDir = makeTempDirSync("tn-issuer-");
    let now = Date.now();
    const issuer = createNetworkingIssuer(config(assetDir), {
      now: () => now,
      fetchImpl: async () => new Response("unexpected", { status: 500 }),
    });
    const grant = issuer.stageGrant("alpha");
    now += 15 * 60 * 1000 + 1;
    const response = await issuer.requestToken({
      authorization: `Bearer ${grant.issuerAuthorization}`,
      origin: "https://localhost:5173",
    });
    expect(response.status).toBe(401);
    expect(response.body).toEqual({ error: "missing or invalid grant" });
    await issuer.cleanup();
  });

  it("rejects wrong player", async () => {
    const assetDir = makeTempDirSync("tn-issuer-");
    const issuer = createNetworkingIssuer(config(assetDir), {
      fetchImpl: async () => new Response("unexpected", { status: 500 }),
    });
    const grant = issuer.stageGrant("alpha");
    const response = await issuer.requestToken({
      authorization: `Bearer ${grant.issuerAuthorization}`,
      origin: "https://localhost:5173",
      playerId: "beta",
    });
    expect(response.status).toBe(403);
    expect(response.body).toEqual({ error: "grant is bound to another player" });
    await issuer.cleanup();
  });

  it("redacts credentials", async () => {
    const assetDir = makeTempDirSync("tn-issuer-");
    const grantCredential = "grant-secret-that-must-not-be-logged";
    const joinCredential = "join-secret-from-admin";
    const issuer = createNetworkingIssuer(config(assetDir), {
      randomBytes: () => new Uint8Array(Buffer.from(grantCredential)),
      fetchImpl: async (_url: string, init?: RequestInit) => {
        expect(String(init?.body)).toContain("alpha");
        return new Response(
          JSON.stringify({
            credential: joinCredential,
            expiresAt: new Date(Date.now() + 60_000).toISOString(),
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        );
      },
      logger: (line: string) => {
        expect(line).not.toContain(grantCredential);
        expect(line).not.toContain(joinCredential);
      },
    });
    const grant = issuer.stageGrant("alpha");
    const response = await issuer.requestToken({
      authorization: `Bearer ${grant.issuerAuthorization}`,
      origin: "https://localhost:5173",
    });
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ credential: joinCredential, expiresAt: expect.any(String) });
    expect(JSON.parse(readFileSync(join(assetDir, networkingSessionFile), "utf8"))).toMatchObject({
      issuerAuthorization: Buffer.from(grantCredential).toString("base64url"),
    });
    await issuer.cleanup();
  });

  it("cleans staged grants", async () => {
    const assetDir = makeTempDirSync("tn-issuer-");
    const issuer = createNetworkingIssuer(config(assetDir));
    issuer.stageGrant("alpha");
    expect(existsSync(join(assetDir, networkingSessionFile))).toBe(true);
    await issuer.cleanup();
    expect(existsSync(join(assetDir, networkingSessionFile))).toBe(false);
  });

  it("rejects an unconfigured browser origin", () => {
    expect(() => validateIssuerConfig({ ...config("/tmp/client"), allowedOrigins: [] })).toThrow(
      /allowedOrigins/u,
    );
  });
});

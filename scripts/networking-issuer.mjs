#!/usr/bin/env node

import { createHash, randomBytes as cryptoRandomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { createServer as createHttpsServer } from "node:https";
import { isIP } from "node:net";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const networkingSessionFile = "networking-session.json";
export const grantLifetimeMs = 15 * 60 * 1000;
export const joinTokenLifetimeMs = 60 * 1000;

const MAX_BODY_BYTES = 4096;
const PLAYER_ID = /^[A-Za-z0-9_-]{1,64}$/u;
const CONFIG_KEYS = new Set([
  "adminUrl",
  "allowedOrigins",
  "bind",
  "certPath",
  "clients",
  "keyPath",
  "room",
]);

function invalid(message) {
  throw new Error(`invalid networking issuer config: ${message}`);
}

function assertObject(value, name) {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    invalid(`${name} must be an object`);
}

function normalizeOrigin(value) {
  if (typeof value !== "string" || value.length === 0)
    invalid("allowedOrigins entries must be strings");
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    invalid(`origin ${JSON.stringify(value)} is not a URL`);
  }
  if (parsed.protocol !== "https:") invalid(`origin ${JSON.stringify(value)} must use https`);
  if (
    parsed.username ||
    parsed.password ||
    parsed.pathname !== "/" ||
    parsed.search ||
    parsed.hash
  ) {
    invalid(`origin ${JSON.stringify(value)} must contain only scheme, host and port`);
  }
  const port = parsed.port || "443";
  return `https://${parsed.hostname.toLowerCase()}:${port}`;
}

function isLoopbackHostname(hostname) {
  return (
    hostname === "localhost" ||
    (isIP(hostname) > 0 && new URL(`http://${hostname}`).hostname === hostname)
  );
}

function validateAdminUrl(value) {
  if (typeof value !== "string" || value.length === 0) invalid("adminUrl must be a URL");
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    invalid("adminUrl must be a URL");
  }
  if (parsed.protocol !== "http:") invalid("adminUrl must use loopback http");
  if (!isLoopbackHostname(parsed.hostname)) invalid("adminUrl must use a loopback hostname");
  if (parsed.username || parsed.password || parsed.search || parsed.hash)
    invalid("adminUrl cannot contain credentials, query or fragment");
  parsed.pathname = "/";
  return parsed;
}

function validateBind(value) {
  if (typeof value !== "string" || value.length === 0) invalid("bind must be host:port");
  const match = value.match(/^\[([^\]]+)\]:(\d+)$/u) ?? value.match(/^([^:]+):(\d+)$/u);
  if (!match) invalid("bind must be host:port");
  const hostname = match[1];
  const port = Number(match[2]);
  if (!Number.isInteger(port) || port < 0 || port > 65535) invalid("bind port must be 0-65535");
  if (
    hostname !== "localhost" &&
    hostname !== "0.0.0.0" &&
    hostname !== "::" &&
    isIP(hostname) === 0
  ) {
    invalid("bind hostname must be an IP, localhost, 0.0.0.0 or ::");
  }
  return value;
}

function bindOptions(value) {
  const match = value.match(/^\[([^\]]+)\]:(\d+)$/u) ?? value.match(/^([^:]+):(\d+)$/u);
  return { host: match[1], port: Number(match[2]) };
}

function validateAbsolutePath(value, name) {
  if (typeof value !== "string" || value.length === 0 || !value.startsWith("/")) {
    invalid(`${name} must be an absolute path`);
  }
  return resolve(value);
}

export function validateIssuerConfig(raw) {
  assertObject(raw, "root");
  for (const key of Object.keys(raw))
    if (!CONFIG_KEYS.has(key)) invalid(`unknown key ${JSON.stringify(key)}`);
  const adminUrl = validateAdminUrl(raw.adminUrl);
  const bind = validateBind(raw.bind);
  const certPath = validateAbsolutePath(raw.certPath, "certPath");
  const keyPath = validateAbsolutePath(raw.keyPath, "keyPath");
  if (!Array.isArray(raw.allowedOrigins) || raw.allowedOrigins.length === 0)
    invalid("allowedOrigins must not be empty");
  const allowedOrigins = [...new Set(raw.allowedOrigins.map(normalizeOrigin))];
  const room = raw.room;
  if (typeof room !== "string" || room.length < 1 || room.length > 64)
    invalid("room must be 1-64 characters");
  if (!Array.isArray(raw.clients) || raw.clients.length === 0)
    invalid("clients must contain at least one client");
  const seen = new Set();
  const clients = raw.clients.map((client, index) => {
    assertObject(client, `clients[${index}]`);
    const keys = Object.keys(client);
    if (keys.some((key) => key !== "assetDir" && key !== "playerId"))
      invalid(`clients[${index}] has an unknown key`);
    if (typeof client.playerId !== "string" || !PLAYER_ID.test(client.playerId))
      invalid(`clients[${index}].playerId is invalid`);
    if (seen.has(client.playerId))
      invalid(`clients contains duplicate playerId ${JSON.stringify(client.playerId)}`);
    seen.add(client.playerId);
    return {
      assetDir: validateAbsolutePath(client.assetDir, `clients[${index}].assetDir`),
      playerId: client.playerId,
    };
  });
  return { adminUrl, allowedOrigins, bind, certPath, clients, keyPath, room };
}

function hashGrant(value) {
  return createHash("sha256").update(value).digest("hex");
}

function response(status, body, headers = {}) {
  return { body, headers, status };
}

function bearerValue(value) {
  if (typeof value !== "string" || !value.startsWith("Bearer ")) return null;
  const grant = value.slice("Bearer ".length);
  return grant.length > 0 && /^[A-Za-z0-9_-]+$/u.test(grant) ? grant : null;
}

function sessionPath(assetDir) {
  return resolve(assetDir, networkingSessionFile);
}

function jsonHeaders(origin, allowedOrigins) {
  const headers = { "cache-control": "no-store", "content-type": "application/json" };
  if (origin && allowedOrigins.includes(origin)) {
    headers["access-control-allow-headers"] = "authorization, content-type";
    headers["access-control-allow-methods"] = "POST, OPTIONS";
    headers["access-control-allow-origin"] = origin;
    headers.vary = "Origin";
  }
  return headers;
}

function readRequestBody(request) {
  return new Promise((resolveBody, rejectBody) => {
    let size = 0;
    const chunks = [];
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      size += Buffer.byteLength(chunk);
      if (size > MAX_BODY_BYTES) {
        rejectBody(new Error("request body is too large"));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => resolveBody(chunks.join("")));
    request.on("error", rejectBody);
  });
}

export function createNetworkingIssuer(rawConfig, dependencies = {}) {
  const config = validateIssuerConfig(rawConfig);
  const now = dependencies.now ?? Date.now;
  const randomBytes = dependencies.randomBytes ?? ((length) => cryptoRandomBytes(length));
  const fetchImpl = dependencies.fetchImpl ?? globalThis.fetch;
  const logger = dependencies.logger ?? (() => {});
  if (typeof fetchImpl !== "function")
    throw new Error("networking issuer requires a fetch implementation");
  const grants = new Map();
  const createdFiles = new Map();
  let server;

  function clientFor(playerId) {
    return config.clients.find((client) => client.playerId === playerId);
  }

  function stageGrant(playerId) {
    const client = clientFor(playerId);
    if (!client) throw new Error(`no configured client for player ${JSON.stringify(playerId)}`);
    const previous = [...grants.entries()].find(([, grant]) => grant.playerId === playerId);
    if (previous) grants.delete(previous[0]);
    mkdirSync(client.assetDir, { recursive: true });
    const file = sessionPath(client.assetDir);
    if (existsSync(file) && !createdFiles.has(file))
      throw new Error(`refusing to overwrite existing ${file}`);
    const authorization = Buffer.from(randomBytes(32)).toString("base64url");
    const expiresAt = now() + grantLifetimeMs;
    const staged = {
      expiresAt: new Date(expiresAt).toISOString(),
      issuerAuthorization: authorization,
    };
    writeFileSync(file, `${JSON.stringify(staged)}\n`, { encoding: "utf8", mode: 0o600 });
    grants.set(hashGrant(authorization), { expiresAt, file, playerId });
    createdFiles.set(file, authorization);
    logger(`staged grant player=${playerId} expiresAt=${staged.expiresAt}`);
    return staged;
  }

  function stageAllGrants() {
    return config.clients.map(({ playerId }) => stageGrant(playerId));
  }

  function authorizeOrigin(origin) {
    if (origin === undefined || origin === "") return { normalized: null };
    try {
      const normalized = normalizeOrigin(origin);
      if (!config.allowedOrigins.includes(normalized))
        return { error: response(403, { error: "origin is not allowed" }) };
      return { normalized };
    } catch {
      return { error: response(403, { error: "origin is not allowed" }) };
    }
  }

  function findGrant(authorization, playerId) {
    const grant = bearerValue(authorization);
    const record = grant ? grants.get(hashGrant(grant)) : undefined;
    if (!record || now() >= record.expiresAt)
      return { error: response(401, { error: "missing or invalid grant" }) };
    if (playerId !== undefined && playerId !== record.playerId)
      return { error: response(403, { error: "grant is bound to another player" }) };
    return { record };
  }

  function invalidAdminResponse(message, origin) {
    return response(502, { error: message }, jsonHeaders(origin, config.allowedOrigins));
  }

  async function fetchJoinToken(record, origin) {
    const body = JSON.stringify({ playerId: record.playerId, room: config.room });
    let adminResponse;
    try {
      adminResponse = await fetchImpl(new URL("/token", config.adminUrl), {
        body,
        headers: { "content-type": "application/json" },
        method: "POST",
      });
    } catch {
      logger(`admin token request failed player=${record.playerId}`);
      return invalidAdminResponse("token issuer unavailable", origin);
    }
    if (!adminResponse.ok) {
      logger(
        `admin token request returned status=${adminResponse.status} player=${record.playerId}`,
      );
      return invalidAdminResponse("token issuer unavailable", origin);
    }
    let issued;
    try {
      issued = await adminResponse.json();
    } catch {
      return invalidAdminResponse("token issuer returned invalid data", origin);
    }
    if (typeof issued?.credential !== "string" || typeof issued?.expiresAt !== "string")
      return invalidAdminResponse("token issuer returned invalid data", origin);
    const expiresAt = Date.parse(issued.expiresAt);
    if (
      !Number.isFinite(expiresAt) ||
      expiresAt <= now() ||
      expiresAt > now() + joinTokenLifetimeMs + 5_000
    ) {
      return invalidAdminResponse("token issuer returned invalid expiry", origin);
    }
    return response(
      200,
      { credential: issued.credential, expiresAt: issued.expiresAt },
      jsonHeaders(origin, config.allowedOrigins),
    );
  }

  async function requestToken({ authorization, origin, playerId } = {}) {
    const originResult = authorizeOrigin(origin);
    if (originResult.error) return originResult.error;
    const grantResult = findGrant(authorization, playerId);
    if (grantResult.error) return grantResult.error;
    return fetchJoinToken(grantResult.record, originResult.normalized);
  }

  async function parsePlayerId(request) {
    const rawBody = await readRequestBody(request);
    if (rawBody.trim() === "") return undefined;
    const body = JSON.parse(rawBody);
    if (body === null || typeof body !== "object" || Array.isArray(body))
      throw new Error("body must be an object");
    if (Object.keys(body).some((key) => key !== "playerId")) throw new Error("unknown body key");
    if (
      body.playerId !== undefined &&
      (typeof body.playerId !== "string" || !PLAYER_ID.test(body.playerId))
    )
      throw new Error("invalid playerId");
    return body.playerId;
  }

  async function handleRequest(request, reply) {
    const originResult = authorizeOrigin(request.headers.origin);
    if (originResult.error) {
      reply(originResult.error);
      return;
    }
    const url = new URL(request.url ?? "/", "https://issuer.invalid");
    const headers = jsonHeaders(originResult.normalized, config.allowedOrigins);
    if (url.pathname !== "/token") {
      reply(response(404, { error: "not found" }, headers));
      return;
    }
    if (request.method === "OPTIONS") {
      reply(response(204, undefined, headers));
      return;
    }
    if (request.method !== "POST") {
      reply(response(405, { error: "method not allowed" }, headers));
      return;
    }
    try {
      const playerId = await parsePlayerId(request);
      reply(
        await requestToken({
          authorization: request.headers.authorization,
          origin: originResult.normalized ?? undefined,
          playerId,
        }),
      );
    } catch {
      reply(response(400, { error: "invalid request body" }, headers));
    }
  }

  function stageFilesExist() {
    return config.clients.every(({ assetDir }) => existsSync(sessionPath(assetDir)));
  }

  async function start() {
    if (server) throw new Error("networking issuer is already started");
    stageAllGrants();
    const options = { cert: readFileSync(config.certPath), key: readFileSync(config.keyPath) };
    server = createHttpsServer(options, (request, reply) => {
      void handleRequest(request, (result) => {
        reply.statusCode = result.status;
        for (const [key, value] of Object.entries(result.headers)) reply.setHeader(key, value);
        reply.end(result.body === undefined ? undefined : JSON.stringify(result.body));
      });
    });
    await new Promise((resolveStart, rejectStart) => {
      server.once("error", rejectStart);
      server.listen(bindOptions(config.bind), () => {
        server.off("error", rejectStart);
        resolveStart();
      });
    });
    const address = server.address();
    const host = typeof address === "object" && address ? address.address : "127.0.0.1";
    const port = typeof address === "object" && address ? address.port : 0;
    const printableHost = host.includes(":") ? `[${host}]` : host;
    return { address: `https://${printableHost}:${port}`, staged: stageFilesExist() };
  }

  async function cleanup() {
    for (const [file, authorization] of createdFiles) {
      try {
        const current = JSON.parse(readFileSync(file, "utf8"));
        if (current.issuerAuthorization === authorization) unlinkSync(file);
      } catch {
        // A missing or already-removed run asset is clean enough.
      }
    }
    grants.clear();
    createdFiles.clear();
    if (!server) return;
    const current = server;
    server = undefined;
    await new Promise((resolveClose, rejectClose) =>
      current.close((error) => (error ? rejectClose(error) : resolveClose())),
    );
  }

  return { cleanup, handleRequest, requestToken, stageAllGrants, stageGrant, start };
}

async function runFromConfig(configPath) {
  if (!configPath || !configPath.startsWith("/"))
    throw new Error("--config must be an absolute JSON path");
  const config = JSON.parse(readFileSync(configPath, "utf8"));
  const issuer = createNetworkingIssuer(config);
  const started = await issuer.start();
  console.log(`ISSUER_LISTENING https=${started.address}`);
  console.log(`ISSUER_READY clients=${config.clients.length}`);
  const stop = async () => {
    await issuer.cleanup();
    process.exit(0);
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  return issuer;
}

function cliConfigPath(argv) {
  if (argv.length !== 2 || argv[0] !== "--config" || !argv[1])
    throw new Error("usage: node scripts/networking-issuer.mjs --config <absolute-json>");
  return argv[1];
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    await runFromConfig(cliConfigPath(process.argv.slice(2)));
  } catch (error) {
    console.error(`networking issuer: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 2;
  }
}

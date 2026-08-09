import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";

import {
  PLAYTEST_PROTOCOL_LIMITS,
  assertJsonSafe,
  jsonByteLength,
  playtestDiagnostic,
  type IPlaytestDeviceRequest,
  type IPlaytestDeviceResponse,
  type JsonValue,
} from "../index.js";
import { type BridgeTransport, PlaytestBridgeError } from "./bridgeClient.js";

export const ANDROID_TRANSPORT_CAPABILITIES = [
  "browser.console",
  "browser.input",
  "browser.screenshot",
] as const;

export interface IDeviceMailbox {
  read(path: string): Promise<string | undefined>;
  remove(path: string): Promise<void>;
  write(path: string, contents: string): Promise<void>;
}

export interface IDeviceMailboxPaths {
  request: string;
  response: string;
}

export interface DevicePlaytestTransport extends BridgeTransport {
  start(): Promise<void>;
}

interface PendingCall {
  reject(error: Error): void;
  resolve(value: unknown): void;
  timeout: ReturnType<typeof setTimeout>;
}

export class DeviceBridgeTransport implements DevicePlaytestTransport {
  readonly capabilities = ANDROID_TRANSPORT_CAPABILITIES;
  readonly endpoint: URL;
  private connected = false;
  private nextId = 1;
  private readonly pending = new Map<string, PendingCall>();
  private readonly queue: IPlaytestDeviceRequest[] = [];
  private server?: Server;
  private waiters: Array<(connected: boolean) => void> = [];

  constructor(endpoint: string) {
    this.endpoint = validateDeviceEndpoint(endpoint);
  }

  async start(): Promise<void> {
    if (this.server !== undefined) return;
    this.server = createServer((request, response) => void this.handle(request, response));
    await new Promise<void>((resolve, reject) => {
      this.server!.once("error", reject);
      this.server!.listen(Number(this.endpoint.port), "127.0.0.1", () => {
        this.server!.off("error", reject);
        resolve();
      });
    });
  }

  async call<T>(method: string, argument?: unknown): Promise<T> {
    if (this.server === undefined) throw new Error("Device bridge transport has not started.");
    if (argument !== undefined) assertBounded(argument);
    const id = String(this.nextId++);
    const request: IPlaytestDeviceRequest = {
      ...(argument === undefined ? {} : { argument: argument as JsonValue }),
      id,
      method,
    };
    return new Promise<T>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new PlaytestBridgeError(playtestDiagnostic(
          "TN_PLAYTEST_OPERATION_TIMEOUT",
          `Device bridge operation '${method}' exceeded ${PLAYTEST_PROTOCOL_LIMITS.operationTimeoutMs}ms.`,
          "Confirm the app is running and polling the configured --endpoint.",
        )));
      }, PLAYTEST_PROTOCOL_LIMITS.operationTimeoutMs);
      this.pending.set(id, { reject, resolve: (value) => resolve(value as T), timeout });
      this.queue.push(request);
    });
  }

  async close(): Promise<void> {
    for (const call of this.pending.values()) {
      clearTimeout(call.timeout);
      call.reject(new Error("Device bridge transport closed."));
    }
    this.pending.clear();
    this.queue.length = 0;
    this.waiters.splice(0).forEach((resolve) => resolve(false));
    if (this.server === undefined) return;
    const server = this.server;
    this.server = undefined;
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  async waitForBridge(timeoutMs: number): Promise<boolean> {
    if (this.connected) return true;
    return new Promise<boolean>((resolve) => {
      const done = (value: boolean): void => {
        clearTimeout(timeout);
        this.waiters = this.waiters.filter((waiter) => waiter !== done);
        resolve(value);
      };
      const timeout = setTimeout(() => done(false), timeoutMs);
      this.waiters.push(done);
    });
  }

  private async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    if (new URL(request.url ?? "/", this.endpoint).pathname !== this.endpoint.pathname) {
      response.writeHead(404).end();
      return;
    }
    this.markConnected();
    if (request.method === "GET") {
      const next = this.queue.shift();
      if (next === undefined) response.writeHead(204).end();
      else sendJson(response, 200, next);
      return;
    }
    if (request.method !== "POST") {
      response.writeHead(405).end();
      return;
    }
    try {
      const payload = parseResponse(await readBody(request));
      const pending = this.pending.get(payload.id);
      if (pending === undefined) throw new Error(`Unknown device response id '${payload.id}'.`);
      this.pending.delete(payload.id);
      clearTimeout(pending.timeout);
      if (payload.error !== undefined) pending.reject(new Error(payload.error.message));
      else pending.resolve(payload.result);
      response.writeHead(204).end();
    } catch (error) {
      sendJson(response, 400, { error: error instanceof Error ? error.message : String(error) });
    }
  }

  private markConnected(): void {
    if (this.connected) return;
    this.connected = true;
    this.waiters.splice(0).forEach((resolve) => resolve(true));
  }
}

export class DeviceMailboxTransport implements DevicePlaytestTransport {
  readonly capabilities = ANDROID_TRANSPORT_CAPABILITIES;
  private connected = false;
  private closed = false;
  private nextId = 1;

  constructor(
    private readonly mailbox: IDeviceMailbox,
    private readonly paths: IDeviceMailboxPaths,
  ) {}

  async start(): Promise<void> {
    this.closed = false;
    this.connected = false;
    await this.mailbox.remove(this.paths.request);
    await this.mailbox.remove(this.paths.response);
  }

  async call<T>(method: string, argument?: unknown): Promise<T> {
    if (this.closed) throw new Error("Device mailbox transport is closed.");
    if (!this.connected) throw new Error("Device mailbox bridge is not connected.");
    if (argument !== undefined) assertBounded(argument);
    const id = String(this.nextId++);
    await this.mailbox.remove(this.paths.response);
    await this.mailbox.write(this.paths.request, JSON.stringify({
      ...(argument === undefined ? {} : { argument: argument as JsonValue }),
      id,
      method,
    } satisfies IPlaytestDeviceRequest));
    const response = await this.waitForResponse(id);
    if (response.error !== undefined) throw new Error(response.error.message);
    return response.result as T;
  }

  async close(): Promise<void> {
    this.closed = true;
    await this.mailbox.remove(this.paths.request).catch(() => undefined);
    await this.mailbox.remove(this.paths.response).catch(() => undefined);
  }

  async waitForBridge(timeoutMs: number): Promise<boolean> {
    if (this.connected) return true;
    const deadline = Date.now() + timeoutMs;
    while (!this.closed && Date.now() < deadline) {
      const response = await this.readResponse();
      if (response !== undefined) {
        await this.mailbox.remove(this.paths.response);
        if (response.id === "ready") {
          this.connected = true;
          return true;
        }
      }
      await delayUntil(deadline);
    }
    return false;
  }

  private async waitForResponse(id: string): Promise<IPlaytestDeviceResponse> {
    const deadline = Date.now() + PLAYTEST_PROTOCOL_LIMITS.operationTimeoutMs;
    while (!this.closed && Date.now() < deadline) {
      const response = await this.readResponse();
      if (response !== undefined) {
        await this.mailbox.remove(this.paths.response);
        if (response.id !== id) throw new Error(`Unexpected device response id '${response.id}'.`);
        return response;
      }
      await delayUntil(deadline);
    }
    throw new PlaytestBridgeError(playtestDiagnostic(
      "TN_PLAYTEST_OPERATION_TIMEOUT",
      `Device mailbox operation '${id}' exceeded ${PLAYTEST_PROTOCOL_LIMITS.operationTimeoutMs}ms.`,
      "Confirm the app is running and its native mailbox is polling the configured files.",
    ));
  }

  private async readResponse(): Promise<IPlaytestDeviceResponse | undefined> {
    const raw = await this.mailbox.read(this.paths.response);
    return raw === undefined ? undefined : parseResponse(raw);
  }
}

export function androidMailboxPaths(
  packageName: string,
  root = `/sdcard/Android/data/${packageName}/files`,
): IDeviceMailboxPaths {
  return {
    request: `${root}/tn-playtest-request.json`,
    response: `${root}/tn-playtest-response.json`,
  };
}

export function validateDeviceEndpoint(value: string): URL {
  const endpoint = new URL(value);
  if (endpoint.protocol !== "http:") throw new Error("Device playtest --endpoint must use http://.");
  if (endpoint.hostname !== "127.0.0.1" && endpoint.hostname !== "localhost") {
    throw new Error("Device playtest --endpoint must use loopback; adb reverse exposes it to the app.");
  }
  if (endpoint.port === "") throw new Error("Device playtest --endpoint must include an explicit port.");
  if (endpoint.search !== "" || endpoint.hash !== "") {
    throw new Error("Device playtest --endpoint cannot contain a query or fragment.");
  }
  return endpoint;
}

function parseResponse(value: string): IPlaytestDeviceResponse {
  const parsed: unknown = JSON.parse(value);
  assertBounded(parsed);
  if (!isRecord(parsed) || typeof parsed.id !== "string") {
    throw new Error("Device response must contain a string id.");
  }
  if (parsed.error !== undefined && (!isRecord(parsed.error) || typeof parsed.error.message !== "string")) {
    throw new Error("Device response error must contain a message.");
  }
  return parsed as unknown as IPlaytestDeviceResponse;
}

async function readBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > PLAYTEST_PROTOCOL_LIMITS.maxPayloadBytes) throw new Error("Device response is too large.");
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function assertBounded(value: unknown): void {
  assertJsonSafe(value);
  if (jsonByteLength(value) > PLAYTEST_PROTOCOL_LIMITS.maxPayloadBytes) {
    throw new Error(`Device bridge payload exceeds ${PLAYTEST_PROTOCOL_LIMITS.maxPayloadBytes} bytes.`);
  }
}

function sendJson(response: ServerResponse, status: number, value: unknown): void {
  const body = JSON.stringify(value);
  response.writeHead(status, { "content-length": Buffer.byteLength(body), "content-type": "application/json" });
  response.end(body);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function delayUntil(deadline: number): Promise<void> {
  const remaining = deadline - Date.now();
  if (remaining > 0) await new Promise<void>((resolve) => setTimeout(resolve, Math.min(40, remaining)));
}

import { type ChildProcess, spawn } from "node:child_process";
import { once } from "node:events";
import { isRecord } from "./utils.js";

const MCP_PROTOCOL_VERSION = "2025-06-18";
const MCP_REQUEST_TIMEOUT_MS = 30_000;

export interface IMcpServerConfig {
  readonly args: readonly string[];
  readonly command: string;
  readonly env?: Readonly<Record<string, string>>;
}

export interface IMcpSurface {
  readonly tools: readonly string[];
  readonly version: string;
}

export type IMcpRequest = (method: string, params?: Record<string, unknown>) => Promise<unknown>;

interface IMcpPendingRequest {
  readonly reject: (reason?: unknown) => void;
  readonly resolve: (value: unknown) => void;
  readonly timer: ReturnType<typeof setTimeout>;
}

interface IMcpOutputState {
  buffer: string;
}

export function assertMcpToolSurface(
  serverName: string,
  expected: readonly string[],
  response: unknown,
): void {
  if (!isRecord(response) || !Array.isArray(response.tools)) {
    throw new Error(`TN_GOLDEN_PATH_MCP_TOOLS_INVALID: ${serverName} returned no tools list.`);
  }
  const actual = response.tools.map((tool) => {
    if (!isRecord(tool) || typeof tool.name !== "string") {
      throw new Error(`TN_GOLDEN_PATH_MCP_TOOL_INVALID: ${serverName} returned a nameless tool.`);
    }
    return tool.name;
  });
  const expectedNames = [...expected].sort();
  const actualNames = [...actual].sort();
  if (JSON.stringify(actualNames) !== JSON.stringify(expectedNames)) {
    throw new Error(
      `${serverName} surface drifted.\nexpected ${expectedNames.length}: ${expectedNames.join(
        ", ",
      )}\nactual ${actualNames.length}: ${actualNames.join(", ")}`,
    );
  }
}

function resolveMcpMessage(value: unknown, pending: Map<number, IMcpPendingRequest>): void {
  if (!isRecord(value) || typeof value.id !== "number") return;
  const waiter = pending.get(value.id);
  if (waiter === undefined) return;
  pending.delete(value.id);
  clearTimeout(waiter.timer);
  if (value.error !== undefined) waiter.reject(new Error(JSON.stringify(value.error)));
  else waiter.resolve(value.result);
}

function consumeMcpOutput(
  chunk: Buffer | string,
  state: IMcpOutputState,
  pending: Map<number, IMcpPendingRequest>,
): void {
  state.buffer += chunk.toString();
  const lines = state.buffer.split(/\r?\n/u);
  state.buffer = lines.pop() ?? "";
  for (const line of lines) {
    if (!line.trim().startsWith("{")) continue;
    try {
      resolveMcpMessage(JSON.parse(line) as unknown, pending);
    } catch {
      // MCP servers may log non-JSON lines to stdout; pending requests still time out.
    }
  }
}

export async function stopProcess(child: ChildProcess): Promise<void> {
  if (child.exitCode === null) {
    if (process.platform === "win32" || child.pid === undefined) child.kill("SIGTERM");
    else {
      try {
        process.kill(-child.pid, "SIGTERM");
      } catch {
        child.kill("SIGTERM");
      }
    }
  }
  const exited = child.exitCode === null ? once(child, "exit") : Promise.resolve();
  await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 5_000))]);
  if (child.exitCode === null) child.kill("SIGKILL");
}

export async function probeMcpServer(
  serverName: string,
  server: IMcpServerConfig,
  surface: IMcpSurface,
  cwd: string,
  afterInitialize?: (request: IMcpRequest) => Promise<void>,
): Promise<void> {
  const child = spawn(server.command, [...server.args], {
    cwd,
    env: { ...process.env, ...server.env },
    stdio: ["pipe", "pipe", "pipe"],
  });
  const output: IMcpOutputState = { buffer: "" };
  let stderr = "";
  let terminalError: Error | undefined;
  const pending = new Map<number, IMcpPendingRequest>();
  const failPending = (error: Error): void => {
    terminalError = error;
    for (const waiter of pending.values()) {
      clearTimeout(waiter.timer);
      waiter.reject(error);
    }
    pending.clear();
  };
  child.stdout?.on("data", (chunk: Buffer | string) => consumeMcpOutput(chunk, output, pending));
  child.stderr?.on("data", (chunk: Buffer | string) => {
    stderr += chunk.toString();
  });
  child.once("error", (error) => {
    failPending(error instanceof Error ? error : new Error(String(error)));
  });
  child.once("exit", (code, signal) => {
    const detail = stderr.trim().slice(-500);
    failPending(
      new Error(
        `${serverName} exited before completing MCP requests (${code ?? `signal ${signal ?? "unknown"}`})${detail.length > 0 ? `: ${detail}` : ""}.`,
      ),
    );
  });

  let nextId = 1;
  const request: IMcpRequest = (method, params = {}) => {
    if (terminalError !== undefined) return Promise.reject(terminalError);
    const id = nextId++;
    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        const detail = stderr.trim().slice(-500);
        reject(
          new Error(
            `${serverName} ${method} timed out after ${MCP_REQUEST_TIMEOUT_MS}ms${detail.length > 0 ? `: ${detail}` : ""}.`,
          ),
        );
      }, MCP_REQUEST_TIMEOUT_MS);
      pending.set(id, { reject, resolve, timer });
      try {
        child.stdin?.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
      } catch (error) {
        clearTimeout(timer);
        pending.delete(id);
        reject(error);
      }
    });
  };

  try {
    await request("initialize", {
      protocolVersion: MCP_PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: "threenative-golden-path", version: "0" },
    });
    child.stdin?.write(
      `${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`,
    );
    const listed = await request("tools/list");
    assertMcpToolSurface(serverName, surface.tools, listed);
    await afterInitialize?.(request);
    process.stdout.write(
      `${serverName} ok: ${surface.tools.length} tools from ${surface.version}\n`,
    );
  } finally {
    await stopProcess(child);
  }
}

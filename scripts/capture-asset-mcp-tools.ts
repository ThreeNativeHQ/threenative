#!/usr/bin/env tsx
// Writes `packages/create-threenative/asset-mcp-tools.json` from the *published*
// `threenative-asset-mcp` installed into a clean directory — never from a workspace checkout, and
// never from its docs. A snapshot read off source is the object asserting about itself: it agrees
// with the code by construction and would keep agreeing after a packaging mistake made the
// shipped server serve nothing at all.
//
//   pnpm tsx scripts/capture-asset-mcp-tools.ts
import { type ChildProcessWithoutNullStreams, execFileSync, spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";

const REPO = path.resolve(import.meta.dirname, "..");
const SNAPSHOT = path.join(REPO, "packages/create-threenative/asset-mcp-tools.json");
const PACKAGE = "threenative-asset-mcp";
const RECOMMENDED = [
  "ambientcg_list_files",
  "ambientcg_search_assets",
  "asset_download_file",
  "asset_search_sources",
  "audio_download_asset",
  "audio_search_assets",
  "polyhaven_list_files",
  "polyhaven_search_assets",
  "asset_inspect_rig",
  "asset_auto_rig",
  "asset_retarget_animations",
  "asset_preview_animation",
] as const;

const scratch: string[] = [];

/** Fail closed: an MCP error is not an empty successful tool surface. */
export async function request(
  child: ChildProcessWithoutNullStreams,
  lines: ReturnType<typeof createInterface>,
  next: { value: number },
  method: string,
  params: Record<string, unknown> = {},
  timeoutMs = 30_000,
): Promise<Record<string, unknown>> {
  const id = next.value++;
  return new Promise((resolve, reject) => {
    let settled = false;
    const cleanup = (): void => {
      clearTimeout(timer);
      lines.off("line", onLine);
      lines.off("close", onClose);
      child.off("error", onError);
      child.off("exit", onExit);
      child.stdin.off("error", onError);
    };
    const fail = (error: Error): void => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };
    const onError = (error: Error): void => fail(error);
    const onClose = (): void => fail(new Error(`MCP ${method}: stdout closed before a response`));
    const onExit = (): void => fail(new Error(`MCP ${method}: server exited before a response`));
    const onLine = (line: string): void => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(line);
      } catch {
        return; // Ignore non-protocol diagnostic lines.
      }
      if (!isRecord(parsed) || parsed.id !== id) return;
      if (parsed.jsonrpc !== "2.0") {
        fail(new Error(`MCP ${method}: invalid JSON-RPC response`));
        return;
      }
      if (Object.hasOwn(parsed, "error")) {
        const error = parsed.error;
        const detail = isRecord(error) ? `${String(error.code)}: ${String(error.message)}` : "malformed error";
        fail(new Error(`MCP ${method}: ${detail}`));
        return;
      }
      if (!isRecord(parsed.result)) {
        fail(new Error(`MCP ${method}: invalid result in response`));
        return;
      }
      settled = true;
      cleanup();
      resolve(parsed.result);
    };
    const timer = setTimeout(() => fail(new Error(`MCP ${method} timed out`)), timeoutMs);
    lines.on("line", onLine);
    lines.on("close", onClose);
    child.on("error", onError);
    child.on("exit", onExit);
    child.stdin.on("error", onError);
    if (child.exitCode !== null || child.signalCode !== null) {
      onExit();
      return;
    }
    try {
      child.stdin.write(`${JSON.stringify({ id, jsonrpc: "2.0", method, params })}\n`, (error) => {
        if (error) fail(error);
      });
    } catch (error) {
      fail(error instanceof Error ? error : new Error(String(error)));
    }
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Read every page and refuse to overwrite the snapshot with a partial surface. */
export async function listTools(
  child: ChildProcessWithoutNullStreams,
  lines: ReturnType<typeof createInterface>,
  next: { value: number },
): Promise<string[]> {
  const names = new Set<string>();
  const cursors = new Set<string>();
  let cursor: string | undefined;
  do {
    const listed = await request(child, lines, next, "tools/list", cursor === undefined ? {} : { cursor });
    if (!Array.isArray(listed.tools)) throw new Error("MCP tools/list: invalid tools array");
    for (const tool of listed.tools) {
      if (!isRecord(tool) || typeof tool.name !== "string" || tool.name.trim() === "" || names.has(tool.name)) {
        throw new Error("MCP tools/list: invalid or duplicate tool name");
      }
      names.add(tool.name);
    }
    const nextCursor = listed.nextCursor;
    if (nextCursor === undefined) break;
    if (typeof nextCursor !== "string" || nextCursor === "" || cursors.has(nextCursor)) {
      throw new Error("MCP tools/list: invalid or repeated pagination cursor");
    }
    cursors.add(nextCursor);
    cursor = nextCursor;
  } while (true);
  const missing = RECOMMENDED.filter((name) => !names.has(name));
  if (missing.length) throw new Error(`MCP tools/list: missing recommended tools: ${missing.join(", ")}`);
  return [...names].sort();
}

function versionPin(): string {
  const manifest = JSON.parse(
    readFileSync(path.join(REPO, "packages/core/package.json"), "utf8"),
  ) as { dependencies?: Record<string, string> };
  const version = manifest.dependencies?.[PACKAGE];
  if (!version) throw new Error(`TN_ASSET_SNAPSHOT: core does not pin ${PACKAGE}.`);
  return version;
}

function installPublished(version: string): string {
  const root = mkdtempSync(path.join(tmpdir(), "tn-asset-install-"));
  scratch.push(root);
  writeFileSync(path.join(root, "package.json"), JSON.stringify({ name: "probe", private: true }));
  mkdirSync(path.join(root, ".threenative"));
  execFileSync("npm", ["install", "--no-audit", "--no-fund", `${PACKAGE}@${version}`], {
    cwd: root,
    stdio: "inherit",
  });
  return root;
}

async function main(): Promise<void> {
  let child: ChildProcessWithoutNullStreams | undefined;
  let lines: ReturnType<typeof createInterface> | undefined;
  try {
    const version = versionPin();
    const install = installPublished(version);
    const installed = path.join(install, "node_modules", PACKAGE);
    const manifest = JSON.parse(readFileSync(path.join(installed, "package.json"), "utf8")) as {
      bin: Record<string, string>;
      version: string;
    };
    if (manifest.version !== version) {
      throw new Error(
        `TN_ASSET_SNAPSHOT: registry ${PACKAGE}@${version} resolved ${manifest.version}.`,
      );
    }
    const entry = path.join(installed, manifest.bin[PACKAGE] ?? "");
    child = spawn(process.execPath, [entry], { cwd: install, stdio: ["pipe", "pipe", "pipe"] });
    lines = createInterface({ input: child.stdout });
    child.stderr.resume();
    const next = { value: 1 };
    await request(child, lines, next, "initialize", {
      capabilities: {},
      clientInfo: { name: "tool-snapshot", version: "0" },
      protocolVersion: "2025-06-18",
    });
    child.stdin.write('{"jsonrpc":"2.0","method":"notifications/initialized"}\n');
    const tools = await listTools(child, lines, next);
    const snapshot = {
      comment: `The asset MCP surface a generated project actually gets. \`tools\` is the live tools/list response of the pinned version, recorded by installing ${PACKAGE}@${version} from the registry into a clean directory containing \`.threenative\` and driving it over stdio - not copied from its docs. The published ${version} serves all ${tools.length} tools, including the humanoid rig inspect, auto-rig, retarget and preview tools. \`profile\` is null because the server has no profile selector. \`recommended\` is the loop the template AGENTS.md teaches, not a claim about what the other tools can do - \`asset_search_sources\` is the authority on that. \`fab_import_asset\` and \`asset_import_unreal\` are deliberately not recommended: they convert an Unreal pack the user already owns, which is a route a game takes on purpose rather than a step in the ordinary asset loop. Regenerate with \`pnpm tsx scripts/capture-asset-mcp-tools.ts\`.`,
      version,
      profile: null,
      recommended: [...RECOMMENDED],
      tools,
    };
    writeFileSync(SNAPSHOT, `${JSON.stringify(snapshot, null, 2)}\n`);
    process.stdout.write(`asset MCP surface: ${tools.length} tool(s) -> ${SNAPSHOT}\n`);
  } finally {
    child?.kill();
    lines?.close();
    for (const root of scratch.splice(0)) rmSync(root, { force: true, recursive: true });
  }
}

if (
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)
) {
  main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}

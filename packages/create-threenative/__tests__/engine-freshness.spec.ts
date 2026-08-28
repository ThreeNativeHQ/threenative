import { EventEmitter } from "node:events";
import { mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { makeTempDir } from "../../../test-support/temp-dir.js";
import { createEngineFreshnessPlugin, hashEngineDist } from "../src/engine-freshness.js";

/**
 * Sandbox games install the engine from tarballs whose filename never changes, so a rebuilt
 * engine looks identical to a package manager and a dev server keeps serving the old code from
 * memory: the 2026-08-27 "the disappearing-walls fix regressed" report was a server that
 * predated the fix. This plugin is the prevention: at boot it hashes the installed
 * `@threenative/*` dist trees, forces dep re-optimization when they changed, and names any
 * still-running server that is serving the older build.
 */
const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { force: true, recursive: true });
  vi.restoreAllMocks();
});

function seedEngine(root: string, body: string): void {
  mkdirSync(path.join(root, "node_modules", "@threenative", "core", "dist"), { recursive: true });
  writeFileSync(path.join(root, "node_modules", "@threenative", "core", "dist", "index.js"), body);
}

function writeMarker(root: string, marker: unknown): void {
  mkdirSync(path.join(root, "node_modules", ".vite"), { recursive: true });
  writeFileSync(
    path.join(root, "node_modules", ".vite", "threenative-engine-build.json"),
    JSON.stringify(marker),
  );
}

function readMarker(root: string): { hash: string; pid: number; port?: number } {
  return JSON.parse(
    readFileSync(path.join(root, "node_modules", ".vite", "threenative-engine-build.json"), "utf8"),
  );
}

const MARKER_HASH = "0".repeat(64);
const DEAD_PID = 2 ** 22; // above Linux's default pid_max: no live process can carry it

describe("engine freshness plugin", () => {
  it("hashes the installed engine dists and changes the hash when they change", async () => {
    const root = await makeTempDir("threenative-engine-fresh-");
    roots.push(root);
    seedEngine(root, "export const build = 1;\n");
    const before = await hashEngineDist(root);
    expect(before).toMatch(/^[0-9a-f]{64}$/u);
    seedEngine(root, "export const build = 2;\n");
    expect(await hashEngineDist(root)).not.toEqual(before);
  });

  it("hashes through pnpm's symlinked node_modules layout", async () => {
    // The sandbox installs engine packages as symlinks into a pnpm store; Dirent.isDirectory()
    // is false for a symlink, and the first live boot hashed nothing and recorded no marker —
    // silently, on exactly the layout this plugin exists to guard.
    const root = await makeTempDir("threenative-engine-fresh-");
    roots.push(root);
    const store = path.join(root, ".pnpm-store", "core");
    seedEngine(store, "export const build = 1;\n");
    mkdirSync(path.join(root, "node_modules", "@threenative"), { recursive: true });
    symlinkSync(
      path.join(store, "node_modules", "@threenative", "core"),
      path.join(root, "node_modules", "@threenative", "core"),
    );
    expect(await hashEngineDist(root)).toMatch(/^[0-9a-f]{64}$/u);
    const plugin = createEngineFreshnessPlugin();
    const httpServer = new EventEmitter() as EventEmitter & { address?: () => unknown };
    httpServer.address = () => ({ port: 4321 });
    plugin.configureServer?.({ config: { root }, httpServer } as never);
    httpServer.emit("listening");
    expect(readMarker(root).hash).toBe(await hashEngineDist(root));
  });

  it("forces dep re-optimization when the engine changed and names the stale live server", async () => {
    const root = await makeTempDir("threenative-engine-fresh-");
    roots.push(root);
    seedEngine(root, "export const build = 1;\n");
    writeMarker(root, { hash: MARKER_HASH, pid: process.pid, port: 4175 });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const plugin = createEngineFreshnessPlugin();
    const patch = await plugin.config({ root }, { command: "serve" });
    expect(patch).toEqual({ optimizeDeps: { force: true } });
    expect(warn).toHaveBeenCalledTimes(1);
    const message = warn.mock.calls[0]?.join(" ") ?? "";
    expect(message).toContain(String(process.pid));
    expect(message).toContain("4175");
    expect(message).toContain(MARKER_HASH.slice(0, 8));
  });

  it("re-optimizes nothing when the installed engine is the recorded build", async () => {
    const root = await makeTempDir("threenative-engine-fresh-");
    roots.push(root);
    seedEngine(root, "export const build = 1;\n");
    writeMarker(root, { hash: await hashEngineDist(root), pid: DEAD_PID });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const plugin = createEngineFreshnessPlugin();
    const patch = await plugin.config({ root }, { command: "serve" });
    expect(patch?.optimizeDeps?.force).toBeFalsy();
    expect(warn).not.toHaveBeenCalled();
  });

  it("records this boot's build, pid and port once the server listens", async () => {
    const root = await makeTempDir("threenative-engine-fresh-");
    roots.push(root);
    seedEngine(root, "export const build = 1;\n");
    const plugin = createEngineFreshnessPlugin();
    const httpServer = new EventEmitter() as EventEmitter & { address?: () => unknown };
    httpServer.address = () => ({ port: 4321 });
    plugin.configureServer?.({
      config: { root },
      httpServer,
    } as never);
    httpServer.emit("listening");
    expect(readMarker(root)).toEqual({
      hash: await hashEngineDist(root),
      pid: process.pid,
      port: 4321,
    });
  });

  it("removes its marker when the server closes cleanly", async () => {
    const root = await makeTempDir("threenative-engine-fresh-");
    roots.push(root);
    seedEngine(root, "export const build = 1;\n");
    const plugin = createEngineFreshnessPlugin();
    const httpServer = new EventEmitter() as EventEmitter & { address?: () => unknown };
    httpServer.address = () => ({ port: 4321 });
    plugin.configureServer?.({
      config: { root },
      httpServer,
    } as never);
    httpServer.emit("listening");
    expect(readMarker(root).pid).toBe(process.pid);
    httpServer.emit("close");
    expect(() => readMarker(root)).toThrow(/ENOENT/u);
  });

  it("does nothing in a project with no installed engine packages", async () => {
    const root = await makeTempDir("threenative-engine-fresh-");
    roots.push(root);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const plugin = createEngineFreshnessPlugin();
    const patch = await plugin.config({ root }, { command: "serve" });
    expect(patch?.optimizeDeps?.force).toBeFalsy();
    expect(warn).not.toHaveBeenCalled();
    expect(await hashEngineDist(root)).toBeUndefined();
  });
});

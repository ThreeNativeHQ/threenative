import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { acquireHotReloadProjectLock } from "../../test-support/hot-reload-lock.js";
import { packageSourcesMatch } from "../../test-support/hot-reload-project.js";
import { makeTempDir } from "../../test-support/temp-dir.js";
import {
  assertAdapterInfo,
  assertWebGpuCaptureProvenance,
} from "../../test-support/webgpu-provenance.js";

const repo = path.resolve(import.meta.dirname, "../..");

describe("root Playwright lane contracts", () => {
  it("runs adapter provenance setup in both browser and benchmark configs", async () => {
    const [browser, benchmark] = await Promise.all([
      readFile(path.join(repo, "playwright.config.ts"), "utf8"),
      readFile(path.join(repo, "benchmark.playwright.config.ts"), "utf8"),
    ]);

    expect(browser).toContain('globalSetup: "./test-support/root-playwright-setup.ts"');
    expect(benchmark).toContain('globalSetup: "./test-support/benchmark-playwright-setup.ts"');
  });

  it("allows the CI software adapter for the starter-look smoke runner", async () => {
    const browser = await readFile(path.join(repo, "playwright.config.ts"), "utf8");
    const start = browser.indexOf("async function runStarterLookScenario");
    const end = browser.indexOf("async function assertStarterScreenshot");

    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    expect(browser.slice(start, end)).toContain('"--allow-software"');
  });

  it("rejects a cached scaffold when a package source moves but keeps its basename", () => {
    const sourcePath = "/tmp/packages-a/threenative-core-0.1.0.tgz";
    const movedSourcePath = "/tmp/packages-b/threenative-core-0.1.0.tgz";
    const localSources = { "@threenative/core": sourcePath };

    expect(
      packageSourcesMatch(localSources, { "@threenative/core": `file:${movedSourcePath}` }),
    ).toBe(false);
    expect(packageSourcesMatch(localSources, { "@threenative/core": `file:${sourcePath}` })).toBe(
      true,
    );
  });

  it("fails closed when adapter.info is absent", () => {
    expect(() => assertAdapterInfo(undefined, [], "root browser")).toThrow(/adapter evidence/i);
  });

  it("fails closed when adapter.info identifies software WebGPU", () => {
    expect(() =>
      assertAdapterInfo({ architecture: "swiftshader", vendor: "google" }, [], "root browser"),
    ).toThrow(/software adapter/i);
  });

  it("fails closed when the adapter explicitly reports a fallback", () => {
    expect(() =>
      assertAdapterInfo(
        { architecture: "turing", isFallbackAdapter: true, vendor: "nvidia" },
        [],
        "benchmark",
      ),
    ).toThrow(/software adapter/i);
  });

  it("accepts a named hardware adapter as capture provenance", () => {
    expect(
      assertAdapterInfo(
        { architecture: "turing", vendor: "nvidia" },
        ["--enable-unsafe-webgpu"],
        "benchmark",
      ),
    ).toEqual({
      adapter: { architecture: "turing", vendor: "nvidia" },
      browserArgs: ["--enable-unsafe-webgpu"],
      captureMethod: "page.screenshot",
      rendererKind: "webgpu",
      target: "benchmark",
    });
  });

  it("reads adapter.info through the browser page before asserting provenance", async () => {
    let evaluations = 0;
    const page = {
      evaluate: async () => {
        evaluations += 1;
        return {
          adapter: { architecture: "turing", vendor: "nvidia" },
          rendererKind: "webgpu",
        };
      },
    } as never;

    await expect(assertWebGpuCaptureProvenance(page, [], "root browser")).resolves.toMatchObject({
      rendererKind: "webgpu",
    });
    expect(evaluations).toBe(1);
  });

  it("rejects adapter evidence when the canvas is WebGL or has no renderer context", async () => {
    for (const rendererKind of ["webgl", undefined] as const) {
      const page = {
        evaluate: async () => ({
          adapter: { architecture: "turing", vendor: "nvidia" },
          rendererKind,
        }),
      } as never;

      await expect(assertWebGpuCaptureProvenance(page, [], "root browser")).rejects.toThrow(
        /renderer kind/i,
      );
    }
  });
});

describe("hot-reload project lock recovery", () => {
  it("recovers a lock whose recorded owner is dead and old", async () => {
    const root = await makeTempDir("playwright-hot-lock-stale-");
    const lockPath = path.join(root, "project.lock");
    const now = 100_000;
    await writeFile(lockPath, JSON.stringify({ pid: 41_001, startedAt: now - 10_000 }));

    const lease = await acquireHotReloadProjectLock({
      isProcessAlive: () => false,
      lockPath,
      now: () => now,
      pollMs: 1,
      pid: 41_002,
      staleAfterMs: 1_000,
      timeoutMs: 100,
    });
    expect(JSON.parse(await readFile(lockPath, "utf8"))).toEqual({ pid: 41_002, startedAt: now });
    await lease.release();
  });

  it("waits for a live owner instead of taking its lock", async () => {
    const root = await makeTempDir("playwright-hot-lock-live-");
    const lockPath = path.join(root, "project.lock");
    const owner = { pid: 41_003, startedAt: Date.now() - 10_000 };
    await writeFile(lockPath, JSON.stringify(owner));

    await expect(
      acquireHotReloadProjectLock({
        isProcessAlive: (pid) => pid === owner.pid,
        lockPath,
        pollMs: 1,
        pid: 41_004,
        staleAfterMs: 1_000,
        timeoutMs: 20,
      }),
    ).rejects.toThrow(/timed out/i);
    expect(JSON.parse(await readFile(lockPath, "utf8"))).toEqual(owner);
  });
});

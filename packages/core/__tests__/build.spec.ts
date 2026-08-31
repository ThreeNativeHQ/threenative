import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { makeTempDir } from "../../../test-support/temp-dir.js";

const run = promisify(execFile);

describe("core package build", () => {
  it("should emit ESM and types for every export", async () => {
    const dist = path.resolve("packages/core/dist");
    expect(existsSync(path.join(dist, "index.js"))).toBe(true);
    expect(existsSync(path.join(dist, "index.d.ts"))).toBe(true);
    const module = await import(
      `${pathToFileURL(path.join(dist, "index.js")).href}?test=${Date.now()}`
    );
    // Asserted against the manifest, never a literal: the literal was 0.1.0 while the package
    // published 0.2.0, so this test certified the skew it existed to prevent.
    const manifest = JSON.parse(
      await readFile(new URL("../package.json", import.meta.url), "utf8"),
    ) as { version: string };
    expect(module.version).toBe(manifest.version);
    expect(module.AnimationPlayer).toBeDefined();
    expect(module.Scheduler).toBeDefined();
    expect(module.createRandom).toBeDefined();
  });

  it("should bundle a usable import-meta declaration for the hot subpath", async () => {
    const dist = path.resolve("packages/core/dist");
    const hotDeclaration = await readFile(path.join(dist, "hot.d.ts"), "utf8");
    expect(hotDeclaration).toContain("interface IImportMeta");

    const consumer = await makeTempDir("threenative-core-hot-");
    try {
      await writeFile(
        path.join(consumer, "tsconfig.json"),
        JSON.stringify({
          compilerOptions: {
            lib: ["ES2022", "DOM"],
            module: "ESNext",
            moduleResolution: "Bundler",
            noEmit: true,
            skipLibCheck: false,
            strict: true,
            target: "ES2022",
          },
          files: [path.join(consumer, "consumer.ts")],
        }),
      );
      await writeFile(
        path.join(consumer, "consumer.ts"),
        [
          `import { acceptHotUpdate } from ${JSON.stringify(path.join(dist, "hot.js"))};`,
          "type HotUpdater = typeof acceptHotUpdate;",
          "const useHotUpdater: HotUpdater | undefined = acceptHotUpdate;",
          "void useHotUpdater;",
        ].join("\n"),
      );

      await run("pnpm", ["exec", "tsc", "-p", path.join(consumer, "tsconfig.json")]);
    } finally {
      await rm(consumer, { force: true, recursive: true });
    }
    // This spawns a real `tsc` with `skipLibCheck: false`, so it type-checks the hot subpath
    // against the DOM lib rather than reading a file: 6.1s on an idle 16-core workstation. The
    // 15s budget was a fast-machine number and CI timed out on it while running 297 test files
    // on two cores. Sized at ~10x the measured cost, because being generous costs a machine that
    // finishes in six seconds nothing, and being tight costs the whole lane.
  }, 60_000);

  it("should emit the optional world subpath without pulling it into the main entry", async () => {
    const dist = path.resolve("packages/core/dist");
    expect(existsSync(path.join(dist, "world.js"))).toBe(true);
    expect(existsSync(path.join(dist, "world.d.ts"))).toBe(true);
    expect(await readFile(path.join(dist, "index.js"), "utf8")).not.toContain("Heightfield");
  });
});

import { access, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { archiveSandbox } from "../sweep-archive";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function fixtureRoot(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "threenative-archive-"));
  temporaryRoots.push(root);
  return root;
}

async function writeSandbox(root: string, name = "sandbox"): Promise<string> {
  const sandbox = path.join(root, name);
  await mkdir(path.join(sandbox, "src"), { recursive: true });
  await mkdir(path.join(sandbox, "playtests"), { recursive: true });
  await mkdir(path.join(sandbox, "node_modules", "@threenative", "core", "dist"), {
    recursive: true,
  });
  await writeFile(path.join(sandbox, "src", "main.ts"), "export const ready = true;\n");
  await writeFile(path.join(sandbox, "playtests", "smoke.json"), "{}\n");
  await mkdir(path.join(sandbox, "public"), { recursive: true });
  await writeFile(
    path.join(sandbox, "index.html"),
    '<script type="module" src="/src/main.ts"></script>\n',
  );
  await writeFile(path.join(sandbox, "vite.config.ts"), "export default {};\n");
  await writeFile(path.join(sandbox, "public", "favicon.svg"), "<svg />\n");
  await writeFile(path.join(sandbox, "package.json"), '{"name":"fixture"}\n');
  await writeFile(
    path.join(sandbox, "sweep.json"),
    JSON.stringify({
      arm: "framework",
      genre: "fixture",
      briefHash: "a".repeat(64),
      proofHash: "b".repeat(64),
      template: "none",
      date: "2099-01-02T00:00:00.000Z",
      frameworkVersion: "0.1.0",
      sourceLines: 0,
    }),
  );
  await writeFile(
    path.join(sandbox, "node_modules", "@threenative", "core", "dist", "index.d.ts"),
    "export declare const FixtureExport: number;\n",
  );
  await writeFile(path.join(sandbox, "dist.js"), "build output\n");
  return sandbox;
}

describe("sweep archive", () => {
  it("copies source evidence and declarations without node_modules or build output", async () => {
    const root = await fixtureRoot();
    const sandbox = await writeSandbox(root);
    const archive = archiveSandbox(sandbox, root);
    await expect(readFile(path.join(archive, "src/main.ts"), "utf8")).resolves.toContain("ready");
    await expect(readFile(path.join(archive, "playtests/smoke.json"), "utf8")).resolves.toBe(
      "{}\n",
    );
    await expect(readFile(path.join(archive, "index.html"), "utf8")).resolves.toContain(
      "/src/main.ts",
    );
    await expect(readFile(path.join(archive, "vite.config.ts"), "utf8")).resolves.toBe(
      "export default {};\n",
    );
    await expect(readFile(path.join(archive, "public/favicon.svg"), "utf8")).resolves.toBe(
      "<svg />\n",
    );
    await expect(readFile(path.join(archive, "sweep.json"), "utf8")).resolves.toContain(
      '"genre":"fixture"',
    );
    await expect(
      readFile(path.join(archive, "framework-types/@threenative/core/index.d.ts"), "utf8"),
    ).resolves.toContain("FixtureExport");
    await expect(access(path.join(archive, "node_modules"))).rejects.toThrow();
    await expect(access(path.join(archive, "dist.js"))).rejects.toThrow();
  });

  it("bundles local file dependencies and rewrites them relative to the archive", async () => {
    const root = await fixtureRoot();
    const sandbox = await writeSandbox(root);
    const tarball = path.join(root, "threenative-playtest.tgz");
    await writeFile(tarball, "package tarball\n");
    await writeFile(
      path.join(sandbox, "package.json"),
      JSON.stringify({
        name: "fixture",
        dependencies: { "@threenative/playtest": `file:${tarball}` },
      }),
    );
    const archive = archiveSandbox(sandbox, root);
    const packageJson = JSON.parse(await readFile(path.join(archive, "package.json"), "utf8")) as {
      dependencies: Record<string, string>;
    };
    expect(packageJson.dependencies["@threenative/playtest"]).toBe(
      "file:./vendor/threenative-playtest/threenative-playtest.tgz",
    );
    await expect(
      readFile(path.join(archive, "vendor/threenative-playtest/threenative-playtest.tgz"), "utf8"),
    ).resolves.toBe("package tarball\n");
  });

  it("rejects a missing local file dependency instead of archiving a broken package", async () => {
    const root = await fixtureRoot();
    const sandbox = await writeSandbox(root);
    await writeFile(
      path.join(sandbox, "package.json"),
      JSON.stringify({ dependencies: { fixture: "file:/tmp/does-not-exist.tgz" } }),
    );
    expect(() => archiveSandbox(sandbox, root)).toThrow(/file does not exist/);
  });

  it("does not overwrite the first archive when the same sweep is archived twice", async () => {
    const root = await fixtureRoot();
    const sandbox = await writeSandbox(root);
    const first = archiveSandbox(sandbox, root);
    const second = archiveSandbox(sandbox, root);
    expect(second).toBe(path.join(root, "docs/benchmark/sweeps/fixture-2099-01-02-2"));
    await expect(access(first)).resolves.toBeUndefined();
    await expect(access(second)).resolves.toBeUndefined();
    await expect(readdir(path.join(root, "docs/benchmark/sweeps"))).resolves.toHaveLength(2);
  });

  it("finds the single scaffolded project when the sandbox root is passed", async () => {
    const root = await fixtureRoot();
    await writeSandbox(path.join(root, "outer"), "my-game");
    const archive = archiveSandbox(path.join(root, "outer"), root);
    expect(archive).toBe(path.join(root, "docs/benchmark/sweeps/fixture-2099-01-02"));
  });

  it("throws when the sandbox has no src directory", async () => {
    const root = await fixtureRoot();
    const sandbox = path.join(root, "empty");
    await mkdir(sandbox, { recursive: true });
    await expect(Promise.resolve().then(() => archiveSandbox(sandbox, root))).rejects.toThrow(
      /missing src\//,
    );
  });

  it("rejects a manifest that could escape the archive root", async () => {
    const root = await fixtureRoot();
    const sandbox = await writeSandbox(root);
    await writeFile(
      path.join(sandbox, "sweep.json"),
      JSON.stringify({
        arm: "framework",
        genre: "../outside",
        briefHash: "a".repeat(64),
        proofHash: "b".repeat(64),
        template: "none",
        date: "2099-01-02T00:00:00.000Z",
        frameworkVersion: "0.1.0",
        sourceLines: 0,
      }),
    );
    expect(() => archiveSandbox(sandbox, root)).toThrow(/lowercase slug/);
  });
});

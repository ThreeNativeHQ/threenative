import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  assertTemplateSourcesCovered,
  isArchived,
  makeSandbox,
  readManifest,
  resolveGenre,
  sealedProofHash,
} from "../make-sandbox";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function temporaryRoot(prefix: string): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), prefix));
  temporaryRoots.push(root);
  return root;
}

describe("genre sandbox", () => {
  it("writes a manifest with the genre and sealed brief hash", async () => {
    const root = await temporaryRoot("threenative-sandbox-");
    const result = makeSandbox({
      bare: true,
      genre: "platformer",
      out: path.join(root, "sandbox"),
      prepare: false,
      repo: process.cwd(),
      template: "platformer",
    });
    const manifest = readManifest(path.join(result.out, "sweep.json"));
    const brief = await readFile(path.join(result.out, "brief.md"));
    const scaffold = await readFile(path.join(result.out, "scaffold.sh"), "utf8");
    expect(manifest).toMatchObject({
      arm: "framework",
      genre: "platformer",
      proofHash: sealedProofHash(process.cwd(), "platformer"),
      template: "platformer",
    });
    expect(manifest.briefHash).toBe(createHash("sha256").update(brief).digest("hex"));
    expect(scaffold).toContain('cp sweep.json "${1:-game}/sweep.json"');
    await expect(readFile(path.join(result.out, "reference.png"))).resolves.toEqual(
      await readFile("docs/benchmark/genres/platformer/reference.png"),
    );
  }, 30_000);

  it("gives the scaffold a local source for every workspace package the template declares", async () => {
    const root = await temporaryRoot("threenative-sandbox-sources-");
    const result = makeSandbox({
      bare: true,
      genre: "endless-runner",
      out: path.join(root, "sandbox"),
      prepare: false,
      repo: process.cwd(),
      template: "starter",
    });
    const scaffold = await readFile(path.join(result.out, "scaffold.sh"), "utf8");
    const manifest = JSON.parse(
      await readFile(
        path.join(process.cwd(), "packages/create-threenative/templates/starter/package.json"),
        "utf8",
      ),
    ) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
    const declared = [
      ...Object.keys(manifest.dependencies ?? {}),
      ...Object.keys(manifest.devDependencies ?? {}),
    ].filter((name) => name === "create-threenative" || name.startsWith("@threenative/"));
    // Every one of these 404s on the registry today; an unpassed source is a dead scaffold.
    expect(declared).toContain("@threenative/studio");
    expect(declared).toContain("create-threenative");
    for (const dependency of declared) {
      const flag =
        dependency === "create-threenative"
          ? "--cli-package"
          : `--${dependency.replace("@threenative/", "")}-package`;
      expect(scaffold, dependency).toContain(flag);
    }
  }, 30_000);

  it("refuses a sandbox whose template needs a package the sweep never packed", () => {
    expect(() =>
      assertTemplateSourcesCovered(process.cwd(), "starter", {
        core: "core.tgz",
        physics: "physics.tgz",
        playtest: "playtest.tgz",
        ui: "ui.tgz",
        "create-threenative": "cli.tgz",
      }),
    ).toThrow(/@threenative\/studio/);
  });

  it("throws before creating a sandbox when the genre brief is missing", async () => {
    const root = await temporaryRoot("threenative-genre-");
    const genre = path.join(root, "docs", "benchmark", "genres", "missing");
    await mkdir(genre, { recursive: true });
    await writeFile(path.join(genre, "reference.png"), "reference");
    expect(() => resolveGenre(root, "missing")).toThrow(/missing its required brief/);
    await expect(readFile(path.join(root, "sandbox", "sweep.json"))).rejects.toThrow();
  });

  it("throws when the genre reference image is missing", async () => {
    const root = await temporaryRoot("threenative-genre-");
    const genre = path.join(root, "docs", "benchmark", "genres", "missing");
    await mkdir(genre, { recursive: true });
    await writeFile(path.join(genre, "brief.md"), "sealed brief\n");
    expect(() => resolveGenre(root, "missing")).toThrow(/missing its required reference image/);
  });

  it("writes a vanilla project with only the plain Three.js bridge package", async () => {
    const root = await temporaryRoot("threenative-vanilla-");
    const result = makeSandbox({
      arm: "vanilla",
      genre: "platformer",
      install: false,
      out: path.join(root, "sandbox"),
      prepare: false,
      repo: process.cwd(),
    });
    const packageJson = JSON.parse(
      await readFile(path.join(result.out, "package.json"), "utf8"),
    ) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const packageText = JSON.stringify(packageJson);
    expect(packageText).toContain("@threenative/playtest");
    expect(packageText).not.toMatch(/@threenative\/(?:core|physics|ui)/);
    await expect(readFile(path.join(result.out, "index.html"), "utf8")).resolves.toContain(
      "/src/main.ts",
    );
    const agents = await readFile(path.join(result.out, "AGENTS.md"), "utf8");
    expect(agents).toContain(
      "You may install any npm package you choose, including a physics engine.",
    );
    expect(agents).toContain("fixedStep");
    expect(agents).toContain("diagnostics: () => []");
    expect(agents).toContain("gameplay: () => ({");
    expect(agents).toContain('animation: { player: { clip: "idle", advancedFrames: 1 } }');
    expect(agents).toContain('states: { player: "idle", mission: "playing" }');
    expect(agents).toContain("resources: { read: () => ({ state: { ...state } }) }");
    expect(agents).toContain("all five provider hooks");
    expect(agents).toContain("generic resource id `state`");
    await expect(readFile(path.join(result.out, "src", "main.ts"))).rejects.toThrow();
    await expect(
      readFile(path.join(result.out, "node_modules", "@threenative", "core")),
    ).rejects.toThrow();
  });

  it("rejects a manifest that omits the arm", async () => {
    const root = await temporaryRoot("threenative-manifest-");
    const file = path.join(root, "sweep.json");
    await writeFile(
      file,
      JSON.stringify({
        genre: "platformer",
        briefHash: "a".repeat(64),
        proofHash: "b".repeat(64),
        template: "platformer",
        date: "2099-01-01T00:00:00.000Z",
        frameworkVersion: "0.1.0",
        sourceLines: 0,
      }),
    );
    expect(() => readManifest(file)).toThrow(/missing arm/);
  });

  it("rejects non-string identity fields and fractional source lines", async () => {
    const root = await temporaryRoot("threenative-manifest-types-");
    const file = path.join(root, "sweep.json");
    const valid = {
      arm: "framework",
      genre: "platformer",
      briefHash: "a".repeat(64),
      proofHash: "b".repeat(64),
      template: "platformer",
      date: "2099-01-01T00:00:00.000Z",
      frameworkVersion: "0.1.0",
      sourceLines: 0,
    };
    for (const field of ["briefHash", "proofHash", "template", "frameworkVersion"] as const) {
      await writeFile(file, JSON.stringify({ ...valid, [field]: 1 }));
      expect(() => readManifest(file)).toThrow(new RegExp(`${field} must be a non-empty string`));
    }
    await writeFile(file, JSON.stringify({ ...valid, sourceLines: 1.5 }));
    expect(() => readManifest(file)).toThrow(/sourceLines must be a non-negative integer/);
  });

  it("refuses to wipe a sandbox whose manifest is not archived", async () => {
    const root = await temporaryRoot("threenative-guard-");
    const sandbox = path.join(root, "sandbox");
    const brief = await readFile("docs/benchmark/genres/platformer/brief.md");
    await mkdir(sandbox, { recursive: true });
    await writeFile(path.join(sandbox, "sentinel.txt"), "keep me\n");
    await writeFile(
      path.join(sandbox, "sweep.json"),
      JSON.stringify({
        genre: "platformer",
        briefHash: createHash("sha256").update(brief).digest("hex"),
        proofHash: sealedProofHash(process.cwd(), "platformer"),
        arm: "framework",
        template: "platformer",
        date: "2099-01-01T00:00:00.000Z",
        frameworkVersion: "0.1.0",
        sourceLines: 0,
      }),
    );
    expect(() =>
      makeSandbox({
        genre: "platformer",
        out: sandbox,
        repo: process.cwd(),
        template: "platformer",
      }),
    ).toThrow(/pnpm sweep:archive/);
    await expect(readFile(path.join(sandbox, "sentinel.txt"), "utf8")).resolves.toBe("keep me\n");
  });

  it("does not treat another arm or proof as the archived run", async () => {
    const root = await temporaryRoot("threenative-archive-identity-");
    const manifest = {
      arm: "vanilla" as const,
      briefHash: "a".repeat(64),
      date: "2099-01-01T00:00:00.000Z",
      frameworkVersion: "0.1.0",
      genre: "platformer",
      proofHash: "b".repeat(64),
      sourceLines: 0,
      template: "platformer",
    };
    const archive = path.join(root, "docs", "benchmark", "sweeps", "platformer-2099-01-01");
    await mkdir(archive, { recursive: true });
    await writeFile(
      path.join(archive, "sweep.json"),
      JSON.stringify({ ...manifest, arm: "framework" }),
    );
    expect(isArchived(manifest, root)).toBe(false);
    await writeFile(
      path.join(archive, "sweep.json"),
      JSON.stringify({ ...manifest, proofHash: "c".repeat(64) }),
    );
    expect(isArchived(manifest, root)).toBe(false);
    await writeFile(path.join(archive, "sweep.json"), JSON.stringify(manifest));
    expect(isArchived(manifest, root)).toBe(true);
  });
});

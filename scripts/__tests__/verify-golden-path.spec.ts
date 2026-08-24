import { chmod, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { makeTempDir } from "../../test-support/temp-dir.js";
import {
  GOLDEN_PATH_STEPS,
  type TemplateStep,
  assertGoldenPathSteps,
  assertMcpToolSurface,
  assertTemplateDependencies,
  discoverGoldenPathTemplates,
  formatCorrectiveCommand,
  goldenPathCorrectiveCommands,
  packWorkspace,
  probeMcpServer,
  runCommand,
  runGoldenPathTemplate,
  scaffold,
  verifyPackedMutationControl,
  writeScaffoldScript,
} from "../verify-golden-path.js";

describe("golden path matrix", () => {
  it("asserts the actual ordered steps and fails when one is omitted", () => {
    expect(() => assertGoldenPathSteps(GOLDEN_PATH_STEPS.slice(0, -1))).toThrow(
      /missing assert artifact/u,
    );
  });

  it("records every template step that really ran", async () => {
    const calls: string[] = [];
    const action = (name: string) => async (): Promise<void> => {
      calls.push(name);
    };
    const steps = await runGoldenPathTemplate("fixture", {
      scaffold: action("scaffold"),
      install: action("install"),
      mcp: action("mcp"),
      dev: action("dev"),
      test: action("test"),
      buildWeb: action("build web"),
      assertArtifact: action("assert artifact"),
    });
    expect(steps).toEqual(GOLDEN_PATH_STEPS.slice(1));
    expect(calls).toEqual(GOLDEN_PATH_STEPS.slice(1));
  });

  it("runs the generated adopter scaffold script from the packed command path", async () => {
    const root = await makeTempDir("threenative-golden-path-script-");
    try {
      const cli = path.join(root, "create-threenative-0.1.0.tgz");
      const core = path.join(root, "threenative-core-0.1.0.tgz");
      const script = await writeScaffoldScript(root, "starter", cli, ["--core-package", core]);
      expect(script).toBe(path.join(root, "scaffold.sh"));
      expect((await stat(script)).mode & 0o111).not.toBe(0);
      const source = await readFile(script, "utf8");
      expect(source).toContain("pnpm dlx");
      expect(source).toContain('"${1:-game}"');
      expect(source).toContain(cli);
      expect(source).toContain(core);
      expect(source).not.toContain("--no-install");
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("reports the failing layer, project, search location, and corrective command", async () => {
    const root = await makeTempDir("threenative-golden-path-command-");
    try {
      await expect(
        runCommand("test", process.execPath, ["-e", "process.exit(7)"], root),
      ).rejects.toThrow(
        new RegExp(
          `layer 'test'.*project '${root}'.*Searched:.*${root}.*Corrective command:.*exited 7`,
          "s",
        ),
      );
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("executes project corrective commands from their recorded cwd", async () => {
    const root = await makeTempDir("threenative-golden-path-corrective-");
    try {
      const project = path.join(root, "game");
      await mkdir(project, { recursive: true });
      await writeFile(path.join(project, "ok.mjs"), "process.exit(0);\n");
      await writeFile(
        path.join(project, "package.json"),
        JSON.stringify({
          name: "corrective-game",
          private: true,
          scripts: {
            dev: "node ok.mjs",
            test: "node ok.mjs",
          },
        }),
      );
      const commands = goldenPathCorrectiveCommands(project, 43123);
      for (const [step, command] of Object.entries(commands)) {
        if (step === "scaffold") continue;
        const rendered = formatCorrectiveCommand(command);
        expect(rendered).not.toMatch(/<[^>]+>/u);
        expect(rendered).not.toMatch(/\b(?:inspect|rerun)\b/u);
        if (step === "build web" || step === "assert artifact") {
          const binaryDirectory = path.join(project, "node_modules/.bin");
          await mkdir(binaryDirectory, { recursive: true });
          const binary = path.join(binaryDirectory, "threenative");
          await writeFile(binary, "#!/bin/sh\nexit 0\n");
          await chmod(binary, 0o755);
        }
        await runCommand(step as TemplateStep, command.command, command.args, command.cwd);
      }
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  }, 30_000);

  it("creates and executes the scaffold recovery command before reporting a missing dependency", async () => {
    const root = await makeTempDir("threenative-golden-path-scaffold-recovery-");
    const originalPath = process.env.PATH;
    try {
      const templatesRoot = path.join(root, "templates");
      const template = path.join(templatesRoot, "broken-vite");
      const project = path.join(root, "game");
      const cli = path.join(root, "create-threenative-0.1.0.tgz");
      const bin = path.join(root, "bin");
      await mkdir(template, { recursive: true });
      await mkdir(bin, { recursive: true });
      await writeFile(
        path.join(template, "package.json"),
        JSON.stringify({
          name: "broken-vite",
          dependencies: { "create-threenative": "0.1.0" },
        }),
      );
      const fakePnpm = path.join(bin, "pnpm");
      await writeFile(fakePnpm, '#!/bin/sh\ntest "$1" = dlx\n');
      await chmod(fakePnpm, 0o755);

      const actions = {
        assertArtifact: async () => {},
        buildWeb: async () => {},
        dev: async () => {},
        install: async () => {},
        mcp: async () => {},
        scaffold: () =>
          scaffold("broken-vite", project, { "create-threenative": cli }, templatesRoot),
        test: async () => {},
      };
      await expect(runGoldenPathTemplate("broken-vite", actions, project)).rejects.toThrow(
        /Corrective command: \(cd .* && \.\/scaffold\.sh game\)/u,
      );

      const script = path.join(root, "scaffold.sh");
      expect((await stat(script)).mode & 0o111).not.toBe(0);
      const command = goldenPathCorrectiveCommands(project).scaffold;
      process.env.PATH = [bin, originalPath]
        .filter((value): value is string => value !== undefined)
        .join(path.delimiter);
      await runCommand("scaffold", command.command, command.args, command.cwd);
    } finally {
      if (originalPath === undefined) process.env.PATH = undefined;
      else process.env.PATH = originalPath;
      await rm(root, { force: true, recursive: true });
    }
  });

  it("fails closed when a template omits vite", () => {
    expect(() => assertTemplateDependencies("broken-vite", {}, {})).toThrow(
      "TN_GOLDEN_PATH_DEPENDENCY_MISSING: template 'broken-vite' is missing dependency 'vite'",
    );
  });

  it("discovers every template directory instead of carrying a list", async () => {
    const root = await makeTempDir("threenative-golden-path-templates-");
    try {
      for (const [name, genre] of [
        ["alpha", "arcade"],
        ["beta-kit", "strategy"],
      ] as const) {
        const directory = path.join(root, name);
        await mkdir(directory);
        await writeFile(
          path.join(directory, "kit.json"),
          JSON.stringify({
            blurb: `${name} blurb`,
            genre,
            kit: true,
            name,
            title: `${name} title`,
          }),
        );
      }
      expect(discoverGoldenPathTemplates(root)).toEqual(["alpha", "beta-kit"]);
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("fails closed when the template directory is empty", async () => {
    const root = await makeTempDir("threenative-golden-path-empty-");
    try {
      expect(() => discoverGoldenPathTemplates(root)).toThrow(/TN_GOLDEN_PATH_TEMPLATES_EMPTY/u);
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("launches an MCP server and checks tools plus sculpt resources over stdio", async () => {
    const root = await makeTempDir("threenative-golden-path-mcp-");
    try {
      const server = path.join(root, "server.mjs");
      await writeFile(
        server,
        `import { createInterface } from "node:readline";
const input = createInterface({ input: process.stdin });
input.on("line", (line) => {
  const request = JSON.parse(line);
  if (request.id === undefined) return;
  const result = request.method === "tools/list"
    ? { tools: [{ name: "sculpt_plan" }] }
    : request.method === "resources/list"
      ? { resources: [{ uri: "grimoire://safe" }] }
      : request.method === "resources/read"
        ? { contents: [{ text: "Use broad shapes and a restrained palette." }] }
        : { protocolVersion: "2025-06-18", capabilities: {} };
  process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: request.id, result }) + "\\n");
});
`,
      );
      await expect(
        probeMcpServer(
          "threenative-sculpt",
          { args: [server], command: process.execPath },
          { tools: ["sculpt_plan"], version: "test" },
          root,
          async (request) => {
            const listed = await request("resources/list");
            expect(listed).toEqual({ resources: [{ uri: "grimoire://safe" }] });
            const read = await request("resources/read", { uri: "grimoire://safe" });
            expect(read).toEqual({
              contents: [{ text: "Use broad shapes and a restrained palette." }],
            });
          },
        ),
      ).resolves.toBeUndefined();
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("fails closed when a sculpt resource validator observes no resources", async () => {
    const root = await makeTempDir("threenative-golden-path-mcp-resource-");
    try {
      const server = path.join(root, "server.mjs");
      await writeFile(
        server,
        `import { createInterface } from "node:readline";
const input = createInterface({ input: process.stdin });
input.on("line", (line) => {
  const request = JSON.parse(line);
  if (request.id === undefined) return;
  const result = request.method === "tools/list"
    ? { tools: [{ name: "sculpt_plan" }] }
    : request.method === "resources/list"
      ? { resources: [] }
      : { protocolVersion: "2025-06-18", capabilities: {} };
  process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: request.id, result }) + "\\n");
});
`,
      );
      await expect(
        probeMcpServer(
          "threenative-sculpt",
          { args: [server], command: process.execPath },
          { tools: ["sculpt_plan"], version: "test" },
          root,
          async (request) => {
            const listed = await request("resources/list");
            const resources = (listed as { resources?: unknown }).resources;
            if (!Array.isArray(resources) || resources.length === 0) {
              throw new Error("threenative-sculpt listed no technique resources.");
            }
          },
        ),
      ).rejects.toThrow(/listed no technique resources/u);
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("rejects MCP tool-surface drift before the packed path can pass", () => {
    expect(() =>
      assertMcpToolSurface("threenative-assets", ["asset_search_sources"], {
        tools: [{ name: "different_tool" }],
      }),
    ).toThrow(/surface drifted/u);
  });

  it("packs and scaffolds the mutated CLI before observing its broken dependency", async () => {
    const root = await makeTempDir("threenative-golden-path-packed-control-");
    try {
      const staging = path.join(root, "packages");
      await mkdir(staging, { recursive: true });
      const outputs = [
        "packages/core/dist/index.js",
        "packages/create-threenative/dist/index.js",
        "packages/physics/dist/index.js",
        "packages/playtest/dist/index.js",
        "packages/ui/dist/index.js",
      ];
      const built = await Promise.all(
        outputs.map(async (output) =>
          (await stat(path.resolve(output)).catch(() => undefined))?.isFile(),
        ),
      );
      const sources = await packWorkspace(staging, !built.every((present) => present === true));
      const evidence = await verifyPackedMutationControl(sources);
      expect(evidence.mutatedSha256).not.toBe(evidence.repositorySha256);
      expect(evidence.mutatedTarball).not.toBe(evidence.repositoryTarball);
      expect(evidence.generatedManifest).toContain("mutated-project/package.json");
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  }, 120_000);
});

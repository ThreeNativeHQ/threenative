import { execFile } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { cliHelp, discoverKitManifests, kitManifest, parseArgs } from "../src/index.js";

const run = promisify(execFile);
const threenativeCli = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../dist/threenative.js",
);

describe("create-threenative CLI", () => {
  it("prints usable help for the scaffold command and every template", () => {
    const manifests = discoverKitManifests();
    const help = cliHelp();
    const width = Math.max(...manifests.map(({ name }) => name.length));

    expect(help).toContain("Usage: npx create-threenative <directory> [options]");
    expect(help).toContain("--template <name>");
    expect(help).toContain("--no-install");
    expect(help).toContain("--help");
    for (const manifest of manifests) {
      expect(help).toContain(
        `${manifest.name.padEnd(width)}  ${manifest.title}: ${manifest.blurb}`,
      );
    }
  });

  it("makes every template's genre reachable through the template flag", () => {
    for (const manifest of discoverKitManifests()) {
      const options = parseArgs(["game", "--template", manifest.name, "--no-install"]);
      expect(options).toMatchObject({ install: false, target: "game", template: manifest.name });
      expect(kitManifest(manifest.name)).toMatchObject({
        genre: manifest.genre,
        name: manifest.name,
      });
    }
  });

  it("prints successful help from the real threenative executable", async () => {
    const root = await run(process.execPath, [threenativeCli, "--help"]);
    expect(root.stderr).toBe("");
    expect(root.stdout).toContain("Usage: threenative <command> [options]");
    const advertised = [...root.stdout.matchAll(/^ {2}([a-z]+)\s+/gmu)]
      .map(([, command]) => command)
      .filter((command): command is string => command !== undefined);

    for (const command of advertised) {
      const commandHelp = await run(process.execPath, [threenativeCli, command, "--help"]);
      expect(commandHelp.stderr, command).toBe("");
      expect(commandHelp.stdout, command).toContain(`Usage: threenative ${command}`);
    }
    expect(advertised).toEqual(["build", "doctor"]);

    for (const command of ["dev", "test", "ship"]) {
      await expect(
        run(process.execPath, [threenativeCli, command, "--help"]),
      ).rejects.toMatchObject({ code: 1 });
    }
  });
});

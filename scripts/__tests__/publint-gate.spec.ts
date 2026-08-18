import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

type PackageManifest = {
  name?: unknown;
  private?: unknown;
  scripts?: {
    test?: unknown;
  };
};

const publintCommandPattern =
  /^(?:(?:pnpm|npm|yarn|npx)\s+(?:exec\s+)?)?publint(?:\s+[^;&|#$()`<>"'\r\n]+)?\s*$/u;
const unsafeShellSyntaxPattern = /[\\#$();|&`<>"'\r\n]/u;
const shellControlWordPattern =
  /(?:^|\s)(?:builtin|command|eval|exit|return|source|trap|\.)(?:\s|$)/u;
const shellExecWordPattern = /(?:^|\s)exec(?:\s|$)/u;
const packageManagerExecPattern = /^(?:pnpm|npm|yarn|npx)\s+[^#$();|&`<>"'\r\n]*\bexec(?:\s|$)/u;

function containsShellControlWord(command: string): boolean {
  return (
    shellControlWordPattern.test(command) ||
    (shellExecWordPattern.test(command) && !packageManagerExecPattern.test(command))
  );
}

function hasPublintGate(script: string): boolean {
  const commands = script.split(/\s*&&\s*/u).map((command) => command.trim());
  if (
    commands.some(
      (command) =>
        command.length === 0 ||
        unsafeShellSyntaxPattern.test(command) ||
        containsShellControlWord(command),
    )
  ) {
    return false;
  }
  return publintCommandPattern.test(commands.at(-1) ?? "");
}

function findPackageManifests(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true })
    .flatMap((entry) => {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) return findPackageManifests(path);
      return entry.isFile() && entry.name === "package.json" ? [path] : [];
    })
    .sort();
}

describe("publint package gate", () => {
  it("requires every non-private package test script to run publint", () => {
    const missing = findPackageManifests(join(process.cwd(), "packages"))
      .map((path) => ({
        manifest: JSON.parse(readFileSync(path, "utf8")) as PackageManifest,
        path,
      }))
      .filter(({ manifest }) => manifest.private !== true)
      .flatMap(({ manifest, path }) => {
        const name = typeof manifest.name === "string" ? manifest.name : path;
        const testScript = manifest.scripts?.test;
        return typeof testScript === "string" && hasPublintGate(testScript) ? [] : [name];
      });

    expect(missing, `Packages missing publint in scripts.test: ${missing.join(", ")}`).toEqual([]);
  });

  it("requires an executable publint command rather than a text mention", () => {
    expect(hasPublintGate("pnpm run build && publint --strict")).toBe(true);
    expect(hasPublintGate("pnpm run build && echo publint")).toBe(false);
    expect(hasPublintGate("pnpm run build || publint")).toBe(false);
    expect(hasPublintGate("publint --strict || true")).toBe(false);
    expect(hasPublintGate("pnpm run build # && publint --strict")).toBe(false);
    expect(hasPublintGate("publint --strict\ntrue")).toBe(false);
    expect(hasPublintGate("exit 0 && publint --strict")).toBe(false);
    expect(hasPublintGate("pnpm run build; exit 0 && publint --strict")).toBe(false);
    expect(hasPublintGate("pnpm run build && command exit 0 && publint --strict")).toBe(false);
    expect(hasPublintGate("true && eval exit 0 && publint --strict")).toBe(false);
    expect(hasPublintGate("true && builtin exit 0 && publint --strict")).toBe(false);
    expect(hasPublintGate("true && source ./exit-success && publint --strict")).toBe(false);
    expect(hasPublintGate("true && . ./exit-success && publint --strict")).toBe(false);
    expect(hasPublintGate("true && time exit 0 && publint --strict")).toBe(false);
    expect(hasPublintGate("true && ! exit 0 && publint --strict")).toBe(false);
    expect(hasPublintGate("true && e\\xit 0 && publint --strict")).toBe(false);
  });
});

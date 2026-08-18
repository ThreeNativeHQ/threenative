import fs from "node:fs";
import { rm } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { makeTempDir } from "../../test-support/temp-dir.js";
import {
  type CommandRunner,
  assertNoLocalSpecifiers,
  checkLockfile,
  verifyRegistryInstall,
} from "../verify-registry-install.js";

const roots: string[] = [];

async function tempRoot(): Promise<string> {
  const root = await makeTempDir("threenative-registry-spec-");
  roots.push(root);
  return root;
}

/** A runner that writes a registry-clean lockfile and succeeds at every step. */
function happyRunner(): CommandRunner {
  return (command, args, cwd) => {
    if (command === "npm" && args[0] === "create") {
      const project = path.join(cwd, "my-game");
      fs.mkdirSync(project, { recursive: true });
      fs.writeFileSync(path.join(project, "package.json"), JSON.stringify({ name: "my-game" }));
      return "created";
    }
    if (command === "npm" && args[0] === "install") {
      fs.writeFileSync(
        path.join(cwd, "package-lock.json"),
        JSON.stringify({
          packages: {
            "node_modules/@threenative/core": {
              resolved: "https://registry.npmjs.org/@threenative/core/-/core-0.2.0.tgz",
            },
          },
        }),
      );
      return "installed";
    }
    return "ok";
  };
}

describe("pnpm tsx scripts/verify-registry-install.ts", () => {
  afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => rm(root, { force: true, recursive: true })));
  });

  it("passes when every step runs and the lockfile names only the registry", async () => {
    const report = verifyRegistryInstall({ parent: await tempRoot(), run: happyRunner() });
    expect(report.steps.filter((step) => !step.ok)).toEqual([]);
    expect(report.exitCode).toBe(0);
  });

  it("fails, and runs nothing further, when the scaffold 404s", async () => {
    // This is the state of the world today, and the reason the gate exists.
    const report = verifyRegistryInstall({
      parent: await tempRoot(),
      run: (command, args) => {
        if (command === "npm" && args[0] === "create")
          throw new Error(
            "npm error 404 Not Found - GET https://registry.npmjs.org/create-threenative",
          );
        return "ok";
      },
    });
    expect(report.exitCode).toBe(1);
    expect(report.steps[0]?.detail).toMatch(/404/u);
    expect(report.steps.slice(1).every((step) => !step.ok)).toBe(true);
    expect(report.steps.slice(1).every((step) => step.detail.includes("Not run"))).toBe(true);
  });

  it("fails when the lockfile resolves a dependency from this machine", async () => {
    const report = verifyRegistryInstall({
      parent: await tempRoot(),
      run: (command, args, cwd) => {
        if (command === "npm" && args[0] === "install") {
          fs.writeFileSync(
            path.join(cwd, "package-lock.json"),
            JSON.stringify({
              packages: {
                "node_modules/@threenative/core": { resolved: "file:../../packages/core" },
              },
            }),
          );
          return "installed";
        }
        return happyRunner()(command, args, cwd);
      },
    });
    expect(report.exitCode).toBe(1);
    expect(report.steps.find((step) => step.name === "lockfile")?.detail).toMatch(
      /TN_REGISTRY_INSTALL_LOCAL_SPECIFIER/u,
    );
  });

  it("rejects a link: specifier as well as file:", () => {
    expect(() =>
      assertNoLocalSpecifiers("pnpm-lock.yaml", "  '@threenative/ui': link:../../packages/ui\n"),
    ).toThrow(/TN_REGISTRY_INSTALL_LOCAL_SPECIFIER/u);
  });

  it("refuses a project with no lockfile rather than finding no offenders", async () => {
    // Vacuous green: no lockfile means no matches means "clean", unless the absence is a failure.
    const root = await tempRoot();
    expect(() => checkLockfile(root)).toThrow(/TN_REGISTRY_INSTALL_NO_LOCKFILE/u);
  });

  it("accepts a lockfile that names only registry tarballs", async () => {
    const root = await tempRoot();
    fs.writeFileSync(
      path.join(root, "package-lock.json"),
      JSON.stringify({ resolved: "https://registry.npmjs.org/@threenative/core/-/core-0.2.0.tgz" }),
    );
    expect(checkLockfile(root)).toBe("package-lock.json");
  });
});

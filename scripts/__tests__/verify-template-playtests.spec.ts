import { mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { makeTempDir } from "../../test-support/temp-dir.js";
import {
  assertTemplatePlaytestsPassed,
  auditTemplatePlaytests,
  runTemplatePlaytests,
  verifyTemplatePlaytests,
} from "../verify-template-playtests.js";

async function writeScenario(
  root: string,
  template: string,
  name: string,
  scenario: Record<string, unknown>,
): Promise<void> {
  const directory = path.join(root, template, "playtests");
  await mkdir(directory, { recursive: true });
  await writeFile(
    path.join(directory, `${name}.playtest.json`),
    JSON.stringify({ name, schemaVersion: 1, ...scenario }),
  );
}

describe("template playtest matrix", () => {
  it("reports every template and continues after a failing template", async () => {
    const root = await makeTempDir("threenative-template-matrix-");
    const calls: string[] = [];
    try {
      const results = await runTemplatePlaytests(
        ["alpha", "beta"],
        root,
        { "create-threenative": "/tmp/create-threenative.tgz" },
        {
          createProject: async ({ target, template }) => {
            const selectedTemplate = template ?? "unknown";
            calls.push(`scaffold:${selectedTemplate}`);
            await mkdir(target, { recursive: true });
            return { installed: true, target, template: selectedTemplate };
          },
          run: async (_command, _args, cwd) => {
            const template = path.basename(cwd);
            calls.push(`test:${template}`);
            if (template === "alpha") throw new Error("alpha test failed");
          },
        },
      );

      expect(results).toEqual([
        { error: "alpha test failed", pass: false, template: "alpha" },
        { pass: true, template: "beta" },
      ]);
      expect(calls).toEqual(["scaffold:alpha", "test:alpha", "scaffold:beta", "test:beta"]);
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("does not count schema-invalid setup.scene as an explicit play-state entry", async () => {
    const root = await makeTempDir("threenative-template-audit-");
    try {
      await writeScenario(root, "alpha", "assumes-play", {
        steps: [{ kind: "wait", waitTicks: 1 }],
      });
      await writeScenario(root, "alpha", "enters-play", {
        steps: [{ kind: "input", label: "start-game", press: "Enter" }],
      });
      await mkdir(path.join(root, "alpha", "native-playtests"), { recursive: true });
      await writeFile(
        path.join(root, "alpha", "native-playtests", "touch.playtest.json"),
        JSON.stringify({ name: "touch", schemaVersion: 1, target: "android", steps: [] }),
      );
      await writeScenario(root, "beta", "declares-scene", {
        setup: { scene: "play" },
        steps: [{ kind: "wait", waitTicks: 1 }],
      });

      await expect(auditTemplatePlaytests(root, ["alpha", "beta"])).resolves.toEqual([
        { assumesStartInPlay: 2, explicitStart: 1, scenarioCount: 3, template: "alpha" },
        { assumesStartInPlay: 1, explicitStart: 0, scenarioCount: 1, template: "beta" },
      ]);
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("fails once after all template results have been reported", () => {
    expect(() =>
      assertTemplatePlaytestsPassed([
        { error: "alpha test failed", pass: false, template: "alpha" },
        { pass: true, template: "beta" },
      ]),
    ).toThrow("TN_TEMPLATE_PLAYTESTS_FAILED: alpha: alpha test failed");
  });

  it("reports an audit failure after every template still runs", async () => {
    const root = await makeTempDir("threenative-template-audit-matrix-");
    const calls: string[] = [];
    try {
      const malformedDirectory = path.join(root, "alpha", "playtests");
      await mkdir(malformedDirectory, { recursive: true });
      await writeFile(
        path.join(malformedDirectory, "malformed.playtest.json"),
        "{ malformed scenario",
      );
      await writeScenario(root, "beta", "valid", {
        steps: [{ kind: "wait", waitTicks: 1 }],
      });

      await expect(
        verifyTemplatePlaytests(
          ["alpha", "beta"],
          root,
          { "create-threenative": "/tmp/create-threenative.tgz" },
          {
            auditRoot: root,
            createProject: async ({ target, template }) => {
              const selectedTemplate = template ?? "unknown";
              calls.push(`scaffold:${selectedTemplate}`);
              await mkdir(target, { recursive: true });
              return { installed: true, target, template: selectedTemplate };
            },
            run: async (_command, _args, cwd) => {
              calls.push(`test:${path.basename(cwd)}`);
            },
          },
        ),
      ).rejects.toThrow("TN_TEMPLATE_PLAYTESTS_FAILED: alpha: TN_TEMPLATE_PLAYTEST_AUDIT_INVALID");
      expect(calls).toEqual(["scaffold:alpha", "test:alpha", "scaffold:beta", "test:beta"]);
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("reports a structural failure and still executes every template", async () => {
    const root = await makeTempDir("threenative-template-structure-matrix-");
    const calls: string[] = [];
    try {
      const dependencies = {
        auditRoot: root,
        inspectTemplates: () => [
          {
            errors: ["alpha: missing src/render/sky.ts"],
            files: [],
            template: "alpha",
          },
          { errors: [], files: [], template: "beta" },
        ],
        createProject: async ({ target, template }: { target: string; template?: string }) => {
          const selectedTemplate = template ?? "unknown";
          calls.push(`scaffold:${selectedTemplate}`);
          await mkdir(target, { recursive: true });
          return { installed: true, target, template: selectedTemplate };
        },
        run: async (_command: string, _args: readonly string[], cwd: string) => {
          calls.push(`test:${path.basename(cwd)}`);
        },
      };

      await expect(
        verifyTemplatePlaytests(
          ["alpha", "beta"],
          root,
          { "create-threenative": "/tmp/create-threenative.tgz" },
          dependencies,
        ),
      ).rejects.toThrow(
        "TN_TEMPLATE_PLAYTESTS_FAILED: alpha: TN_VISUAL_STRUCTURE_FAILED:\nalpha: missing src/render/sky.ts",
      );
      expect(calls).toEqual(["scaffold:alpha", "test:alpha", "scaffold:beta", "test:beta"]);
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });
});

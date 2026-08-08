import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { sealedProofHash } from "../make-sandbox";
import { pairSweeps } from "../sweep-pair";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function fixtureRoot(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "threenative-pair-"));
  temporaryRoots.push(root);
  await mkdir(path.join(root, "docs/benchmark/genres/fixture/proof"), { recursive: true });
  await writeFile(
    path.join(root, "docs/benchmark/genres/fixture/proof/fixture.playtest.json"),
    JSON.stringify({
      name: "fixture",
      schemaVersion: 1,
      target: "web",
      steps: [{ waitFrames: 1 }],
      assert: {
        movement: { entity: "player", minDistance: 1 },
        visibility: [{ entity: "player", minProjectedPixels: 20 }],
      },
    }),
  );
  return root;
}

async function writeArchive(
  root: string,
  name: string,
  options: {
    readonly arm: "framework" | "vanilla";
    readonly genre?: string;
    readonly briefHash?: string;
    readonly proofHash?: string;
    readonly proof?: boolean;
  },
): Promise<string> {
  const archive = path.join(root, name);
  await mkdir(path.join(archive, "src"), { recursive: true });
  await writeFile(
    path.join(archive, "src", "main.ts"),
    options.arm === "framework"
      ? 'import { defineGame } from "@threenative/core";\nvoid defineGame;\n'
      : 'import { Scene } from "three";\nvoid Scene;\n',
  );
  await writeFile(
    path.join(archive, "package.json"),
    JSON.stringify({
      dependencies:
        options.arm === "framework"
          ? { "@threenative/core": "0.1.0" }
          : { "@threenative/playtest": "0.1.0", three: "0.185.1" },
    }),
  );
  if (options.arm === "framework") {
    await mkdir(path.join(archive, "starter-baseline", "src"), { recursive: true });
    await writeFile(
      path.join(archive, "starter-baseline", "src", "main.ts"),
      'import { defineGame } from "@threenative/core";\n',
    );
    await mkdir(path.join(archive, "framework-types", "@threenative", "core"), { recursive: true });
    await writeFile(
      path.join(archive, "framework-types", "@threenative", "core", "index.d.ts"),
      "export declare const defineGame: number;\n",
    );
  }
  const genre = options.genre ?? "fixture";
  const briefHash = options.briefHash ?? "a".repeat(64);
  const proofHash =
    options.proofHash ?? (genre === "fixture" ? sealedProofHash(root, genre) : "b".repeat(64));
  await writeFile(
    path.join(archive, "sweep.json"),
    `${JSON.stringify(
      {
        arm: options.arm,
        genre,
        briefHash,
        proofHash,
        template: "fixture",
        date: "2099-01-01T00:00:00.000Z",
        frameworkVersion: "0.1.0",
        sourceLines: 0,
      },
      null,
      2,
    )}\n`,
  );
  if (options.proof !== false) {
    await writeFile(
      path.join(archive, "proof.json"),
      `${JSON.stringify(
        {
          arm: options.arm,
          genre,
          proofHash,
          scenarios: [
            {
              name: "fixture",
              verdict: "pass",
              assertions: [
                { id: "movement.distance", pass: true },
                { id: "visibility.player", pass: true },
              ],
              diagnostics: [],
            },
          ],
          passed: 1,
          total: 1,
        },
        null,
        2,
      )}\n`,
    );
  }
  return archive;
}

describe("paired sweep", () => {
  it("reports both arms' proof and source measurements", async () => {
    const root = await fixtureRoot();
    const framework = await writeArchive(root, "framework", { arm: "framework" });
    const vanilla = await writeArchive(root, "vanilla", { arm: "vanilla" });
    expect(pairSweeps(framework, vanilla, root)).toMatchObject({
      genre: "fixture",
      framework: {
        passed: 1,
        total: 1,
        reachRate: 1,
        sourceFiles: 1,
        frameworkFiles: 1,
        threeOnlyFiles: 0,
        usedExports: ["defineGame"],
        unusedExports: [],
      },
      vanilla: {
        passed: 1,
        total: 1,
        reachRate: 0,
        sourceFiles: 1,
        frameworkFiles: 0,
        threeOnlyFiles: 1,
        usedExports: [],
        unusedExports: [],
      },
    });
    const pair = pairSweeps(framework, vanilla, root);
    expect(pair.framework.sourceBytes).toBeGreaterThan(0);
    expect(pair.vanilla.sourceBytes).toBeGreaterThan(0);
  });

  it("reports a signed framework-minus-vanilla source cost delta", async () => {
    const root = await fixtureRoot();
    const framework = await writeArchive(root, "framework", { arm: "framework" });
    const vanilla = await writeArchive(root, "vanilla", { arm: "vanilla" });
    await writeFile(path.join(vanilla, "src", "extra.ts"), "export const extra = true;\n");

    const pair = pairSweeps(framework, vanilla, root);

    expect(pair.delta).toEqual({
      authoredBytes: pair.framework.authoredBytes - pair.vanilla.authoredBytes,
      authoredLoc: pair.framework.authoredLoc - pair.vanilla.authoredLoc,
      sourceBytes: pair.framework.sourceBytes - pair.vanilla.sourceBytes,
      sourceFiles: -1,
      userLoc: -1,
    });
    expect(pair.delta.sourceBytes).toBeLessThan(0);
  });

  it("rejects self-comparison and same-arm pairs", async () => {
    const root = await fixtureRoot();
    const framework = await writeArchive(root, "framework", { arm: "framework" });
    const secondFramework = await writeArchive(root, "framework-2", { arm: "framework" });
    expect(() => pairSweeps(framework, framework, root)).toThrow(/with itself/);
    expect(() => pairSweeps(framework, secondFramework, root)).toThrow(/arms must differ/);
  });

  it("rejects mismatched genre, brief, and proof identities", async () => {
    const root = await fixtureRoot();
    const framework = await writeArchive(root, "framework", { arm: "framework" });
    const vanillaGenre = await writeArchive(root, "vanilla-genre", {
      arm: "vanilla",
      genre: "other",
    });
    const vanillaBrief = await writeArchive(root, "vanilla-brief", {
      arm: "vanilla",
      briefHash: "c".repeat(64),
    });
    const vanillaProof = await writeArchive(root, "vanilla-proof", {
      arm: "vanilla",
      proofHash: "d".repeat(64),
    });
    expect(() => pairSweeps(framework, vanillaGenre, root)).toThrow(/different genres/);
    expect(() => pairSweeps(framework, vanillaBrief, root)).toThrow(/different brief hashes/);
    expect(() => pairSweeps(framework, vanillaProof, root)).toThrow(/different proof hashes/);
  });

  it("rejects archives whose proof hash is not the sealed proof set", async () => {
    const root = await fixtureRoot();
    const framework = await writeArchive(root, "framework", {
      arm: "framework",
      proofHash: "c".repeat(64),
    });
    const vanilla = await writeArchive(root, "vanilla", {
      arm: "vanilla",
      proofHash: "c".repeat(64),
    });
    expect(() => pairSweeps(framework, vanilla, root)).toThrow(/sealed proof set/);
  });

  it("requires a proof observation on both sides", async () => {
    const root = await fixtureRoot();
    const framework = await writeArchive(root, "framework", { arm: "framework" });
    const vanilla = await writeArchive(root, "vanilla", { arm: "vanilla", proof: false });
    expect(() => pairSweeps(framework, vanilla, root)).toThrow(/missing proof.json/);
  });

  it("rejects a vanilla archive that declares framework dependencies", async () => {
    const root = await fixtureRoot();
    const framework = await writeArchive(root, "framework", { arm: "framework" });
    const vanilla = await writeArchive(root, "vanilla", { arm: "vanilla" });
    await writeFile(
      path.join(vanilla, "package.json"),
      JSON.stringify({ dependencies: { "@threenative/core": "0.1.0" } }),
    );
    expect(() => pairSweeps(framework, vanilla, root)).toThrow(/forbidden framework dependency/);
  });

  it("rejects a vanilla bridge dependency aliased to a framework package", async () => {
    const root = await fixtureRoot();
    const framework = await writeArchive(root, "framework", { arm: "framework" });
    const vanilla = await writeArchive(root, "vanilla", { arm: "vanilla" });
    await writeFile(
      path.join(vanilla, "package.json"),
      JSON.stringify({ dependencies: { "@threenative/playtest": "npm:@threenative/core@0.1.0" } }),
    );
    expect(() => pairSweeps(framework, vanilla, root)).toThrow(/forbidden framework package/);
  });

  it("rejects an unscoped dependency whose local tarball embeds a framework package", async () => {
    const root = await fixtureRoot();
    const framework = await writeArchive(root, "framework", { arm: "framework" });
    const vanilla = await writeArchive(root, "vanilla", { arm: "vanilla" });
    const packageRoot = path.join(vanilla, "vendor", "renamed-core", "package");
    await mkdir(packageRoot, { recursive: true });
    await writeFile(
      path.join(packageRoot, "package.json"),
      JSON.stringify({ name: "@threenative/core", version: "0.1.0" }),
    );
    execFileSync("tar", [
      "-czf",
      path.join(vanilla, "vendor", "renamed-core.tgz"),
      "-C",
      path.dirname(packageRoot),
      "package",
    ]);
    await writeFile(
      path.join(vanilla, "package.json"),
      JSON.stringify({ dependencies: { engine: "file:./vendor/renamed-core.tgz" } }),
    );
    expect(() => pairSweeps(framework, vanilla, root)).toThrow(
      /embeds forbidden framework package/,
    );
  });

  it("rejects a vanilla archive that imports framework packages", async () => {
    const root = await fixtureRoot();
    const framework = await writeArchive(root, "framework", { arm: "framework" });
    const vanilla = await writeArchive(root, "vanilla", { arm: "vanilla" });
    await writeFile(
      path.join(vanilla, "src", "main.ts"),
      'import { RigidBody3D } from "@threenative/physics";\nvoid RigidBody3D;\n',
    );
    expect(() => pairSweeps(framework, vanilla, root)).toThrow(/source import/);
  });

  it.each([
    ["omitted", [{ name: "other", verdict: "pass", assertions: [], diagnostics: [] }]],
    [
      "extra",
      [
        { name: "fixture", verdict: "pass", assertions: [], diagnostics: [] },
        { name: "extra", verdict: "pass", assertions: [], diagnostics: [] },
      ],
    ],
    [
      "duplicate",
      [
        { name: "fixture", verdict: "pass", assertions: [], diagnostics: [] },
        { name: "fixture", verdict: "pass", assertions: [], diagnostics: [] },
      ],
    ],
  ])("rejects %s proof scenarios", async (_label, scenarios) => {
    const root = await fixtureRoot();
    const framework = await writeArchive(root, "framework", { arm: "framework" });
    const vanilla = await writeArchive(root, "vanilla", { arm: "vanilla" });
    const manifest = JSON.parse(await readFile(path.join(vanilla, "sweep.json"), "utf8")) as {
      arm: string;
      genre: string;
      proofHash: string;
    };
    await writeFile(
      path.join(vanilla, "proof.json"),
      JSON.stringify({
        arm: manifest.arm,
        genre: manifest.genre,
        proofHash: manifest.proofHash,
        scenarios,
        passed: scenarios.length,
        total: scenarios.length,
      }),
    );
    expect(() => pairSweeps(framework, vanilla, root)).toThrow(/scenario/);
  });

  it("rejects a proof that omits a sealed assertion", async () => {
    const root = await fixtureRoot();
    const framework = await writeArchive(root, "framework", { arm: "framework" });
    const vanilla = await writeArchive(root, "vanilla", { arm: "vanilla" });
    const manifest = JSON.parse(await readFile(path.join(vanilla, "sweep.json"), "utf8")) as {
      arm: string;
      genre: string;
      proofHash: string;
    };
    await writeFile(
      path.join(vanilla, "proof.json"),
      JSON.stringify({
        arm: manifest.arm,
        genre: manifest.genre,
        proofHash: manifest.proofHash,
        scenarios: [
          {
            name: "fixture",
            verdict: "pass",
            assertions: [{ id: "movement.distance", pass: true }],
            diagnostics: [],
          },
        ],
        passed: 1,
        total: 1,
      }),
    );
    expect(() => pairSweeps(framework, vanilla, root)).toThrow(/assertion ids do not match/);
  });

  it("rejects malformed scenarios and non-integer proof counts", async () => {
    const root = await fixtureRoot();
    const framework = await writeArchive(root, "framework", { arm: "framework" });
    const vanilla = await writeArchive(root, "vanilla", { arm: "vanilla" });
    const manifest = JSON.parse(await readFile(path.join(vanilla, "sweep.json"), "utf8")) as {
      arm: string;
      genre: string;
      proofHash: string;
    };
    const invalid = (proof: Record<string, unknown>) =>
      writeFile(path.join(vanilla, "proof.json"), `${JSON.stringify(proof)}\n`);
    await invalid({
      arm: manifest.arm,
      genre: manifest.genre,
      proofHash: manifest.proofHash,
      scenarios: [null],
      passed: 0,
      total: 1,
    });
    expect(() => pairSweeps(framework, vanilla, root)).toThrow(/malformed scenario entry/);
    await invalid({
      arm: manifest.arm,
      genre: manifest.genre,
      proofHash: manifest.proofHash,
      scenarios: [{ name: "fixture", verdict: "pass", assertions: [], diagnostics: [] }],
      passed: 1,
      total: 1.5,
    });
    expect(() => pairSweeps(framework, vanilla, root)).toThrow(/invalid passed\/total/);
    await invalid({
      arm: manifest.arm,
      genre: manifest.genre,
      proofHash: manifest.proofHash,
      scenarios: [
        {
          name: "fixture",
          verdict: "pass",
          assertions: [
            { id: "movement.distance", pass: true },
            { id: "visibility.player", pass: true },
          ],
          diagnostics: [{}],
        },
      ],
      passed: 1,
      total: 1,
    });
    expect(() => pairSweeps(framework, vanilla, root)).toThrow(/malformed diagnostics/);
  });

  it.each([
    ["empty assertions", []],
    ["pass-false assertion", [{ id: "movement.distance", pass: false }]],
  ])("rejects fabricated proof records with %s", async (_label, assertions) => {
    const root = await fixtureRoot();
    const framework = await writeArchive(root, "framework", { arm: "framework" });
    const vanilla = await writeArchive(root, "vanilla", { arm: "vanilla" });
    const manifest = JSON.parse(await readFile(path.join(vanilla, "sweep.json"), "utf8")) as {
      arm: string;
      genre: string;
      proofHash: string;
    };
    await writeFile(
      path.join(vanilla, "proof.json"),
      JSON.stringify({
        arm: manifest.arm,
        genre: manifest.genre,
        proofHash: manifest.proofHash,
        scenarios: [{ name: "fixture", verdict: "pass", assertions, diagnostics: [] }],
        passed: 1,
        total: 1,
      }),
    );
    expect(() => pairSweeps(framework, vanilla, root)).toThrow(/assertion/);
  });

  it("rejects a pass verdict with an error diagnostic", async () => {
    const root = await fixtureRoot();
    const framework = await writeArchive(root, "framework", { arm: "framework" });
    const vanilla = await writeArchive(root, "vanilla", { arm: "vanilla" });
    const manifest = JSON.parse(await readFile(path.join(vanilla, "sweep.json"), "utf8")) as {
      arm: string;
      genre: string;
      proofHash: string;
    };
    await writeFile(
      path.join(vanilla, "proof.json"),
      JSON.stringify({
        arm: manifest.arm,
        genre: manifest.genre,
        proofHash: manifest.proofHash,
        scenarios: [
          {
            name: "fixture",
            verdict: "pass",
            assertions: [
              { id: "movement.distance", pass: true },
              { id: "visibility.player", pass: true },
            ],
            diagnostics: [{ code: "TN_FAILURE", message: "runtime failed", severity: "error" }],
          },
        ],
        passed: 1,
        total: 1,
      }),
    );
    expect(() => pairSweeps(framework, vanilla, root)).toThrow(/error diagnostic/);
  });

  it("rejects a fail verdict without failed evidence", async () => {
    const root = await fixtureRoot();
    const framework = await writeArchive(root, "framework", { arm: "framework" });
    const vanilla = await writeArchive(root, "vanilla", { arm: "vanilla" });
    const manifest = JSON.parse(await readFile(path.join(vanilla, "sweep.json"), "utf8")) as {
      arm: string;
      genre: string;
      proofHash: string;
    };
    await writeFile(
      path.join(vanilla, "proof.json"),
      JSON.stringify({
        arm: manifest.arm,
        genre: manifest.genre,
        proofHash: manifest.proofHash,
        scenarios: [
          {
            name: "fixture",
            verdict: "fail",
            assertions: [
              { id: "movement.distance", pass: true },
              { id: "visibility.player", pass: true },
            ],
            diagnostics: [{ code: "TN_NOTE", message: "warning only", severity: "warning" }],
          },
        ],
        passed: 0,
        total: 1,
      }),
    );
    expect(() => pairSweeps(framework, vanilla, root)).toThrow(/without failed evidence/);
  });

  it("exposes the package command", async () => {
    const packageJson = JSON.parse(
      await readFile(path.join(process.cwd(), "package.json"), "utf8"),
    ) as {
      scripts?: Record<string, string>;
    };
    expect(packageJson.scripts?.["sweep:pair"]).toBe("tsx scripts/sweep-pair.ts");
    expect(packageJson.scripts?.["sweep:proof"]).toBe("tsx scripts/sweep-proof.ts");
  });
});

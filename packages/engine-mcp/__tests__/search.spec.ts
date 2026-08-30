import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import * as ts from "typescript";
import { describe, expect, it } from "vitest";
import { makeTempDir } from "../../../test-support/temp-dir.js";
import {
  capabilityDetail,
  defaultManifestPath,
  loadCapabilityManifest,
  searchCapabilities,
  toolDefinitions,
} from "../src/index.js";

const workspaceManifest = path.resolve("packages/create-threenative/capabilities.json");

describe("threenative-engine-mcp", () => {
  it("exposes exactly the two read-only capability tools", () => {
    expect(toolDefinitions().map((tool) => tool.name)).toEqual([
      "engine_search_capabilities",
      "engine_capability_detail",
    ]);
  });

  it("ranks NavigationAgent3D for an agent walking around a wall", () => {
    const results = searchCapabilities("enemy walks around a wall", workspaceManifest);
    expect(results.slice(0, 3).map((result) => result.symbol)).toContain("NavigationAgent3D");
    expect(results.find((result) => result.symbol === "NavigationAgent3D")?.importPath).toBe(
      "@threenative/physics/navigation",
    );
    expect(results.find((result) => result.symbol === "NavigationAgent3D")?.example).toContain(
      'from "@threenative/physics/navigation"',
    );
    expect(
      results.find((result) => result.symbol === "NavigationAgent3D")?.constraints.join(" "),
    ).toMatch(/hand-written A\*/u);
  });

  it("ranks NavigationAgent3D for the exact patrol and line-of-sight task", () => {
    const results = searchCapabilities(
      "enemy walks around a patrol path and chases the player when it sees them",
      workspaceManifest,
    );
    const navigationIndex = results.findIndex((result) => result.symbol === "NavigationAgent3D");
    const pathFollowIndex = results.findIndex((result) => result.symbol === "PathFollow3D");
    expect(navigationIndex).toBeGreaterThanOrEqual(0);
    expect(navigationIndex).toBeLessThan(3);
    expect(navigationIndex).toBe(0);
    if (pathFollowIndex >= 0) expect(navigationIndex).toBeLessThan(pathFollowIndex);
    const navigation = results[navigationIndex];
    expect(navigation?.importPath).toBe("@threenative/physics/navigation");
    expect(navigation?.example).toContain(
      'import { NavigationAgent3D } from "@threenative/physics/navigation"',
    );
    expect(navigation?.constraints.join(" ")).toContain(
      "import NavigationAgent3D from exactly `@threenative/physics/navigation`",
    );
    expect(navigation?.constraints.join(" ")).toContain(
      "`@threenative/physics` is not a valid import for this symbol",
    );
  });

  it("ranks attachToBone for putting a weapon in a character's hand", () => {
    const results = searchCapabilities("put a weapon in a character's hand", workspaceManifest);
    expect(results.slice(0, 3).map((result) => result.symbol)).toContain("attachToBone");
    expect(results.find((result) => result.symbol === "attachToBone")?.example).toContain(
      'from "@threenative/core"',
    );
    expect(
      results.find((result) => result.symbol === "attachToBone")?.constraints.join(" "),
    ).toMatch(/import and call `attachToBone` from `@threenative\/core`/u);
  });

  it("does not pretend a genre label is a concrete capability recipe", () => {
    expect(searchCapabilities("make a pirate game", workspaceManifest)).toEqual([]);
  });

  it("finds a cross-system set from a mechanically explicit complete request", () => {
    const results = searchCapabilities(
      "sailing ship on ocean waves with buoyancy, cloth sails in wind, cannonball physics and smoke particles, crew navigating a deck with swords, islands and coastlines, and positional sound",
      workspaceManifest,
    );
    const symbols = results.map((result) => result.symbol);

    expect(symbols).toEqual(
      expect.arrayContaining([
        "AudioBus",
        "FluidField2D",
        "GPUParticles3D",
        "GPUReadback",
        "Heightfield",
        "NavigationAgent3D",
        "RigidBody3D",
        "SoftBody3D",
        "SpectralOcean",
        "attachToBone",
      ]),
    );
    expect(symbols).not.toContain("SharpenNode");
    expect(results.length).toBeLessThanOrEqual(15);
    expect(results.every((result) => result.matchedSituation.length > 0)).toBe(true);
  });

  it("finds cloth simulation from natural sail vocabulary", () => {
    const results = searchCapabilities("cloth sails blowing in wind on a ship", workspaceManifest);
    expect(results[0]?.symbol).toBe("SoftBody3D");
  });

  it("ranks fluid simulation for ocean currents affecting a ship", () => {
    const results = searchCapabilities(
      "ocean fluid dynamics and currents affect the ship",
      workspaceManifest,
    );
    expect(results[0]?.symbol).toBe("FluidField2D");
    expect(results[0]?.matchedSituation).toContain("fluid dynamics");
  });

  it("does not advertise SpectralOcean as the ocean-current solver", () => {
    expect(capabilityDetail("SpectralOcean", workspaceManifest).situations).not.toContain(
      "simulate ocean waves and currents that affect a sailing ship",
    );
  });

  it("finds physical cannonballs and pooled cannon smoke without broad-result noise", () => {
    const results = searchCapabilities(
      "fire a cannonball projectile with cannon smoke particles",
      workspaceManifest,
    );
    expect(results.map((result) => result.symbol)).toEqual(
      expect.arrayContaining(["GPUParticles3D", "RigidBody3D"]),
    );
    expect(results.length).toBeLessThanOrEqual(5);
  });

  it("returns one compilable example for the plain-language zoom capability", async () => {
    const results = searchCapabilities(
      "let the player zoom the camera with a wheel, pinch, or gamepad axis",
      workspaceManifest,
    );
    const zoom = results.find((result) => result.symbol === "defineGame");
    expect(zoom).toBeDefined();
    const example = zoom?.example ?? "";
    expect(example.match(/\bconst game\b/gu) ?? []).toHaveLength(1);

    const root = await makeTempDir("threenative-engine-mcp-zoom-example-");
    try {
      const file = path.join(root, "zoom-example.ts");
      await writeFile(
        file,
        [
          "declare const Play: unknown;",
          "declare function defineGame(config: unknown): unknown;",
          example,
          "",
        ].join("\n"),
      );
      const options: ts.CompilerOptions = {
        module: ts.ModuleKind.ESNext,
        moduleResolution: ts.ModuleResolutionKind.Bundler,
        noEmit: true,
        skipLibCheck: true,
        strict: true,
        target: ts.ScriptTarget.ES2022,
      };
      const program = ts.createProgram([file], options);
      const diagnostics = ts.getPreEmitDiagnostics(program);
      expect(
        diagnostics.map((diagnostic) =>
          ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"),
        ),
      ).toEqual([]);
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("answers that native ray tracing is unavailable until readable output interop exists", () => {
    const results = searchCapabilities("can I raytrace on native", workspaceManifest);
    const platform = results.find((result) => result.symbol === "getPlatform");
    expect(platform).toBeDefined();
    expect(platform?.constraints.join(" ")).toContain("ray tracing is unavailable on native");
    expect(platform?.constraints.join(" ")).toContain("buffer-to-texture copy-out interop exists");
    expect(platform?.constraints.join(" ")).toContain("traceRays");
  });

  it("ranks attachToBone for holding a rifle in a character's right hand", () => {
    const results = searchCapabilities(
      "hold a rifle in a character's right hand",
      workspaceManifest,
    );
    const attachmentIndex = results.findIndex((result) => result.symbol === "attachToBone");
    expect(attachmentIndex).toBeGreaterThanOrEqual(0);
    expect(attachmentIndex).toBeLessThan(3);
    const attachment = results[attachmentIndex];
    expect(attachment?.importPath).toBe("@threenative/core");
    expect(attachment?.example).toContain('attachToBone(character, "RightHand", rifle);');
    expect(attachment?.constraints.join(" ")).toContain(
      "when a request is to hold or attach a weapon to a hand, import and call `attachToBone` from `@threenative/core`",
    );
    expect(attachment?.constraints.join(" ")).toContain(
      "do not manually parent, position, or rotate the rifle",
    );
    expect(attachment?.constraints.join(" ")).toContain(
      "add a portable Three.js Bone named `RightHand`",
    );
  });

  it("returns attachment guidance for the exact full enemy task", () => {
    const results = searchCapabilities(
      "Add an enemy that patrols the level, chases the player when it sees them, and holds a rifle in its right hand.",
      workspaceManifest,
    );
    const attachment = results.find((result) => result.symbol === "attachToBone");
    expect(results.slice(0, 3).map((result) => result.symbol)).toContain("attachToBone");
    expect(attachment?.importPath).toBe("@threenative/core");
    expect(attachment?.example).toContain('import { attachToBone } from "@threenative/core"');
    expect(attachment?.example).toContain('attachToBone(character, "RightHand", rifle);');
  });

  it("surfaces GroundSnap's enabled override in detail", () => {
    const detail = capabilityDetail("GroundSnap", workspaceManifest);
    expect(detail.overrides?.join(" ")).toMatch(/enabled/u);
    expect(detail.constraints.join(" ")).toContain("physics collider");
  });

  it("throws with the manifest path when the committed file is missing", async () => {
    const root = await makeTempDir("threenative-engine-mcp-missing-");
    try {
      const file = path.join(root, "capabilities.json");
      expect(() => loadCapabilityManifest(file)).toThrow(file);
      expect(() => searchCapabilities("enemy walks around a wall", file)).toThrow(file);
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("throws with the manifest path when the committed file is unparseable", async () => {
    const root = await makeTempDir("threenative-engine-mcp-unparseable-");
    try {
      const file = path.join(root, "capabilities.json");
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, "not json");
      expect(() => loadCapabilityManifest(file)).toThrow(file);
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("rejects an entry that carries no usage example rather than answering with undefined", async () => {
    const root = await makeTempDir("threenative-engine-mcp-no-example-");
    try {
      const file = path.join(root, "capabilities.json");
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(
        file,
        JSON.stringify({
          version: 1,
          entries: [
            {
              symbol: "GroundSnap",
              package: "@threenative/core",
              importPath: "@threenative/core",
              kind: "class",
              signature: "class GroundSnap",
              summary: "Keeps a character's feet on the floor.",
              situations: ["keep a character's feet on the floor"],
              constraints: [],
            },
          ],
        }),
      );
      expect(() => loadCapabilityManifest(file)).toThrow("entry 0 is malformed");
      expect(() => searchCapabilities("feet on the floor", file)).toThrow("entry 0 is malformed");
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("uses the project-root manifest by default", () => {
    expect(defaultManifestPath()).toBe(path.resolve("capabilities.json"));
  });

  it("rejects a structurally malformed manifest with the exact reason", async () => {
    const root = await makeTempDir("threenative-engine-mcp-malformed-");
    try {
      const file = path.join(root, "capabilities.json");
      const entry = {
        constraints: [],
        example: "const game = defineGame({});",
        importPath: "@threenative/core",
        kind: "class",
        package: "@threenative/core",
        signature: "class GroundSnap",
        situations: ["keep feet on the floor"],
        summary: "Feet meet floor.",
        symbol: "GroundSnap",
      };
      const entries = (overrides: Record<string, unknown>): string =>
        JSON.stringify({ entries: [{ ...entry, ...overrides }], version: 1 });
      const cases: ReadonlyArray<[string, string, RegExp]> = [
        ["nonobject-root", "[]", /root must contain a numeric version and entries array/u],
        [
          "nonnumeric-version",
          JSON.stringify({ entries: [entry], version: "1" }),
          /root must contain a numeric version and entries array/u,
        ],
        ["entries-not-array", JSON.stringify({ entries: {}, version: 1 }), /entries array/u],
        ["nonstring-symbol", entries({ symbol: 7 }), /entry 0 is malformed/u],
        ["nonstring-situations", entries({ situations: [1, 2] }), /entry 0 is malformed/u],
        ["nonstring-constraints", entries({ constraints: [false] }), /entry 0 is malformed/u],
        ["nonrecord-entry", JSON.stringify({ entries: [42], version: 1 }), /entry 0 is malformed/u],
      ];
      for (const [name, content, expected] of cases) {
        await writeFile(file, content);
        expect(() => loadCapabilityManifest(file), name).toThrow(expected);
      }
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });
});

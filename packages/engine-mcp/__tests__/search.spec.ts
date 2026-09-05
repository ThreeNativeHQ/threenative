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

function searchResults(
  situation: string,
  manifestFile = workspaceManifest,
  scope: "mechanic" | "request" = "mechanic",
) {
  return searchCapabilities(situation, manifestFile, scope).results;
}

describe("threenative-engine-mcp", () => {
  it("exposes exactly the two read-only capability tools", () => {
    expect(toolDefinitions().map((tool) => tool.name)).toEqual([
      "engine_search_capabilities",
      "engine_capability_detail",
    ]);
  });

  it("returns a matched verdict and exposes a numeric score on every result", () => {
    const response = searchCapabilities("enemy walks around a wall", workspaceManifest);

    expect(response.verdict).toBe("matched");
    expect(response.guidance).toBe("");
    expect(response.results.length).toBeGreaterThan(0);
    expect(response.results.every((result) => typeof result.score === "number")).toBe(true);
    expect(response.results.every((result) => result.matchedSituation.length > 0)).toBe(true);
  });

  it("returns no capability for a save-system request", () => {
    const response = searchCapabilities("save the player progress", workspaceManifest, "request");

    expect(response.verdict).toBe("none");
    expect(response.results).toEqual([]);
    expect(response.guidance).toMatch(/write .*src\//iu);
    expect(response.guidance).toContain("ctx.state");
    expect(response.guidance).not.toContain("Area3D");
    expect(response.guidance).not.toContain("Heightfield");
  });

  it("returns actionable guidance for measured not-owned requests", () => {
    const cases = [
      ["make an inventory system", "src/"],
      ["dialogue with an NPC", "src/"],
      ["multiplayer", "pnpm add"],
    ] as const;

    for (const [query, expectedGuidance] of cases) {
      const response = searchCapabilities(query, workspaceManifest, "request");
      expect(response.verdict, query).toBe("none");
      expect(response.results, query).toEqual([]);
      expect(response.guidance, query).toContain(expectedGuidance);
    }
  });

  it("finds camera framing from third-person vocabulary", () => {
    const results = searchResults("third person camera follow", workspaceManifest);
    expect(results.slice(0, 3).map((result) => result.symbol)).toContain("defineGame");
  });

  it("finds platformer traversal from double-jump vocabulary", () => {
    const results = searchResults("make a platformer with double jump", workspaceManifest);
    expect(results.slice(0, 3).map((result) => result.symbol)).toContain("CharacterBody3D");
  });

  it("finds measured miss-list vocabulary across the owning packages", () => {
    const cases = [
      ["different props in each area", "createAssetLoader"],
      ["journal objective panel", "publishUiState"],
      ["landmarks points of interest", "InstancedBatch"],
      ["bright sky saturated green platforms", "Atmosphere"],
      ["raised platform gap hazard restart", "CharacterBody3D"],
    ] as const;

    for (const [query, symbol] of cases) {
      expect(
        searchResults(query, workspaceManifest).map((result) => result.symbol),
        query,
      ).toContain(symbol);
    }
  });

  it("ranks the terrain streamer above virtual geometry for chunk streaming", () => {
    const results = searchResults("stream terrain across chunks", workspaceManifest);
    const terrainIndex = results.findIndex((result) => result.symbol === "TerrainTiles");
    const clusteredIndex = results.findIndex((result) => result.symbol === "ClusteredMesh");

    expect(terrainIndex).toBe(0);
    expect(clusteredIndex === -1 || clusteredIndex > terrainIndex).toBe(true);
    expect(results[terrainIndex]?.importPath).toBe("@threenative/core/world");
    expect(results[terrainIndex]?.matchedSituation).toBe("stream terrain without cracks");
  });

  it("does not advertise health while retaining the owned hitscan primitive", () => {
    const manifest = loadCapabilityManifest(workspaceManifest);
    const defineGame = manifest.entries.find((entry) => entry.symbol === "defineGame");
    const physicsQuery = manifest.entries.find(
      (entry) => entry.symbol === "PhysicsDirectSpaceState3D",
    );

    expect(defineGame?.aliases).not.toContain("health never regenerates");
    expect(physicsQuery?.aliases).toContain("hitscan camera");
    expect(
      searchResults("health never regenerates", workspaceManifest).map((result) => result.symbol),
    ).not.toContain("defineGame");
    expect(searchResults("hitscan camera", workspaceManifest)[0]?.symbol).toBe(
      "PhysicsDirectSpaceState3D",
    );
  });

  it("explains an alias hit with a readable situation", () => {
    const manifest = loadCapabilityManifest(workspaceManifest);
    const result = searchResults("third person camera follow", workspaceManifest).find(
      (candidate) => candidate.symbol === "defineGame",
    );
    const defineGame = manifest.entries.find((entry) => entry.symbol === "defineGame");

    expect(result?.matchedSituation).toBe("frame a camera behind the player");
    expect(defineGame?.aliases).toContain("third-person camera");
    expect(defineGame?.aliases).not.toContain(result?.matchedSituation);
  });

  it("uses an alias score while keeping a readable situation for explanation", async () => {
    const root = await makeTempDir("threenative-engine-mcp-alias-score-");
    try {
      const file = path.join(root, "capabilities.json");
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(
        file,
        JSON.stringify({
          version: 2,
          notOwned: [],
          entries: [
            {
              aliases: ["camera player"],
              constraints: [],
              example: "const capability = new CameraCapability();",
              importPath: "@threenative/core",
              kind: "class",
              package: "@threenative/core",
              signature: "class CameraCapability",
              situations: ["frame the player from behind"],
              summary: "Frames a player camera.",
              symbol: "CameraCapability",
            },
          ],
        }),
      );

      const response = searchCapabilities("camera player", file);
      expect(response.results).toContainEqual(
        expect.objectContaining({
          matchedSituation: "frame the player from behind",
          symbol: "CameraCapability",
        }),
      );
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("never returns an alias as the explanation for a match", () => {
    const manifest = loadCapabilityManifest(workspaceManifest);
    const aliases = new Set(manifest.entries.flatMap((entry) => entry.aliases));

    for (const alias of aliases) {
      const results = searchResults(alias, workspaceManifest);
      expect(results.every((result) => !aliases.has(result.matchedSituation))).toBe(true);
    }
  });

  it("does not return an alias hit when no readable situation is relevant", async () => {
    const root = await makeTempDir("threenative-engine-mcp-unexplained-alias-");
    try {
      const file = path.join(root, "capabilities.json");
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(
        file,
        JSON.stringify({
          version: 2,
          notOwned: [],
          entries: [
            {
              aliases: ["field of view while aiming"],
              constraints: [],
              example: "const game = defineGame({});",
              importPath: "@threenative/core",
              kind: "function",
              package: "@threenative/core",
              signature: "function defineGame()",
              situations: [],
              summary: "Define a game.",
              symbol: "defineGame",
            },
          ],
        }),
      );

      const response = searchCapabilities("field of view while aiming", file);
      expect(response.verdict).toBe("none");
      expect(response.results).toEqual([]);
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("ranks NavigationAgent3D for an agent walking around a wall", () => {
    const results = searchResults("enemy walks around a wall", workspaceManifest);
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

  it("finds the texture pass for a GPU texture-optimisation request", () => {
    const results = searchResults("optimize textures for the GPU", workspaceManifest);
    const texture = results.find((result) => result.symbol === "texturePass");

    expect(texture).toBeDefined();
    expect(texture?.importPath).toBe("@threenative/assets");
    expect(texture?.matchedSituation).toBe("optimize textures for the GPU");
  });

  it("states the BC7 block constraint in capability detail", () => {
    const detail = capabilityDetail("texturePass", workspaceManifest);

    expect(detail.constraints.join(" ")).toMatch(
      /BC7.*4x4 blocks.*WebGPU rejects an unaligned texture/u,
    );
  });

  it("ranks NavigationAgent3D for the exact patrol and line-of-sight task", () => {
    const results = searchResults(
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
    const results = searchResults("put a weapon in a character's hand", workspaceManifest);
    expect(results.slice(0, 3).map((result) => result.symbol)).toContain("attachToBone");
    expect(results.find((result) => result.symbol === "attachToBone")?.example).toContain(
      'from "@threenative/core"',
    );
    expect(
      results.find((result) => result.symbol === "attachToBone")?.constraints.join(" "),
    ).toMatch(/import and call `attachToBone` from `@threenative\/core`/u);
  });

  it("does not pretend a genre label is a concrete capability recipe", () => {
    const response = searchCapabilities("make a pirate game", workspaceManifest);
    expect(response.verdict).toBe("none");
    expect(response.results).toEqual([]);
  });

  it("finds a cross-system set from a mechanically explicit complete request", () => {
    const results = searchResults(
      "sailing ship on ocean waves with buoyancy, cloth sails in wind, cannonball physics and smoke particles, crew navigating a deck with swords, islands and coastlines, and positional sound",
      workspaceManifest,
      "request",
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
    const results = searchResults("cloth sails blowing in wind on a ship", workspaceManifest);
    expect(results[0]?.symbol).toBe("SoftBody3D");
  });

  it("ranks fluid simulation for ocean currents affecting a ship", () => {
    const results = searchResults(
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
    const results = searchResults(
      "fire a cannonball projectile with cannon smoke particles",
      workspaceManifest,
    );
    expect(results.map((result) => result.symbol)).toEqual(
      expect.arrayContaining(["GPUParticles3D", "RigidBody3D"]),
    );
    expect(results.length).toBeLessThanOrEqual(5);
  });

  it("filters one-word coincidences from a verbose mechanic query", () => {
    const results = searchResults(
      "detect overlap with a treasure chest, collect it, update score, and reach a win state",
      workspaceManifest,
    );
    expect(results.map((result) => result.symbol)).not.toContain("NavigationAgent3D");
    expect(results.length).toBeLessThanOrEqual(5);
  });

  /**
   * The index is written in the vocabulary of the situation, and a request is written in the
   * vocabulary of the game. "clicking" and "click", "instanced" and "instance" are the same word
   * to an author and were different tokens to the matcher, so a request that named the mechanic
   * outright returned nothing and the agent hand-wrote a Raycaster that was already installed.
   */
  it("finds the pointer capabilities from an inflected pointer request", () => {
    const results = searchResults(
      "drag a crate with the mouse by clicking on it in the 3D scene",
      workspaceManifest,
    );

    expect(results.map((result) => result.symbol)).toEqual(
      expect.arrayContaining(["PointerEvents3D"]),
    );
  });

  it("finds the batching and particle capabilities a runner request names outright", () => {
    const results = searchResults(
      "an endless runner where procedurally generated track chunks stream toward the player, obstacles repeat as thousands of identical instanced blocks, dust particles trail behind, and the camera shakes on a near miss",
      workspaceManifest,
      "request",
    );

    expect(results.map((result) => result.symbol)).toEqual(
      expect.arrayContaining(["CameraShake", "GPUParticles3D", "InstancedBatch"]),
    );
  });

  it("finds the joint and pointer capabilities a physics-puzzle request names outright", () => {
    const results = searchResults(
      "a physics puzzle room where the player drags crates with the mouse, swings a hinged pendulum weight on a joint to knock a ball loose, and wins when the ball rolls into a goal zone on the floor",
      workspaceManifest,
      "request",
    );

    expect(results.map((result) => result.symbol)).toEqual(
      expect.arrayContaining(["Area3D", "Joint3D", "RigidBody3D"]),
    );
  });

  /**
   * A rare word is not automatically the right word.
   *
   * Weighting a single distinctive token highly is what let `drag a crate … clicking on it` find
   * `PointerEvents3D` at all. It also let homonyms win outright: `cycle` (a walk cycle),
   * `health` (an asset health report), `guard` (a blank-frame capture guard) and `cone` (a
   * godray's cone) each appear in one or two situations, so each cleared the floor alone and
   * displaced answers the previous ranking got right. Agreement on several words has to beat
   * agreement on one rare word, or the search is confidently wrong exactly where it used to be
   * honestly silent.
   */
  it.each([
    ["a day and night cycle", "solarPosition", "AnimationPlayer"],
    ["a health bar that shows the player's damage", "publishUiState", "formatHealthReport"],
  ])("ranks %s above its homonym", (query, expected, homonym) => {
    const symbols = searchResults(query, workspaceManifest, "request").map(
      (result) => result.symbol,
    );
    const wanted = symbols.indexOf(expected);
    const wrong = symbols.indexOf(homonym);

    expect(wanted, `${expected} missing entirely for '${query}'`).toBeGreaterThanOrEqual(0);
    if (wrong >= 0) expect(wanted, `${homonym} outranked ${expected}`).toBeLessThan(wrong);
  });

  it("returns one compilable example for the plain-language zoom capability", async () => {
    const results = searchResults(
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
    const results = searchResults("can I raytrace on native", workspaceManifest);
    const platform = results.find((result) => result.symbol === "getPlatform");
    expect(platform).toBeDefined();
    expect(platform?.constraints.join(" ")).toContain("ray tracing is unavailable on native");
    expect(platform?.constraints.join(" ")).toContain("buffer-to-texture copy-out interop exists");
    expect(platform?.constraints.join(" ")).toContain("traceRays");
  });

  it("ranks attachToBone for holding a rifle in a character's right hand", () => {
    const results = searchResults("hold a rifle in a character's right hand", workspaceManifest);
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
    const results = searchResults(
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
          version: 2,
          notOwned: [],
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

  it("prefers the manifest installed with @threenative/core over a committed project copy", async () => {
    // A committed copy drifts the moment the engine dependency moves; the installed package's
    // manifest is generated by the same build as the engine the game actually runs.
    const root = await makeTempDir("threenative-engine-mcp-installed-");
    try {
      const installed = path.join(
        root,
        "node_modules",
        "@threenative",
        "core",
        "capabilities.json",
      );
      await mkdir(path.dirname(installed), { recursive: true });
      await writeFile(installed, JSON.stringify({ entries: [], notOwned: [], version: 2 }));
      await writeFile(
        path.join(root, "capabilities.json"),
        JSON.stringify({ entries: [], notOwned: [], version: 2 }),
      );
      expect(defaultManifestPath(root)).toBe(installed);
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("finds the installed manifest from a working directory nested under the project root", async () => {
    const root = await makeTempDir("threenative-engine-mcp-nested-");
    try {
      const installed = path.join(
        root,
        "node_modules",
        "@threenative",
        "core",
        "capabilities.json",
      );
      await mkdir(path.join(root, "src", "render"), { recursive: true });
      await mkdir(path.dirname(installed), { recursive: true });
      await writeFile(installed, JSON.stringify({ entries: [], notOwned: [], version: 2 }));
      expect(defaultManifestPath(path.join(root, "src", "render"))).toBe(installed);
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("answers with the engine repository's own manifest when no installed package provides one", async () => {
    // Committed or absent, a bare project's copy loses to the repository manifest the running
    // server was built from — the same drift argument as the installed-package case.
    const root = await makeTempDir("threenative-engine-mcp-bare-");
    try {
      await writeFile(
        path.join(root, "capabilities.json"),
        JSON.stringify({ entries: [], notOwned: [], version: 2 }),
      );
      expect(defaultManifestPath(root)).toBe(path.resolve("packages/core/capabilities.json"));
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("honours THREENATIVE_CAPABILITIES_MANIFEST over every default", async () => {
    const root = await makeTempDir("threenative-engine-mcp-override-");
    const previous = process.env.THREENATIVE_CAPABILITIES_MANIFEST;
    try {
      process.env.THREENATIVE_CAPABILITIES_MANIFEST = "/tmp/tn-explicit-manifest.json";
      expect(defaultManifestPath(root)).toBe("/tmp/tn-explicit-manifest.json");
    } finally {
      // `Reflect.deleteProperty` rather than `delete`: biome's lint, and a true removal — an
      // `undefined` assignment would coerce to the string "undefined" and read as an override.
      if (previous === undefined)
        Reflect.deleteProperty(process.env, "THREENATIVE_CAPABILITIES_MANIFEST");
      else process.env.THREENATIVE_CAPABILITIES_MANIFEST = previous;
      await rm(root, { force: true, recursive: true });
    }
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
        JSON.stringify({ entries: [{ ...entry, ...overrides }], notOwned: [], version: 2 });
      const cases: ReadonlyArray<[string, string, RegExp]> = [
        [
          "nonobject-root",
          "[]",
          /root must contain manifest version 2.*entries array.*notOwned array/u,
        ],
        [
          "nonnumeric-version",
          JSON.stringify({ entries: [entry], version: "1" }),
          /root must contain manifest version 2.*entries array.*notOwned array/u,
        ],
        [
          "entries-not-array",
          JSON.stringify({ entries: {}, notOwned: [], version: 2 }),
          /entries array/u,
        ],
        ["nonstring-symbol", entries({ symbol: 7 }), /entry 0 is malformed/u],
        ["nonstring-situations", entries({ situations: [1, 2] }), /entry 0 is malformed/u],
        ["nonstring-constraints", entries({ constraints: [false] }), /entry 0 is malformed/u],
        [
          "nonrecord-entry",
          JSON.stringify({ entries: [42], notOwned: [], version: 2 }),
          /entry 0 is malformed/u,
        ],
      ];
      for (const [name, content, expected] of cases) {
        await writeFile(file, content);
        expect(() => loadCapabilityManifest(file), name).toThrow(expected);
      }
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("rejects a v2 manifest whose notOwned section is malformed", async () => {
    const root = await makeTempDir("threenative-engine-mcp-malformed-not-owned-");
    try {
      const file = path.join(root, "capabilities.json");
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(
        file,
        JSON.stringify({
          entries: [],
          notOwned: [{ guidance: "write it in src/", id: "save-load", situations: [7] }],
          version: 2,
        }),
      );
      expect(() => loadCapabilityManifest(file)).toThrow("notOwned 0 is malformed");
      expect(() => searchCapabilities("save the player progress", file)).toThrow(
        "notOwned 0 is malformed",
      );
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("rejects a v1 manifest that has no notOwned section", async () => {
    const root = await makeTempDir("threenative-engine-mcp-v1-manifest-");
    try {
      const file = path.join(root, "capabilities.json");
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, JSON.stringify({ entries: [], version: 1 }));
      expect(() => loadCapabilityManifest(file)).toThrow(/manifest version 2.*notOwned array/u);
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });
});

import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { RELEVANCE_FLOOR } from "../../packages/engine-mcp/src/index.js";
import { makeTempDir } from "../../test-support/temp-dir.js";
import {
  buildCapabilityManifest,
  checkCapabilityManifest,
  validateCapabilityAllowlist,
  validateNotOwned,
  writeCapabilityManifest,
} from "../build-capability-manifest.js";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function writePackage(
  root: string,
  directory: string,
  name: string,
  source: string,
  exports = { ".": { types: "./dist/index.d.ts", import: "./dist/index.js" } },
): Promise<void> {
  const packageRoot = path.join(root, "packages", directory);
  await mkdir(path.join(packageRoot, "src"), { recursive: true });
  await writeFile(path.join(packageRoot, "package.json"), JSON.stringify({ exports, name }));
  await writeFile(path.join(packageRoot, "src", "index.ts"), source);
}

const documentedClass = [
  "/**",
  " * A fixture capability.",
  " * @situation test a documented capability",
  " * @constraint use it from the fixture",
  " * @example const capability = new DocumentedCapability();",
  " */",
  "export class DocumentedCapability {}",
  "",
].join("\n");

describe("capability manifest generator", () => {
  it("includes subpath exports with the literal import path", async () => {
    const root = await makeTempDir("threenative-capability-subpath-");
    temporaryRoots.push(root);
    await writePackage(root, "core", "@threenative/core", documentedClass);
    const physicsRoot = path.join(root, "packages", "physics");
    await mkdir(path.join(physicsRoot, "src", "navigation"), { recursive: true });
    await writeFile(
      path.join(physicsRoot, "package.json"),
      JSON.stringify({
        exports: {
          "./navigation": {
            types: "./dist/navigation/index.d.ts",
            import: "./dist/navigation/index.js",
          },
        },
        name: "@threenative/physics",
      }),
    );
    await writeFile(
      path.join(physicsRoot, "src", "navigation", "index.ts"),
      [
        "/**",
        " * A navigation fixture.",
        " * @situation enemy walks around a wall",
        " * @example const agent = new NavigationAgent3D();",
        " */",
        "export class NavigationAgent3D {}",
        "",
      ].join("\n"),
    );

    const manifest = buildCapabilityManifest(root);
    expect(manifest.entries).toContainEqual(
      expect.objectContaining({
        importPath: "@threenative/physics/navigation",
        symbol: "NavigationAgent3D",
      }),
    );
  });

  it("fails closed and names every untagged public class or function", async () => {
    const root = await makeTempDir("threenative-capability-missing-situation-");
    temporaryRoots.push(root);
    await writePackage(
      root,
      "core",
      "@threenative/core",
      `${documentedClass}\nexport function MissingSituation(): void {}\n`,
    );

    expect(() => buildCapabilityManifest(root)).toThrow(/MissingSituation/u);
  });

  it("rejects an allowlist entry with an empty reason", () => {
    expect(() =>
      validateCapabilityAllowlist([{ package: "@threenative/core", reason: "", symbol: "Hidden" }]),
    ).toThrow(/non-empty.*reason/u);
  });

  it("rejects a one-token owned situation when the notOwned match clears the relevance floor", () => {
    const entries = [
      {
        constraints: [],
        example: "const capability = new InventoryCapability();",
        importPath: "@threenative/core",
        kind: "class" as const,
        overrides: [],
        package: "@threenative/core",
        signature: "class InventoryCapability",
        situations: ["inventory"],
        summary: "Manages inventory.",
        supersedes: [],
        symbol: "InventoryCapability",
      },
    ];
    const notOwnedSituation = "inventory system";
    const notOwned = [
      {
        guidance: "Write inventory state in the game's src/.",
        id: "inventory-system",
        situations: [notOwnedSituation],
      },
    ];
    const rawOverlapScore = 1 / Math.max(notOwnedSituation.split(" ").length, 1);

    expect(rawOverlapScore).toBeGreaterThanOrEqual(RELEVANCE_FLOOR);
    expect(() => validateNotOwned(entries, notOwned)).toThrow(
      /notOwned 'inventory-system'.*InventoryCapability/u,
    );
  });

  it("rejects inflection-equivalent owned and notOwned situations", () => {
    const entries = [
      {
        constraints: [],
        example: "const capability = new SaveCapability();",
        importPath: "@threenative/core",
        kind: "class" as const,
        overrides: [],
        package: "@threenative/core",
        signature: "class SaveCapability",
        situations: ["saving progress"],
        summary: "Saves progress.",
        supersedes: [],
        symbol: "SaveCapability",
      },
    ];
    const notOwned = [
      {
        guidance: "Write save state in the game's src/.",
        id: "save-progress",
        situations: ["save progress"],
      },
    ];

    expect(() => validateNotOwned(entries, notOwned)).toThrow(
      /notOwned 'save-progress'.*SaveCapability/u,
    );
  });

  it("rejects an alias that overlaps a notOwned situation", () => {
    const entries = [
      {
        aliases: ["inventory system"],
        constraints: [],
        example: "const capability = new InventoryCapability();",
        importPath: "@threenative/core",
        kind: "class" as const,
        overrides: [],
        package: "@threenative/core",
        signature: "class InventoryCapability",
        situations: ["manage item slots"],
        summary: "Manages inventory.",
        supersedes: [],
        symbol: "InventoryCapability",
      },
    ];
    const notOwned = [
      {
        guidance: "Write inventory state in the game's src/.",
        id: "inventory-system",
        situations: ["inventory system"],
      },
    ];

    expect(() => validateNotOwned(entries, notOwned)).toThrow(
      /notOwned 'inventory-system'.*InventoryCapability/u,
    );
  });

  it("writes and checks a generated manifest instead of accepting a stale copy", async () => {
    const root = await makeTempDir("threenative-capability-freshness-");
    temporaryRoots.push(root);
    await writePackage(root, "core", "@threenative/core", documentedClass);
    const generated = await writeCapabilityManifest(root);
    await expect(checkCapabilityManifest(root)).resolves.toMatchObject({
      entries: generated.entries,
    });

    const file = path.join(root, "packages/create-threenative/capabilities.json");
    await writeFile(file, `${await readFile(file, "utf8")}\n`);
    await expect(checkCapabilityManifest(root)).rejects.toThrow(/stale/u);
  });

  it("fails loudly with the manifest path when the committed copy is missing", async () => {
    const root = await makeTempDir("threenative-capability-missing-manifest-");
    temporaryRoots.push(root);
    await writePackage(root, "core", "@threenative/core", documentedClass);

    await expect(checkCapabilityManifest(root)).rejects.toThrow(
      path.join(root, "packages/create-threenative/capabilities.json"),
    );
  });

  it("proves the committed manifest contains the navigation regression entry", async () => {
    const manifest = await checkCapabilityManifest(process.cwd());
    expect(manifest.entries.length).toBeGreaterThan(0);
    expect(manifest.entries).toContainEqual(
      expect.objectContaining({
        importPath: "@threenative/physics/navigation",
        symbol: "NavigationAgent3D",
      }),
    );
  });

  it("keeps the IComputeDriven cloth and fluid capability searchable in both manifests", async () => {
    for (const file of [
      "packages/core/capabilities.json",
      "packages/create-threenative/capabilities.json",
    ]) {
      const manifest = JSON.parse(await readFile(file, "utf8")) as {
        entries: Array<{ symbol: string; situations: string[] }>;
      };
      const search = (query: string) =>
        manifest.entries.filter((entry) => JSON.stringify(entry).toLowerCase().includes(query));
      expect(
        search("icomputedriven").some((entry) => entry.symbol === "ComputeDrivenRegistry"),
        file,
      ).toBe(true);
      expect(
        search("cloth").some((entry) => entry.symbol === "ComputeDrivenRegistry"),
        file,
      ).toBe(true);
      expect(
        search("fluid").some((entry) => entry.symbol === "ComputeDrivenRegistry"),
        file,
      ).toBe(true);
    }
  });

  it("keeps the measured Pixel 8 cloth cost in the shipped capability manifests", async () => {
    for (const file of [
      "packages/core/capabilities.json",
      "packages/create-threenative/capabilities.json",
    ]) {
      const manifest = JSON.parse(await readFile(file, "utf8")) as {
        entries: Array<{ constraints: string[]; symbol: string }>;
      };
      const softBody = manifest.entries.find((entry) => entry.symbol === "SoftBody3D");
      expect(softBody, file).toBeDefined();
      expect(softBody?.constraints.join(" "), file).toMatch(/Pixel 8.*steady.*ms/iu);
    }
  });

  it("keeps every public velocity example provisioned across the render boundary", async () => {
    const velocitySymbols = new Set([
      "VelocityTracker",
      "ensureVelocityOutput",
      "readVelocityPreviousBoneMatrices",
      "readVelocityPreviousMatrices",
      "readVelocityPreviousWorldMatrix",
      "velocityTexture",
      "withVelocityContext",
    ]);
    const manifest = await checkCapabilityManifest(process.cwd());
    const entries = manifest.entries.filter(
      (entry) => entry.importPath === "@threenative/core" && velocitySymbols.has(entry.symbol),
    );

    expect(entries.map((entry) => entry.symbol).sort()).toEqual([...velocitySymbols].sort());
    for (const entry of entries) {
      expect(entry.example, entry.symbol).toContain("ensureVelocityOutput(scenePass)");
      expect(entry.example, entry.symbol).toContain("renderer.setOutputNode(scenePass)");
      expect(entry.example, entry.symbol).toContain("tracker.update(scene)");
      expect(entry.example, entry.symbol).toContain("renderer.render(scene, camera)");
      expect(entry.example, entry.symbol).toContain("tracker.commit(scene)");
    }
  });

  it("carries @supersedes into the manifest entry as a source construct", async () => {
    const root = await makeTempDir("threenative-capability-supersedes-");
    temporaryRoots.push(root);
    await writePackage(
      root,
      "core",
      "@threenative/core",
      [
        "/**",
        " * A fixture capability that replaces a raw three construct.",
        " * @situation test what the ray hit",
        " * @supersedes new Raycaster(",
        " * @example const capability = new DocumentedCapability();",
        " */",
        "export class DocumentedCapability {}",
        "",
      ].join("\n"),
    );

    const manifest = buildCapabilityManifest(root);
    expect(manifest.entries).toContainEqual(
      expect.objectContaining({
        symbol: "DocumentedCapability",
        supersedes: ["new Raycaster("],
      }),
    );
  });

  it("leaves supersedes empty rather than undefined when untagged", async () => {
    const root = await makeTempDir("threenative-capability-no-supersedes-");
    temporaryRoots.push(root);
    await writePackage(root, "core", "@threenative/core", documentedClass);

    const manifest = buildCapabilityManifest(root);
    const entry = manifest.entries.find((candidate) => candidate.symbol === "DocumentedCapability");
    expect(entry?.supersedes).toEqual([]);
  });

  it("emits authored aliases without changing the displayed situations", async () => {
    const root = await makeTempDir("threenative-capability-alias-");
    temporaryRoots.push(root);
    await writePackage(
      root,
      "core",
      "@threenative/core",
      [
        "/**",
        " * A fixture capability with an alternate search key.",
        " * @situation display the readable fixture sentence",
        " * @alias fixture alternate wording",
        " * @example const capability = new DocumentedCapability();",
        " */",
        "export class DocumentedCapability {}",
        "",
      ].join("\n"),
    );

    const manifest = buildCapabilityManifest(root);
    expect(manifest.entries).toContainEqual(
      expect.objectContaining({
        aliases: ["fixture alternate wording"],
        situations: ["display the readable fixture sentence"],
        symbol: "DocumentedCapability",
      }),
    );
  });

  it("maps every authored alias to a named predecessor corpus row", async () => {
    const manifest = await checkCapabilityManifest(process.cwd());
    const aliases = manifest.entries.flatMap((entry) => entry.aliases ?? []);
    const predecessorRows = {
      "third-person camera": ["request.third-person-camera"],
      "restart the run without a page reload": ["brief.endless-runner.5"],
      "field of view while aiming": ["brief.fps.2"],
      "health never regenerates": ["brief.fps.3"],
      "firing line nearest target crosshair": ["brief.fps.4"],
      "obstacles collectibles increasing pace": ["brief.endless-runner.3"],
      "readable world lighting": ["brief.exploration.5"],
      "different props in each area": ["brief.exploration.3"],
      "journal objective panel": ["brief.exploration.4"],
      "objective panel journal text": ["brief.exploration.4"],
      "readable HUD": ["brief.physics-puzzle.6"],
      "stream terrain across chunks": ["brief.open-world.2"],
      "landmarks points of interest": ["brief.open-world.4"],
      "first playable screen external assets": ["brief.open-world.5"],
      "fixed seed fixed-step simulation": ["brief.physics-puzzle.5"],
      "spawn waves": ["request.spawn-waves"],
      "tower defense game": ["request.tower-defense-game"],
      "one round per press": ["brief.fps.5"],
      "pick up item": ["request.pick-up-item"],
      "platformer double jump": ["request.platformer-double-jump"],
      "first person": ["brief.fps.1"],
      "push solid bodies": ["brief.physics-puzzle.2"],
      "run jump coins goal": ["brief.platformer.2"],
      "passes through body": ["brief.physics-puzzle.3"],
      "arena walls pickups": ["brief.topdown-action.4"],
      "hitscan camera": ["brief.fps.7"],
      "damage body height": ["brief.fps.8"],
      "dynamic bodies stack topple": ["brief.physics-puzzle.1"],
      "simulated contact": ["brief.physics-puzzle.4"],
      "raised platform gap hazard restart": ["brief.platformer.3"],
      "bright sky saturated green platforms": ["brief.platformer.4"],
      "enemy targets cooldown reload win condition": ["brief.topdown-action.3"],
      "patrol route": ["brief.fps.10"],
      "close engagement range": ["brief.fps.12"],
      "search last place saw player": ["brief.fps.13"],
    } as const;

    expect([...new Set(aliases)].sort()).toEqual(Object.keys(predecessorRows).sort());
    expect(Object.values(predecessorRows).every((rows) => rows.length > 0)).toBe(true);
  });

  it("should fail when one normalized alias spans more than MAX_ALIAS_FANOUT entries", async () => {
    const root = await makeTempDir("threenative-capability-alias-fanout-");
    temporaryRoots.push(root);
    await writePackage(
      root,
      "core",
      "@threenative/core",
      [
        "/**",
        " * First fixture.",
        " * @situation first fixture",
        " * @alias RACING",
        " * @example const first = new First();",
        " */",
        "export class First {}",
        "/**",
        " * Second fixture.",
        " * @situation second fixture",
        " * @alias racing!",
        " * @example const second = new Second();",
        " */",
        "export class Second {}",
        "/**",
        " * Third fixture.",
        " * @situation third fixture",
        " * @alias racing",
        " * @example const third = new Third();",
        " */",
        "export class Third {}",
        "",
      ].join("\n"),
    );

    expect(() => buildCapabilityManifest(root)).toThrow(/racing.*First.*Second.*Third/u);
  });
});

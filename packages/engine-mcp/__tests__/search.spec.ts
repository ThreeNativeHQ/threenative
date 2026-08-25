import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
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
});

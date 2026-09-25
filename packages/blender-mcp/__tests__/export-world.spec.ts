import { execFile } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { type IWorldPackage, validateWorldPackage } from "@threenative/core/world";
import { describe, expect, it } from "vitest";
import { makeTempDir } from "../../../test-support/temp-dir.js";
import { resolveBlender } from "../src/detect.js";
import { handleToolCall } from "../src/index.js";

/**
 * The recipe that turns a Blender world into a world package, driven the way an agent drives it:
 * through the `blender_export_world` MCP tool, then validated with the runtime's own contract.
 *
 * It proves the two things a green summary cannot: the instance count is the render-density count
 * (not the viewport one), and the package on disk validates. The fixture is generated procedurally
 * from CC0 primitives, so the proof needs nothing but a Blender.
 */

const execFileAsync = promisify(execFile);
const blender = resolveBlender();
if (!blender.available) {
  process.stderr.write(
    `TN_BLENDER_TESTS_SKIPPED: ${blender.detail} Install Blender to run packages/blender-mcp/__tests__/export-world.spec.ts.\n`,
  );
}
const withBlender = blender.available ? describe : describe.skip;

const fixtureScript = path.resolve("packages/blender-mcp/gpl/fixtures/make_world_fixture.py");

const COUNT_SNIPPET = `import bpy, json
bpy.ops.wm.open_mainfile(filepath=__BLEND__)
captured = {}
def count(depsgraph):
    total = 0
    for instance in depsgraph.object_instances:
        if instance.is_instance and instance.instance_object is not None:
            total += 1
    return total
class Grab(bpy.types.RenderEngine):
    bl_idname = "TN_COUNT_CAPTURE"
    bl_label = "TN Count Capture"
    def render(self, depsgraph):
        captured["render"] = count(depsgraph)
bpy.utils.register_class(Grab)
scene = bpy.context.scene
camera_data = bpy.data.cameras.new("count-camera")
camera = bpy.data.objects.new("count-camera", camera_data)
scene.collection.objects.link(camera)
scene.camera = camera
previous = scene.render.engine
scene.render.engine = "TN_COUNT_CAPTURE"
bpy.ops.render.render(write_still=False)
scene.render.engine = previous
print("TN_COUNT " + json.dumps({"render": captured["render"], "viewport": count(bpy.context.evaluated_depsgraph_get())}))
`;

async function blenderRun(root: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync(blender.path as string, args, {
    encoding: "utf8",
    env: { ...process.env, TEMP: root, TMP: root, TMPDIR: root },
    maxBuffer: 64 * 1024 * 1024,
    timeout: 180_000,
  });
  return stdout;
}

function parseCount(stdout: string): { render: number; viewport: number } {
  const line = stdout
    .split("\n")
    .reverse()
    .find((candidate) => candidate.startsWith("TN_COUNT "));
  if (line === undefined) throw new Error(`No TN_COUNT line in:\n${stdout}`);
  return JSON.parse(line.slice("TN_COUNT ".length)) as { render: number; viewport: number };
}

function jsonFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .sort();
}

withBlender("blender_export_world against a real Blender", () => {
  it("writes a validating package whose count is the render-density count", async () => {
    const root = await makeTempDir("tn-export-world-");
    const blend = path.join(root, "world.blend");
    const out = path.join(root, "package");

    // The fixture is deterministic, so a failure here is the fixture, not a flaky scatter.
    await blenderRun(root, [
      "--background",
      "--factory-startup",
      "--python",
      fixtureScript,
      "--",
      "--out",
      blend,
    ]);
    expect(existsSync(blend)).toBe(true);

    const countScript = path.join(root, "count.py");
    await writeFile(countScript, COUNT_SNIPPET.replace("__BLEND__", JSON.stringify(blend)));
    const counts = parseCount(
      await blenderRun(root, ["--background", "--factory-startup", "--python", countScript]),
    );

    // The tool handler, not the raw script: this is the surface an agent calls.
    const response = await handleToolCall({
      arguments: { cell: 64, out, source: blend },
      name: "blender_export_world",
    });
    const result = JSON.parse(response.content[0].text) as {
      ok: boolean;
      detail?: string;
      summary?: {
        assetsWritten: number;
        cells: number;
        instances: number;
        instancesByAsset: Record<string, number>;
        viewportInstances: number;
      };
    };
    expect(result.ok, result.detail ?? response.content[0].text).toBe(true);
    if (!result.ok || result.summary === undefined) return;
    const summary = result.summary;

    // Render density, not viewport: the fixture's Is Viewport switch makes them an order apart.
    expect(summary.instances).toBe(counts.render);
    expect(counts.render).not.toBe(counts.viewport);
    expect(summary.viewportInstances).toBe(counts.viewport);

    // Every asset written once, and its LOD beside it, with nothing extra in assets/. The ids are
    // the tn_asset_id values, so a fallback to the emitter's name would fail here.
    const assets = new Set(Object.keys(summary.instancesByAsset));
    expect([...assets].sort()).toEqual(["ground_cover", "pine", "rock"]);
    expect(summary.assetsWritten).toBe(assets.size);
    const expectedGlbs = [...assets]
      .flatMap((asset) => [`${asset}.glb`, `${asset}_lod1.glb`])
      .sort();
    expect(jsonFiles(path.join(out, "assets"))).toEqual(expectedGlbs);

    // The chunk collection straddles a cell boundary, so its objects land in two cells.
    const manifest = JSON.parse(
      readFileSync(path.join(out, "world.json"), "utf8"),
    ) as IWorldPackage;
    const chunkCells = manifest.cells.filter((cell) =>
      (cell.chunks ?? []).some((chunk) => chunk.startsWith("chunks/yard_")),
    );
    expect(chunkCells.length).toBeGreaterThanOrEqual(2);
    for (const cell of chunkCells) {
      for (const chunk of cell.chunks ?? []) expect(existsSync(path.join(out, chunk))).toBe(true);
    }

    // The contract the runtime enforces, against the bytes actually on disk.
    const validation = validateWorldPackage(manifest, {
      heightmapByteLength: readFileSync(path.join(out, "terrain/heightmap.u16")).byteLength,
      placementsByteLength: readFileSync(path.join(out, "placements.bin")).byteLength,
    });
    expect(validation.errors, JSON.stringify(validation.errors)).toEqual([]);
    expect(validation.ok).toBe(true);
  }, 300_000);
});

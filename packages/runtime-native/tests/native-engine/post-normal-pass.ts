/**
 * PRD-526: a post pass that reads the scene's view-space normals (r185 GTAO, as the starter's high
 * tier wires it through `mrt({ output, normal: normalView })`) renders natively. The renderer draws
 * the normal target itself; without it the post graph is refused with TN_POST_INPUT_MISSING.
 * Two frames of the exported AO node: a box standing on a plane (contact occlusion darkens the
 * frame) and the plane alone (nothing to occlude). Usage: post-normal-pass.ts <render-driver> <work-dir>
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { PNG } from "pngjs";
import { PerspectiveCamera, Texture } from "three";
import { ao } from "three/addons/tsl/display/GTAONode.js";
import { texture } from "three/tsl";
import type { FixtureOp, IFixture } from "../../../three-native/src/fixture-format.js";
import { encodeFixture, parseReply } from "../../../three-native/src/fixture-protocol.js";
import { exportTslGraph } from "../../scripts/tsl-export.js";

const [driver, work] = process.argv.slice(2);
if (!driver || !work) throw new Error("Usage: post-normal-pass.ts <render-driver> <work-dir>");
const directory = mkdtempSync(path.join(work, "post-normal-"));
const [width, height] = [320, 240];

const camera = new PerspectiveCamera(60, width / height, 0.1, 100);
camera.updateProjectionMatrix();
const depth = new Texture();
depth.name = "depth";
const normal = new Texture();
normal.name = "normal";
const graph = path.join(directory, "gtao-normals.json");
const occlusion = ao(texture(depth), texture(normal), camera);
occlusion.radius.value = 1; // a unit box's contact shadow, not the default quarter metre
writeFileSync(graph, JSON.stringify(exportTslGraph(occlusion.getTextureNode())));

function fixture(withBox: boolean): IFixture {
  const set = (id: string, field: string, value: number): FixtureOp => ({ op: "set", id, path: field, value });
  const ops: FixtureOp[] = [
    { op: "new", id: "scene", class: "Scene", args: [] },
    { op: "new", id: "camera", class: "PerspectiveCamera", args: [60, width / height, 0.1, 100] },
    set("camera", "position.x", 2.5),
    set("camera", "position.y", 3),
    set("camera", "position.z", 4.5),
    { op: "call", id: "camera", method: "lookAt", args: [0, 0.4, 0] },
    { op: "call", id: "camera", method: "updateProjectionMatrix", args: [] },
    { op: "new", id: "material", class: "MeshStandardMaterial", args: [] },
    { op: "new", id: "groundGeometry", class: "PlaneGeometry", args: [12, 12] },
    { op: "new", id: "ground", class: "Mesh", args: [{ ref: "groundGeometry" }, { ref: "material" }] },
    set("ground", "rotation.x", -Math.PI / 2),
    { op: "call", id: "scene", method: "add", args: [{ ref: "ground" }] },
  ];
  if (withBox) {
    ops.push(
      { op: "new", id: "boxGeometry", class: "BoxGeometry", args: [1.2, 1.2, 1.2] },
      { op: "new", id: "box", class: "Mesh", args: [{ ref: "boxGeometry" }, { ref: "material" }] },
      set("box", "position.y", 0.6),
      { op: "call", id: "scene", method: "add", args: [{ ref: "box" }] },
    );
  }
  ops.push({ op: "call", id: "scene", method: "updateMatrixWorld", args: [true] });
  return {
    name: withBox ? "post-normal-box" : "post-normal-plane",
    adaptedFrom: "original, a GTAO frame over a box on a plane",
    tolerance: { abs: 0 },
    ops,
    render: { scene: "scene", camera: "camera", width, height, toneMapping: "none", toneMappingExposure: 1, outputColorSpace: "srgb" },
    observe: [{ id: "scene", kind: "pixels", metric: { maxPixelMismatchRatio: 0, maxPerceptualDeltaE: 0 } }],
  };
}

/** Pixels whose red channel is below `level`, after the frame drew something at all. */
function darkPixels(name: string, withBox: boolean, level: number): number {
  const png = path.join(directory, `${name}.png`);
  const run = spawnSync(driver as string, [], {
    env: { ...process.env, TN_FIXTURE_POST_GRAPH: graph },
    input: `${encodeFixture(fixture(withBox), png).join("\n")}\n`,
    encoding: "utf8",
    timeout: 120_000,
  });
  const replies = run.stdout.trim().split("\n").filter(Boolean).map(parseReply);
  if (run.status !== 0 || replies.length !== 1 || replies[0]?.kind !== "obs" || !existsSync(png))
    throw new Error(`TN_POST_NORMAL_FRAME_FAILED ${name}: ${run.stdout}${run.stderr}`);
  const { data } = PNG.sync.read(readFileSync(png));
  let dark = 0;
  let bright = 0;
  for (let i = 0; i < data.length; i += 4) {
    if ((data[i] as number) < level) dark++;
    else bright++;
  }
  console.info(`${name}: ${dark} pixels below ${level}, ${bright} at or above`);
  return dark;
}

const level = 200;
const box = darkPixels("box", true, level);
const plane = darkPixels("plane", false, level);
if (box < 100) throw new Error(`TN_POST_NORMAL_NO_OCCLUSION: only ${box} occluded pixels around the box`);
if (plane > box / 20) throw new Error(`TN_POST_NORMAL_NOISE: ${plane} dark pixels on a bare plane (box ${box})`);
console.info("post normal pass ok");

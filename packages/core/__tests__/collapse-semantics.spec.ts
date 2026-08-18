import {
  BoxGeometry,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshToonMaterial,
  type Object3D,
  Scene,
} from "three";
import { describe, expect, it } from "vitest";
import { type ISceneCollapseReport, SceneCollapse } from "../src/collapse.js";

/**
 * PRD-152 §2. The incumbent collapse accepts several ordinary Three.js inputs whose semantics it
 * cannot reproduce, and rewrites the scene anyway. Each fixture here drives the real pass and
 * asserts what a developer who never opted into batching is entitled to see.
 *
 * These are differential fixtures, not count assertions: every one of them passes trivially if the
 * pass declines, and fails only when the pass claims a scene it then draws wrongly.
 */

const GEOMETRY = new BoxGeometry(1, 1, 1);

function fill(parent: Object3D, material: MeshToonMaterial, count: number): Mesh[] {
  const meshes: Mesh[] = [];
  for (let index = 0; index < count; index += 1) {
    const mesh = new Mesh(GEOMETRY.clone(), material);
    mesh.position.set(index, 0, 0);
    parent.add(mesh);
    meshes.push(mesh);
  }
  return meshes;
}

function run(
  scene: Scene,
  frames: number,
  options: { observeFrames?: number; minMeshes?: number } = {},
) {
  let report: ISceneCollapseReport | undefined;
  const collapse = new SceneCollapse(scene as never, {
    observeFrames: options.observeFrames ?? 3,
    minMeshes: options.minMeshes ?? 8,
    onReport: (value) => {
      report = value;
    },
  });
  for (let index = 0; index < frames; index += 1) {
    scene.updateMatrixWorld(true);
    collapse.frame();
  }
  return { collapse, report };
}

/** Every object the renderer would walk and draw, after whatever the pass did to the scene. */
function drawCandidates(scene: Scene): Mesh[] {
  const meshes: Mesh[] = [];
  scene.traverse((object) => {
    if ((object as Mesh).isMesh === true) meshes.push(object as Mesh);
  });
  return meshes;
}

describe("SceneCollapse semantics (PRD-152)", () => {
  it("never draws a mesh the game hid before the collapse", () => {
    const scene = new Scene();
    const material = new MeshToonMaterial({ color: 0x445566 });
    const meshes = fill(scene, material, 24);
    const hidden = meshes[0] as Mesh;
    hidden.visible = false;
    // The hidden mesh sits far from every other so a merged buffer containing it is detectable
    // by its bounds alone, not only by counting.
    hidden.position.set(500, 500, 500);

    const { report } = run(scene, 6);
    expect(report?.status).toBeDefined();

    for (const candidate of drawCandidates(scene)) {
      if (candidate === hidden) continue;
      candidate.geometry.computeBoundingBox();
      const box = candidate.geometry.boundingBox;
      expect(box).not.toBeNull();
      // A merged draw that swallowed the hidden mesh reaches out to (500, 500, 500) and shows a
      // box the game asked not to be drawn.
      expect(box?.max.x ?? 0).toBeLessThan(400);
    }
  });

  it("keeps both materials of a two-group indexed geometry", () => {
    const scene = new Scene();
    const shared = new MeshToonMaterial({ color: 0x223344 });
    fill(scene, shared, 20);

    const geometry = new BoxGeometry(1, 1, 1);
    geometry.clearGroups();
    const total = geometry.getAttribute("position").count;
    geometry.addGroup(0, total / 2, 0);
    geometry.addGroup(total / 2, total / 2, 1);
    const front = new MeshBasicMaterial({ color: 0xff0000 });
    const back = new MeshBasicMaterial({ color: 0x00ff00 });
    const twoTone = new Mesh(geometry, [front, back]);
    twoTone.position.set(-40, 0, 0);
    scene.add(twoTone);

    run(scene, 6);

    // A geometry drawn with two materials over two index groups cannot become one merged draw:
    // there is no single material that is both. It stays on the exact source path, with both
    // materials and both groups intact.
    const survivor = drawCandidates(scene).find((mesh) => mesh === twoTone);
    expect(survivor).toBe(twoTone);
    expect(Array.isArray(survivor?.material)).toBe(true);
    expect((survivor?.material as unknown[]).length).toBe(2);
    expect(survivor?.geometry.groups.length).toBe(2);
    expect((survivor?.material as unknown[])[0]).toBe(front);
    expect((survivor?.material as unknown[])[1]).toBe(back);
  });

  it("keeps every instance of an InstancedMesh", () => {
    const scene = new Scene();
    const shared = new MeshToonMaterial({ color: 0x334455 });
    fill(scene, shared, 20);

    const instanced = new InstancedMesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial(), 3);
    for (let index = 0; index < 3; index += 1) {
      instanced.setMatrixAt(index, new Matrix4().makeTranslation(index * 30 - 60, 0, 0));
    }
    instanced.instanceMatrix.needsUpdate = true;
    scene.add(instanced);

    run(scene, 6);

    const candidates = drawCandidates(scene);
    const survivor = candidates.find((mesh) => mesh === instanced);
    // Three instances cannot become one ordinary mesh. Either the InstancedMesh is untouched, or
    // the pass produced three separate copies of its geometry — anything else drops two of them.
    expect(survivor).toBe(instanced);
    expect((survivor as InstancedMesh).count).toBe(3);
  });

  it("shows motion that starts after the observation window closes", () => {
    const scene = new Scene();
    const material = new MeshToonMaterial({ color: 0x556677 });
    const meshes = fill(scene, material, 24);
    const sleeper = meshes[3] as Mesh;

    const { collapse, report } = run(scene, 6);
    expect(report).toBeDefined();

    // Frame 600 in miniature: nothing moved during observation, so the pass classified this mesh
    // static. The game moves it anyway, which is its right.
    for (let frame = 0; frame < 8; frame += 1) {
      sleeper.position.x += 25;
      scene.updateMatrixWorld(true);
      collapse.frame();
    }

    const rendered = drawCandidates(scene);
    // Either the source is back in the scene (the watchdog restored), or some rendered candidate
    // covers where the sleeper now is. A frozen merged buffer satisfies neither.
    if (rendered.includes(sleeper)) return;
    let reach = Number.NEGATIVE_INFINITY;
    for (const candidate of rendered) {
      candidate.geometry.computeBoundingBox();
      const box = candidate.geometry.boundingBox;
      if (box !== null) reach = Math.max(reach, box.max.x);
    }
    expect(reach).toBeGreaterThan(sleeper.position.x - 1);
  });
});

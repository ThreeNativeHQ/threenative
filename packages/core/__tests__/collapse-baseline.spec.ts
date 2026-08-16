import {
  BoxGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshToonMaterial,
  type Object3D,
  PerspectiveCamera,
  Scene,
} from "three";
import { describe, expect, it } from "vitest";
import { type ISceneCollapseReport, SceneCollapse } from "../src/collapse.js";

/**
 * A recorded baseline for what the collapse does to a fixed scene.
 *
 * The defect this exists for was invisible to every other test: the pass reported `collapsed:
 * true` with healthy timings while a chunk of the level had silently stopped rendering. Frame rate
 * could not catch it either — the missing geometry made the frame *cheaper*. What moves when the
 * pass regresses is the shape of its output: how many draws it leaves, how many meshes it declined
 * and why, how many parts it decided were moving.
 *
 * So the baseline is those counts, on a scene built here rather than sampled from a game. It runs
 * on the node test environment with no GPU and no browser, which is what lets it sit in `pnpm test`
 * and gate every commit. Frame timings deliberately are not in it: they are machine-dependent and
 * would either flake or be set so loose they assert nothing.
 *
 * **When this fails**, the collapse changed what it emits. That is not automatically wrong — but it
 * is never incidental. Work out which number moved and why, convince yourself the new value is
 * better, and only then edit the baseline in the same commit as the change that moved it. Editing
 * it to get green is how the number stops meaning anything.
 */
const BASELINE = {
  collapsed: true,
  mergedMeshes: 2,
  movingParts: 3,
  overlayDraws: 1,
  overlayMeshes: 12,
  resultDrawCandidates: 3,
  resultMaterialIdentities: 3,
  skipped: { cameraOverlay: 12, transparency: 6 },
  // 30 ground + 24 second material + 3 movers. The 6 transparent meshes are counted as skipped,
  // not as source meshes, and the 12 HUD meshes are camera-parented, so neither reaches this.
  sourceMeshes: 57,
  // Every renderable the scan saw: the 57 above, the 6 transparent, the 12 on the camera.
  sourceRenderables: 75,
} as const;

const GEOMETRY = new BoxGeometry(1, 1, 1);

function fill(parent: Object3D, material: MeshToonMaterial | MeshBasicMaterial, count: number) {
  const meshes: Mesh[] = [];
  for (let index = 0; index < count; index += 1) {
    const mesh = new Mesh(GEOMETRY.clone(), material);
    mesh.position.set(index, 0, 0);
    parent.add(mesh);
    meshes.push(mesh);
  }
  return meshes;
}

/**
 * The fixture: a level shaped like the games this framework is for, small enough to stay legible.
 *
 * Static ground, a second static material, transparent water the pass must refuse to merge, three
 * groups that move, and a camera-parented HUD. Every one of those is a distinct path through the
 * collapse, so a regression in any of them moves a number above.
 */
function buildScene() {
  const scene = new Scene();
  const ground = new Group();
  scene.add(ground);
  fill(ground, new MeshToonMaterial({ color: 0x5cbb37 }), 30);
  fill(ground, new MeshToonMaterial({ color: 0x8d6b4b }), 24);
  // Transparent surfaces are preserved, never merged: blending order is part of how they look.
  fill(ground, new MeshToonMaterial({ color: 0x3fa9f5, transparent: true }), 6);

  const movers: Group[] = [];
  for (let index = 0; index < 3; index += 1) {
    const mover = new Group();
    mover.position.set(index * 4, 0, 0);
    scene.add(mover);
    fill(mover, new MeshToonMaterial({ color: 0xffd23f }), 1);
    movers.push(mover);
  }

  const camera = new PerspectiveCamera();
  camera.position.set(0, 5, 12);
  scene.add(camera);
  fill(camera, new MeshBasicMaterial({ color: 0x123043 }), 12);
  return { camera, ground, movers, scene };
}

function collapseFixture() {
  const { camera, ground, movers, scene } = buildScene();
  let report: ISceneCollapseReport | undefined;
  const collapse = new SceneCollapse(scene as never, {
    minMeshes: 8,
    observeFrames: 3,
    onReport: (value) => {
      report = value;
    },
  });
  for (let frame = 0; frame < 5_000 && report === undefined; frame += 1) {
    // The movers move, so the pass must classify them as moving rather than bake them static.
    for (const [index, mover] of movers.entries()) mover.position.y = frame * 0.1 * (index + 1);
    scene.updateMatrixWorld(true);
    collapse.frame();
  }
  return { camera, collapse, ground, report, scene };
}

describe("scene collapse baseline", () => {
  it("emits the recorded draw and skip counts for a fixed scene", () => {
    const { report } = collapseFixture();
    expect(report).toBeDefined();
    expect({
      collapsed: report?.collapsed,
      mergedMeshes: report?.mergedMeshes,
      movingParts: report?.movingParts,
      overlayDraws: report?.overlayDraws,
      overlayMeshes: report?.overlayMeshes,
      resultDrawCandidates: report?.diagnostics.resultDrawCandidates,
      resultMaterialIdentities: report?.diagnostics.resultMaterialIdentities,
      skipped: {
        cameraOverlay: report?.diagnostics.skipped.cameraOverlay,
        transparency: report?.diagnostics.skipped.transparency,
      },
      sourceMeshes: report?.sourceMeshes,
      sourceRenderables: report?.diagnostics.sourceRenderables,
    }).toEqual(BASELINE);
  });

  /**
   * The performance claim, stated as the thing it actually is: the collapse exists to turn many
   * draws into few. A change that stops merging is a performance regression even when every test
   * about correctness still passes, and this is the assertion that notices.
   */
  it("keeps collapsing many source draws into few", () => {
    const { report } = collapseFixture();
    const before = report?.diagnostics.sourceMaterialIdentities ?? 0;
    const after = report?.diagnostics.resultDrawCandidates ?? Number.POSITIVE_INFINITY;
    expect(before).toBeGreaterThan(0);
    expect(after).toBeLessThanOrEqual(BASELINE.resultDrawCandidates);
    expect(report?.sourceMeshes ?? 0).toBeGreaterThan(after * 10);
  });

  /**
   * The regression this whole file exists for, stated as an invariant rather than a count.
   *
   * Every mesh that was in the scene before the collapse must still be accounted for after it:
   * either it was merged away and the merged draw stands in for it, or it was preserved and is
   * still reachable from the scene. A mesh that is neither has been silently deleted — which is
   * exactly what happened to the platform past the bridge in the fox game.
   */
  it("leaves no source mesh both unmerged and unreachable", () => {
    const { report, scene } = collapseFixture();
    expect(report?.collapsed).toBe(true);
    const reachable = new Set<Object3D>();
    scene.traverse((object) => reachable.add(object));

    const preserved = report?.diagnostics.skipped.transparency ?? 0;
    const visibleTransparent = [...reachable].filter(
      (object) =>
        (object as Mesh).isMesh === true &&
        ((object as Mesh).material as { transparent?: boolean } | undefined)?.transparent === true,
    );
    expect(visibleTransparent).toHaveLength(preserved);
  });

  /** Geometry a game streams in after the collapse must reach the scene, on any code path. */
  it("keeps streamed-in geometry reachable once the collapse has settled", () => {
    const { collapse, ground, report, scene } = collapseFixture();
    expect(report?.collapsed).toBe(true);
    const streamed = fill(ground, new MeshToonMaterial({ color: 0xef3b36 }), 5);
    collapse.frame();

    const reachable = new Set<Object3D>();
    scene.traverse((object) => reachable.add(object));
    for (const mesh of streamed) expect(reachable.has(mesh)).toBe(true);
  });
});

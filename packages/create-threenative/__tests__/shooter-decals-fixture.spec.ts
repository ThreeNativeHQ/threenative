import { readFile } from "node:fs/promises";
import { Mesh, PerspectiveCamera, Scene, Vector2, Vector3 } from "three";
import { afterEach, expect, it, vi } from "vitest";
import { createAssetLoader } from "../../core/src/assets.js";
import { baseGeometryOf, updateModelLods } from "../../core/src/model-lod.js";
import { ScenePicker } from "../../core/src/picking.js";
import { DecalField, bulletHoleTexture } from "../templates/shooter/src/render/decals.js";

afterEach(() => vi.unstubAllGlobals());

it("projects real framework hits onto the fixture's authored surface after actual LOD selection", async () => {
  const glb = await readFile(
    new URL("./fixtures/bounded-decals/public/receiver.glb", import.meta.url),
  );
  const manifest = await readFile(
    new URL("./fixtures/bounded-decals/public/assets.manifest.json", import.meta.url),
    "utf8",
  );
  vi.stubGlobal("fetch", async (url: string) =>
    url.endsWith("assets.manifest.json")
      ? new Response(manifest, { headers: { "content-type": "application/json" } })
      : new Response(glb, { headers: { "content-type": "model/gltf-binary" } }),
  );
  const loader = createAssetLoader({ basePath: "https://fixture.invalid" });
  const loaded = await loader.model<{ scene: Scene }>("receiver.glb");
  const receiver = loaded.scene.getObjectByProperty("isMesh", true);
  if (!(receiver instanceof Mesh)) throw new Error("Fixture mesh missing");
  const base = baseGeometryOf(receiver);
  expect(base.index?.count).toBe(384);
  const root = new Scene();
  root.add(receiver);
  const camera = new PerspectiveCamera(48, 16 / 9, 0.1, 100);
  camera.position.set(0, 0, 12);
  camera.updateMatrixWorld(true);
  root.updateMatrixWorld(true);
  expect(updateModelLods(root, camera, 540)).toBe(2);
  expect(receiver.geometry).not.toBe(base);
  expect(baseGeometryOf(receiver)).toBe(base);
  const picker = new ScenePicker({
    camera,
    pointer: () => new Vector2(),
    scene: root,
    viewport: {} as never,
  });
  const hit = picker.raycast({
    origin: new Vector3(1, 1, 2),
    direction: new Vector3(0, 0, -1),
    targets: receiver,
  });
  expect(hit?.object).toBe(receiver);
  expect(hit?.point.toArray()).toEqual([1, 1, 0]);
  const map = bulletHoleTexture(8);
  const field = new DecalField(root, {
    countPerVariant: 1,
    size: 0.2,
    offset: 0.01,
    map,
    tints: { impact: 0xffffff },
  });
  if (hit?.face === null || hit?.face === undefined) throw new Error("Fixture hit normal missing");
  expect(
    field.project(receiver, baseGeometryOf(receiver), hit.point, hit.face.normal, "impact", {
      depth: 0.1,
    }),
  ).toBe(true);
  const mark = receiver.children[0];
  if (!(mark instanceof Mesh)) throw new Error("Fixture mark missing");
  const projected = mark.geometry;
  camera.position.z = 0.3;
  camera.updateMatrixWorld(true);
  expect(updateModelLods(root, camera, 540)).toBe(128);
  expect(receiver.geometry).toBe(base);
  expect(mark.geometry).toBe(projected);
  expect(
    picker
      .raycast({
        origin: new Vector3(1, 1, 2),
        direction: new Vector3(0, 0, -1),
        targets: receiver,
        exclude: receiver.children,
      })
      ?.point.toArray(),
  ).toEqual([1, 1, 0]);
  field.dispose();
  map.dispose();
  picker.dispose();
});

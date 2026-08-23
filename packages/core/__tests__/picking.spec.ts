import {
  BoxGeometry,
  type BufferAttribute,
  type Intersection,
  Mesh,
  Object3D,
  PerspectiveCamera,
  PlaneGeometry,
  type Raycaster,
  Sprite,
  SpriteMaterial,
  Vector2,
  Vector3,
} from "three";
import { acceleratedRaycast } from "three-mesh-bvh";
import { describe, expect, it, vi } from "vitest";
import { ScenePicker } from "../src/picking.js";
import { type IViewportSize, Viewport } from "../src/viewport.js";

function renderer(canvas: HTMLCanvasElement) {
  return {
    canvas,
    compileAsync: async () => undefined,
    compute: () => undefined,
    domElement: canvas,
    info: {},
    kind: "webgl2" as const,
    raw: {},
    render: () => undefined,
    renderOverlay: () => undefined,
    setOutputNode: () => undefined,
    setSize: () => undefined,
    dispose: () => undefined,
  };
}

function testCanvas(width = 1280, height = 720): HTMLCanvasElement & { size: IViewportSize } {
  const canvas = new EventTarget() as HTMLCanvasElement & { size: IViewportSize };
  Object.defineProperties(canvas, {
    clientHeight: { configurable: true, get: () => canvas.size.height },
    clientWidth: { configurable: true, get: () => canvas.size.width },
  });
  canvas.size = { aspect: width / height, height, width };
  return canvas;
}

function scenePicker(...contents: Object3D[]) {
  const camera = new PerspectiveCamera(60, 1, 0.1, 100);
  camera.position.z = 5;
  camera.lookAt(0, 0, 0);
  const viewport = new Viewport({ camera, renderer: renderer(testCanvas()) });
  const root = new Mesh();
  for (const child of contents) root.add(child);
  const picker = new ScenePicker({
    camera,
    pointer: () => new Vector2(640, 360),
    scene: root,
    viewport,
  });
  return { camera, picker, root, viewport };
}

/** Subdivided so the hierarchy is more than a single leaf, which is what makes stale bounds observable. */
function plane(name: string, z: number): Mesh {
  const mesh = new Mesh(new PlaneGeometry(2, 2, 32, 32));
  mesh.name = name;
  mesh.position.z = z;
  return mesh;
}

function box(name: string, z: number): Mesh {
  const mesh = new Mesh(new BoxGeometry(2, 2, 2));
  mesh.name = name;
  mesh.position.z = z;
  return mesh;
}

describe("ScenePicker", () => {
  it("returns the nearest hit under the pointer and nothing when the ray misses", () => {
    const near = plane("near", 2);
    const far = plane("far", 0);
    const { picker } = scenePicker(far, near);

    const hit = picker.raycast();
    expect(hit?.object.name).toBe("near");
    expect(hit?.distance).toBeCloseTo(3, 5);

    expect(picker.raycast({ screen: new Vector2(0, 0) })).toBeUndefined();
  });

  it("should return the nearest hit when a farther target is listed first", () => {
    // Passes on the pre-change baseline too — correctness is not the discriminating gate here;
    // paired with the collection test below per PRD-186's negative-control rule.
    const near = box("near", 0);
    const far = box("far", -3);
    const { picker } = scenePicker(far, near);

    const hit = picker.raycast({ origin: new Vector3(0, 0, 5), direction: new Vector3(0, 0, -1) });
    expect(hit?.object.name).toBe("near");
  });

  it("should not collect hits behind the nearest for a single-hit query", () => {
    // The discriminating gate (PRD-186 phase 1): each target's raycast receives its own empty
    // scratch buffer and only one hit per object survives. On the old full-sort path every
    // object wrote into one shared array, so the second target saw the first's hits already
    // collected — red there, green here.
    class MultiHitProbe extends Object3D {
      seen: number[] = [];
      constructor(name: string, z: number) {
        super();
        this.name = name;
        this.position.z = z;
      }
      override raycast(_raycaster: Raycaster, intersects: Intersection[]): void {
        this.seen.push(intersects.length);
        const base = this.position.z === 0 ? 4 : 7;
        for (const distance of [base + 1, base + 2, base + 3]) {
          intersects.push({
            distance,
            object: this,
            point: new Vector3(),
          });
        }
      }
    }
    const near = new MultiHitProbe("near", 0);
    const far = new MultiHitProbe("far", -3);
    const { picker } = scenePicker(far, near);

    const hit = picker.raycast({ origin: new Vector3(0, 0, 5), direction: new Vector3(0, 0, -1) });
    expect(hit?.object.name).toBe("near");
    expect(hit?.distance).toBe(5);
    // One hit kept per object, and no target ever observed another target's hits.
    expect(near.seen).toEqual([0]);
    expect(far.seen).toEqual([0]);
  });

  it("restores the every-hit traversal mode after a single-hit query", () => {
    const seenFlags: boolean[] = [];
    const target = plane("target", 0);
    target.morphTargetInfluences = [0]; // force the stock fallback so we can observe the flag
    const stock = target.raycast.bind(target);
    target.raycast = (raycaster, intersects) => {
      seenFlags.push(raycaster.firstHitOnly === true);
      return stock(raycaster, intersects);
    };
    const { picker } = scenePicker(target);

    expect(picker.raycast()?.object.name).toBe("target");
    expect(seenFlags).toEqual([true]);

    // raycastAll must still see every hit afterwards.
    const hits = picker.raycastAll({
      direction: new Vector3(0, 0, -1),
      origin: new Vector3(0, 0, 5),
    });
    expect(hits.length).toBeGreaterThan(1);
    expect(seenFlags.at(-1)).toBe(false);
  });

  it("takes the accelerated path without patching any three prototype", () => {
    const target = plane("target", 0);
    const { picker } = scenePicker(target);
    const stock = vi.spyOn(target, "raycast");

    expect(picker.raycast()?.object.name).toBe("target");
    expect(stock).not.toHaveBeenCalled();
    expect(Mesh.prototype.raycast).not.toBe(acceleratedRaycast);
  });

  it("falls back to the stock raycast for a morphed mesh", () => {
    const target = plane("morphed", 0);
    target.morphTargetInfluences = [0];
    const { picker } = scenePicker(target);
    const stock = vi.spyOn(target, "raycast");

    expect(picker.raycast()?.object.name).toBe("morphed");
    expect(stock).toHaveBeenCalledTimes(1);
  });

  it("rebuilds the hierarchy when the geometry's positions change", () => {
    const target = plane("moved", 0);
    const position = target.geometry.attributes.position as BufferAttribute;
    for (let index = 0; index < position.count; index += 1)
      position.setX(index, position.getX(index) + 10);
    const { picker } = scenePicker(target);

    expect(picker.raycast()).toBeUndefined();

    for (let index = 0; index < position.count; index += 1)
      position.setX(index, position.getX(index) - 10);
    position.version += 1;

    expect(picker.raycast()?.object.name).toBe("moved");
  });

  it("drops cached hierarchies on dispose and rebuilds them on the next query", () => {
    const target = plane("kept", 0);
    const { picker } = scenePicker(target);

    expect(picker.raycast()?.object.name).toBe("kept");
    picker.dispose();
    expect(picker.raycast()?.object.name).toBe("kept");
  });

  it("rejects a screen point that is not finite", () => {
    const { picker } = scenePicker(plane("target", 0));
    expect(() => picker.raycast({ screen: new Vector2(Number.NaN, 0) })).toThrow(/must be finite/u);
  });

  it("casts a world ray, respects far, and returns all hits near to far", () => {
    const far = box("far", -3);
    const near = box("near", 0);
    far.position.x = 3;
    near.position.x = 3;
    const { picker } = scenePicker(far, near);
    const origin = new Vector3(3, 0, 5);
    const direction = new Vector3(0, 0, -1);

    expect(picker.raycast({ screen: new Vector2(640, 360) })).toBeUndefined();
    expect(picker.raycast({ origin, direction })?.object.name).toBe("near");
    expect(picker.raycast({ origin, direction })?.distance).toBeCloseTo(4, 5);
    expect(picker.raycast({ origin, direction, far: 3.5 })).toBeUndefined();

    const hits = picker.raycastAll({ origin, direction });
    expect(hits.length).toBeGreaterThan(2);
    expect(hits[0]?.object.name).toBe("near");
    expect(hits.at(-1)?.object.name).toBe("far");
    const distances = hits.map((hit) => hit.distance);
    expect(distances).toEqual([...distances].sort((first, second) => first - second));
  });

  it("sets the camera before a world ray reaches a sprite", () => {
    const sprite = new Sprite(new SpriteMaterial());
    sprite.name = "sprite";
    sprite.position.set(2, 0, 0);
    const target = box("target", -3);
    target.position.x = 2;
    const { picker } = scenePicker(sprite, target);

    expect(
      picker.raycast({
        direction: new Vector3(0, 0, -1),
        origin: new Vector3(2, 0, 5),
      })?.object.name,
    ).toBe("sprite");
  });

  it("keeps a previous raycastAll result unchanged after another query", () => {
    const far = box("far", -3);
    const near = box("near", 0);
    const { picker } = scenePicker(far, near);
    const origin = new Vector3(0, 0, 5);
    const direction = new Vector3(0, 0, -1);

    const firstHits = picker.raycastAll({ origin, direction });
    const firstHitNames = firstHits.map((hit) => hit.object.name);

    picker.raycastAll({ origin, direction, targets: near });

    expect(firstHits.map((hit) => hit.object.name)).toEqual(firstHitNames);
  });

  it("excludes a parent and its whole subtree", () => {
    const excludedParent = new Object3D();
    const excludedChild = box("excluded", 0);
    excludedParent.add(excludedChild);
    const included = box("included", -3);
    const { picker } = scenePicker(excludedParent, included);

    const hit = picker.raycast({
      direction: new Vector3(0, 0, -1),
      exclude: excludedParent,
      origin: new Vector3(0, 0, 5),
      targets: excludedChild,
    });
    expect(hit).toBeUndefined();
    expect(
      picker.raycast({
        direction: new Vector3(0, 0, -1),
        exclude: excludedParent,
        origin: new Vector3(0, 0, 5),
        targets: [excludedParent, included],
      })?.object.name,
    ).toBe("included");
  });

  it("rejects ambiguous ray descriptions", () => {
    const { picker } = scenePicker(plane("target", 0));
    expect(() => picker.raycast({ origin: new Vector3(), screen: new Vector2(640, 360) })).toThrow(
      /cannot be combined/u,
    );
    expect(() => picker.raycast({ direction: new Vector3(0, 0, -1) })).toThrow(/requires origin/u);
  });
});

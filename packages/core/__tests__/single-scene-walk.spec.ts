import { type Object3D, PerspectiveCamera, Scene } from "three";
import { describe, expect, it } from "vitest";

import { createRenderer } from "../src/renderer.js";

function testCanvas(): HTMLCanvasElement {
  const canvas = new EventTarget() as EventTarget & Partial<HTMLCanvasElement>;
  Object.defineProperties(canvas, {
    clientHeight: { configurable: true, value: 180 },
    clientWidth: { configurable: true, value: 320 },
    parentElement: { configurable: true, value: null },
  });
  return canvas as HTMLCanvasElement;
}

/**
 * A raw renderer that walks the scene graph exactly as three does — `Renderer.js` runs
 * `if ( scene.matrixWorldAutoUpdate === true ) scene.updateMatrixWorld()` at the top of every
 * `render()` — and can render a second scene out of its own first render, which is what a water
 * surface's mirrored pass does (`ReflectorBaseNode.updateBefore` calls `renderer.render(scene, …)`
 * before the outer render reaches its own walk).
 */
function fakeRaw(canvas: HTMLCanvasElement, options: { nestedScene?: () => Object3D | undefined }) {
  const walks: Object3D[] = [];
  let depth = 0;
  const raw = {
    domElement: canvas,
    render: (scene: Object3D, camera: unknown) => {
      depth += 1;
      try {
        // Three's order: the node-update phase (which a mirrored pass renders from) runs first,
        // and `Renderer.js` walks the graph only after it — so a nested render's walk lands before
        // the outer render's own.
        const nested = depth === 1 ? options.nestedScene?.() : undefined;
        if (nested !== undefined) raw.render(nested, camera);
        if (scene.matrixWorldAutoUpdate === true) {
          walks.push(scene);
          scene.updateMatrixWorld();
        }
      } finally {
        depth -= 1;
      }
    },
    setSize: () => undefined,
  };
  return { raw, walks };
}

describe("one scene-graph walk per frame", () => {
  it("walks once when a scene is rendered again inside its own render", async () => {
    const canvas = testCanvas();
    const scene = new Scene();
    const mirrored = { active: true };
    const { raw, walks } = fakeRaw(canvas, {
      nestedScene: () => (mirrored.active ? scene : undefined),
    });
    const renderer = await createRenderer({
      canvas,
      preferWebGPU: false,
      webgl2Factory: () => raw as never,
    });
    try {
      renderer.render(scene, new PerspectiveCamera());
      // The mirror's nested walk is the frame's walk; the outer render's repeat is skipped.
      expect(walks).toEqual([scene]);
      expect(scene.matrixWorldAutoUpdate).toBe(true);

      // A second frame walks again: the pin lasts one frame, not for the renderer's life.
      mirrored.active = false;
      renderer.render(scene, new PerspectiveCamera());
      expect(walks).toEqual([scene, scene]);
      expect(scene.matrixWorldAutoUpdate).toBe(true);
    } finally {
      renderer.dispose();
    }
  });

  it("walks once for a scene rendered once", async () => {
    const canvas = testCanvas();
    const scene = new Scene();
    const { raw, walks } = fakeRaw(canvas, {});
    const renderer = await createRenderer({
      canvas,
      preferWebGPU: false,
      webgl2Factory: () => raw as never,
    });
    try {
      renderer.render(scene, new PerspectiveCamera());
      expect(walks).toEqual([scene]);
      expect(scene.matrixWorldAutoUpdate).toBe(true);
    } finally {
      renderer.dispose();
    }
  });

  it("walks both scenes when the nested render is a different one", async () => {
    const canvas = testCanvas();
    const outer = new Scene();
    const overlay = new Scene();
    let nested = true;
    const { raw, walks } = fakeRaw(canvas, { nestedScene: () => (nested ? overlay : undefined) });
    const renderer = await createRenderer({
      canvas,
      preferWebGPU: false,
      webgl2Factory: () => raw as never,
    });
    try {
      renderer.render(outer, new PerspectiveCamera());
      // The overlay is a different graph: neither walk is redundant.
      expect(walks).toEqual([overlay, outer]);
      expect(outer.matrixWorldAutoUpdate).toBe(true);
      expect(overlay.matrixWorldAutoUpdate).toBe(true);
      nested = false;
    } finally {
      renderer.dispose();
    }
  });

  it("keeps the scene's own choice when it arrived with auto-update off", async () => {
    const canvas = testCanvas();
    const scene = new Scene();
    scene.matrixWorldAutoUpdate = false;
    const { raw, walks } = fakeRaw(canvas, { nestedScene: () => scene });
    const renderer = await createRenderer({
      canvas,
      preferWebGPU: false,
      webgl2Factory: () => raw as never,
    });
    try {
      renderer.render(scene, new PerspectiveCamera());
      expect(walks).toEqual([]);
      expect(scene.matrixWorldAutoUpdate).toBe(false);
    } finally {
      renderer.dispose();
    }
  });
});

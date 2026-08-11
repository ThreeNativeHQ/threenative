import {
  type Camera,
  Mesh,
  MeshBasicMaterial,
  type Object3D,
  type PerspectiveCamera,
  PlaneGeometry,
  type Scene,
} from "three";
import { palette } from "./palette.js";

/**
 * What the framework hands a loading screen. Structural on purpose: nothing under `src/render/`
 * imports the framework, and `ctx` already satisfies this shape.
 */
export interface LoadingHost {
  readonly camera: Camera;
  readonly scene: Scene;
  readonly renderer: { compileAsync(scene: Scene, camera: Camera): Promise<void> };
  readonly startup: { readonly progress: number; whenReady(): Promise<void> };
}

/**
 * The loading screen, and the reason the game does not start visible.
 *
 * The framework does two things before a scene is worth looking at: every shader is compiled the
 * first time something using it is drawn, and `SceneCollapse` folds the scene in a single frame.
 * On a Pixel 8 that was 2.9 s of a map assembling itself in pieces followed by a 3.5 s freeze.
 *
 * Covering it is not only cosmetic — it is most of the speed-up. Hidden geometry is never drawn,
 * so the shaders for the thousands of meshes the collapse is about to merge away are never
 * compiled at all: launch to a finished picture went from 2,877 ms to 1,051 ms by hiding the world
 * during startup. Then, still behind the screen, the merged geometry's pipelines are built with
 * `compileAsync`, because revealing before that leaves objects drawing solid black for about a
 * second while their shaders compile.
 *
 * Create it **after** the scene is populated: it hides what is in the scene when it is made.
 *
 * ```ts
 * const loading = createLoadingScreen(ctx);   // after the world is built
 * // ...inside the frame function:
 * loading.update();
 * ```
 *
 * This is yours. Colours, layout and the shape of the bar are here, in your source, and deleting
 * the file is a supported way to opt out.
 */
export function createLoadingScreen(host: LoadingHost) {
  const camera = host.camera as PerspectiveCamera;
  const cover = (color: number) =>
    new Mesh(
      new PlaneGeometry(1, 1),
      // Transparent at full opacity rather than opaque: a HUD built from transparent materials is
      // drawn after every opaque object whatever its render order, so an opaque backdrop lets the
      // score float over the loading screen. This sorts alongside them and wins on render order.
      new MeshBasicMaterial({
        color,
        depthTest: false,
        depthWrite: false,
        opacity: 1,
        transparent: true,
      }),
    );
  const backdrop = cover(palette.skyLow);
  const track = cover(palette.skyHigh);
  const fill = cover(palette.accent);
  const parts = [backdrop, track, fill];

  // Everything already parented to the camera — HUD, touch controls — goes dark too. Render order
  // alone could not be trusted to cover them, and a progress bar with a score and a joystick
  // floating on top of it reads as a bug rather than as loading.
  const hidden = new Map<Object3D, boolean>();
  for (const child of camera.children) {
    hidden.set(child, child.visible);
    child.visible = false;
  }
  for (const mesh of parts) {
    mesh.frustumCulled = false;
    mesh.renderOrder = 20_000;
    camera.add(mesh);
  }
  // The scene is hidden per child rather than wholesale: the camera is parented into it, and
  // hiding the scene would hide this screen along with it.
  for (const child of host.scene.children) {
    if (child === camera) continue;
    hidden.set(child, child.visible);
    child.visible = false;
  }

  // Sized in world units one unit in front of the camera, which beats pixels and survives any
  // viewport. The backdrop is over-sized so no aspect ratio can uncover an edge.
  const distance = 1;
  const height = Math.tan((camera.fov * Math.PI) / 360) * distance * 2;
  const width = height * 4;
  backdrop.scale.set(width * 2, height * 2, 1);
  backdrop.position.set(0, 0, -distance);
  track.scale.set(width * 0.5, height * 0.012, 1);
  track.position.set(0, -height * 0.05, -distance * 0.999);
  fill.position.set(0, -height * 0.05, -distance * 0.998);

  // Sizing the bar is one function called before the first frame, not only from `update()`. A
  // `PlaneGeometry(1, 1)` left at its default scale is a full world unit square — about seventy
  // times the height of the bar — so a screen that renders before the first update flashes a green
  // square across the middle. Observed on a Pixel 8.
  const setProgress = (progress: number): void => {
    const clamped = Math.max(0, Math.min(1, progress));
    const full = width * 0.5;
    // Scaled from the left edge rather than the centre, so the bar fills instead of growing.
    fill.scale.set(Math.max(full * 0.002, full * clamped), height * 0.012, 1);
    fill.position.x = -full / 2 + (full * clamped) / 2;
  };
  setProgress(0);

  let done = false;
  const finish = (): void => {
    if (done) return;
    done = true;
    for (const [child, visible] of hidden) child.visible = visible;
    // Hidden, never removed. By now `SceneCollapse` has folded these three quads into a merged
    // camera draw, so removing them from the camera leaves the merged copy on screen and the
    // player stares at a full progress bar forever. The collapse honours each part's `visible`.
    for (const mesh of parts) mesh.visible = false;
  };

  void (async () => {
    await host.startup.whenReady();
    // Build the collapsed scene's pipelines while the screen still covers it. Without this the
    // world appears and then several objects render solid black for about a second.
    await host.renderer.compileAsync(host.scene, host.camera).catch(() => undefined);
    finish();
  })();

  return {
    /** Call once per frame. Fills the bar, then holds while the collapse bakes. */
    update(): void {
      if (done) return;
      setProgress(host.startup.progress);
    },
    /** Reveals the world early. The screen takes itself down without this. */
    finish,
  };
}
